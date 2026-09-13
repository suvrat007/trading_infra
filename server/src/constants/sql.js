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

// --- paper trading -----------------------------------------------------------

/** Timestamps arrive as epoch ms from the broker; Postgres wants an instant. */
export const SQL_INSERT_POSITION = `
  INSERT INTO positions (symbol, quantity, entry_price, opened_at)
  VALUES ($1, $2, $3, to_timestamp($4 / 1000.0))
  ON CONFLICT (symbol) DO NOTHING
  RETURNING id
`;

export const SQL_DELETE_POSITION = `
  DELETE FROM positions WHERE symbol = $1 RETURNING id
`;

export const SQL_SELECT_POSITIONS = `
  SELECT symbol, quantity, entry_price,
         (extract(epoch FROM opened_at) * 1000)::bigint AS opened_at
  FROM positions
  ORDER BY opened_at ASC
`;

export const SQL_INSERT_TRADE = `
  INSERT INTO trades (symbol, side, quantity, entry_price, exit_price, pnl, opened_at, closed_at)
  VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0), to_timestamp($8 / 1000.0))
  RETURNING id
`;

/** Newest first for the UI; the caller reverses when rehydrating the broker. */
export const SQL_SELECT_TRADES = `
  SELECT id, symbol, side, quantity, entry_price, exit_price, pnl,
         (extract(epoch FROM opened_at) * 1000)::bigint AS opened_at,
         (extract(epoch FROM closed_at) * 1000)::bigint AS closed_at
  FROM trades
  ORDER BY closed_at DESC, id DESC
  LIMIT $1
`;

export const SQL_SELECT_ALL_TRADES = `
  SELECT id, symbol, side, quantity, entry_price, exit_price, pnl,
         (extract(epoch FROM opened_at) * 1000)::bigint AS opened_at,
         (extract(epoch FROM closed_at) * 1000)::bigint AS closed_at
  FROM trades
  ORDER BY closed_at ASC, id ASC
`;

// --- retention ---------------------------------------------------------------

/** Every (symbol, interval) pair held, so a series orphaned by a config change is still pruned. */
export const SQL_DISTINCT_SERIES = `
  SELECT symbol, "interval", count(*)::int AS held
  FROM candles
  GROUP BY symbol, "interval"
  ORDER BY symbol, "interval"
`;

/**
 * Drop everything older than the Nth newest candle, keeping exactly N.
 *
 * OFFSET $3 - 1 lands on the Nth newest row; deleting strictly older than it
 * retains rows 1..N. (OFFSET $3 would find the N+1th and retain N+1.)
 *
 * The subquery walks the existing (symbol, interval, open_time DESC) index and
 * stops at row N, so the cutoff is an index scan rather than a sort.
 */
export const SQL_PRUNE_CANDLES = `
  DELETE FROM candles
  WHERE symbol = $1
    AND "interval" = $2
    AND open_time < (
      SELECT open_time
      FROM candles
      WHERE symbol = $1 AND "interval" = $2
      ORDER BY open_time DESC
      OFFSET ($3 - 1) LIMIT 1
    )
`;

/**
 * Row count and range per timeframe, for one symbol.
 *
 * Feeds the timeframe picker: a timeframe with zero rows is shown but
 * unselectable, which is the normal state for 1d during the first day of
 * running. Grouping by interval lets Postgres answer from each partition
 * separately rather than scanning one large table.
 */
export const SQL_TIMEFRAME_SUMMARY = `
  SELECT "interval",
         count(*)      AS count,
         min(open_time) AS oldest,
         max(open_time) AS newest
  FROM candles
  WHERE symbol = $1
  GROUP BY "interval"
`;

export const SQL_SELECT_STRATEGIES = `
  SELECT id, name, document, created_at, updated_at
  FROM strategies ORDER BY updated_at DESC
`;

export const SQL_SELECT_STRATEGY = `
  SELECT id, name, document, created_at, updated_at FROM strategies WHERE id = $1
`;

export const SQL_INSERT_STRATEGY = `
  INSERT INTO strategies (name, document) VALUES ($1, $2)
  RETURNING id, name, document, created_at, updated_at
`;

export const SQL_UPDATE_STRATEGY = `
  UPDATE strategies SET name = $2, document = $3, updated_at = now()
  WHERE id = $1
  RETURNING id, name, document, created_at, updated_at
`;

export const SQL_DELETE_STRATEGY = 'DELETE FROM strategies WHERE id = $1 RETURNING id';
