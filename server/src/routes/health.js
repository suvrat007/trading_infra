import { Router } from 'express';
import { pool } from '../db.js';
import { SQL_HEALTHCHECK } from '../constants/sql.js';
import { HTTP_STATUS } from '../constants/http.js';

export const healthRouter = Router();

/**
 * Reports the dependency, not just the process. A health check that returns
 * 200 while Postgres is unreachable tells an orchestrator nothing useful.
 */

healthRouter.get('/health', async (req, res) => {
  try {
    await pool.query(SQL_HEALTHCHECK);
    res.status(HTTP_STATUS.OK).json({ status: 'ok', db: 'up' });
  } catch (err) {
    res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({
      status: 'degraded',
      db: 'down',
      message: err.message,
    });
  }
});
