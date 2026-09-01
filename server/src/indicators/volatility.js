import {
  assertCandles,
  assertPeriod,
  assertSeries,
  mean,
  nulls,
  populationStdDev,
  wilderSmooth,
} from './math.js';
import { ema, sma } from './trend.js';

/** Volatility indicators — how much the price is moving, not which way. */

/** Rolling population standard deviation of closes. */
export function stdDev(prices, period = 20) {
  assertSeries(prices, 'prices');
  assertPeriod(period, 'period');

  const out = nulls(prices.length);

  for (let i = period - 1; i < prices.length; i += 1) {
    const from = i - period + 1;
    out[i] = populationStdDev(prices, from, i + 1, mean(prices, from, i + 1));
  }

  return out;
}

/**
 * Bollinger Bands: an SMA with bands set `multiplier` standard deviations away.
 *
 * Returns the three lines plus two derived readings that are more useful than
 * the bands themselves for building rules:
 *
 *   bandwidth — (upper - lower) / middle. Volatility as a single number; a
 *               multi-period low is the "squeeze" that often precedes a move.
 *   percentB  — where price sits across the bands: 0 = lower, 1 = upper.
 *               Comparable across symbols and price levels, unlike the raw
 *               bands, so it is what you would actually put a threshold on.
 *
 * Note the deliberate O(n x period) loop: the rolling sum-of-squares trick
 * would be O(n), but subtracting large squared prices loses precision through
 * catastrophic cancellation. At 200 candles the naive form costs microseconds,
 * so correctness wins. That tradeoff would flip at a million points.
 */
export function bollingerBands(prices, period = 20, multiplier = 2) {
  assertSeries(prices, 'prices');
  assertPeriod(period, 'period');

  if (typeof multiplier !== 'number' || !Number.isFinite(multiplier) || multiplier <= 0) {
    throw new TypeError(`multiplier must be a positive finite number, received ${multiplier}`);
  }

  const middle = sma(prices, period);
  const upper = nulls(prices.length);
  const lower = nulls(prices.length);
  const bandwidth = nulls(prices.length);
  const percentB = nulls(prices.length);

  for (let i = period - 1; i < prices.length; i += 1) {
    const from = i - period + 1;
    const average = middle[i];
    const deviation = populationStdDev(prices, from, i + 1, average);
    const offset = multiplier * deviation;

    upper[i] = average + offset;
    lower[i] = average - offset;
    bandwidth[i] = average === 0 ? null : (upper[i] - lower[i]) / average;

    const span = upper[i] - lower[i];
    percentB[i] = span === 0 ? 0.5 : (prices[i] - lower[i]) / span;
  }

  return { upper, middle, lower, bandwidth, percentB };
}

/**
 * True Range: the largest of
 *   high - low,  |high - previousClose|,  |low - previousClose|
 *
 * The previous close matters because it captures GAPS. A market that opens far
 * from where it closed has moved, and high - low alone would not show it.
 */
export function trueRange(candles) {
  assertCandles(candles, 'candles');

  return candles.map((candle, i) => {
    if (i === 0) return candle.high - candle.low; // no previous close to gap from

    const previousClose = candles[i - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose)
    );
  });
}

/**
 * Average True Range: Wilder-smoothed true range. A pure volatility reading in
 * quote currency — the standard input for position sizing and stop distance.
 */
export function atr(candles, period = 14) {
  assertCandles(candles, 'candles');
  assertPeriod(period, 'period');

  const ranges = trueRange(candles);
  const out = nulls(candles.length);
  if (ranges.length < period) return out;

  let average = mean(ranges, 0, period);
  out[period - 1] = average;

  for (let i = period; i < ranges.length; i += 1) {
    average = wilderSmooth(average, ranges[i], period);
    out[i] = average;
  }

  return out;
}

/**
 * Keltner Channels: an EMA with bands set at a multiple of ATR.
 *
 * Same silhouette as Bollinger Bands but volatility is measured from the true
 * range rather than the standard deviation of closes, so the bands react to
 * gaps and intrabar range. Bollinger bands inside Keltner channels is the
 * canonical "squeeze" setup.
 */
export function keltnerChannels(candles, period = 20, multiplier = 2, atrPeriod = 10) {
  assertCandles(candles, 'candles');
  assertPeriod(period, 'period');
  assertPeriod(atrPeriod, 'atrPeriod');

  const closes = candles.map((candle) => candle.close);
  const middle = ema(closes, period);
  const range = atr(candles, atrPeriod);

  const upper = middle.map((value, i) =>
    value === null || range[i] === null ? null : value + multiplier * range[i]
  );
  const lower = middle.map((value, i) =>
    value === null || range[i] === null ? null : value - multiplier * range[i]
  );

  return { upper, middle, lower };
}

/**
 * Historical volatility: standard deviation of LOG returns, annualized.
 *
 * Log returns rather than percentage changes because they are additive over
 * time and symmetric — a +50% then -50% move is not a round trip in percentage
 * terms, but log returns handle it correctly.
 *
 * `periodsPerYear` defaults to 1m candles trading around the clock:
 * 60 * 24 * 365 = 525,600. Crypto never closes, so unlike equities there is no
 * 252-trading-day convention to apply.
 */
export function historicalVolatility(prices, period = 20, periodsPerYear = 525_600) {
  assertSeries(prices, 'prices');
  assertPeriod(period, 'period');

  const logReturns = nulls(prices.length);
  for (let i = 1; i < prices.length; i += 1) {
    if (prices[i - 1] <= 0 || prices[i] <= 0) continue;
    logReturns[i] = Math.log(prices[i] / prices[i - 1]);
  }

  const out = nulls(prices.length);
  const annualize = Math.sqrt(periodsPerYear);

  for (let i = period; i < prices.length; i += 1) {
    const window = logReturns.slice(i - period + 1, i + 1);
    if (window.some((value) => value === null)) continue;

    const average = mean(window, 0, window.length);
    out[i] = populationStdDev(window, 0, window.length, average) * annualize * 100;
  }

  return out;
}
