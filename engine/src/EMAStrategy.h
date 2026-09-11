#pragma once

#include <stdexcept>
#include <string>
#include <vector>

#include "Strategy.h"

namespace engine {

/**
 * EMA crossover - the C++ port of strategies/EMAStrategy.js.
 *
 *   fast crosses ABOVE slow -> BUY   (the "golden cross")
 *   fast crosses BELOW slow -> SELL  (the "death cross")
 *
 * Behaviour is deliberately identical to the JavaScript version, down to the
 * warmup rule and the equality case, because Phase 7 compares their latency.
 * A benchmark between two implementations that disagree about WHAT to compute
 * measures nothing.
 *
 * Worth knowing what this strategy is and is not: crossovers lag by
 * construction, because a moving average is a function of the past. They do
 * well in trends and badly in ranges, where price oscillates across the average
 * and produces a stream of losing round trips. That is a property of the
 * strategy, not a defect in the port.
 */
class EMAStrategy final : public Strategy {
 public:
  EMAStrategy(int fastPeriod = 9, int slowPeriod = 21)
      : Strategy("EMA " + std::to_string(fastPeriod) + "/" + std::to_string(slowPeriod) +
                 " Crossover"),
        fastKey_("ema" + std::to_string(fastPeriod)),
        slowKey_("ema" + std::to_string(slowPeriod)) {
    if (fastPeriod <= 0 || slowPeriod <= 0) {
      throw std::invalid_argument("EMAStrategy: periods must be positive");
    }
    if (fastPeriod >= slowPeriod) {
      throw std::invalid_argument("EMAStrategy: fastPeriod must be less than slowPeriod");
    }
  }

  [[nodiscard]] std::vector<std::string> requiredIndicators() const override {
    return {fastKey_, slowKey_};
  }

  TradeSignal onCandle(const Candle& candle, const Indicators& indicators) override {
    const auto fast = indicators.value(fastKey_);
    const auto slow = indicators.value(slowKey_);

    // Warmup, or the engine failed this candle. Crucially this does NOT advance
    // the tracker: feeding a missing value as 0 would read as "fast is far
    // below slow" and fire a spurious BUY the moment a real value arrived.
    if (!fast || !slow) return hold(candle);

    switch (cross_.update(*fast, *slow)) {
      case CrossTracker::Cross::Up:   return emit(Action::Buy, candle);
      case CrossTracker::Cross::Down: return emit(Action::Sell, candle);
      case CrossTracker::Cross::None: break;
    }

    return hold(candle);
  }

  void reset() override { cross_.reset(); }

 private:
  // Resolved once in the constructor rather than formatted per candle: this is
  // the hot path, and building two strings per candle to look up two doubles
  // would be the single most expensive thing the strategy does.
  std::string fastKey_;
  std::string slowKey_;

  CrossTracker cross_;
};

}  // namespace engine
