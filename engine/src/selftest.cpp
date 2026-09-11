// Offline checks for the type and strategy layers, run with --self-test.
// Kept as a build target so a refactor that breaks crossover semantics fails
// loudly instead of quietly trading differently from the Node engine.
#include <cstdio>
#include <memory>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "EMAStrategy.h"
#include "Strategy.h"
#include "types.h"

namespace {

int failures = 0;

void check(bool ok, const std::string& what) {
  std::printf("  %s  %s\n", ok ? "PASS" : "FAIL", what.c_str());
  if (!ok) ++failures;
}

/** A realistic frame, exactly the shape Node will push in Step 6. */
const char* kFrame = R"({
  "candle": {
    "symbol": "BTCUSDT", "interval": "1m", "open_time": 1788725400000,
    "open": "79776.60000000", "high": "79810.00000000", "low": "79770.10000000",
    "close": "79802.45000000", "volume": "12.48310000"
  },
  "indicators": {
    "ema9": 79795.12345678, "ema21": 79781.4, "sma20": 79788.0,
    "rsi14": 61.2, "macd": 12.5, "macdSignal": 10.1,
    "bbUpper": 79900.0, "bbLower": 79700.0,
    "atr14": null, "stochK": null
  }
})";

void testParsing() {
  std::printf("\n-- parsing --\n");
  const auto j = nlohmann::json::parse(kFrame);

  engine::Candle candle;
  engine::from_json(j.at("candle"), candle);
  engine::Indicators ind;
  engine::from_json(j.at("indicators"), ind);

  check(candle.symbol == "BTCUSDT", "symbol");
  check(candle.timestamp == 1788725400000LL, "timestamp is int64 ms");
  check(candle.close > 79802.4 && candle.close < 79802.5, "close parsed from string");
  check(candle.closeRaw == "79802.45000000", "closeRaw kept byte-for-byte");

  check(ind.rsi.has_value() && *ind.rsi == 61.2, "rsi14 -> rsi");
  check(ind.signal.has_value() && *ind.signal == 10.1, "macdSignal -> signal");
  check(ind.upperBand.has_value() && *ind.upperBand == 79900.0, "bbUpper -> upperBand");
  check(ind.sma20.has_value(), "sma20");
}

void testWarmupIsNotZero() {
  std::printf("\n-- warmup --\n");
  const auto j = nlohmann::json::parse(kFrame);
  engine::Indicators ind;
  engine::from_json(j.at("indicators"), ind);

  check(!ind.value("atr14").has_value(), "null indicator stays empty, not 0");
  check(!ind.value("nope").has_value(), "unknown key is empty");
  check(ind.value("ema9").has_value(), "configurable period found via extra");
  check(ind.value("ema21").value_or(0.0) == 79781.4, "ema21 value");
}

void testCrossover() {
  std::printf("\n-- crossover --\n");
  std::unique_ptr<engine::Strategy> strategy = std::make_unique<engine::EMAStrategy>(9, 21);

  check(strategy->name() == "EMA 9/21 Crossover", "name");
  check(strategy->requiredIndicators() == std::vector<std::string>{"ema9", "ema21"}, "requires");

  // {fast, slow, present} -> expected action
  struct Step { double fast; double slow; bool present; const char* expect; const char* why; };
  const std::vector<Step> steps = {
      {0, 0, false, "HOLD", "warmup: no values"},
      {0, 0, false, "HOLD", "warmup again"},
      {10, 20, true, "HOLD", "first real observation only sets the side"},
      {12, 20, true, "HOLD", "still below"},
      {25, 20, true, "BUY",  "crossed above"},
      {26, 20, true, "HOLD", "still above, not a new cross"},
      {20, 20, true, "HOLD", "exactly equal carries no direction"},
      {27, 20, true, "HOLD", "separated the way it came - not a cross"},
      {15, 20, true, "SELL", "crossed below"},
      {14, 20, true, "HOLD", "still below"},
  };

  engine::Candle candle;
  candle.symbol = "BTCUSDT";
  candle.closeRaw = "79802.45000000";
  candle.timestamp = 1788725400000LL;

  for (std::size_t i = 0; i < steps.size(); ++i) {
    const auto& step = steps[i];
    engine::Indicators ind;
    if (step.present) {
      ind.extra.emplace("ema9", step.fast);
      ind.extra.emplace("ema21", step.slow);
    }

    const engine::TradeSignal signal = strategy->onCandle(candle, ind);
    const std::string got{engine::toString(signal.action)};
    check(got == step.expect,
          std::to_string(i) + ": " + step.why + " -> " + got);
  }

  // A HOLD still carries the price and symbol, so Node can mark positions.
  engine::Indicators empty;
  const auto held = strategy->onCandle(candle, empty);
  check(held.price == "79802.45000000", "HOLD echoes the exact price string");
  check(!held.isActionable(), "HOLD is not actionable");

  strategy->reset();
  engine::Indicators after;
  after.extra.emplace("ema9", 25.0);
  after.extra.emplace("ema21", 20.0);
  check(strategy->onCandle(candle, after).action == engine::Action::Hold,
        "after reset, the first observation cannot be a cross");
}

void testSerialization() {
  std::printf("\n-- serialization --\n");
  engine::Candle candle;
  candle.symbol = "BTCUSDT";
  candle.closeRaw = "79802.45000000";
  candle.timestamp = 1788725400000LL;

  engine::TradeSignal signal = engine::TradeSignal::hold(candle, "EMA 9/21 Crossover");
  signal.action = engine::Action::Buy;

  const nlohmann::json j = signal;
  std::printf("  %s\n", j.dump().c_str());

  check(j.at("action") == "BUY", "action");
  check(j.at("price") == "79802.45000000", "price stays a string on the wire");
  check(j.at("timestamp") == 1788725400000LL, "timestamp");
}

}  // namespace

namespace engine {

int runSelfTest() {
  std::printf("engine self-test\n");
  testParsing();
  testWarmupIsNotZero();
  testCrossover();
  testSerialization();
  std::printf("\n%s (%d failure%s)\n", failures == 0 ? "ALL PASS" : "FAILURES",
              failures, failures == 1 ? "" : "s");
  return failures == 0 ? 0 : 1;
}

}  // namespace engine
