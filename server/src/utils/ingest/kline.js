/**
 * Translation layer for Binance's wire format. "kline" is their word for a
 * candlestick, and their payload uses single-letter keys. Only this file
 * understands that shape — everything downstream deals in `candle` objects.
 */

/** True only for a sealed kline. In-progress ticks arrive every ~1-2s with x=false. */
export function isClosedKline(msg) {
  return Boolean(msg?.k?.x === true);
}

/** Binance kline -> row tuple for SQL_INSERT_CANDLE, prices left as strings. */
export function klineToRow(k) {
  return [k.s, k.i, k.t, k.o, k.h, k.l, k.c, k.v];
}

/** Binance kline + inserted id -> the shape we persist, serve, and broadcast. */
export function klineToCandle(k, id) {
  return {
    id,
    symbol: k.s,
    interval: k.i,
    open_time: k.t,
    open: k.o,
    high: k.h,
    low: k.l,
    close: k.c,
    volume: k.v,
  };
}
