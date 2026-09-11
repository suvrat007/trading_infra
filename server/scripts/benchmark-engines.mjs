/**
 * Phase 5 benchmark: the JavaScript strategy path against the C++ engine path.
 *
 *   EXECUTION_MODE=shadow node scripts/benchmark-engines.mjs [candles]
 *
 * Measures three things, and is careful about what each one contains, because
 * the naive comparison — a JS function call against a C++ process round trip —
 * compares different work and flatters whichever side you framed generously.
 *
 *   strategy only   the crossover decision alone. The work Phase 5 set out to
 *                   move into C++.
 *   engine-equivalent
 *                   parse JSON -> decide -> serialise JSON. Exactly what the
 *                   C++ engine reports as its in->out time, so the JS number is
 *                   computed over the same span.
 *   round trip      Node -> ZeroMQ -> C++ -> ZeroMQ -> Node, timed on ONE clock
 *                   at both ends. What the system actually pays.
 *
 * Both paths run the same crossover over the same candles, and the run fails if
 * they ever disagree — a latency comparison between two implementations that
 * compute different things measures nothing.
 */
import { EventEmitter } from 'node:events';

import { EXECUTION_MODE } from '../src/constants/engine.js';
import { getEngineStats, resetEngineStats, startEngineBridge, stopEngineBridge } from '../src/engineBridge.js';
import { getComparisonStats, recordNodeDecision, resetComparison } from '../src/utils/engine/compare.js';
import { buildEngineFrame, nowMicros } from '../src/utils/engine/frame.js';
import { createStrategy } from '../src/utils/strategies/factory.js';

const CANDLES = Number(process.argv[2] || 500);
const WARMUP = 50;

if (EXECUTION_MODE === 'node') {
  console.error('run with EXECUTION_MODE=shadow');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Synthetic candles
//
// EMA values oscillate so the pair crosses roughly every 40 candles - frequent
// enough to exercise the signal path, rare enough to look like a real market.
// Prices are strings, as they are everywhere else in this system.
// ---------------------------------------------------------------------------
const makeCandles = (count) => {
  const out = [];

  for (let i = 0; i < count; i += 1) {
    const price = 79800 + Math.sin(i / 20) * 400;
    const fast = 100 + Math.sin(i / 20) * 12;
    const slow = 100 + Math.sin(i / 20 - 0.35) * 12;

    out.push({
      symbol: 'BTCUSDT',
      interval: '1m',
      open_time: 1788725400000 + i * 60000,
      open: price.toFixed(8),
      high: (price + 15).toFixed(8),
      low: (price - 15).toFixed(8),
      close: price.toFixed(8),
      volume: '12.48310000',
      indicators: { sma20: 79788, rsi14: 61.2, ema9: fast, ema21: slow },
    });
  }

  return out;
};

// ---------------------------------------------------------------------------

const stats = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const total = sorted.reduce((sum, value) => sum + value, 0);

  return {
    n: sorted.length,
    min: sorted[0],
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted.at(-1),
    mean: total / sorted.length,
  };
};

const row = (label, s) =>
  `  ${label.padEnd(20)} ${String(s.n).padStart(5)}  ` +
  `${String(s.min).padStart(7)}  ${String(s.p50).padStart(7)}  ` +
  `${String(s.p95).padStart(7)}  ${String(s.p99).padStart(7)}  ` +
  `${String(s.max).padStart(8)}  ${s.mean.toFixed(1).padStart(8)}`;

const header =
  `  ${'measurement'.padEnd(20)} ${'n'.padStart(5)}  ${'min'.padStart(7)}  ` +
  `${'p50'.padStart(7)}  ${'p95'.padStart(7)}  ${'p99'.padStart(7)}  ` +
  `${'max'.padStart(8)}  ${'mean'.padStart(8)}`;

// ---------------------------------------------------------------------------
// Path A — JavaScript, in process
// ---------------------------------------------------------------------------

/**
 * Nanoseconds, monotonic, valid only inside this process.
 *
 * process.hrtime.bigint() counts from an arbitrary origin, so it can never be
 * compared against a timestamp from the engine — but for timing one function
 * call it is the right instrument, and the only one here with the resolution to
 * see a crossover check at all.
 */
const hrNs = () => process.hrtime.bigint();

const runNodePath = (candles) => {
  const strategy = createStrategy('ema', { fastPeriod: 9, slowPeriod: 21 });
  const decisions = [];
  const strategyNs = [];
  const engineEquivalent = [];

  candles.forEach((candle, i) => {
    // The frame is built outside the timed region: the C++ engine does not pay
    // for building it either, Node does.
    const frame = JSON.stringify(buildEngineFrame(candle));

    const startEquivalent = nowMicros();
    const parsed = JSON.parse(frame);

    const startStrategy = hrNs();
    const signal = strategy.onCandle(parsed.candle, parsed.indicators);
    const endStrategy = hrNs();

    JSON.stringify({
      action: signal ?? 'HOLD',
      price: parsed.candle.close,
      timestamp: parsed.candle.open_time,
      strategyName: strategy.getName(),
      symbol: parsed.candle.symbol,
    });
    const endEquivalent = nowMicros();

    if (i >= WARMUP) {
      strategyNs.push(Number(endStrategy - startStrategy));
      engineEquivalent.push(endEquivalent - startEquivalent);
    }

    decisions.push(signal ?? 'HOLD');
  });

  return { decisions, strategyNs, engineEquivalent };
};

// ---------------------------------------------------------------------------
// Path B — C++, over ZeroMQ
// ---------------------------------------------------------------------------

const waitForCount = async (target) => {
  // Sequential: push one candle, wait for its answer, push the next. That is
  // how the real system behaves at one candle per minute. Pipelining all 500
  // would measure queue drain, not latency.
  const deadline = Date.now() + 10000;

  while (getComparisonStats().compared < target) {
    if (Date.now() > deadline) throw new Error(`engine stalled at ${getComparisonStats().compared}/${target}`);
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const runCppPath = async (candles, nodeDecisions) => {
  resetComparison();

  const source = new EventEmitter();
  await startEngineBridge(source);

  for (let i = 0; i < candles.length; i += 1) {
    // Same warmup discard as the JS pass: the first frames pay for a cold
    // instruction cache, first allocations and an unwarmed TCP path.
    if (i === WARMUP) resetEngineStats();

    recordNodeDecision({
      openTime: candles[i].open_time,
      action: nodeDecisions[i],
      strategyUs: 0,
    });

    source.emit('candle', candles[i]);
    await waitForCount(i + 1);
  }

  const engine = getEngineStats();
  const comparison = getComparisonStats();
  await stopEngineBridge();

  return { engine, comparison };
};

// ---------------------------------------------------------------------------

console.log(`\nPhase 5 benchmark — ${CANDLES} candles (first ${WARMUP} discarded as warmup)\n`);

const candles = makeCandles(CANDLES);

// Warm the JIT before the measured pass. V8 interprets first and only compiles
// a function once it has run enough times; timing a cold function measures the
// interpreter, which is not what this system runs in steady state.
runNodePath(candles.slice(0, WARMUP));

const node = runNodePath(candles);
const { engine, comparison } = await runCppPath(candles, node.decisions);

const buys = node.decisions.filter((d) => d === 'BUY').length;
const sells = node.decisions.filter((d) => d === 'SELL').length;

console.log(`signals: ${buys} BUY, ${sells} SELL, ${node.decisions.length - buys - sells} HOLD`);
console.log(`agreement: ${comparison.agreed}/${comparison.compared} candles, ${comparison.diverged} divergence(s)`);

if (comparison.diverged > 0) {
  for (const d of comparison.divergences.slice(0, 10)) {
    console.log(`   ${d.openTime}  node=${d.node}  cpp=${d.cpp}`);
  }
}

console.log(`\nall figures in MICROSECONDS\n`);
console.log(header);
console.log('  ' + '-'.repeat(78));
/** The bridge already summarises; rename its keys for the shared row printer. */
const asRow = (s) => ({
  n: s.count, min: s.min, p50: s.p50, p95: s.p95, p99: s.p99, max: s.max, mean: s.mean,
});

const jsStrategyNs = stats(node.strategyNs);
const jsEquivalent = stats(node.engineEquivalent);

console.log(row('js parse+run+ser', jsEquivalent));
console.log(row('c++ in->out', asRow(engine.engineUs)));
console.log(row('node->c++->node', asRow(engine.roundTripUs)));

console.log(`
  the strategy call alone, in NANOSECONDS`);
console.log(header);
console.log('  ' + '-'.repeat(78));
console.log(row('js onCandle', jsStrategyNs));
console.log(row('c++ onCandle', asRow(engine.strategyNs)));

const strategyRatio = jsStrategyNs.p50 / Math.max(1, engine.strategyNs.p50);
console.log(`
  javascript ${jsStrategyNs.p50}ns   c++ ${engine.strategyNs.p50}ns   ->  ${strategyRatio.toFixed(1)}x`);

// The only honest comparison is between spans that contain the same work.
const speedup = jsEquivalent.p50 / Math.max(1, engine.engineUs.p50);
const ipcOverhead = engine.roundTripUs.p50 - engine.engineUs.p50;
const endToEnd = engine.roundTripUs.p50 / Math.max(1, jsEquivalent.p50);

console.log(`\nlike for like — parse + decide + serialise, p50`);
console.log(
  `  javascript ${jsEquivalent.p50}us   c++ ${engine.engineUs.p50}us   ->  ` +
  (speedup >= 1 ? `${speedup.toFixed(1)}x faster in C++` : `${(1 / speedup).toFixed(1)}x SLOWER in C++`)
);

console.log(`\nwhat the system actually pays, p50`);
console.log(`  c++ work ${engine.engineUs.p50}us + IPC ${ipcOverhead}us = ${engine.roundTripUs.p50}us round trip`);
console.log(`  javascript stays in process at ${jsEquivalent.p50}us  ->  ${endToEnd.toFixed(1)}x SLOWER end to end`);

console.log(`\nbudget: one 1m candle every 60,000,000us`);
console.log(`  javascript ${((jsEquivalent.p50 / 60_000_000) * 100).toFixed(6)}%   c++ path ${((engine.roundTripUs.p50 / 60_000_000) * 100).toFixed(6)}%`);

console.log(`\npush failures: ${engine.pushFailures}, malformed: ${engine.malformed}\n`);

process.exit(comparison.diverged === 0 ? 0 : 1);
