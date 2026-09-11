import './env.js';
import { ACTIVE_TIMEFRAMES, DEFAULT_TIMEFRAME } from './timeframes.js';

export const SYMBOL = (process.env.SYMBOL || 'BTCUSDT').toUpperCase();

/**
 * The timeframe used when a caller does not name one.
 *
 * It no longer decides what gets INGESTED — every timeframe in
 * ACTIVE_TIMEFRAMES is ingested. This is only the fallback for REST queries and
 * the welcome frame. Kept under the old name so the audit, backfill and
 * validation layers keep a sensible default.
 */
export const INTERVAL = DEFAULT_TIMEFRAME;

export const BINANCE_WS_BASE = 'wss://stream.binance.com:9443';

/** e.g. ['btcusdt@kline_1m', 'btcusdt@kline_5m', ...] */
export const KLINE_STREAMS = ACTIVE_TIMEFRAMES.map(
  (interval) => `${SYMBOL.toLowerCase()}@kline_${interval}`
);

/**
 * One connection carrying every timeframe, using Binance's COMBINED stream
 * endpoint.
 *
 * Five separate sockets would mean five reconnect loops, five stale-data
 * watchdogs and five backoff states — five times the ways to be half-connected
 * without noticing. One socket has exactly the failure modes we already handle.
 *
 * The combined endpoint wraps each event: {stream, data} rather than the bare
 * event a single-stream URL sends. ingest.js unwraps it, and still accepts the
 * bare form so a single-stream URL keeps working.
 */
export const KLINE_STREAM_URL = `${BINANCE_WS_BASE}/stream?streams=${KLINE_STREAMS.join('/')}`;
