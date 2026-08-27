import { ERROR_CODE, HTTP_STATUS } from '../constants/http.js';
import { LOG_HTTP } from '../constants/logging.js';
import { ApiError } from '../utils/http/errors.js';

/** Any route that fell through matched nothing. */
export function notFoundHandler(req, res) {
  res.status(HTTP_STATUS.NOT_FOUND).json({
    error: { code: ERROR_CODE.NOT_FOUND, message: `Cannot ${req.method} ${req.originalUrl}` },
  });
}

/**
 * The single exit point for every failure. 
 * it MUST take four arguments, even though `next` is unused here.
 */
export function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }

  console.error(`${LOG_HTTP} unhandled error on ${req.method} ${req.originalUrl}:`, err);

  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    error: { code: ERROR_CODE.INTERNAL, message: 'Internal server error' },
  });
}
