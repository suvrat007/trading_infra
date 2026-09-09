import { Router } from 'express';
import { HTTP_STATUS } from '../constants/http.js';
import { getBroker, getStrategy } from '../strategyRunner.js';
import { loadTrades } from '../utils/broker/persistence.js';
import { asyncHandler } from '../utils/http/asyncHandler.js';
import { parseTradesQuery } from '../utils/http/validate.js';

export const accountRouter = Router();

/**
 * Trades come from the TABLE, positions and balance from the BROKER.
 *
 * Not an inconsistency: the table is the durable log and pages cheaply, while
 * only the broker holds the live mark price that unrealized PnL needs.
 */

const noBroker = (res) =>
  res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({
    error: { code: 'STRATEGY_NOT_RUNNING', message: 'The strategy runner has not started' },
  });

/** GET /api/trades?limit=200 — closed round trips, newest first. */
accountRouter.get(
  '/trades',
  asyncHandler(async (req, res) => {
    const { limit } = parseTradesQuery(req.query);
    const trades = await loadTrades(limit);

    res.status(HTTP_STATUS.OK).json({ count: trades.length, trades });
  })
);

/** GET /api/positions — open positions, marked to the latest price. */
accountRouter.get('/positions', (req, res) => {
  const broker = getBroker();
  if (!broker) return noBroker(res);

  const positions = broker.getPositions();
  res.status(HTTP_STATUS.OK).json({ count: positions.length, positions });
});

/** GET /api/balance — cash, equity and PnL. */
accountRouter.get('/balance', (req, res) => {
  const broker = getBroker();
  if (!broker) return noBroker(res);

  const strategy = getStrategy();

  res.status(HTTP_STATUS.OK).json({
    ...broker.getSummary(),
    strategy: strategy ? strategy.describe() : null,
  });
});
