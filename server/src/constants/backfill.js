import './env.js';

/**
 * Historical candle recovery from Binance's REST API.
 *
 * The WebSocket stream has no replay: anything that closed while we were
 * disconnected is gone from it forever. REST is the only way to recover it.
 */
export const BINANCE_REST_BASE = 'https://api.binance.com';
export const KLINES_ENDPOINT = '/api/v3/klines';

/** Binance's hard cap on candles per REST call. */
export const MAX_KLINES_PER_REQUEST = 1_000;

/**
 * Ceilings for a single backfill run.
 *
 * A cold database against a year of 1m candles is ~525,000 bars — several
 * hundred requests. Bounding the run keeps a first startup from looking like an
 * attack on Binance and from blocking the live feed behind a long import; what
 * is left is simply picked up by the next run.
 */
export const MAX_CANDLES_PER_RUN = 5_000;
export const MAX_REQUESTS_PER_RUN = 10;

/**
 * Spacing between REST calls. Binance bills by request weight over a rolling
 * minute and answers a breach with a 429 and then an IP ban, so a fixed gap is
 * cheaper than discovering the limit.
 */
export const REQUEST_SPACING_MS = 350;

export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * How far back to seed a completely empty table.
 *
 * Enough to warm every indicator (the slowest needs 50 bars) with room to spare,
 * so the chart is useful immediately rather than filling in over an hour.
 */
export const COLD_START_CANDLES = 500;

/**
 * Ceiling on a diagnostic gap scan.
 *
 * Separate from MAX_CANDLES_PER_RUN so that *reporting* how many candles are
 * missing is not silently truncated to how many one run is willing to fetch —
 * a capped count read as a true one makes a backfill look like it closed fewer
 * holes than it did.
 */
export const GAP_SCAN_LIMIT = 1_000_000;

/**
 * Quiet period before repairing a gap noticed on the live stream.
 *
 * A flaky minute can produce several gaps in a row; waiting collapses them into
 * one backfill. Short enough that a hole does not linger, long enough that a
 * burst does not become a burst of REST calls.
 */
export const GAP_BACKFILL_DEBOUNCE_MS = 5_000;
