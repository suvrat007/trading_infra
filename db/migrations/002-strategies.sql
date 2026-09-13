-- Migration 002 — user-built strategy documents
--
-- Run with:  psql -U postgres -d trading -f db/migrations/002-strategies.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS strategies (
    id          bigserial    PRIMARY KEY,
    name        varchar(80)  NOT NULL,
    document    jsonb        NOT NULL,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now()
);

-- Name is how a human refers to a strategy, so it has to be unique.
CREATE UNIQUE INDEX IF NOT EXISTS strategies_name_key ON strategies (lower(name));

-- Shape is enforced in JS by the validator, not here. These two catch a row
-- inserted by something that bypassed it — a psql session, a future importer.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'strategies_document_is_object') THEN
        ALTER TABLE strategies ADD CONSTRAINT strategies_document_is_object
            CHECK (jsonb_typeof(document) = 'object');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'strategies_document_has_trees') THEN
        ALTER TABLE strategies ADD CONSTRAINT strategies_document_has_trees
            CHECK (document ? 'entry' AND document ? 'exit' AND document ? 'timeframe');
    END IF;
END $$;
