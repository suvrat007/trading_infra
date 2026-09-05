import {
  BINANCE_REST_BASE,
  KLINES_ENDPOINT,
  MAX_KLINES_PER_REQUEST,
  REQUEST_TIMEOUT_MS,
} from '../../constants/backfill.js';

/**
 * Binance's REST kline is a positional ARRAY, not an object — unlike the
 * WebSocket payload, which uses single-letter keys. Same data, two encodings.
 *
 *   [0] open time   [1] open   [2] high   [3] low   [4] close   [5] volume
 *   [6] close time  [7] quote volume  [8] trades  ...
 *
 * Prices stay strings exactly as they arrive, same as the live path, so the
 * NUMERIC column receives exact decimals either way. A backfilled candle and a
 * streamed one must be byte-identical in the database.
 */
export const restKlineToRow = (kline, symbol, interval) => [
  symbol,
  interval,
  kline[0],
  kline[1],
  kline[2],
  kline[3],
  kline[4],
  kline[5],
];

export const buildKlinesUrl = ({ symbol, interval, startTime, endTime, limit }) => {
  const url = new URL(KLINES_ENDPOINT, BINANCE_REST_BASE);

  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', interval);
  url.searchParams.set('startTime', String(startTime));
  url.searchParams.set('endTime', String(endTime));
  url.searchParams.set('limit', String(limit ?? MAX_KLINES_PER_REQUEST));

  return url.toString();
};

/**
 * Fetch one chunk of historical candles.
 *
 * Both bounds are inclusive on Binance's side, and the response is ordered
 * oldest first. A 429 means the rate limit was breached and the correct
 * response is to stop the run, not to retry immediately — repeated 429s escalate
 * to a temporary IP ban.
 */
export const fetchKlines = async ({ symbol, interval, startTime, endTime, limit }) => {
  const url = buildKlinesUrl({ symbol, interval, startTime, endTime, limit });

  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

  if (response.status === 429 || response.status === 418) {
    throw new Error(`Binance rate limit hit (${response.status}) — stopping this run`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Binance klines request failed with ${response.status} ${body.slice(0, 120)}`);
  }

  const klines = await response.json();

  if (!Array.isArray(klines)) {
    throw new Error('Binance klines response was not an array');
  }

  return klines;
};
