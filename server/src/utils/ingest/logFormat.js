import { isoTime } from '../shared/time.js';

export function formatCandleLog(candle) {
  return (
    `saved id=${candle.id} ${candle.symbol} ${candle.interval} ${isoTime(candle.open_time)} ` +
    `O=${candle.open} H=${candle.high} L=${candle.low} C=${candle.close} V=${candle.volume}`
  );
}

export function formatDuplicateLog(k) {
  return `duplicate ${k.s} ${k.i} ${isoTime(k.t)} — skipped`;
}
