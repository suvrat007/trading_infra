import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Push, Pull } from 'zeromq';

import {
  ENGINE_AUTOSTART,
  ENGINE_BINARY,
  ENGINE_FAST_PERIOD,
  ENGINE_PULL_ENDPOINT,
  ENGINE_PUSH_ENDPOINT,
  ENGINE_SLOW_PERIOD,
  ENGINE_STARTUP_GRACE_MS,
  DECISION_HISTORY,
  ENGINE_TRADES,
  EXECUTION_MODE,
  LOG_ENGINE,
  LOG_ENGINE_OUT,
} from './constants/engine.js';
import { executeSignal } from './strategyRunner.js';
import { recordCppDecision } from './utils/engine/compare.js';
import { buildEngineFrame, isActionable, nowMicros, parseEngineSignal } from './utils/engine/frame.js';

/**
 * The seam between Node and the C++ execution engine.
 *
 * Another OBSERVER of the enriched stream, exactly like the strategy runner and
 * continuity: it subscribes, and emits nothing back into the pipeline. Removing
 * it is a one-line edit in index.js, and while it is absent nothing else
 * notices — which is the whole point of putting a second engine behind the same
 * interface the first one uses.
 *
 * Two sockets rather than one, because ZeroMQ sockets are unidirectional by
 * type. PUSH/PULL and not REQ/REP: a request-reply pair locks both sides into
 * strict alternation, so a single slow strategy call would block the next
 * candle from even being sent. PUSH/PULL lets candles flow while answers come
 * back independently.
 */

let push = null;
let pull = null;
let child = null;
let unsubscribe = null;
let reading = null;
let stopping = false;

const stats = {
  pushed: 0,
  received: 0,
  actionable: 0,
  malformed: 0,
  pushFailures: 0,
  roundTripUs: [],
  engineUs: [],
  strategyNs: [],
};

/**
 * When each candle was pushed, by open time, read by Node's own clock.
 *
 * The round trip is measured with ONE clock, start and finish, because the
 * obvious alternative does not work: subtracting a C++ system_clock timestamp
 * from a Node performance-clock timestamp produced round trips of -350us in
 * testing. Node derives its wall time as performance.timeOrigin (captured once,
 * at process start) plus a monotonic counter, so it drifts against the system
 * clock C++ reads. At microsecond resolution that drift is larger than the
 * thing being measured.
 *
 * The engine's own in->out figure stays trustworthy for the opposite reason: it
 * begins and ends inside one process, on one steady_clock.
 */
const pushedAtUs = new Map();

/**
 * Spawn the engine, or expect one already running.
 *
 * stdout is piped and re-logged with a prefix rather than inherited, so the
 * engine's output is distinguishable from Node's in a single terminal. The
 * engine sets its own stdout unbuffered, which is what makes that readable in
 * real time rather than in 4KB bursts.
 */
const spawnEngine = () => {
  if (!existsSync(ENGINE_BINARY)) {
    throw new Error(
      `engine binary not found at ${ENGINE_BINARY} — run engine/build.ps1, ` +
      `or set ENGINE_AUTOSTART=false to attach to one you started yourself`
    );
  }

  const args = [
    '--in', ENGINE_PUSH_ENDPOINT,
    '--out', ENGINE_PULL_ENDPOINT,
    '--fast', String(ENGINE_FAST_PERIOD),
    '--slow', String(ENGINE_SLOW_PERIOD),
  ];

  child = spawn(ENGINE_BINARY, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  const relay = (stream) => {
    stream.setEncoding('utf8');
    let partial = '';

    stream.on('data', (chunk) => {
      // A pipe chunk can split a line anywhere; holding the tail until the next
      // newline keeps log lines intact instead of interleaved mid-word.
      const lines = (partial + chunk).split('\n');
      partial = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) console.log(`${LOG_ENGINE_OUT} ${line.trimEnd()}`);
      }
    });
  };

  relay(child.stdout);
  relay(child.stderr);

  child.on('exit', (code, signal) => {
    const how = signal ? `signal ${signal}` : `code ${code}`;
    child = null;

    if (stopping) return;

    // Loud, and specific about the consequence. In cpp mode this means trading
    // has stopped, and nothing else in the process would reveal that.
    console.error(`${LOG_ENGINE} engine exited unexpectedly (${how})`);
    if (ENGINE_TRADES) {
      console.error(`${LOG_ENGINE} NO ENGINE IS TRADING — restart the server, or set EXECUTION_MODE=node`);
    }
  });

  console.log(`${LOG_ENGINE} spawned ${ENGINE_BINARY} (pid ${child.pid})`);
};

/** One signal frame back from C++. */
const onSignal = async (raw) => {
  const arrivedUs = nowMicros();
  const signal = parseEngineSignal(raw);

  if (!signal) {
    stats.malformed += 1;
    console.error(`${LOG_ENGINE} malformed signal frame (${stats.malformed} total)`);
    return;
  }

  stats.received += 1;

  // Same clock at both ends. `pushedAtUs` is consumed here so the map cannot
  // grow for the life of the process.
  const sentAtUs = pushedAtUs.get(signal.openTime) ?? null;
  pushedAtUs.delete(signal.openTime);

  const roundTripUs = sentAtUs === null ? null : arrivedUs - sentAtUs;
  if (roundTripUs !== null) stats.roundTripUs.push(roundTripUs);

  // The engine's own in->out figure, measured inside one process on one
  // steady_clock. Trustworthy in a way the cross-process numbers are not.
  if (Number.isFinite(signal.engineLatencyUs)) stats.engineUs.push(signal.engineLatencyUs);
  if (signal.strategyNs > 0) stats.strategyNs.push(signal.strategyNs);

  const comparison = recordCppDecision({
    openTime: signal.openTime,
    action: signal.action,
    engineLatencyUs: signal.engineLatencyUs,
    roundTripUs,
  });

  // A divergence means the two engines disagreed about the same candle. That is
  // the single most important thing this bridge can tell you, so it is logged
  // at error level even though nothing is broken.
  if (comparison && !comparison.agreed) {
    console.error(
      `${LOG_ENGINE} DIVERGENCE at ${comparison.openTime}: ` +
      `node=${comparison.node.action} cpp=${comparison.cpp.action}`
    );
  }

  if (!isActionable(signal)) return;
  stats.actionable += 1;

  if (!ENGINE_TRADES) {
    console.log(`${LOG_ENGINE} ${signal.action} ${signal.symbol} @ ${signal.price} (shadow — not executed)`);
    return;
  }

  try {
    await executeSignal({
      signal: signal.action,
      symbol: signal.symbol,
      price: signal.price,
      openTime: signal.openTime,
      strategyName: `${signal.strategyName} [C++]`,
    });
  } catch (err) {
    console.error(`${LOG_ENGINE} execution failed for ${signal.openTime}:`, err.message);
  }
};

/** Reads until the socket closes. Runs for the life of the process. */
const readLoop = async () => {
  try {
    for await (const [frame] of pull) {
      await onSignal(frame.toString());
    }
  } catch (err) {
    // Closing a socket while an await is pending rejects it; that is a normal
    // shutdown, not a failure.
    if (!stopping) console.error(`${LOG_ENGINE} read loop failed:`, err.message);
  }
};

const onCandle = async (candle) => {
  try {
    stats.pushed += 1;

    // Stamped before send() so the measurement includes serialisation and the
    // socket write, not just the wire.
    pushedAtUs.set(candle.open_time, nowMicros());

    // An engine that never answers would leak one entry per candle. 500 is the
    // same bound the decision ledger uses.
    if (pushedAtUs.size > DECISION_HISTORY) {
      pushedAtUs.delete(pushedAtUs.keys().next().value);
    }

    await push.send(JSON.stringify(buildEngineFrame(candle)));
  } catch (err) {
    // Pushing to the engine must never break the pipeline. A failure here costs
    // one candle of C++ analysis; throwing would cost the candle itself.
    stats.pushFailures += 1;
    console.error(`${LOG_ENGINE} push failed for ${candle.open_time}:`, err.message);
  }
};

export const startEngineBridge = async (source) => {
  stopping = false;

  if (ENGINE_AUTOSTART) spawnEngine();

  push = new Push();
  pull = new Pull();

  // Node connects, the engine binds. Connecting is the right side for the
  // process that restarts more often: a connecting peer reconnects on its own,
  // while a binding peer coming back has to reclaim the port.
  push.connect(ENGINE_PUSH_ENDPOINT);
  pull.connect(ENGINE_PULL_ENDPOINT);

  // Do not queue candles forever for an engine that is not there.
  push.sendTimeout = 1000;
  push.linger = 0;
  pull.linger = 0;

  reading = readLoop();

  // ZeroMQ connect is asynchronous. A candle sent before the handshake is
  // queued rather than lost, but a spawned engine also needs a moment to bind
  // its ports, and starting to push into that window makes the first round trip
  // look far slower than it is.
  if (ENGINE_AUTOSTART) {
    await new Promise((resolve) => setTimeout(resolve, ENGINE_STARTUP_GRACE_MS));
  }

  source.on('candle', onCandle);
  unsubscribe = () => source.off('candle', onCandle);

  console.log(
    `${LOG_ENGINE} bridge attached | mode=${EXECUTION_MODE} | ` +
    `push ${ENGINE_PUSH_ENDPOINT} -> pull ${ENGINE_PULL_ENDPOINT} | ` +
    `${ENGINE_TRADES ? 'C++ IS TRADING' : 'shadow only'}`
  );
};

const summarise = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  if (sorted.length === 0) return { count: 0, min: null, p50: null, p95: null, p99: null, max: null, mean: null };

  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const total = sorted.reduce((sum, value) => sum + value, 0);

  return {
    count: sorted.length,
    min: sorted[0],
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted.at(-1),
    mean: total / sorted.length,
  };
};

export const getEngineStats = () => {
  return {
    mode: EXECUTION_MODE,
    trading: ENGINE_TRADES,
    running: child !== null || !ENGINE_AUTOSTART,
    pid: child?.pid ?? null,
    pushed: stats.pushed,
    received: stats.received,
    actionable: stats.actionable,
    malformed: stats.malformed,
    pushFailures: stats.pushFailures,
    roundTripUs: summarise(stats.roundTripUs),
    engineUs: summarise(stats.engineUs),
    strategyNs: summarise(stats.strategyNs),
  };
};

/** Clears latency samples so a benchmark can discard its warmup pass. */
export const resetEngineStats = () => {
  stats.roundTripUs = [];
  stats.engineUs = [];
  stats.strategyNs = [];
};

export const stopEngineBridge = async () => {
  stopping = true;

  unsubscribe?.();
  unsubscribe = null;

  push?.close();
  pull?.close();
  await reading?.catch(() => {});

  push = null;
  pull = null;
  reading = null;
  pushedAtUs.clear();

  if (child) {
    // SIGTERM so the engine prints its latency report on the way out. It is a
    // child of this process, so leaving it running would orphan it.
    child.kill('SIGTERM');
    child = null;
  }

  console.log(`${LOG_ENGINE} bridge stopped`);
};
