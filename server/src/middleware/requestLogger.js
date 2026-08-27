import { LOG_HTTP } from '../constants/logging.js';

/**
 * Logs on 'finish' rather than on entry, so the line carries the status code
 * and real duration. process.hrtime.bigint() is monotonic — unlike Date.now(),
 * an NTP correction cannot make a duration come out negative.
 */
export function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    console.log(
      `${LOG_HTTP} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`
    );
  });

  next();
}
