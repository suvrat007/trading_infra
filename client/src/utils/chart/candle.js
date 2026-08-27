import { MS_PER_SECOND } from '../../constants/chart.js';

/**
 * API candle -> lightweight-charts candlestick point.
 *
 * Two conversions happen here, and both are load-bearing:
 *
 * 1. TIME UNITS. Binance and our database use epoch MILLISECONDS.
 *    lightweight-charts expects epoch SECONDS. Feed it milliseconds and every
 *    bar lands ~55,000 years in the future — the chart renders blank with no
 *    error, which is a genuinely confusing hour to debug.
 *
 * 2. STRING -> NUMBER. Prices travel as strings all the way from Binance so
 *    they stay exact. This is the one place that must convert, because the
 *    charting library needs numbers to compute pixel positions. Converting
 *    HERE and nowhere else keeps the lossy step at the very edge of the system,
 *    for display only — never on a value we store or trade on.
 */
export function toChartCandle(candle) {
  return {
    time: Math.floor(candle.open_time / MS_PER_SECOND),
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
  };
}

export function toChartCandles(candles) {
  return candles.map(toChartCandle);
}
