import { createApp } from './app.js';
import { assertDbReady, pool } from './db.js';
import { PORT, SHUTDOWN_TIMEOUT_MS } from './constants/http.js';
import { LOG_APP } from './constants/logging.js';
import { candles, startIngest, stopIngest } from './ingest.js';
import { startBroadcast, stopBroadcast } from './broadcast.js';

await assertDbReady();

const app = createApp();
const server = app.listen(PORT, () => {
  console.log(`${LOG_APP} REST API listening on http://localhost:${PORT}`);
});

// Wired here so neither side knows about the other: the ingester only emits,
// the broadcaster only consumes an EventEmitter.
startBroadcast(candles);
startIngest();

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return; // a second Ctrl+C should not race the first
  shuttingDown = true;

  console.log(`\n${LOG_APP} ${signal} — shutting down`);

  // If something is wedged, do not hang forever waiting on it.
  const forceExit = setTimeout(() => {
    console.error(`${LOG_APP} shutdown timed out — forcing exit`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  stopIngest();
  await stopBroadcast();
  await new Promise((resolve) => server.close(resolve)); // drain in-flight requests
  await pool.end();

  console.log(`${LOG_APP} clean exit`);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
