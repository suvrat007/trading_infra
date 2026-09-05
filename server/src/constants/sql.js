export const SQL_HEALTHCHECK = 'SELECT current_database() AS db, now() AS now';

export const SQL_INSERT_CANDLE = `
  INSERT INTO candles (symbol, "interval", open_time, open, high, low, close, volume)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  ON CONFLICT (symbol, "interval", open_time) DO NOTHING
  RETURNING id, created_at
`;

// The chart wants the newest N candles, drawn oldest -> newest.
// Inner query: ORDER BY open_time DESC + LIMIT walks the index backwards and
// stops after N rows — it never reads or sorts the rest of the table.
// Outer query: flips those N rows into ascending order for the client.
// Doing it in one pass (ORDER BY open_time ASC LIMIT N) would return the
// OLDEST N candles, which is the wrong end of the table.
export const SQL_SELECT_RECENT_CANDLES = `
  SELECT id, symbol, "interval", open_time, open, high, low, close, volume
  FROM (
    SELECT id, symbol, "interval", open_time, open, high, low, close, volume
    FROM candles
    WHERE symbol = $1 AND "interval" = $2
    ORDER BY open_time DESC
    LIMIT $3
  ) recent
  ORDER BY open_time ASC
`;

/** Oldest and newest candle we hold for one symbol/interval, plus the count. */
export const SQL_CANDLE_BOUNDS = `
  SELECT
    min(open_time) AS oldest,
    max(open_time) AS newest,
    count(*)::int  AS total
  FROM candles
  WHERE symbol = $1 AND "interval" = $2
`;

/**
 * Interior holes in the candle grid.
 *
 * generate_series lays down every open_time that SHOULD exist between the
 * oldest and newest rows we hold, at one interval per step; the anti-join keeps
 * only the ones that do not. This finds gaps in the middle of history — it
 * cannot find a gap at the end, because the series stops at the newest row we
 * have. The trailing gap (everything since our newest candle) is computed in
 * application code, which knows what time it is now.
 */
export const SQL_FIND_INTERIOR_GAPS = `
  WITH bounds AS (
    SELECT min(open_time) AS oldest, max(open_time) AS newest
    FROM candles
    WHERE symbol = $1 AND "interval" = $2
  ),
  expected AS (
    SELECT generate_series(bounds.oldest, bounds.newest, $3::bigint) AS open_time
    FROM bounds
    WHERE bounds.oldest IS NOT NULL
  )
  SELECT expected.open_time
  FROM expected
  LEFT JOIN candles c
    ON c.open_time = expected.open_time
   AND c.symbol = $1
   AND c."interval" = $2
  WHERE c.id IS NULL
  ORDER BY expected.open_time
  LIMIT $4
`;

/**
 * Rows whose close moved more than $3 (a ratio) from the previous close.
 *
 * Needs lag(), so it cannot join the single-pass FILTER query with the other
 * checks. Ordered by open_time within the symbol so "previous" means the
 * previous BAR, not the previous row the planner happened to emit.
 */
export const SQL_AUDIT_PRICE_JUMPS = `
  WITH ordered AS (
    SELECT
      open_time,
      close,
      lag(close) OVER (ORDER BY open_time) AS previous_close
    FROM candles
    WHERE symbol = $1 AND "interval" = $2
  )
  SELECT count(*)::int AS violations
  FROM ordered
  WHERE previous_close IS NOT NULL
    AND previous_close > 0
    AND abs(close - previous_close) / previous_close > $3
`;

/** Same-key rows, which the unique index should make impossible. */
export const SQL_AUDIT_DUPLICATES = `
  SELECT count(*)::int AS violations
  FROM (
    SELECT open_time
    FROM candles
    WHERE symbol = $1 AND "interval" = $2
    GROUP BY open_time
    HAVING count(*) > 1
  ) duplicated
`;

/** The most recent N candles, oldest first, for comparison against the source. */
export const SQL_AUDIT_RECENT_SAMPLE = `
  SELECT open_time, open, high, low, close, volume
  FROM (
    SELECT open_time, open, high, low, close, volume
    FROM candles
    WHERE symbol = $1 AND "interval" = $2
    ORDER BY open_time DESC
    LIMIT $3
  ) recent
  ORDER BY open_time ASC
`;
