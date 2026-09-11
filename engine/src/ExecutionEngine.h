#pragma once

#include <atomic>
#include <chrono>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "Strategy.h"
#include "types.h"

namespace engine {

// ---------------------------------------------------------------------------

struct EngineConfig {
  /** Node PUSHes candles here; the engine PULLs. */
  std::string inboundEndpoint = "tcp://127.0.0.1:5555";

  /** The engine PUSHes signals here; Node PULLs. */
  std::string outboundEndpoint = "tcp://127.0.0.1:5556";

  /**
   * The engine binds both endpoints; Node connects to both.
   *
   * Either side may bind in ZeroMQ - that is one of its selling points. The
   * engine binds because it is the fixed address in this system: Node restarts
   * during development far more often, and a connecting peer reconnects on its
   * own, whereas a binding peer coming back has to reclaim the port.
   */
  bool bind = true;

  /**
   * How long a blocking recv waits before returning empty.
   *
   * This is NOT latency - a waiting recv wakes the instant a message lands. It
   * only bounds how long shutdown takes after Ctrl+C, since the loop can check
   * its stop flag once per timeout.
   */
  std::chrono::milliseconds pollTimeout{200};

  /**
   * Refuse to block forever when Node is not listening.
   *
   * A PUSH socket with no peer QUEUES rather than errors, and blocks once the
   * queue is full. Without this the engine would freeze mid-loop and stop
   * reading candles - failing silently in the worst possible way.
   */
  std::chrono::milliseconds sendTimeout{1000};

  /** Bound on queued messages per socket, in messages. */
  int highWaterMark = 1000;

  /** Log every candle, not just actionable signals. */
  bool verbose = false;

  /** Emit HOLD frames. Off makes the wire quiet; on makes silence diagnostic. */
  bool publishHolds = true;
};

// ---------------------------------------------------------------------------

/**
 * Rolling latency samples in microseconds.
 *
 * Percentiles rather than an average, because an average hides exactly what
 * matters here. A mean of 40us can be 40us every time, or 20us with one 12ms
 * stall - and the second is a bug. p99 is where a stall shows up.
 */
class LatencyStats {
 public:
  explicit LatencyStats(std::size_t capacity = 100000) : capacity_(capacity) {
    samples_.reserve(capacity);
  }

  void add(std::int64_t micros);

  [[nodiscard]] std::size_t count() const noexcept { return count_; }
  [[nodiscard]] std::int64_t min() const noexcept { return min_; }
  [[nodiscard]] std::int64_t max() const noexcept { return max_; }
  [[nodiscard]] double mean() const noexcept;

  /** `p` in [0, 1]. Sorts a copy, so call it off the hot path. */
  [[nodiscard]] std::int64_t percentile(double p) const;

  [[nodiscard]] std::string summary(const std::string& label) const;

 private:
  std::size_t capacity_;
  std::vector<std::int64_t> samples_;
  std::size_t next_ = 0;             // ring position once capacity is reached
  std::size_t count_ = 0;
  std::int64_t min_ = 0;
  std::int64_t max_ = 0;
  double total_ = 0.0;
};

// ---------------------------------------------------------------------------

/**
 * The process: pull a candle, run the strategy, push a signal, record how long
 * that took.
 *
 * Single-threaded on purpose. A worker pool would let two candles be processed
 * concurrently, but a crossover strategy is order-dependent state - processing
 * candle N+1 before N corrupts it. One candle per minute per symbol does not
 * need parallelism; correctness does need ordering.
 */
class ExecutionEngine {
 public:
  ExecutionEngine(EngineConfig config, std::unique_ptr<Strategy> strategy);
  ~ExecutionEngine();

  ExecutionEngine(const ExecutionEngine&) = delete;
  ExecutionEngine& operator=(const ExecutionEngine&) = delete;

  /** Blocks until stop() is called. */
  void run();

  /** Safe from a signal handler: sets an atomic flag the loop polls. */
  void stop() noexcept { running_.store(false, std::memory_order_relaxed); }

  [[nodiscard]] const LatencyStats& engineLatency() const noexcept { return engineUs_; }
  [[nodiscard]] const LatencyStats& strategyLatency() const noexcept { return strategyUs_; }
  [[nodiscard]] const LatencyStats& transportLatency() const noexcept { return transportUs_; }

  void printReport() const;

 private:
  // Hidden so zmq.hpp does not leak into every file that includes this header.
  struct Sockets;

  void handleFrame(const std::string& payload, std::chrono::steady_clock::time_point received);

  EngineConfig config_;
  std::unique_ptr<Strategy> strategy_;
  std::unique_ptr<Sockets> sockets_;

  std::atomic<bool> running_{false};

  std::uint64_t candlesSeen_ = 0;
  std::uint64_t signalsEmitted_ = 0;
  std::uint64_t malformed_ = 0;

  LatencyStats engineUs_;      // recv -> send, everything the engine controls
  LatencyStats strategyUs_;    // onCandle() alone
  LatencyStats transportUs_;   // Node's send timestamp -> engine recv
};

/** Unix epoch microseconds, comparable with Node's performance.timeOrigin. */
[[nodiscard]] std::int64_t epochMicros() noexcept;

}  // namespace engine
