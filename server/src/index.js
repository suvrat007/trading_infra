import { createApp } from './app.js';
import { assertDbReady, pool } from './db.js';
import { PORT, SHUTDOWN_TIMEOUT_MS } from './constants/http.js';
import { LOG_APP } from './constants/logging.js';
import { startAuditSchedule, stopAuditSchedule } from './audit.js';
import { runBackfillAll } from './backfill.js';
import { startContinuityWatch, stopContinuityWatch } from './continuity.js';
import { candles, startIngest, stopIngest } from './ingest.js';
import { startIndicatorEngine, stopIndicatorEngine } from './indicatorEngine.js';
import { getBroker, startStrategyRunner, stopStrategyRunner } from './strategyRunner.js';
import { buildAccountMessage } from './utils/broadcast/message.js';
import { startBroadcast, stopBroadcast } from './broadcast.js';
import { startEngineBridge, stopEngineBridge } from './engineBridge.js';
import { ENGINE_ENABLED, EXECUTION_MODE, LOG_ENGINE } from './constants/engine.js';

await assertDbReady();

const app = createApp();
const server = app.listen(PORT, () => {
  console.log(`${LOG_APP} REST API listening on http://localhost:${PORT}`);
});

// The whole pipeline, wired here and nowhere else.
//
//   ingest ──emit──> indicators ──emit──> broadcast ──ws:8080──> browser
//      │                  │
//      │                  ├──> strategy runner ──> PaperBroker ──> trades/positions
//      │                  │
//      │                  └──> engine bridge ──zmq:5555──> C++ ──zmq:5556──┐
//      │                                                                   │
//      │                        (cpp mode) ─────> PaperBroker <────────────┘
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

// Another observer of the enriched stream. Started AFTER the strategy runner
// because in cpp mode its signals execute through the runner's broker.
if (ENGINE_ENABLED) {
  try {
    await startEngineBridge(enrichedCandles);
  } catch (err) {
    // A missing or broken engine binary must not stop the server. The
    // JavaScript strategy is still subscribed and, outside cpp mode, still
    // trading — so the system degrades to Phase 4 behaviour rather than dying.
    console.error(`${LOG_ENGINE} bridge failed to start: ${err.message}`);
    console.error(`${LOG_ENGINE} continuing without it (EXECUTION_MODE=${EXECUTION_MODE})`);
  }
}

startIngest({ onConnect: () => runBackfillAll() });
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
  await stopEngineBridge();
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
