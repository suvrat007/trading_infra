-- Migration 001 — one physical table per timeframe
--
-- Turns `candles` into a LIST-partitioned table keyed on "interval", giving a
-- real separate table per timeframe (candles_1m, candles_5m, candles_15m,
-- candles_1h, candles_1d) while every query against `candles` keeps working.
--
-- All five are native Binance kline intervals, so every bar is what the
-- exchange published — nothing here is aggregated.
--
-- Why partitioning rather than five hand-written tables:
--
--   * Every query, the audit, backfill, retention and the REST layer already
--     take `interval` as a parameter. Five real tables would mean rewriting all
--     of them to pick a table name, and a table name cannot be parameterised —
--     it would have to be interpolated, which is where SQL injection lives.
--   * Postgres routes INSERTs to the right partition and prunes partitions on
--     SELECT, so reading 1m data never touches the 1d table.
--   * DROP TABLE candles_5m still works. So does \dt. They ARE separate tables.
--
-- Run with:  psql -U postgres -d trading -f db/migrations/001-partition-candles.sql
--
-- Safe to re-run: does nothing if `candles` is already partitioned.

BEGIN;

DO $$
DECLARE
    already_partitioned boolean;
    source_rows bigint;
    copied_rows bigint;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM pg_partitioned_table p
        JOIN pg_class c ON c.oid = p.partrelid
        WHERE c.relname = 'candles'
    ) INTO already_partitioned;

    IF already_partitioned THEN
        RAISE NOTICE 'candles is already partitioned — nothing to do';
        RETURN;
    END IF;

    -- -----------------------------------------------------------------------
    -- 1. The partitioned parent.
    --
    -- `id` is a plain bigserial, NOT the primary key. Postgres requires every
    -- unique index on a partitioned table to contain the partition key, and
    -- `id` alone does not — so the identity of a candle is what it always
    -- really was: (symbol, interval, open_time). `id` survives only because
    -- SQL_INSERT_CANDLE does RETURNING id.
    -- -----------------------------------------------------------------------
    CREATE TABLE candles_partitioned (
        id          bigserial     NOT NULL,
        symbol      varchar(20)   NOT NULL,
        "interval"  varchar(10)   NOT NULL,
        open_time   bigint        NOT NULL,
        open        numeric(18,8) NOT NULL,
        high        numeric(18,8) NOT NULL,
        low         numeric(18,8) NOT NULL,
        close       numeric(18,8) NOT NULL,
        volume      numeric(28,8) NOT NULL,
        created_at  timestamptz   NOT NULL DEFAULT now(),

        CONSTRAINT candles_ohlc_ordered CHECK (
            high >= low
            AND high >= open AND high >= close
            AND low  <= open AND low  <= close
        ),
        CONSTRAINT candles_prices_positive CHECK (
            open > 0 AND high > 0 AND low > 0 AND close > 0
        ),
        CONSTRAINT candles_volume_not_negative CHECK (volume >= 0),
        CONSTRAINT candles_open_time_sane CHECK (open_time > 0)
    ) PARTITION BY LIST ("interval");

    -- -----------------------------------------------------------------------
    -- 2. One partition per timeframe.
    --
    -- Must match constants/timeframes.js. A row whose interval has no partition
    -- is REJECTED rather than silently stored, which is the behaviour we want:
    -- an unknown timeframe is a bug, not data.
    -- -----------------------------------------------------------------------
    CREATE TABLE candles_1m  PARTITION OF candles_partitioned FOR VALUES IN ('1m');
    CREATE TABLE candles_5m  PARTITION OF candles_partitioned FOR VALUES IN ('5m');
    CREATE TABLE candles_15m PARTITION OF candles_partitioned FOR VALUES IN ('15m');
    CREATE TABLE candles_1h  PARTITION OF candles_partitioned FOR VALUES IN ('1h');
    CREATE TABLE candles_1d  PARTITION OF candles_partitioned FOR VALUES IN ('1d');

    -- Idempotency for ingest and backfill, and the identity of a candle.
    --
    -- Built under a temporary name: index names are unique per SCHEMA, not per
    -- table, so the live table's index still owns the real name until it is
    -- renamed out of the way in step 4.
    CREATE UNIQUE INDEX candles_partitioned_key
        ON candles_partitioned (symbol, "interval", open_time);

    -- -----------------------------------------------------------------------
    -- 3. Copy every existing row, then PROVE the counts match before the swap.
    -- -----------------------------------------------------------------------
    SELECT count(*) INTO source_rows FROM candles;

    INSERT INTO candles_partitioned
        (symbol, "interval", open_time, open, high, low, close, volume, created_at)
    SELECT symbol, "interval", open_time, open, high, low, close, volume, created_at
    FROM candles;

    SELECT count(*) INTO copied_rows FROM candles_partitioned;

    IF copied_rows <> source_rows THEN
        RAISE EXCEPTION 'row count mismatch: % source, % copied — rolling back',
            source_rows, copied_rows;
    END IF;

    RAISE NOTICE 'copied % rows into partitions', copied_rows;

    -- -----------------------------------------------------------------------
    -- 4. Swap. The old table is KEPT as candles_legacy, not dropped — verify
    --    the application first, then drop it by hand.
    -- -----------------------------------------------------------------------
    -- Free the canonical index names before claiming them. The DESC index is
    -- deliberately NOT recreated: it took 344 scans against the unique index's
    -- 15,881 while being 30% larger, so it dies with the legacy table.
    ALTER INDEX candles_symbol_interval_open_time_key RENAME TO candles_legacy_key;
    ALTER INDEX candles_symbol_interval_open_time_desc_idx RENAME TO candles_legacy_desc_idx;

    ALTER TABLE candles RENAME TO candles_legacy;
    ALTER TABLE candles_partitioned RENAME TO candles;
    ALTER INDEX candles_partitioned_key RENAME TO candles_symbol_interval_open_time_key;

    RAISE NOTICE 'swapped. old table kept as candles_legacy — drop it once verified';
END $$;

COMMIT;
