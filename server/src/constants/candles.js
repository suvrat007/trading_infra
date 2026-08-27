export const DEFAULT_CANDLE_LIMIT = 200;

// Hard ceiling on rows per request. Without it, ?limit=10000000 is a trivial
// way for one client to exhaust the pool and the server's memory.
export const MAX_CANDLE_LIMIT = 1_000;

export const SYMBOL_PATTERN = /^[A-Z0-9]{4,20}$/;

export const VALID_INTERVALS = new Set([
  '1m', '3m', '5m', '15m', '30m',
  '1h', '2h', '4h', '6h', '8h', '12h',
  '1d', '3d', '1w', '1M',
]);
