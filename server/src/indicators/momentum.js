import {
  assertCandles,
  assertPeriod,
  assertSeries,
  mapDense,
  mean,
  nulls,
  typicalPrices,
  wilderSmooth,
} from './math.js';
import { ema, sma } from './trend.js';

/**
 * Momentum indicators — rate and strength of price movement.
 *
 * Functions taking `prices` want an array of closes.
 * Functions taking `candles` need { high, low, close } and say so in the name
 * of the parameter — a range indicator cannot be computed from closes alone.
 */

function rsiFromAverages(averageGain, averageLoss) {
  // A perfectly flat series has neither gains nor losses. Many libraries
  // return 100 here because they only special-case a zero denominator; that
  // reads as "maximally overbought" for a market that has not moved at all.
  // 50 (neutral) is the honest value.
  if (averageGain === 0 && averageLoss === 0) return 50;

  if (averageLoss === 0) return 100;
  if (averageGain === 0) return 0;

  return 100 - 100 / (1 + averageGain / averageLoss);
}

/**
 * Relative Strength Index: 0-100, comparing average gain to average loss over
 * the lookback. Conventionally >70 is overbought and <30 oversold.
 *
 * Uses WILDER smoothing (alpha = 1/period), not a standard EMA (2/(period+1)).
 * RSI was defined that way in 1978 and every charting platform follows it —
 * substituting a normal EMA yields numbers that look plausible and match
 * nothing.
 *
 * The first value lands at index `period`, not `period - 1`, because n prices
 * only produce n-1 changes.
 */
export function rsi(prices, period = 14) {
  assertSeries(prices, 'prices');
  assertPeriod(period, 'period');

  const out = nulls(prices.length);
  if (prices.length <= period) return out;

  let gainTotal = 0;
  let lossTotal = 0;

  for (let i = 1; i <= period; i += 1) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gainTotal += change;
    else lossTotal -= change;
  }

  let averageGain = gainTotal / period;
  let averageLoss = lossTotal / period;
  out[period] = rsiFromAverages(averageGain, averageLoss);

  for (let i = period + 1; i < prices.length; i += 1) {
    const change = prices[i] - prices[i - 1];
    averageGain = wilderSmooth(averageGain, change > 0 ? change : 0, period);
    averageLoss = wilderSmooth(averageLoss, change < 0 ? -change : 0, period);
    out[i] = rsiFromAverages(averageGain, averageLoss);
  }

  return out;
}

/**
 * Moving Average Convergence Divergence.
 *
 *   macd      = EMA(fast) - EMA(slow)
 *   signal    = EMA(macd, signalPeriod)
 *   histogram = macd - signal
 *
 * The subtlety is the signal line: it is an EMA of the MACD line, which is
 * itself null for its first slowPeriod-1 slots. `mapDense` strips those, runs
 * the EMA over real values only, then re-pads. Feeding the nulls in directly
 * (or treating them as zero) shifts the signal line and is the classic reason
 * a hand-rolled MACD never matches TradingView.
 */
export function macd(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  assertSeries(prices, 'prices');
  assertPeriod(fastPeriod, 'fastPeriod');
  assertPeriod(slowPeriod, 'slowPeriod');
  assertPeriod(signalPeriod, 'signalPeriod');

  if (fastPeriod >= slowPeriod) {
    throw new TypeError(
      `fastPeriod (${fastPeriod}) must be smaller than slowPeriod (${slowPeriod})`
    );
  }

  const fast = ema(prices, fastPeriod);
  const slow = ema(prices, slowPeriod);

  const macdLine = prices.map((_, i) =>
    fast[i] === null || slow[i] === null ? null : fast[i] - slow[i]
  );

  const signalLine = mapDense(macdLine, (dense) => ema(dense, signalPeriod));

  const histogram = macdLine.map((value, i) =>
    value === null || signalLine[i] === null ? null : value - signalLine[i]
  );

  return { macd: macdLine, signal: signalLine, histogram };
}

/** Rate of Change: percentage move over the lookback. */
export function roc(prices, period = 12) {
  assertSeries(prices, 'prices');
  assertPeriod(period, 'period');

  const out = nulls(prices.length);

  for (let i = period; i < prices.length; i += 1) {
    const previous = prices[i - period];
    out[i] = previous === 0 ? null : ((prices[i] - previous) / previous) * 100;
  }

  return out;
}

/** Momentum: the raw price difference over the lookback, in quote currency. */
export function momentum(prices, period = 10) {
  assertSeries(prices, 'prices');
  assertPeriod(period, 'period');

  const out = nulls(prices.length);
  for (let i = period; i < prices.length; i += 1) {
    out[i] = prices[i] - prices[i - period];
  }
  return out;
}

/**
 * Stochastic Oscillator: where the close sits inside the recent high-low range.
 *
 *   %K = 100 * (close - lowestLow) / (highestHigh - lowestLow)
 *   %D = SMA(%K, signalPeriod)
 *
 * When the range is zero (a completely flat window) the formula divides by
 * zero. 50 — the middle of the range — is the meaningful answer.
 */
export function stochastic(candles, period = 14, signalPeriod = 3) {
  assertCandles(candles, 'candles');
  assertPeriod(period, 'period');
  assertPeriod(signalPeriod, 'signalPeriod');

  const k = nulls(candles.length);

  for (let i = period - 1; i < candles.length; i += 1) {
    let highest = -Infinity;
    let lowest = Infinity;

    for (let w = i - period + 1; w <= i; w += 1) {
      if (candles[w].high > highest) highest = candles[w].high;
      if (candles[w].low < lowest) lowest = candles[w].low;
    }

    const range = highest - lowest;
    k[i] = range === 0 ? 50 : ((candles[i].close - lowest) / range) * 100;
  }

  const d = mapDense(k, (dense) => sma(dense, signalPeriod));

  return { k, d };
}

/**
 * Williams %R: the same geometry as stochastic %K, expressed on a -100..0
 * scale measured down from the high instead of up from the low.
 */
export function williamsR(candles, period = 14) {
  assertCandles(candles, 'candles');
  assertPeriod(period, 'period');

  const out = nulls(candles.length);

  for (let i = period - 1; i < candles.length; i += 1) {
    let highest = -Infinity;
    let lowest = Infinity;

    for (let w = i - period + 1; w <= i; w += 1) {
      if (candles[w].high > highest) highest = candles[w].high;
      if (candles[w].low < lowest) lowest = candles[w].low;
    }

    const range = highest - lowest;
    out[i] = range === 0 ? -50 : ((highest - candles[i].close) / range) * -100;
  }

  return out;
}

/**
 * Commodity Channel Index: how far the typical price sits from its own average,
 * scaled by MEAN ABSOLUTE deviation — not standard deviation.
 *
 * The 0.015 constant exists purely to place roughly 70-80% of readings inside
 * +/-100; it has no statistical meaning. Using stdev here (an easy substitution)
 * changes the scale and breaks the conventional +/-100 thresholds.
 */
export function cci(candles, period = 20) {
  assertCandles(candles, 'candles');
  assertPeriod(period, 'period');

  const typical = typicalPrices(candles);
  const out = nulls(candles.length);

  for (let i = period - 1; i < typical.length; i += 1) {
    const from = i - period + 1;
    const average = mean(typical, from, i + 1);

    let absoluteDeviation = 0;
    for (let w = from; w <= i; w += 1) absoluteDeviation += Math.abs(typical[w] - average);
    const meanDeviation = absoluteDeviation / period;

    out[i] = meanDeviation === 0 ? 0 : (typical[i] - average) / (0.015 * meanDeviation);
  }

  return out;
}
