#include "types.h"

#include <cmath>
#include <string>
#include <utility>

namespace engine {
namespace {

/**
 * Node sends prices as decimal STRINGS and indicator values as numbers, so
 * every numeric field has to accept both. Anything else - null, absent, a
 * malformed string - yields nothing rather than a silent zero.
 */
std::optional<double> readNumber(const nlohmann::json& j, const char* key) {
  const auto it = j.find(key);
  if (it == j.end() || it->is_null()) return std::nullopt;

  if (it->is_number()) {
    const double value = it->get<double>();
    return std::isfinite(value) ? std::optional<double>{value} : std::nullopt;
  }

  if (it->is_string()) {
    try {
      const double value = std::stod(it->get<std::string>());
      return std::isfinite(value) ? std::optional<double>{value} : std::nullopt;
    } catch (const std::exception&) {
      return std::nullopt;
    }
  }

  return std::nullopt;
}

std::string readString(const nlohmann::json& j, const char* key) {
  const auto it = j.find(key);
  if (it == j.end() || it->is_null()) return {};
  if (it->is_string()) return it->get<std::string>();
  return it->dump();
}

/** Wire name -> the named member it lands in. Everything else goes to `extra`. */
void assignNamed(Indicators& out, const std::string& key, double value) {
  if (key == "sma20") out.sma20 = value;
  else if (key == "ema20") out.ema20 = value;
  else if (key == "rsi14") out.rsi = value;
  else if (key == "macd") out.macd = value;
  else if (key == "macdSignal") out.signal = value;
  else if (key == "bbUpper") out.upperBand = value;
  else if (key == "bbLower") out.lowerBand = value;
}

}  // namespace

// ---------------------------------------------------------------------------

std::optional<double> Indicators::value(std::string_view key) const {
  if (key == "sma20") return sma20;
  if (key == "ema20") return ema20;
  if (key == "rsi14" || key == "rsi") return rsi;
  if (key == "macd") return macd;
  if (key == "macdSignal" || key == "signal") return signal;
  if (key == "bbUpper" || key == "upperBand") return upperBand;
  if (key == "bbLower" || key == "lowerBand") return lowerBand;

  const auto it = extra.find(std::string{key});
  if (it == extra.end()) return std::nullopt;
  return it->second;
}

std::string_view toString(Action action) noexcept {
  switch (action) {
    case Action::Buy:  return "BUY";
    case Action::Sell: return "SELL";
    case Action::Hold: break;
  }
  return "HOLD";
}

TradeSignal TradeSignal::hold(const Candle& candle, std::string strategyName) {
  TradeSignal signal;
  signal.action = Action::Hold;
  signal.price = candle.closeRaw;
  signal.timestamp = candle.timestamp;
  signal.strategyName = std::move(strategyName);
  signal.symbol = candle.symbol;
  return signal;
}

// ---------------------------------------------------------------------------

void from_json(const nlohmann::json& j, Candle& candle) {
  candle.symbol = readString(j, "symbol");
  candle.interval = readString(j, "interval");

  candle.open = readNumber(j, "open").value_or(0.0);
  candle.high = readNumber(j, "high").value_or(0.0);
  candle.low = readNumber(j, "low").value_or(0.0);
  candle.close = readNumber(j, "close").value_or(0.0);
  candle.volume = readNumber(j, "volume").value_or(0.0);

  candle.closeRaw = readString(j, "close");
  candle.timestamp = j.value("open_time", static_cast<std::int64_t>(0));
}

void from_json(const nlohmann::json& j, Indicators& indicators) {
  if (!j.is_object()) return;

  for (const auto& [key, raw] : j.items()) {
    if (!raw.is_number()) continue;  // null = still warming up

    const double value = raw.get<double>();
    if (!std::isfinite(value)) continue;

    assignNamed(indicators, key, value);
    indicators.extra.emplace(key, value);
  }
}

void to_json(nlohmann::json& j, const TradeSignal& signal) {
  j = nlohmann::json{
      {"action", toString(signal.action)},
      {"price", signal.price},
      {"timestamp", signal.timestamp},
      {"strategyName", signal.strategyName},
      {"symbol", signal.symbol},
  };
}

}  // namespace engine
