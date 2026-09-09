/**
 * Indicator configuration.
 *
 * These live here rather than inside `indicators/` on purpose: the indicator
 * functions take every period as an argument and know nothing about this
 * project's choices. This file is where THIS application decides which periods
 * it cares about.
 */

/** How many candles of history each recalculation runs over. */
export const INDICATOR_LOOKBACK = 200;

/**
 * Extra candles fetched BEFORE the requested window when serving indicator
 * series over REST.
 *
 * Without it, asking for 200 candles computes SMA(50) from those 200 alone, so
 * the first 49 points of the visible chart are null and every line starts with
 * a bald patch. Fetching warmup history and then trimming to the requested
 * window means the whole visible range is populated. 100 comfortably covers
 * the slowest indicator here (SMA/EMA 50, and MACD's 26 + 9).
 */
export const INDICATOR_WARMUP = 100;

export const PERIODS = {
  SMA_FAST: 20,
  SMA_SLOW: 50,
  EMA_VERY_FAST: 9,
  EMA_MEDIUM: 21,
  EMA_FAST: 20,
  EMA_SLOW: 50,
  RSI: 14,
  MACD_FAST: 12,
  MACD_SLOW: 26,
  MACD_SIGNAL: 9,
  BOLLINGER: 20,
  BOLLINGER_STDDEV: 2,
  ATR: 14,
  STOCHASTIC: 14,
  STOCHASTIC_SIGNAL: 3,
  WILLIAMS_R: 14,
  CCI: 20,
  ROC: 12,
  STDDEV: 20,
  VWAP: 20,
  MFI: 14,
  CMF: 20,
  VOLUME_SMA: 20,
  HISTORICAL_VOLATILITY: 20,
};

/**
 * Indicator outputs are already floating point, so rounding costs nothing in
 * accuracy and keeps 80123.45600000001 out of every WebSocket frame.
 */
export const INDICATOR_PRECISION = 8;

/**
 * Every wire name the engine can produce.
 *
 * Lives here rather than beside the registry so that strategies — which consume
 * indicator values but must not depend on how they are computed — can validate
 * their parameters against it without importing the engine.
 */
export const INDICATOR_KEYS = Object.freeze([
  'sma20', 'sma50', 'ema9', 'ema21', 'ema20', 'ema50',
  'rsi14',
  'macd', 'macdSignal', 'macdHistogram',
  'bbUpper', 'bbMiddle', 'bbLower', 'bbBandwidth', 'bbPercentB',
  'atr14', 'stdDev20', 'historicalVolatility20',
  'stochK', 'stochD', 'williamsR14', 'cci20', 'roc12',
  'obv', 'vwap20', 'mfi14', 'adLine', 'cmf20', 'volumeSma20',
]);
