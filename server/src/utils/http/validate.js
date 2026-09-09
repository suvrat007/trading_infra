import {
  DEFAULT_CANDLE_LIMIT,
  MAX_CANDLE_LIMIT,
  SYMBOL_PATTERN,
  VALID_INTERVALS,
} from '../../constants/candles.js';
import { INTERVAL, SYMBOL } from '../../constants/binance.js';
import { ERROR_CODE } from '../../constants/http.js';
import { STRATEGY_NAMES } from '../strategies/factory.js';
import { ApiError } from './errors.js';

const parseSymbol = (raw) => {
  const symbol = String(raw ?? SYMBOL).trim().toUpperCase();

  if (!SYMBOL_PATTERN.test(symbol)) {
    throw ApiError.badRequest(
      ERROR_CODE.INVALID_SYMBOL,
      `symbol must match ${SYMBOL_PATTERN} (e.g. BTCUSDT)`
    );
  }
  return symbol;
};

const parseInterval = (raw) => {
  const interval = String(raw ?? INTERVAL).trim();

  if (!VALID_INTERVALS.has(interval)) {
    throw ApiError.badRequest(
      ERROR_CODE.INVALID_INTERVAL,
      `interval must be one of: ${[...VALID_INTERVALS].join(', ')}`
    );
  }
  return interval;
};

const parseLimit = (raw) => {
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
};

/**
 * Query flags arrive as strings ("true"), never booleans. Accept the handful
 * of spellings a client might reasonably send and reject anything else, rather
 * than treating every non-empty string as true — which would make
 * `?indicators=false` mean the opposite of what it says.
 */
const parseBooleanFlag = (raw, name) => {
  if (raw === undefined || raw === '') return false;

  const value = String(raw).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(value)) return true;
  if (['false', '0', 'no'].includes(value)) return false;

  throw ApiError.badRequest(
    ERROR_CODE.INVALID_FLAG,
    `${name} must be one of: true, false, 1, 0, yes, no`
  );
};

/**
 * Validate and normalize the query for GET /api/candles.
 * Everything past this point can trust its inputs.
 */
export const parseCandlesQuery = (query = {}) => {
  return {
    symbol: parseSymbol(query.symbol),
    interval: parseInterval(query.interval),
    limit: parseLimit(query.limit),
    includeIndicators: parseBooleanFlag(query.indicators, 'indicators'),
  };
};

/**
 * Validate and normalize the query for GET /api/audit.
 *
 * `deep` is opt-in because it spends a Binance REST request; leaving it on by
 * default would make a monitoring probe hammer the exchange.
 */
export const parseAuditQuery = (query = {}) => ({
  symbol: parseSymbol(query.symbol),
  interval: parseInterval(query.interval),
  deep: parseBooleanFlag(query.deep, 'deep'),
});

/** GET /api/trades — limit only; trades are not filtered by symbol yet. */
export const parseTradesQuery = (query = {}) => ({
  limit: parseLimit(query.limit),
});

/**
 * POST /api/strategy/start body.
 *
 * Only the shape is checked here; the strategy constructor validates the
 * parameter VALUES and produces a better message than this layer could.
 */
export const parseStrategyBody = (body) => {
  if (!body || typeof body !== 'object') {
    throw ApiError.badRequest(ERROR_CODE.INVALID_BODY, 'Expected a JSON object body');
  }

  const name = String(body.name ?? '').toLowerCase();

  if (!STRATEGY_NAMES.includes(name)) {
    throw ApiError.badRequest(
      ERROR_CODE.INVALID_STRATEGY,
      `Unknown strategy "${body.name}". Available: ${STRATEGY_NAMES.join(', ')}`
    );
  }

  const params = body.params ?? {};

  if (typeof params !== 'object' || Array.isArray(params)) {
    throw ApiError.badRequest(ERROR_CODE.INVALID_BODY, 'params must be an object');
  }

  return { name, params };
};
