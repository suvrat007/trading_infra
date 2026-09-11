#pragma once

#include <string>
#include <string_view>
#include <vector>

#include "types.h"

namespace engine {

/**
 * Abstract base for every strategy. The C++ half of the same contract Node's
 * Strategy.js defines.
 *
 * Where JavaScript has to fake "abstract" with a runtime `new.target` guard and
 * an onCandle() that throws, C++ enforces it at COMPILE time: a pure virtual
 * makes the class impossible to instantiate, and forgetting to override it is a
 * build error rather than a strategy that silently never signals.
 *
 * The cost is a vtable. Each call to onCandle() through a Strategy* is an
 * indirect jump the compiler cannot inline: load the vptr, index the vtable,
 * call through the pointer. That is roughly one extra cache-line touch and a
 * mispredictable branch - a few nanoseconds. At one candle per minute it is
 * free; the design is worth far more than the cycles. In a per-tick hot loop
 * you would reach for a template or std::variant instead, and the cost of that
 * choice is losing runtime strategy swapping.
 *
 * The virtual destructor is not optional. The engine owns strategies through
 * std::unique_ptr<Strategy>; without it, deleting through the base pointer is
 * undefined behaviour and the derived destructor never runs.
 */
class Strategy {
 public:
  explicit Strategy(std::string name) : name_(std::move(name)) {}

  Strategy(const Strategy&) = delete;
  Strategy& operator=(const Strategy&) = delete;
  Strategy(Strategy&&) = delete;
  Strategy& operator=(Strategy&&) = delete;

  virtual ~Strategy() = default;

  /**
   * Called once per CLOSED candle. Returns HOLD on almost every one.
   *
   * Not const: a crossover is defined by two consecutive observations, so a
   * strategy is inherently stateful and this call mutates it.
   */
  virtual TradeSignal onCandle(const Candle& candle, const Indicators& indicators) = 0;

  /**
   * Wire names this strategy reads.
   *
   * Declared rather than discovered, so the engine can verify at STARTUP that
   * the incoming payload will carry them, instead of finding out via a strategy
   * that never fires.
   */
  [[nodiscard]] virtual std::vector<std::string> requiredIndicators() const { return {}; }

  /** Forget accumulated state - on a strategy swap, or after a stream gap. */
  virtual void reset() {}

  [[nodiscard]] const std::string& name() const noexcept { return name_; }

 protected:
  /** Convenience for subclasses: a HOLD tagged with this strategy's name. */
  [[nodiscard]] TradeSignal hold(const Candle& candle) const {
    return TradeSignal::hold(candle, name_);
  }

  [[nodiscard]] TradeSignal emit(Action action, const Candle& candle) const {
    TradeSignal signal = hold(candle);
    signal.action = action;
    return signal;
  }

 private:
  std::string name_;
};

// ---------------------------------------------------------------------------

/**
 * Detects when one series crosses another. Ported from utils/strategies/cross.js
 * with identical semantics, so the two engines cannot disagree about what a
 * cross is.
 */
class CrossTracker {
 public:
  enum class Cross { None, Up, Down };

  Cross update(double a, double b) noexcept {
    // Exactly equal carries no direction. Leaving the previous side intact
    // matters: if the lines touch and separate the way they came, that is not a
    // cross, and treating equality as a side would manufacture two signals.
    if (a == b) return Cross::None;

    const bool isAbove = a > b;
    const bool hadPrevious = hasPrevious_;
    const bool wasAbove = previousAbove_;

    previousAbove_ = isAbove;
    hasPrevious_ = true;

    if (!hadPrevious) return Cross::None;      // first observation sets the side
    if (isAbove == wasAbove) return Cross::None;

    return isAbove ? Cross::Up : Cross::Down;
  }

  void reset() noexcept {
    hasPrevious_ = false;
    previousAbove_ = false;
  }

  [[nodiscard]] bool hasPrevious() const noexcept { return hasPrevious_; }

 private:
  // Two bools rather than std::optional<bool>: the "nothing seen yet" state has
  // to be distinct from "was below", and conflating them fires a false signal
  // on the very first candle.
  bool hasPrevious_ = false;
  bool previousAbove_ = false;
};

}
