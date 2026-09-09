-- Phase 1: Live Market Data Pipeline
-- Run with:  psql -U postgres -d trading -f db/schema.sql
--
-- Idempotent: safe to re-run against an existing database.

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

-- Idempotency: Binance replays the same closed kline on reconnect, and the
-- backfill deliberately overlaps live data. This lets both use
-- INSERT ... ON CONFLICT DO NOTHING and need no coordination with each other.
CREATE UNIQUE INDEX IF NOT EXISTS candles_symbol_interval_open_time_key
    ON candles (symbol, "interval", open_time);

-- Read path: GET /api/candles?symbol=...&limit=200
-- ORDER BY open_time DESC LIMIT 200 becomes an index-only backward scan.
CREATE INDEX IF NOT EXISTS candles_symbol_interval_open_time_desc_idx
    ON candles (symbol, "interval", open_time DESC);


-- ---------------------------------------------------------------------------
-- Integrity constraints
--
-- These encode facts that are true of a candlestick BY DEFINITION, not
-- heuristics. A row breaking any of them is corrupt whatever produced it, so
-- the database refuses it rather than letting an audit discover it an hour
-- later. Prevention beats detection: there is no window in which bad data
-- exists, and every writer — live ingest, backfill, a psql session, a future
-- importer — is covered without having to remember.
--
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, hence the guards, which keep
-- this file re-runnable.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    -- The high is the highest price in the bar and the low is the lowest.
    -- Anything else is not a candle.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'candles_ohlc_ordered') THEN
        ALTER TABLE candles ADD CONSTRAINT candles_ohlc_ordered CHECK (
            high >= low
            AND high >= open AND high >= close
            AND low  <= open AND low  <= close
        );
    END IF;

    -- A traded price of zero or less is not a price.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'candles_prices_positive') THEN
        ALTER TABLE candles ADD CONSTRAINT candles_prices_positive CHECK (
            open > 0 AND high > 0 AND low > 0 AND close > 0
        );
    END IF;

    -- Volume may be zero (a bar in which nothing traded) but never negative.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'candles_volume_non_negative') THEN
        ALTER TABLE candles ADD CONSTRAINT candles_volume_non_negative CHECK (volume >= 0);
    END IF;

    -- open_time is epoch MILLISECONDS. Rejecting values below 2001-09-09
    -- catches the single most likely unit mistake — seconds passed as
    -- milliseconds — which would otherwise silently place bars in 1970.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'candles_open_time_is_millis') THEN
        ALTER TABLE candles ADD CONSTRAINT candles_open_time_is_millis CHECK (
            open_time > 1000000000000
        );
    END IF;
END $$;

-- Grid alignment (open_time being an exact multiple of the interval) is
-- deliberately NOT a constraint: the multiplier depends on the `interval`
-- column, so the CHECK would need a CASE listing every interval and would have
-- to be rewritten each time one is added. It is an audit check instead.


-- ---------------------------------------------------------------------------
-- Phase 3: paper trading
-- ---------------------------------------------------------------------------

-- Closed round trips. Append-only; a trade is never updated after it lands.
CREATE TABLE IF NOT EXISTS trades (
    id           serial PRIMARY KEY,
    symbol       varchar(20)   NOT NULL,
    side         varchar(4)    NOT NULL,
    -- numeric, not integer: enabling fractional units later needs no migration.
    quantity     numeric(28,8) NOT NULL,
    entry_price  numeric(18,8) NOT NULL,
    exit_price   numeric(18,8) NOT NULL,
    pnl          numeric(28,8) NOT NULL,
    opened_at    timestamptz   NOT NULL,
    closed_at    timestamptz   NOT NULL DEFAULT now()
);

-- Open positions. One row per symbol, mirroring the broker's invariant.
CREATE TABLE IF NOT EXISTS positions (
    id           serial PRIMARY KEY,
    symbol       varchar(20)   NOT NULL,
    quantity     numeric(28,8) NOT NULL,
    entry_price  numeric(18,8) NOT NULL,
    opened_at    timestamptz   NOT NULL DEFAULT now()
);

-- One open position per symbol, enforced here rather than trusted in memory.
CREATE UNIQUE INDEX IF NOT EXISTS positions_symbol_key ON positions (symbol);

-- Trade history is read newest-first.
CREATE INDEX IF NOT EXISTS trades_closed_at_desc_idx ON trades (closed_at DESC);
CREATE INDEX IF NOT EXISTS trades_symbol_closed_at_idx ON trades (symbol, closed_at DESC);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trades_side_valid') THEN
        ALTER TABLE trades ADD CONSTRAINT trades_side_valid CHECK (side IN ('BUY', 'SELL'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trades_amounts_positive') THEN
        ALTER TABLE trades ADD CONSTRAINT trades_amounts_positive CHECK (
            quantity > 0 AND entry_price > 0 AND exit_price > 0
        );
    END IF;

    -- PnL must equal the arithmetic that produced it. Catches a broker bug or a
    -- hand-edited row; direction depends on which way the position was held.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trades_pnl_consistent') THEN
        ALTER TABLE trades ADD CONSTRAINT trades_pnl_consistent CHECK (
            (side = 'BUY'  AND pnl = (exit_price - entry_price) * quantity)
            OR
            (side = 'SELL' AND pnl = (entry_price - exit_price) * quantity)
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trades_closed_after_open') THEN
        ALTER TABLE trades ADD CONSTRAINT trades_closed_after_open CHECK (closed_at >= opened_at);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'positions_amounts_positive') THEN
        ALTER TABLE positions ADD CONSTRAINT positions_amounts_positive CHECK (
            quantity > 0 AND entry_price > 0
        );
    END IF;
END $$;
