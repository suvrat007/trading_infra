import { MS_PER_SECOND } from '../../constants/chart.js';

/**
 * Epoch milliseconds -> epoch seconds.
 *
 * lightweight-charts expects SECONDS. The whole backend uses MILLISECONDS.
 * Pass milliseconds and every bar lands ~55,000 years in the future: the chart
 * renders blank with no error and nothing in the console.
 *
 * Every series on the chart routes its timestamps through this one function, so
 * a candle and its indicator line can never disagree about where "now" is.
 */
export function toChartTime(openTimeMs) {
  return Math.floor(openTimeMs / MS_PER_SECOND);
}

/**
 * API candle -> lightweight-charts candlestick point.
 *
 * Prices arrive as strings and stay strings all the way from Binance so they
 * remain exact. This is the one place they become numbers, because a canvas
 * needs numbers to compute pixel positions — display only, never a stored or
 * traded value.
 */
export function toChartCandle(candle) {
  return {
    time: toChartTime(candle.open_time),
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
  };
}

export function toChartCandles(candles) {
  return candles.map(toChartCandle);
}
