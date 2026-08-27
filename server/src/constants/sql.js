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
