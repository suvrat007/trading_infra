# Server — Phase 1: Live Market Data Pipeline

Three subsystems in one process, wired together only in `src/index.js`:

| Subsystem | Entry | Port | Responsibility |
|---|---|---|---|
| Ingest | `src/ingest.js` | — | Binance kline socket -> Postgres, emits `candle` |
| REST API | `src/app.js` | 4000 | `GET /api/candles`, `GET /api/health` |
| Broadcast | `src/broadcast.js` | 8080 | Fans saved candles out to browser clients |

Data flow:

```
Binance ws  ->  ingest.js  ->  Postgres
                    |
                    +-- candles.emit('candle')  ->  broadcast.js  ->  browser clients
```

`ingest.js` knows nothing about WebSocket clients; `broadcast.js` knows nothing
about Binance or Postgres. They meet only at the `EventEmitter` passed in by
`index.js`, which is why the broadcaster can be tested with a fake source.

## Layout

```
src/
├── index.js              boot + graceful shutdown (the only file wiring subsystems)
├── app.js                Express app factory, middleware order
├── db.js                 pg Pool + type parsers
├── ingest.js             Binance socket lifecycle
├── broadcast.js          WebSocket server lifecycle
│
├── constants/            one file per feature — no magic values in logic files
│   ├── env.js            dotenv anchored to server root, not cwd
│   ├── binance.js        SYMBOL, INTERVAL, stream URL
│   ├── connection.js     stale timeout, backoff bounds
│   ├── postgres.js       pool config, type OIDs
│   ├── sql.js            every SQL statement
│   ├── http.js           port, CORS origins, status + error codes
│   ├── candles.js        limits, symbol pattern, valid intervals
│   ├── websocket.js      port, heartbeat, backpressure cap, close codes
│   └── logging.js        log prefixes
│
├── utils/                grouped by which subsystem consumes them
│   ├── shared/time.js
│   ├── ingest/           kline.js  backoff.js  frame.js  logFormat.js
│   ├── broadcast/        client.js  message.js
│   └── http/             validate.js  errors.js  asyncHandler.js
│
├── middleware/           cors.js  requestLogger.js  errorHandler.js
└── routes/               candles.js  health.js
```

A helper used by exactly one subsystem lives under that subsystem's folder.
It moves to `shared/` only once a second subsystem imports it.

## Run

```bash
cp .env.example .env     # then set PGPASSWORD
npm start
```
