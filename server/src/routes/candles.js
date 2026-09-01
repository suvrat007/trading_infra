import { Router } from 'express';
import { pool } from '../db.js';
import { INDICATOR_WARMUP } from '../constants/indicators.js';
import { SQL_SELECT_RECENT_CANDLES } from '../constants/sql.js';
import { HTTP_STATUS } from '../constants/http.js';
import { asyncHandler } from '../utils/http/asyncHandler.js';
import { parseCandlesQuery } from '../utils/http/validate.js';
import { toNumericCandles } from '../utils/indicators/convert.js';
import { computeIndicators } from '../utils/indicators/registry.js';

export const candlesRouter = Router();

/**
 * GET /api/candles?symbol=BTCUSDT&interval=1m&limit=200&indicators=true
 *
 * Returns the most recent `limit` candles, ordered oldest -> newest.
 * With indicators=true, also returns every indicator as a series aligned 1:1
 * with those candles — series[i] describes candles[i], null where the
 * indicator has no value yet.
 */
candlesRouter.get(
  '/candles',
  asyncHandler(async (req, res) => {
    const { symbol, interval, limit, includeIndicators } = parseCandlesQuery(req.query);

    // Fetch warmup history beyond the requested window so indicators are
    // already converged by the first visible candle, then trim it back off.
    const fetchLimit = includeIndicators ? limit + INDICATOR_WARMUP : limit;

    const { rows } = await pool.query(SQL_SELECT_RECENT_CANDLES, [symbol, interval, fetchLimit]);

    if (!includeIndicators) {
      res.status(HTTP_STATUS.OK).json({ symbol, interval, count: rows.length, candles: rows });
      return;
    }

    const { series } = computeIndicators(toNumericCandles(rows));

    // Trim the warmup off the candles and every series by the same amount, so
    // the 1:1 alignment between candles[i] and series[i] is preserved.
    const candles = rows.slice(-limit);
    const trimmed = Object.fromEntries(
      Object.entries(series).map(([key, values]) => [key, values.slice(-limit)])
    );

    res.status(HTTP_STATUS.OK).json({
      symbol,
      interval,
      count: candles.length,
      candles,
      indicators: trimmed,
    });
  })
);
