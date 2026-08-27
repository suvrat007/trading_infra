import {
  DEFAULT_CANDLE_LIMIT,
  MAX_CANDLE_LIMIT,
  SYMBOL_PATTERN,
  VALID_INTERVALS,
} from '../../constants/candles.js';
import { INTERVAL, SYMBOL } from '../../constants/binance.js';
import { ERROR_CODE } from '../../constants/http.js';
import { ApiError } from './errors.js';

function parseSymbol(raw) {
  const symbol = String(raw ?? SYMBOL).trim().toUpperCase();

  if (!SYMBOL_PATTERN.test(symbol)) {
    throw ApiError.badRequest(
      ERROR_CODE.INVALID_SYMBOL,
      `symbol must match ${SYMBOL_PATTERN} (e.g. BTCUSDT)`
    );
  }
  return symbol;
}

function parseInterval(raw) {
  const interval = String(raw ?? INTERVAL).trim();

  if (!VALID_INTERVALS.has(interval)) {
    throw ApiError.badRequest(
      ERROR_CODE.INVALID_INTERVAL,
      `interval must be one of: ${[...VALID_INTERVALS].join(', ')}`
    );
  }
  return interval;
}

function parseLimit(raw) {
  if (raw === undefined || raw === '') return DEFAULT_CANDLE_LIMIT;

  const limit = Number(raw);

  // Number('') is 0 and Number('12abc') is NaN — check explicitly rather than
  // trusting parseInt, which would happily read "12abc" as 12.
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CANDLE_LIMIT) {
    throw ApiError.badRequest(
      ERROR_CODE.INVALID_LIMIT,
      `limit must be an integer between 1 and ${MAX_CANDLE_LIMIT}`
    );
  }
  return limit;
}

/**
 * Validate and normalize the query for GET /api/candles.
 * Everything past this point can trust its inputs.
 */
export function parseCandlesQuery(query = {}) {
  return {
    symbol: parseSymbol(query.symbol),
    interval: parseInterval(query.interval),
    limit: parseLimit(query.limit),
  };
}
