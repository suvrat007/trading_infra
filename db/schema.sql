
CREATE TABLE IF NOT EXISTS candles (
    id          serial PRIMARY KEY,
    symbol      varchar(20)  NOT NULL,
    "interval"  varchar(10)  NOT NULL,
    open_time   bigint       NOT NULL,
    open        numeric(18,8) NOT NULL,
    high        numeric(18,8) NOT NULL,
    low         numeric(18,8) NOT NULL,
    close       numeric(18,8) NOT NULL,
    volume      numeric(28,8) NOT NULL,
    created_at  timestamptz  NOT NULL DEFAULT now()
);

-- Idempotency: Binance replays the same closed kline on reconnect.
-- This lets the ingester use INSERT ... ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX IF NOT EXISTS candles_symbol_interval_open_time_key
    ON candles (symbol, "interval", open_time);

-- Read path: GET /api/candles?symbol=...&limit=200
-- ORDER BY open_time DESC LIMIT 200 becomes an index-only backward scan.
CREATE INDEX IF NOT EXISTS candles_symbol_interval_open_time_desc_idx
    ON candles (symbol, "interval", open_time DESC);
