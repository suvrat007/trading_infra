import { MAX_CLOSE_JUMP_RATIO, SEVERITY } from '../../constants/audit.js';

/**
 * Every per-row integrity check, as data.
 *
 * `condition` is a SQL boolean that is TRUE for a VIOLATING row. Adding a check
 * is one entry here — the query, the API response and the pass/fail summary all
 * derive from this list, so nothing can be added in one place and forgotten in
 * another.
 *
 * These strings are compile-time constants written by us, never user input, so
 * interpolating them into SQL is safe. Every VALUE the query needs (symbol,
 * interval, interval length) is still a bound parameter.
 */
export const ROW_CHECKS = [
  {
    id: 'highBelowLow',
    label: 'high < low',
    severity: SEVERITY.ERROR,
    why: 'The high must be the highest price in the bar.',
    condition: 'high < low',
  },
  {
    id: 'highNotHighest',
    label: 'high below open or close',
    severity: SEVERITY.ERROR,
    why: 'open and close both occur inside the bar, so neither can exceed the high.',
    condition: 'high < open OR high < close',
  },
  {
    id: 'lowNotLowest',
    label: 'low above open or close',
    severity: SEVERITY.ERROR,
    why: 'open and close both occur inside the bar, so neither can be below the low.',
    condition: 'low > open OR low > close',
  },
  {
    id: 'nonPositivePrice',
    label: 'price <= 0',
    severity: SEVERITY.ERROR,
    why: 'A traded price of zero or less is not a price.',
    condition: 'open <= 0 OR high <= 0 OR low <= 0 OR close <= 0',
  },
  {
    id: 'negativeVolume',
    label: 'volume < 0',
    severity: SEVERITY.ERROR,
    why: 'Volume may be zero, never negative.',
    condition: 'volume < 0',
  },
  {
    id: 'offGrid',
    label: 'open_time off the interval grid',
    severity: SEVERITY.ERROR,
    why: 'Candles open on exact interval boundaries; anything else is malformed.',
    // $3 is the interval length in ms, bound as a parameter.
    condition: 'open_time % $3 <> 0',
  },
  {
    id: 'recordedBeforeItOpened',
    label: 'created_at earlier than open_time',
    severity: SEVERITY.ERROR,
    why: 'We cannot have recorded a bar before it opened — implies clock skew or a bad import.',
    condition: 'created_at < to_timestamp(open_time / 1000.0)',
  },
  {
    id: 'zeroVolume',
    label: 'volume = 0',
    severity: SEVERITY.WARNING,
    why: 'Legal, but a bar in which nothing traded on a major pair is unusual.',
    condition: 'volume = 0',
  },
];

/**
 * Checks needing a window function, which cannot live in the same FILTER pass.
 */
export const SEQUENCE_CHECKS = [
  {
    id: 'impossibleJump',
    label: `close-to-close move > ${MAX_CLOSE_JUMP_RATIO * 100}%`,
    severity: SEVERITY.WARNING,
    why: 'Real during a liquidation cascade, but also what a decimal-point bug looks like.',
  },
];

export const ALL_CHECK_DEFINITIONS = [...ROW_CHECKS, ...SEQUENCE_CHECKS];

/**
 * One pass over the table producing every row-check count at once.
 *
 * `count(*) FILTER (WHERE ...)` lets Postgres evaluate all of them in a single
 * sequential scan. Running eight separate COUNT queries would scan eight times
 * for the same answer.
 */
export const buildRowCheckQuery = () => {
  const columns = ROW_CHECKS
    .map((check) => `count(*) FILTER (WHERE ${check.condition})::int AS "${check.id}"`)
    .join(',\n    ');

  return `
  SELECT
    count(*)::int AS "total",
    ${columns}
  FROM candles
  WHERE symbol = $1 AND "interval" = $2
`;
};
