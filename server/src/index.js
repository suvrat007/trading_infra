import { createApp } from './app.js';
import { assertDbReady, pool } from './db.js';
import { PORT, SHUTDOWN_TIMEOUT_MS } from './constants/http.js';
import { LOG_APP } from './constants/logging.js';
import { startAuditSchedule, stopAuditSchedule } from './audit.js';
import { runBackfill } from './backfill.js';
import { startContinuityWatch, stopContinuityWatch } from './continuity.js';
import { candles, startIngest, stopIngest } from './ingest.js';
import { startIndicatorEngine, stopIndicatorEngine } from './indicatorEngine.js';
import { getBroker, startStrategyRunner, stopStrategyRunner } from './strategyRunner.js';
import { buildAccountMessage } from './utils/broadcast/message.js';
import { startBroadcast, stopBroadcast } from './broadcast.js';

await assertDbReady();

const app = createApp();
const server = app.listen(PORT, () => {
  console.log(`${LOG_APP} REST API listening on http://localhost:${PORT}`);
});

// The whole pipeline, wired here and nowhere else.
//
//   ingest ──emit──> indicators ──emit──> broadcast ──ws:8080──> browser
//      │                  │
//      │                  └──> strategy runner ──> PaperBroker ──> trades/positions
//      │
//      └─ continuity watch (raw stream): a gap schedules a repair
//
// Repair has three triggers: reconnect, a gap in the live stream, and a
// scheduled audit. All converge on the same idempotent backfill.
const enrichedCandles = startIndicatorEngine(candles);

// Watches the RAW stream: a missing candle is an ingestion problem, and
// noticing it must not depend on indicators having succeeded.
startContinuityWatch(candles);

// Reads indicator values, so it must sit after the engine.
await startStrategyRunner(enrichedCandles);

startBroadcast(enrichedCandles, {
  snapshot: () => (getBroker() ? [buildAccountMessage(getBroker())] : []),
  // Live ticks bypass indicators and the strategy — chart only.
  tickSource: candles,
});

startIngest({ onConnect: () => runBackfill() });
startAuditSchedule();

let shuttingDown = false;

const shutdown = async (signal) => {
  if (shuttingDown) return; // a second Ctrl+C should not race the first
  shuttingDown = true;

  console.log(`\n${LOG_APP} ${signal} — shutting down`);

  const forceExit = setTimeout(() => {
    console.error(`${LOG_APP} shutdown timed out — forcing exit`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  // Pipeline order, so nothing emits into a closed stage.
  stopIngest();
  stopContinuityWatch();
  stopAuditSchedule();
  stopStrategyRunner();
  stopIndicatorEngine();
  await stopBroadcast();
  await new Promise((resolve) => server.close(resolve));
  await pool.end();

  console.log(`${LOG_APP} clean exit`);
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
