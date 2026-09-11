/**
 * Integration test for the Node <-> C++ bridge, without the database, Binance
 * or the browser.
 *
 * Feeds a synthetic crossover sequence into a bare EventEmitter standing in for
 * the enriched candle stream, records what the JavaScript strategy decided for
 * each candle, and checks that the C++ engine returned the same decisions.
 *
 * Run:  EXECUTION_MODE=shadow node scripts/engine-shadow-test.mjs
 */
import { EventEmitter } from 'node:events';
import { EXECUTION_MODE } from '../src/constants/engine.js';
import { getEngineStats, startEngineBridge, stopEngineBridge } from '../src/engineBridge.js';
import { getComparisonStats, recordNodeDecision } from '../src/utils/engine/compare.js';

if (EXECUTION_MODE === 'node') {
  console.error('run with EXECUTION_MODE=shadow (or cpp)');
  process.exit(2);
}

// [ema9, ema21, what the JS crossover strategy decides]
const STEPS = [
  [null, null, 'HOLD'],
  [10, 20, 'HOLD'],
  [12, 20, 'HOLD'],
  [25, 20, 'BUY'],
  [26, 20, 'HOLD'],
  [20, 20, 'HOLD'],
  [27, 20, 'HOLD'],
  [15, 20, 'SELL'],
  [14, 20, 'HOLD'],
];

const source = new EventEmitter();
await startEngineBridge(source);

const base = 1788725400000;

for (let i = 0; i < STEPS.length; i += 1) {
  const [fast, slow, expected] = STEPS[i];
  const openTime = base + i * 60000;

  const indicators = { sma20: 79788, rsi14: 61.2 };
  if (fast !== null) {
    indicators.ema9 = fast;
    indicators.ema21 = slow;
  }

  // Stands in for what strategyRunner.onCandle records on the JS side.
  recordNodeDecision({ openTime, action: expected, strategyUs: 0 });

  source.emit('candle', {
    symbol: 'BTCUSDT',
    interval: '1m',
    open_time: openTime,
    open: '79776.60000000',
    high: '79810.00000000',
    low: '79770.10000000',
    close: `798${String(2 + i).padStart(2, '0')}.45000000`,
    volume: '12.48310000',
    indicators,
  });

  // The emitter is synchronous but the push is not; yield so each frame goes
  // out in order rather than nine at once.
  await new Promise((resolve) => setTimeout(resolve, 40));
}

await new Promise((resolve) => setTimeout(resolve, 1000));

const comparison = getComparisonStats();
const engine = getEngineStats();

console.log('\n-- bridge --');
console.log(`  mode          ${engine.mode}  (trading: ${engine.trading})`);
console.log(`  engine pid    ${engine.pid}`);
console.log(`  pushed        ${engine.pushed}`);
console.log(`  received      ${engine.received}`);
console.log(`  actionable    ${engine.actionable}`);
console.log(`  malformed     ${engine.malformed}`);
console.log(`  push failures ${engine.pushFailures}`);
console.log(`  return trip   p50=${engine.roundTripUs.p50}us  p95=${engine.roundTripUs.p95}us  max=${engine.roundTripUs.max}us`);

console.log('\n-- agreement --');
console.log(`  compared      ${comparison.compared}`);
console.log(`  agreed        ${comparison.agreed}`);
console.log(`  diverged      ${comparison.diverged}`);
console.log(`  pending       ${comparison.pending}`);
for (const d of comparison.divergences) {
  console.log(`    ${d.openTime}  node=${d.node}  cpp=${d.cpp}`);
}

await stopEngineBridge();

const ok = comparison.compared === STEPS.length
  && comparison.diverged === 0
  && engine.malformed === 0
  && engine.pushFailures === 0;

console.log(ok ? '\nPASS — both engines agreed on every candle' : '\nFAIL');
process.exit(ok ? 0 : 1);
