import { Router } from 'express';
import { SYMBOL } from '../constants/binance.js';
import { HTTP_STATUS } from '../constants/http.js';
import {
  ACTIVE_TIMEFRAMES,
  DEFAULT_TIMEFRAME,
  TIMEFRAMES,
  partitionFor,
  retentionFor,
} from '../constants/timeframes.js';
import { pool } from '../db.js';
import { SQL_TIMEFRAME_SUMMARY } from '../constants/sql.js';

export const timeframesRouter = Router();

/**
 * GET /api/timeframes
 *
 * Everything the UI needs to render a timeframe switcher without hardcoding
 * anything — the same reasoning as /api/strategy/status. Adding a timeframe on
 * the server makes it appear in the picker with zero frontend changes; a
 * hardcoded list would silently drift the day one is added or removed.
 *
 * Row counts come from the live tables rather than being assumed, so the UI can
 * grey out a timeframe that has no data yet — which is the normal state for 1d
 * in the first days of running.
 */
timeframesRouter.get('/timeframes', async (req, res, next) => {
  try {
    const symbol = String(req.query.symbol ?? SYMBOL).toUpperCase();
    const { rows } = await pool.query(SQL_TIMEFRAME_SUMMARY, [symbol]);

    const counts = new Map(rows.map((row) => [row.interval, row]));

    res.status(HTTP_STATUS.OK).json({
      symbol,
      default: DEFAULT_TIMEFRAME,
      timeframes: TIMEFRAMES.map((timeframe) => {
        const stored = counts.get(timeframe.id);

        return {
          id: timeframe.id,
          label: timeframe.label,
          ms: timeframe.ms,
          minutes: timeframe.minutes,
          active: ACTIVE_TIMEFRAMES.includes(timeframe.id),
          table: partitionFor(timeframe.id),
          retention: retentionFor(timeframe.id),
          count: stored ? Number(stored.count) : 0,
          oldest: stored ? Number(stored.oldest) : null,
          newest: stored ? Number(stored.newest) : null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});
