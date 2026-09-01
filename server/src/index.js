import { createApp } from './app.js';
import { assertDbReady, pool } from './db.js';
import { PORT, SHUTDOWN_TIMEOUT_MS } from './constants/http.js';
import { LOG_APP } from './constants/logging.js';
import { candles, startIngest, stopIngest } from './ingest.js';
import { startIndicatorEngine, stopIndicatorEngine } from './indicatorEngine.js';
import { startBroadcast, stopBroadcast } from './broadcast.js';

await assertDbReady();

const app = createApp();
const server = app.listen(PORT, () => {
  console.log(`${LOG_APP} REST API listening on http://localhost:${PORT}`);
});

// The whole pipeline, wired in one place and nowhere else:
//
//   ingest ──emit('candle')──> indicators ──emit('candle')──> broadcast
//
// Each stage only knows it consumes an EventEmitter and (for the middle stage)
// produces one. Removing indicators from the chain is `startBroadcast(candles)`.
const enrichedCandles = startIndicatorEngine(candles);
startBroadcast(enrichedCandles);
startIngest();

let shuttingDown = false;

async function shutdown(signal) {
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
  stopIndicatorEngine();
  await stopBroadcast();
  await new Promise((resolve) => server.close(resolve)); 
  await pool.end();

  console.log(`${LOG_APP} clean exit`);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
