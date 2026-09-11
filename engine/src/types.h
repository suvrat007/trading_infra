#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>

#include <nlohmann/json.hpp>

namespace engine {

// ---------------------------------------------------------------------------
// Candle
// ---------------------------------------------------------------------------

/**
 * One closed candle, as pushed by Node.
 *
 * Prices appear TWICE and that is the point. Node keeps them as decimal strings
 * end to end (Binance -> NUMERIC(18,8) -> the broker's scaled BigInt) precisely
 * so no rounding ever enters the money path. A strategy needs to compare
 * numbers, so it gets doubles; but the price echoed back on a signal is the
 * ORIGINAL STRING, byte for byte. The engine therefore never becomes a place
 * where a price silently changes value.
 */
struct Candle {
  std::string symbol;
  std::string interval;

  double open = 0.0;
  double high = 0.0;
  double low = 0.0;
  double close = 0.0;
  double volume = 0.0;

  /** Exactly what arrived on the wire. Echoed, never recomputed. */
  std::string closeRaw;

  /** Candle open time, epoch milliseconds — the same key Node uses. */
  std::int64_t timestamp = 0;
};

// ---------------------------------------------------------------------------
// Indicators
// ---------------------------------------------------------------------------

/**
 * Indicator values for one candle.
 *
 * `std::optional` rather than double, because "not computed yet" is a normal
 * state, not an error: SMA(20) has no value for the first 19 candles. A plain
 * double would force a sentinel like 0 or NaN, and 0 is a catastrophic sentinel
 * for a crossover strategy — it would read as "fast is below slow" and fire a
 * spurious BUY on the first real value.
 *
 * The named members are the seven the spec calls for, mapped from Node's wire
 * names (rsi14 -> rsi, macdSignal -> signal, bbUpper -> upperBand,
 * bbLower -> lowerBand).
 *
 * `extra` holds every other key Node sends, addressed by wire name. It exists
 * because strategy periods are configurable: EMAStrategy(9, 21) needs `ema9`
 * and `ema21`, which are not fields on any fixed struct. Named members stay for
 * the common case (no hashing, no allocation); `value()` falls through to the
 * map for the rest.
 */
struct Indicators {
  std::optional<double> sma20;
  std::optional<double> ema20;
  std::optional<double> rsi;
  std::optional<double> macd;
  std::optional<double> signal;
  std::optional<double> upperBand;
  std::optional<double> lowerBand;

  std::unordered_map<std::string, double> extra;

  /** Look one up by Node's wire name. Empty means warming up or absent. */
  [[nodiscard]] std::optional<double> value(std::string_view key) const;

  /** True if every listed wire name has a finite value. */
  [[nodiscard]] bool has(std::string_view key) const { return value(key).has_value(); }
};

// ---------------------------------------------------------------------------
// TradeSignal
// ---------------------------------------------------------------------------

/**
 * HOLD is a first-class value, not an absence.
 *
 * Node's strategies return null on the ~99% of candles with nothing to say. Over
 * a socket, sending nothing is indistinguishable from a crash, a dropped
 * message or a hung strategy. Emitting HOLD every candle makes silence
 * diagnostic: if Node stops seeing frames, something is genuinely wrong.
 */
enum class Action { Hold, Buy, Sell };

[[nodiscard]] std::string_view toString(Action action) noexcept;

struct TradeSignal {
  Action action = Action::Hold;

  /** The exact decimal string from the candle. See Candle::closeRaw. */
  std::string price;

  std::int64_t timestamp = 0;
  std::string strategyName;

  /** Not in the original spec, but the broker is keyed by symbol. */
  std::string symbol;

  [[nodiscard]] bool isActionable() const noexcept { return action != Action::Hold; }

  static TradeSignal hold(const Candle& candle, std::string strategyName);
};

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

/** Parses one inbound frame: {"candle": {...}, "indicators": {...}}. */
void from_json(const nlohmann::json& j, Candle& candle);
void from_json(const nlohmann::json& j, Indicators& indicators);

void to_json(nlohmann::json& j, const TradeSignal& signal);

}  // namespace engine
