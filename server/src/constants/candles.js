import { TIMEFRAME_IDS } from './timeframes.js';
export const DEFAULT_CANDLE_LIMIT = 200;

// Hard ceiling on rows per request. Without it, ?limit=10000000 is a trivial
// way for one client to exhaust the pool and the server's memory.
export const MAX_CANDLE_LIMIT = 1_000;

export const SYMBOL_PATTERN = /^[A-Z0-9]{4,20}$/;

/**
 * Exactly the timeframes this system ingests — no more.
 *
 * Previously this listed every Binance interval, which accepted requests for
 * data that was never stored, and included '1M' even though intervalToMs
 * deliberately rejects monthly bars as not being a fixed-length grid. Sourcing
 * it from the registry means the API can only ask for what exists.
 */
export const VALID_INTERVALS = new Set(TIMEFRAME_IDS);
