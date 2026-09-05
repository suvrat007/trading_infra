import { Router } from 'express';
import { runAudit } from '../audit.js';
import { AUDIT_STATUS } from '../constants/audit.js';
import { HTTP_STATUS } from '../constants/http.js';
import { asyncHandler } from '../utils/http/asyncHandler.js';
import { parseAuditQuery } from '../utils/http/validate.js';

export const auditRouter = Router();

/**
 * GET /api/audit?symbol=BTCUSDT&interval=1m&deep=true
 *
 * Reports data integrity across completeness, validity, freshness and — with
 * deep=true — correctness against the exchange.
 *
 * Returns 200 even when the data is broken: the REQUEST succeeded, and the
 * finding is the payload. A 500 would mean "the audit failed to run", which is
 * a different thing entirely and would be indistinguishable to a caller.
 * Callers branch on `status`.
 */
auditRouter.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const { symbol, interval, deep } = parseAuditQuery(req.query);
    const report = await runAudit({ symbol, interval, deep });

    res.status(HTTP_STATUS.OK).json(report);
  })
);

/**
 * GET /api/audit/health
 *
 * The same signal reduced to one line, for a monitor that wants a probe rather
 * than a report. This one DOES use the status code, because that is the entire
 * interface a probe consumes.
 */
auditRouter.get(
  '/audit/health',
  asyncHandler(async (req, res) => {
    const { symbol, interval } = parseAuditQuery(req.query);
    const report = await runAudit({ symbol, interval });

    const healthy = report.status === AUDIT_STATUS.OK;

    res.status(healthy ? HTTP_STATUS.OK : HTTP_STATUS.SERVICE_UNAVAILABLE).json({
      status: report.status,
      candles: report.candles,
      missing: report.completeness.missing,
      intervalsBehind: report.freshness.intervalsBehind,
      errors: report.errors,
      warnings: report.warnings,
    });
  })
);
