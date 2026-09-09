import { Router } from 'express';
import { ERROR_CODE, HTTP_STATUS } from '../constants/http.js';
import {
  getStrategyStatus,
  startStrategy,
  stopStrategy,
} from '../strategyRunner.js';
import { ApiError } from '../utils/http/errors.js';
import { asyncHandler } from '../utils/http/asyncHandler.js';
import { parseStrategyBody } from '../utils/http/validate.js';

export const strategyRouter = Router();

/**
 * POST /api/strategy/start  { name, params }
 *
 * Strategy constructors throw TypeError on a bad period or an unknown
 * parameter. That is a client mistake, not a server fault, so it becomes a 400
 * carrying the constructor's message — which already names what is wrong and
 * lists what is valid.
 */
strategyRouter.post(
  '/strategy/start',
  asyncHandler(async (req, res) => {
    const { name, params } = parseStrategyBody(req.body);

    try {
      res.status(HTTP_STATUS.OK).json(startStrategy({ name, params }));
    } catch (err) {
      if (err instanceof TypeError) {
        throw ApiError.badRequest(ERROR_CODE.INVALID_STRATEGY, err.message);
      }
      throw err;
    }
  })
);

/** POST /api/strategy/stop — stop trading and liquidate at the last price. */
strategyRouter.post(
  '/strategy/stop',
  asyncHandler(async (req, res) => {
    res.status(HTTP_STATUS.OK).json(await stopStrategy());
  })
);

/** GET /api/strategy/status — what is running, and what the UI may offer. */
strategyRouter.get('/strategy/status', (req, res) => {
  res.status(HTTP_STATUS.OK).json(getStrategyStatus());
});
