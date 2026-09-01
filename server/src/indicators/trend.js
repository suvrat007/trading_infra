import { assertPeriod, assertSeries, mean, nulls } from './math.js';

/**
 * Trend indicators — moving averages.
 *
 * Every function here takes an array of closing prices and returns an array of
 * the SAME LENGTH, with `null` in every slot that does not have enough history
 * behind it. That alignment is the contract of this whole module: result[i]
 * always describes candle[i], so the caller can zip them without arithmetic.
 *
 * The alternative — returning only the defined values — forces every consumer
 * to re-derive the offset, and someone eventually gets it wrong by one.
 */

/**
 * Simple Moving Average: the unweighted mean of the last `period` closes.
 *
 * Computed with a rolling sum: add the entering price, subtract the leaving
 * one. O(n) total instead of O(n x period) for the naive re-sum per window.
 */
export function sma(prices, period) {
  assertSeries(prices, 'prices');
  assertPeriod(period, 'period');

  const out = nulls(prices.length);
  if (prices.length < period) return out;

  let windowSum = 0;
  for (let i = 0; i < period; i += 1) windowSum += prices[i];
  out[period - 1] = windowSum / period;

  for (let i = period; i < prices.length; i += 1) {
    windowSum += prices[i] - prices[i - period];
    out[i] = windowSum / period;
  }

  return out;
}

/**
 * Exponential Moving Average: weights recent prices more heavily, so it turns
 * faster than an SMA of the same period at the cost of being noisier.
 *
 * Seeded with the SMA of the first `period` values — the standard convention.
 * Seeding with prices[0] instead (also seen in the wild) makes the first
 * several dozen values wrong until the weighting decays the error away.
 */
export function ema(prices, period) {
  assertSeries(prices, 'prices');
  assertPeriod(period, 'period');

  const out = nulls(prices.length);
  if (prices.length < period) return out;

  const multiplier = 2 / (period + 1);
  let previous = mean(prices, 0, period);
  out[period - 1] = previous;

  for (let i = period; i < prices.length; i += 1) {
    previous = (prices[i] - previous) * multiplier + previous;
    out[i] = previous;
  }

  return out;
}

/**
 * Weighted Moving Average: weights decay linearly (period, period-1, ... 1)
 * rather than exponentially. Sits between SMA and EMA in responsiveness.
 */
export function wma(prices, period) {
  assertSeries(prices, 'prices');
  assertPeriod(period, 'period');

  const out = nulls(prices.length);
  if (prices.length < period) return out;

  const weightTotal = (period * (period + 1)) / 2;

  for (let i = period - 1; i < prices.length; i += 1) {
    let weighted = 0;
    for (let w = 0; w < period; w += 1) {
      weighted += prices[i - w] * (period - w);
    }
    out[i] = weighted / weightTotal;
  }

  return out;
}

/**
 * Double Exponential Moving Average: 2*EMA - EMA(EMA).
 *
 * Subtracting the lag of the second smoothing pass removes most of the delay a
 * plain EMA carries, without the whipsaw of simply using a shorter period.
 */
export function dema(prices, period) {
  assertSeries(prices, 'prices');
  assertPeriod(period, 'period');

  const first = ema(prices, period);
  const firstDense = first.filter((value) => value !== null);
  const second = ema(firstDense, period);

  const offset = first.length - firstDense.length;

  return first.map((value, i) => {
    const smoothed = second[i - offset];
    if (value === null || smoothed === undefined || smoothed === null) return null;
    return 2 * value - smoothed;
  });
}
