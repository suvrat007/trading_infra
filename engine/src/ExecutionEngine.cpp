#include "ExecutionEngine.h"

#include <algorithm>
#include <cstdio>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>

#include <nlohmann/json.hpp>
#include <zmq.hpp>

namespace engine {
namespace {

constexpr const char* kLog = "[engine]";

/** Nearest-rank percentile. Interpolation buys nothing at these sample counts. */
std::int64_t nearestRank(const std::vector<std::int64_t>& sorted, double p) {
  if (sorted.empty()) return 0;
  const auto n = static_cast<double>(sorted.size());
  auto index = static_cast<std::size_t>(p * n);
  if (index >= sorted.size()) index = sorted.size() - 1;
  return sorted[index];
}

}  // namespace

// ---------------------------------------------------------------------------

std::int64_t epochMicros() noexcept {
  using namespace std::chrono;
  return duration_cast<microseconds>(system_clock::now().time_since_epoch()).count();
}

// ---------------------------------------------------------------------------
// LatencyStats
// ---------------------------------------------------------------------------

void LatencyStats::add(std::int64_t micros) {
  if (count_ == 0) {
    min_ = micros;
    max_ = micros;
  } else {
    min_ = std::min(min_, micros);
    max_ = std::max(max_, micros);
  }

  total_ += static_cast<double>(micros);
  ++count_;

  // Ring buffer: percentiles cover the most recent `capacity_` samples and
  // memory never grows. min/max/mean above stay lifetime figures.
  if (samples_.size() < capacity_) {
    samples_.push_back(micros);
  } else {
    samples_[next_] = micros;
    next_ = (next_ + 1) % capacity_;
  }
}

double LatencyStats::mean() const noexcept {
  if (count_ == 0) return 0.0;
  return total_ / static_cast<double>(count_);
}

std::int64_t LatencyStats::percentile(double p) const {
  std::vector<std::int64_t> sorted = samples_;
  std::sort(sorted.begin(), sorted.end());
  return nearestRank(sorted, p);
}

std::string LatencyStats::summary(const std::string& label) const {
  std::ostringstream out;
  if (count_ == 0) {
    out << label << ": no samples";
    return out.str();
  }

  std::vector<std::int64_t> sorted = samples_;
  std::sort(sorted.begin(), sorted.end());

  out.setf(std::ios::fixed);
  out.precision(1);
  out << label << " n=" << count_
      << "  min=" << min_
      << "  p50=" << nearestRank(sorted, 0.50)
      << "  p95=" << nearestRank(sorted, 0.95)
      << "  p99=" << nearestRank(sorted, 0.99)
      << "  max=" << max_
      << "  mean=" << mean() << " us";
  return out.str();
}

// ---------------------------------------------------------------------------
// ExecutionEngine
// ---------------------------------------------------------------------------

/**
 * ZeroMQ types live here rather than in the header, so including
 * ExecutionEngine.h does not drag zmq.hpp into every translation unit.
 */
struct ExecutionEngine::Sockets {
  zmq::context_t context;
  zmq::socket_t inbound;
  zmq::socket_t outbound;

  explicit Sockets(int ioThreads)
      : context(ioThreads),
        inbound(context, zmq::socket_type::pull),
        outbound(context, zmq::socket_type::push) {}
};

ExecutionEngine::ExecutionEngine(EngineConfig config, std::unique_ptr<Strategy> strategy)
    : config_(std::move(config)), strategy_(std::move(strategy)) {
  if (!strategy_) throw std::invalid_argument("ExecutionEngine requires a strategy");

  // One I/O thread. ZeroMQ does the socket work on a background pool; one
  // thread saturates well past a gigabit, and this system moves a few hundred
  // bytes a minute.
  sockets_ = std::make_unique<Sockets>(1);

  sockets_->inbound.set(zmq::sockopt::rcvhwm, config_.highWaterMark);
  sockets_->inbound.set(zmq::sockopt::rcvtimeo,
                        static_cast<int>(config_.pollTimeout.count()));

  sockets_->outbound.set(zmq::sockopt::sndhwm, config_.highWaterMark);
  sockets_->outbound.set(zmq::sockopt::sndtimeo,
                         static_cast<int>(config_.sendTimeout.count()));

  // Do not wait on shutdown for messages nobody is collecting; the default is
  // to block forever in the context destructor.
  sockets_->outbound.set(zmq::sockopt::linger, 0);
  sockets_->inbound.set(zmq::sockopt::linger, 0);

  if (config_.bind) {
    sockets_->inbound.bind(config_.inboundEndpoint);
    sockets_->outbound.bind(config_.outboundEndpoint);
  } else {
    sockets_->inbound.connect(config_.inboundEndpoint);
    sockets_->outbound.connect(config_.outboundEndpoint);
  }

  std::printf("%s strategy   : %s\n", kLog, strategy_->name().c_str());
  std::printf("%s indicators :", kLog);
  for (const auto& key : strategy_->requiredIndicators()) {
    std::printf(" %s", key.c_str());
  }
  std::printf("\n%s inbound    : PULL %s %s\n", kLog,
              config_.bind ? "bind   " : "connect", config_.inboundEndpoint.c_str());
  std::printf("%s outbound   : PUSH %s %s\n", kLog,
              config_.bind ? "bind   " : "connect", config_.outboundEndpoint.c_str());
}

ExecutionEngine::~ExecutionEngine() = default;

void ExecutionEngine::run() {
  running_.store(true, std::memory_order_relaxed);
  std::printf("%s running. ctrl+c to stop.\n", kLog);

  while (running_.load(std::memory_order_relaxed)) {
    zmq::message_t message;

    // Blocks up to pollTimeout. An empty result means the timeout elapsed,
    // which is this loop's chance to notice the stop flag.
    const auto received = sockets_->inbound.recv(message, zmq::recv_flags::none);

    // Clock starts the instant the bytes are in hand, before any parsing, so
    // the measurement covers everything the engine is responsible for.
    const auto arrivedAt = std::chrono::steady_clock::now();

    if (!received.has_value()) continue;

    handleFrame(message.to_string(), arrivedAt);
  }

  std::printf("%s stopped after %llu candle(s)\n", kLog,
              static_cast<unsigned long long>(candlesSeen_));
}

void ExecutionEngine::handleFrame(const std::string& payload,
                                  std::chrono::steady_clock::time_point received) {
  using clock = std::chrono::steady_clock;

  Candle candle;
  Indicators indicators;
  std::int64_t sentAtUs = 0;

  // A malformed frame must not take the process down. Node is the only sender,
  // but "the only sender" is an assumption, and an unhandled parse throw here
  // would kill the engine and halt all trading.
  try {
    const auto json = nlohmann::json::parse(payload);
    from_json(json.at("candle"), candle);
    if (json.contains("indicators")) from_json(json.at("indicators"), indicators);
    sentAtUs = json.value("sent_at_us", static_cast<std::int64_t>(0));
  } catch (const std::exception& err) {
    ++malformed_;
    std::printf("%s malformed frame (%llu total): %s\n", kLog,
                static_cast<unsigned long long>(malformed_), err.what());
    return;
  }

  ++candlesSeen_;

  // A wall-clock difference across two processes. Both read the same system
  // clock, so this is meaningful on one machine and meaningless across two
  // whose clocks are not disciplined together.
  if (sentAtUs > 0) {
    const std::int64_t transport = epochMicros() - sentAtUs;
    if (transport >= 0) transportUs_.add(transport);
  }

  const auto strategyStart = clock::now();
  const TradeSignal signal = strategy_->onCandle(candle, indicators);
  const auto strategyEnd = clock::now();

  // Nanoseconds, not microseconds. A crossover check is two map lookups and a
  // comparison; at microsecond resolution it reports 0 or 1 and the number says
  // nothing. This is the figure Phase 5 exists to move into C++, so it is the
  // one that has to be measurable.
  const std::int64_t strategyNs =
      std::chrono::duration_cast<std::chrono::nanoseconds>(strategyEnd - strategyStart).count();

  strategyUs_.add(strategyNs / 1000);

  if (!signal.isActionable() && !config_.publishHolds) return;

  nlohmann::json out = signal;
  out["candle_time"] = candle.timestamp;
  out["strategy_ns"] = strategyNs;
  out["engine_sent_at_us"] = epochMicros();

  // What the engine is accountable for: bytes in to bytes out. Taken before
  // send() so a blocked consumer is not charged to the strategy.
  const std::int64_t engineUs =
      std::chrono::duration_cast<std::chrono::microseconds>(clock::now() - received).count();
  out["engine_latency_us"] = engineUs;
  engineUs_.add(engineUs);

  const std::string encoded = out.dump();

  try {
    const auto sent = sockets_->outbound.send(zmq::buffer(encoded), zmq::send_flags::none);
    if (!sent.has_value()) {
      std::printf("%s send timed out - is Node listening on %s?\n", kLog,
                  config_.outboundEndpoint.c_str());
      return;
    }
  } catch (const zmq::error_t& err) {
    std::printf("%s send failed: %s\n", kLog, err.what());
    return;
  }

  ++signalsEmitted_;

  if (signal.isActionable() || config_.verbose) {
    const std::string action{toString(signal.action)};
    std::printf("%s %-4s %s @ %s  t=%lld  %lld us\n", kLog, action.c_str(),
                candle.symbol.c_str(), signal.price.c_str(),
                static_cast<long long>(candle.timestamp),
                static_cast<long long>(engineUs));
  }
}

void ExecutionEngine::printReport() const {
  std::printf("\n%s ---- latency report ----\n", kLog);
  std::printf("%s candles=%llu  signals=%llu  malformed=%llu\n", kLog,
              static_cast<unsigned long long>(candlesSeen_),
              static_cast<unsigned long long>(signalsEmitted_),
              static_cast<unsigned long long>(malformed_));
  std::printf("%s %s\n", kLog, strategyUs_.summary("strategy ").c_str());
  std::printf("%s %s\n", kLog, engineUs_.summary("engine   ").c_str());
  std::printf("%s %s\n", kLog, transportUs_.summary("transport").c_str());
}

}  // namespace engine
