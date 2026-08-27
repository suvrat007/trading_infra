import { Router } from 'express';
import { pool } from '../db.js';
import { SQL_SELECT_RECENT_CANDLES } from '../constants/sql.js';
import { HTTP_STATUS } from '../constants/http.js';
import { asyncHandler } from '../utils/http/asyncHandler.js';
import { parseCandlesQuery } from '../utils/http/validate.js';

export const candlesRouter = Router();

/**
 * GET /api/candles?symbol=BTCUSDT&interval=1m&limit=200
 * Returns the most recent `limit` candles, ordered oldest -> newest.
 */

candlesRouter.get('/candles', asyncHandler(async (req, res) => {
    const { symbol, interval, limit } = parseCandlesQuery(req.query);

    // Parameterized: $1/$2/$3 are sent separately from the SQL text, so a
    const { rows } = await pool.query(SQL_SELECT_RECENT_CANDLES, [symbol, interval, limit]);

    res.status(HTTP_STATUS.OK).json({
      symbol,
      interval,
      count: rows.length,
      candles: rows,
    });
  })
);
