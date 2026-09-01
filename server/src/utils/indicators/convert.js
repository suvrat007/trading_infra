import { INDICATOR_PRECISION } from '../../constants/indicators.js';

/**
 * The one place prices stop being exact.
 *
 * Everywhere else in this system prices are strings: Binance sends strings, pg
 * returns NUMERIC as a string, and the API serves strings — all so no rounding
 * error can touch a stored value.
 *
 * Indicators cannot work that way. An EMA multiplier is 2/(period+1), standard
 * deviation needs a square root, and log returns need a logarithm. None of
 * those are representable in exact decimal. So indicator math is IEEE 754 math,
 * and this boundary is where we admit it.
 *
 * we store and serve keeps its exact strings, and only the analytics computed
 * FROM it are floats. Nothing here ever flows back into the database.
 */
export function toNumericCandles(rows) {
  return rows.map((row) => ({
    open_time: row.open_time,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
  }));
}

export function closesOf(candles) {
  return candles.map((candle) => candle.close);
}

/** Trim float noise for the wire. Null-safe, because most series start null. */
export function round(value, decimals = INDICATOR_PRECISION) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;

  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function roundSeries(series, decimals = INDICATOR_PRECISION) {
  return series.map((value) => round(value, decimals));
}
