import { pool } from './db.js';
import { inspectGaps, runBackfill } from './backfill.js';
import { inspectRetention, pruneCandles } from './retention.js';
import { INTERVAL, SYMBOL } from './constants/binance.js';
import {
  AUDIT_INTERVAL_MS,
  AUDIT_STATUS,
  CROSS_CHECK_SAMPLE,
  MAX_CLOSE_JUMP_RATIO,
  SEVERITY,
  STALE_AFTER_INTERVALS,
} from './constants/audit.js';
import { LOG_AUDIT } from './constants/logging.js';
import {
  SQL_AUDIT_DUPLICATES,
  SQL_AUDIT_PRICE_JUMPS,
  SQL_AUDIT_RECENT_SAMPLE,
} from './constants/sql.js';
import { ROW_CHECKS, SEQUENCE_CHECKS, buildRowCheckQuery } from './utils/audit/checks.js';
import { crossCheckAgainstSource } from './utils/audit/crossCheck.js';
import { intervalToMs, latestClosedOpenTime } from './utils/shared/interval.js';

/**
 * Answers "is the candle data trustworthy?" across four independent axes:
 *
 *   COMPLETENESS  are any candles missing?          (reuses the backfill's gap scan)
 *   VALIDITY      does any candle contradict itself?
 *   FRESHNESS     has ingestion stalled?
 *   CORRECTNESS   does what we stored match the exchange?  (opt-in, costs a REST call)
 *
 * The first three are pure SQL and cheap enough to expose on a plain GET. The
 * fourth is the only one that can catch a candle which is internally perfect and
 * simply wrong, and the only one that spends an API request — so it is opt-in.
 */

const ROW_CHECK_QUERY = buildRowCheckQuery();

const summarise = (checks) => {
  const errors = checks.filter((c) => c.severity === SEVERITY.ERROR && c.violations > 0);
  const warnings = checks.filter((c) => c.severity === SEVERITY.WARNING && c.violations > 0);

  if (errors.length > 0) return { status: AUDIT_STATUS.ERROR, errors: errors.length, warnings: warnings.length };
  if (warnings.length > 0) return { status: AUDIT_STATUS.WARNING, errors: 0, warnings: warnings.length };

  return { status: AUDIT_STATUS.OK, errors: 0, warnings: 0 };
};

const toCheck = (definition, violations) => ({
  id: definition.id,
  label: definition.label,
  severity: definition.severity,
  why: definition.why,
  violations,
  passed: violations === 0,
});

/**
 * @param {object}  [options]
 * @param {boolean} [options.deep] also verify a sample against Binance
 */
export const runAudit = async ({
  symbol = SYMBOL,
  interval = INTERVAL,
  deep = false,
} = {}) => {
  const startedAt = Date.now();
  const intervalMs = intervalToMs(interval);

  // Independent queries, so run them together rather than in sequence.
  const [rowCounts, jumps, duplicates, gaps, retention] = await Promise.all([
    pool.query(ROW_CHECK_QUERY, [symbol, interval, intervalMs]),
    pool.query(SQL_AUDIT_PRICE_JUMPS, [symbol, interval, MAX_CLOSE_JUMP_RATIO]),
    pool.query(SQL_AUDIT_DUPLICATES, [symbol, interval]),
    inspectGaps({ symbol, interval }),
    inspectRetention(),
  ]);

  const counts = rowCounts.rows[0];

  const checks = [
    ...ROW_CHECKS.map((definition) => toCheck(definition, counts[definition.id])),
    ...SEQUENCE_CHECKS.map((definition) => toCheck(definition, jumps.rows[0].violations)),
    toCheck(
      {
        id: 'duplicateOpenTime',
        label: 'duplicate open_time',
        severity: SEVERITY.ERROR,
        why: 'The unique index should make this impossible; a hit means it is missing.',
      },
      duplicates.rows[0].violations
    ),
  ];

  // Freshness is about the newest candle's AGE, which no row-level check can
  // see — an empty table and a stalled ingester both pass every other test.
  const newestClosed = latestClosedOpenTime(intervalMs);
  const behind = gaps.newest === null
    ? null
    : Math.round((newestClosed - Number(gaps.newest)) / intervalMs);

  const freshness = {
    newest: gaps.newest === null ? null : Number(gaps.newest),
    intervalsBehind: behind,
    staleAfterIntervals: STALE_AFTER_INTERVALS,
    stale: behind === null || behind > STALE_AFTER_INTERVALS,
  };

  const summary = summarise(checks);

  const report = {
    symbol,
    interval,
    checkedAt: new Date().toISOString(),
    status: freshness.stale && summary.status === AUDIT_STATUS.OK
      ? AUDIT_STATUS.WARNING
      : summary.status,
    ...summary,
    candles: counts.total,
    completeness: {
      held: gaps.held,
      expected: gaps.expected,
      missing: gaps.missing,
      oldest: gaps.oldest === null ? null : Number(gaps.oldest),
      newest: gaps.newest === null ? null : Number(gaps.newest),
    },
    freshness,
    retention,
    checks,
    durationMs: Date.now() - startedAt,
  };

  if (deep) {
    const { rows } = await pool.query(SQL_AUDIT_RECENT_SAMPLE, [
      symbol,
      interval,
      CROSS_CHECK_SAMPLE,
    ]);

    report.source = await crossCheckAgainstSource({ symbol, interval, rows });

    if (report.source.mismatched > 0) report.status = AUDIT_STATUS.ERROR;
    report.durationMs = Date.now() - startedAt;
  }

  console.log(
    `${LOG_AUDIT} ${symbol} ${interval}: ${report.status} — ` +
    `${report.candles} candles, ${report.errors} error(s), ${report.warnings} warning(s), ` +
    `${report.completeness.missing} missing` +
    (report.source ? `, ${report.source.mismatched}/${report.source.compared} mismatched vs source` : '') +
    ` (${report.durationMs}ms)`
  );

  return report;
};

// ---------------------------------------------------------------------------
// Scheduled auditing
// ---------------------------------------------------------------------------

let auditTimer = null;

/**
 * Run the audit and act on what it finds.
 *
 * Acting is the point. An audit nobody reads is a report, not a guard — so a
 * completeness failure schedules the repair that fixes it, rather than waiting
 * for someone to notice a number on an endpoint.
 *
 * Validity failures deliberately do NOT self-heal: with the CHECK constraints
 * in place, a violated invariant means something wrote around the application
 * or the constraints are missing. That needs a human, not a retry.
 */
const auditAndRepair = async ({ symbol, interval, label }) => {
  try {
    // Prune BEFORE auditing: pruning raises min(open_time), so the gap scan
    // that follows will not treat the removed range as missing and refetch it.
    await pruneCandles();

    const report = await runAudit({ symbol, interval });

    if (report.errors > 0) {
      console.error(
        `${LOG_AUDIT} ${label}: ${report.errors} INTEGRITY ERROR(S) — ` +
        report.checks.filter((c) => !c.passed && c.severity === SEVERITY.ERROR)
          .map((c) => `${c.label} x${c.violations}`).join(', ')
      );
    }

    if (report.completeness.missing > 0) {
      console.warn(
        `${LOG_AUDIT} ${label}: ${report.completeness.missing} candle(s) missing — repairing`
      );
      await runBackfill({ symbol, interval });
    }

    return report;
  } catch (err) {
    // Auditing is a guard, not the product. It must never take down a server
    // that is otherwise ingesting and serving correctly.
    console.error(`${LOG_AUDIT} ${label} failed:`, err.message);
    return null;
  }
};

/**
 * Runs once at boot and then on an interval.
 *
 * The boot run matters most: it reports the state of the data the server is
 * about to serve, before anyone queries it. It logs rather than exits, because
 * the audit endpoint is how you would diagnose the problem — a server that
 * refuses to start over a data issue takes its own diagnostics down with it.
 */
export const startAuditSchedule = ({ symbol = SYMBOL, interval = INTERVAL } = {}) => {
  auditAndRepair({ symbol, interval, label: 'startup' });

  auditTimer = setInterval(
    () => auditAndRepair({ symbol, interval, label: 'scheduled' }),
    AUDIT_INTERVAL_MS
  );

  // Do not let the audit timer alone keep the process alive.
  auditTimer.unref();

  console.log(
    `${LOG_AUDIT} scheduled every ${AUDIT_INTERVAL_MS / 60000} minute(s)`
  );
};

export const stopAuditSchedule = () => {
  clearInterval(auditTimer);
  auditTimer = null;
};
