import { createApp } from './app.js';
import { assertDbReady, pool } from './db.js';
import { PORT, SHUTDOWN_TIMEOUT_MS } from './constants/http.js';
import { LOG_APP } from './constants/logging.js';
import { startAuditSchedule, stopAuditSchedule } from './audit.js';
import { runBackfill } from './backfill.js';
import { startContinuityWatch, stopContinuityWatch } from './continuity.js';
import { candles, startIngest, stopIngest } from './ingest.js';
import { startIndicatorEngine, stopIndicatorEngine } from './indicatorEngine.js';
import { startBroadcast, stopBroadcast } from './broadcast.js';

await assertDbReady();

const app = createApp();
const server = app.listen(PORT, () => {
  console.log(`${LOG_APP} REST API listening on http://localhost:${PORT}`);
});

// The whole pipeline, wired in one place and nowhere else.
//
//   ingest ──emit('candle')──> indicators ──emit('candle')──> broadcast
//      │           │
//      │           └─ continuity watch: a gap in the stream schedules a repair
//      └─ on every (re)connect: backfill whatever the stream missed
//
//   audit: on boot and every 15 min — verifies integrity, repairs completeness
//
// Three independent triggers for the same repair, covering three different
// failure modes: a reconnect (we were away), a gap in the live stream (a write
// failed while we were here), and a scheduled sweep (something changed the data
// without going through us at all).
const enrichedCandles = startIndicatorEngine(candles);

// Watches the RAW ingest output, not the enriched stream: a missing candle is
// an ingestion problem, and noticing it should not depend on indicators having
// succeeded.
startContinuityWatch(candles);

startBroadcast(enrichedCandles);
startIngest({ onConnect: () => runBackfill() });
startAuditSchedule();

let shuttingDown = false;

const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\n${LOG_APP} ${signal} — shutting down`);

  // If something is wedged, do not hang forever waiting on it.
  const forceExit = setTimeout(() => {
    console.error(`${LOG_APP} shutdown timed out — forcing exit`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  // Tear down in pipeline order, so nothing emits into a closed stage.
  stopIngest();
  stopContinuityWatch();
  stopAuditSchedule();
  stopIndicatorEngine();
  await stopBroadcast();
  await new Promise((resolve) => server.close(resolve)); // drain in-flight requests
  await pool.end();

  console.log(`${LOG_APP} clean exit`);
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
