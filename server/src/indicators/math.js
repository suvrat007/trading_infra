/**
 * Shared primitives for the indicator functions.
 *
 * This is the only file the other indicator modules import, and it imports
 * nothing at all. The whole `indicators/` directory is deliberately sealed off
 * from the rest of the server: no db, no constants, no logging. That is what
 * makes every indicator testable with a literal array and reusable anywhere.
 */

/**
 * Invalid periods are a PROGRAMMER error, so they throw.
 * Insufficient data is a DATA condition, so it returns nulls instead.
 * Keeping those two apart is what stops a typo from silently producing a
 * plausible-looking line on a chart.
 */
export function assertPeriod(period, name = 'period') {
  if (!Number.isInteger(period) || period < 1) {
    throw new TypeError(`${name} must be a positive integer, received ${period}`);
  }
}

export function assertSeries(values, name = 'values') {
  if (!Array.isArray(values)) {
    throw new TypeError(`${name} must be an array, received ${typeof values}`);
  }
  for (let i = 0; i < values.length; i += 1) {
    if (typeof values[i] !== 'number' || !Number.isFinite(values[i])) {
      throw new TypeError(`${name}[${i}] must be a finite number, received ${values[i]}`);
    }
  }
}

export function assertCandles(candles, name = 'candles') {
  if (!Array.isArray(candles)) {
    throw new TypeError(`${name} must be an array, received ${typeof candles}`);
  }
  for (let i = 0; i < candles.length; i += 1) {
    const c = candles[i];
    if (!c || typeof c !== 'object') {
      throw new TypeError(`${name}[${i}] must be an object`);
    }
    for (const key of ['high', 'low', 'close']) {
      if (typeof c[key] !== 'number' || !Number.isFinite(c[key])) {
        throw new TypeError(`${name}[${i}].${key} must be a finite number, received ${c[key]}`);
      }
    }
  }
}

/** Volume-based indicators need one more field than the range-based ones. */
export function assertVolumes(candles, name = 'candles') {
  for (let i = 0; i < candles.length; i += 1) {
    const { volume } = candles[i];
    if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0) {
      throw new TypeError(`${name}[${i}].volume must be a non-negative finite number, received ${volume}`);
    }
  }
}

/** Every indicator returns an array as long as its input; this fills the head. */
export function nulls(length) {
  return length > 0 ? new Array(length).fill(null) : [];
}

/** Mean of values[from, to) — no allocation, unlike slice().reduce(). */
export function mean(values, from, to) {
  let total = 0;
  for (let i = from; i < to; i += 1) total += values[i];
  return total / (to - from);
}

/**
 * Population standard deviation (divide by n), not sample (n - 1).
 *
 * This matters: Bollinger's original definition uses the population form
 * because the window IS the whole population you are measuring, not a sample
 * drawn from a larger one. Using n-1 gives slightly wider bands than every
 * charting platform, and your numbers will not match anyone else's.
 */
export function populationStdDev(values, from, to, average) {
  let sumSquares = 0;
  for (let i = from; i < to; i += 1) {
    const deviation = values[i] - average;
    sumSquares += deviation * deviation;
  }
  return Math.sqrt(sumSquares / (to - from));
}

/** Pull one numeric field out of a candle array. */
export function pluck(candles, key) {
  return candles.map((candle) => Number(candle[key]));
}

/** (high + low + close) / 3 — the "typical price" used by CCI, MFI and VWAP. */
export function typicalPrices(candles) {
  return candles.map((c) => (c.high + c.low + c.close) / 3);
}

/**
 * Wilder's smoothing: an EMA with alpha = 1/period rather than 2/(period+1).
 * RSI, ATR and ADX are all defined with this specific smoothing, so using a
 * standard EMA in their place produces values that look right but are not.
 */
export function wilderSmooth(previous, value, period) {
  return (previous * (period - 1) + value) / period;
}

/**
 * Drop leading nulls, run a calculation on the dense remainder, then re-pad.
 *
 * Needed whenever one indicator feeds another — MACD's signal line is an EMA
 * of the MACD line, which is itself null for its first `slowPeriod - 1` slots.
 * Feeding those nulls straight into an EMA is the single most common MACD bug:
 * the signal line comes out shifted and never matches TradingView.
 */
export function mapDense(values, compute) {
  const firstIndex = values.findIndex((value) => value !== null);
  if (firstIndex === -1) return nulls(values.length);

  const dense = values.slice(firstIndex);
  const computed = compute(dense);

  return [...nulls(firstIndex), ...computed];
}
