import { PERIODS } from './indicators.js';

/**
 * The only three things a strategy may return.
 *
 * `null` is the third and by far the most common: on almost every candle a
 * strategy has nothing to say. Making "no signal" an explicit, expected return
 * rather than an exception or an omission keeps the runner's logic trivial.
 */
export const SIGNAL = {
  BUY: 'BUY',
  SELL: 'SELL',
};

/** Direction of a crossing, as reported by the cross tracker. */
export const CROSS = {
  UP: 'up',
  DOWN: 'down',
};

/**
 * Default parameters, chosen to match indicators the engine actually computes.
 *
 * These are not arbitrary: a strategy consumes PRE-COMPUTED indicator values,
 * so its parameter space is limited to what the engine produces. EMA defaults
 * to 20/50 rather than the textbook 12/26 because `ema20` and `ema50` are the
 * keys that exist; asking for `ema12` would fail loudly at construction.
 *
 * MACD's periods are pinned to the engine's own configuration for the same
 * reason — the wire carries one MACD, computed at PERIODS.MACD_*.
 */
export const DEFAULT_STRATEGY_PARAMS = {
  ema: { fastPeriod: PERIODS.EMA_FAST, slowPeriod: PERIODS.EMA_SLOW },
  rsi: { period: PERIODS.RSI, oversold: 30, overbought: 70 },
  macd: {
    fastPeriod: PERIODS.MACD_FAST,
    slowPeriod: PERIODS.MACD_SLOW,
    signalPeriod: PERIODS.MACD_SIGNAL,
  },
};

/** RSI is defined on 0-100; thresholds outside that can never fire. */
export const RSI_BOUNDS = { MIN: 0, MAX: 100 };
