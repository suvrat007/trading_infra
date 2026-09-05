import test from 'node:test';
import assert from 'node:assert/strict';

import { Strategy } from '../src/strategies/Strategy.js';
import { EMAStrategy } from '../src/strategies/EMAStrategy.js';
import { RSIStrategy } from '../src/strategies/RSIStrategy.js';
import { MACDStrategy } from '../src/strategies/MACDStrategy.js';
import { createCrossTracker } from '../src/utils/strategies/cross.js';
import { CROSS, SIGNAL } from '../src/constants/strategies.js';

const candle = { open_time: 1, close: '100' };

/** Feed a strategy a sequence of indicator payloads, collect the signals. */
const run = (strategy, payloads) => payloads.map((p) => strategy.onCandle(candle, p));

// ---------------------------------------------------------------------------
// cross tracker
// ---------------------------------------------------------------------------

test('crossTracker: needs two observations before it can report a cross', () => {
  const cross = createCrossTracker();
  assert.equal(cross.update(5, 3), null, 'first observation only establishes the side');
  assert.equal(cross.previousAbove, true);
  assert.equal(cross.update(6, 3), null, 'same side is not a cross');
  assert.equal(cross.update(2, 3), CROSS.DOWN);
  assert.equal(cross.update(4, 3), CROSS.UP);
});

test('crossTracker: nulls are warmup, not zero, and do not advance state', () => {
  const cross = createCrossTracker();
  assert.equal(cross.update(null, 3), null);
  assert.equal(cross.update(5, null), null);
  assert.equal(cross.update(undefined, 3), null);
  assert.equal(cross.update(NaN, 3), null);
  assert.equal(cross.previousAbove, null, 'no state recorded from warmup values');

  assert.equal(cross.update(5, 3), null, 'first REAL value still just establishes the side');
  assert.equal(cross.update(1, 3), CROSS.DOWN);
});

test('crossTracker: exact equality carries no direction and preserves the side', () => {
  const cross = createCrossTracker();
  cross.update(5, 3);                                  // above
  assert.equal(cross.update(3, 3), null, 'touching is not crossing');
  assert.equal(cross.previousAbove, true, 'side preserved through the touch');
  assert.equal(cross.update(6, 3), null, 'came back the same way: still not a cross');
  assert.equal(cross.update(1, 3), CROSS.DOWN, 'genuine cross still detected');
});

test('crossTracker: reset forgets the side', () => {
  const cross = createCrossTracker();
  cross.update(5, 3);
  cross.reset();
  assert.equal(cross.previousAbove, null);
  assert.equal(cross.update(1, 3), null, 'no cross without a previous side');
});

// ---------------------------------------------------------------------------
// abstract base
// ---------------------------------------------------------------------------

test('Strategy: cannot be instantiated directly', () => {
  assert.throws(() => new Strategy('x'), TypeError);
});

test('Strategy: subclass must implement onCandle', () => {
  class Incomplete extends Strategy {
    constructor() { super('incomplete'); }
  }
  assert.throws(() => new Incomplete().onCandle(candle, {}), /must implement onCandle/);
});

test('Strategy: params are frozen so recorded trades keep their meaning', () => {
  const strategy = new EMAStrategy();
  assert.throws(() => { strategy.getParams().fastPeriod = 5; }, TypeError);
  assert.equal(strategy.getParams().fastPeriod, 20);
});

test('Strategy: name and params are reported', () => {
  const strategy = new EMAStrategy({ fastPeriod: 20, slowPeriod: 50 });
  assert.equal(strategy.getName(), 'EMA 20/50 Crossover');
  assert.deepEqual(strategy.getParams(), { fastPeriod: 20, slowPeriod: 50 });
  assert.deepEqual(strategy.requiredIndicators(), ['ema20', 'ema50']);
  assert.equal(strategy.describe().type, 'EMAStrategy');
});

// ---------------------------------------------------------------------------
// EMA
// ---------------------------------------------------------------------------

test('EMAStrategy: signals only on the crossing candle', () => {
  const strategy = new EMAStrategy();
  const signals = run(strategy, [
    { ema20: 10, ema50: 12 },   // below — establishes side
    { ema20: 11, ema50: 12 },   // still below
    { ema20: 13, ema50: 12 },   // crossed up
    { ema20: 15, ema50: 12 },   // still above: no repeat
    { ema20: 11, ema50: 12 },   // crossed down
    { ema20: 10, ema50: 12 },   // still below
  ]);

  assert.deepEqual(signals, [null, null, SIGNAL.BUY, null, SIGNAL.SELL, null]);
});

test('EMAStrategy: stays silent through warmup and a null payload', () => {
  const strategy = new EMAStrategy();
  const signals = run(strategy, [
    null,                        // engine failed entirely
    { ema20: null, ema50: null },
    { ema20: 10, ema50: null },  // partially warmed
    { ema20: 10, ema50: 12 },    // first usable: side only
    { ema20: 13, ema50: 12 },    // now a cross
  ]);

  assert.deepEqual(signals, [null, null, null, null, SIGNAL.BUY]);
});

test('EMAStrategy: rejects bad parameters at construction', () => {
  assert.throws(() => new EMAStrategy({ fastPeriod: 50, slowPeriod: 20 }), /must be smaller/);
  assert.throws(() => new EMAStrategy({ fastPeriod: 0, slowPeriod: 20 }), /positive integer/);
  assert.throws(() => new EMAStrategy({ fastPerid: 20 }), /unknown parameter/);
  // The engine computes ema20 and ema50 only.
  assert.throws(() => new EMAStrategy({ fastPeriod: 12, slowPeriod: 26 }), /does not compute/);
});

// ---------------------------------------------------------------------------
// RSI
// ---------------------------------------------------------------------------

test('RSIStrategy: fires on the crossing, not on every candle beyond the band', () => {
  const strategy = new RSIStrategy();
  const signals = run(strategy, [
    { rsi14: 50 },   // establishes both sides
    { rsi14: 28 },   // crossed below 30 -> BUY
    { rsi14: 22 },   // still oversold: silent, does NOT average in
    { rsi14: 25 },   // still oversold
    { rsi14: 45 },   // back inside the band: silent
    { rsi14: 75 },   // crossed above 70 -> SELL
    { rsi14: 80 },   // still overbought: silent
    { rsi14: 60 },   // back inside
    { rsi14: 20 },   // crossed below 30 again -> BUY
  ]);

  assert.deepEqual(signals, [
    null, SIGNAL.BUY, null, null, null, SIGNAL.SELL, null, null, SIGNAL.BUY,
  ]);
});

test('RSIStrategy: a violent move through both bands is two separate events', () => {
  const strategy = new RSIStrategy();
  run(strategy, [{ rsi14: 50 }]);

  assert.equal(strategy.onCandle(candle, { rsi14: 15 }), SIGNAL.BUY);
  assert.equal(strategy.onCandle(candle, { rsi14: 85 }), SIGNAL.SELL,
    'crossing up through 70 is detected even though it also left the oversold band');
});

test('RSIStrategy: custom thresholds and validation', () => {
  const strategy = new RSIStrategy({ oversold: 20, overbought: 80 });
  assert.equal(strategy.getName(), 'RSI 14 (20/80)');
  run(strategy, [{ rsi14: 50 }]);
  assert.equal(strategy.onCandle(candle, { rsi14: 25 }), null, '25 is not below 20');
  assert.equal(strategy.onCandle(candle, { rsi14: 15 }), SIGNAL.BUY);

  assert.throws(() => new RSIStrategy({ oversold: 70, overbought: 30 }), /must be smaller/);
  assert.throws(() => new RSIStrategy({ oversold: -5 }), /between 0 and 100/);
  assert.throws(() => new RSIStrategy({ overbought: 150 }), /between 0 and 100/);
  assert.throws(() => new RSIStrategy({ period: 9 }), /does not compute/);
});

// ---------------------------------------------------------------------------
// MACD
// ---------------------------------------------------------------------------

test('MACDStrategy: crosses of the signal line', () => {
  const strategy = new MACDStrategy();
  const signals = run(strategy, [
    { macd: -5, macdSignal: -2 },
    { macd: -1, macdSignal: -2 },  // crossed up
    { macd: 3, macdSignal: -2 },   // still above
    { macd: -4, macdSignal: -2 },  // crossed down
  ]);

  assert.deepEqual(signals, [null, SIGNAL.BUY, null, SIGNAL.SELL]);
});

test('MACDStrategy: periods must match the engine configuration', () => {
  assert.doesNotThrow(() => new MACDStrategy({ fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }));
  assert.throws(() => new MACDStrategy({ signalPeriod: 5 }), /does not match the engine/);
  assert.throws(() => new MACDStrategy({ fastPeriod: 5, slowPeriod: 35 }), /does not match the engine/);
});

// ---------------------------------------------------------------------------
// shared behaviour
// ---------------------------------------------------------------------------

test('every strategy: reset clears crossover state', () => {
  const strategy = new EMAStrategy();
  run(strategy, [{ ema20: 10, ema50: 12 }]);
  strategy.reset();
  assert.equal(strategy.onCandle(candle, { ema20: 13, ema50: 12 }), null,
    'after reset there is no previous side, so no cross');
  assert.equal(strategy.onCandle(candle, { ema20: 11, ema50: 12 }), SIGNAL.SELL);
});

test('every strategy: only ever returns BUY, SELL or null', () => {
  const strategies = [new EMAStrategy(), new RSIStrategy(), new MACDStrategy()];
  const payloads = [
    null,
    {},
    { ema20: 1, ema50: 2, rsi14: 50, macd: 1, macdSignal: 2 },
    { ema20: 3, ema50: 2, rsi14: 10, macd: 3, macdSignal: 2 },
    { ema20: 1, ema50: 2, rsi14: 90, macd: 1, macdSignal: 2 },
  ];

  for (const strategy of strategies) {
    for (const signal of run(strategy, payloads)) {
      assert.ok(
        signal === null || signal === SIGNAL.BUY || signal === SIGNAL.SELL,
        `${strategy.getName()} returned ${signal}`
      );
    }
  }
});

test('every strategy: is a Strategy and declares indicators the engine computes', () => {
  for (const strategy of [new EMAStrategy(), new RSIStrategy(), new MACDStrategy()]) {
    assert.ok(strategy instanceof Strategy, `${strategy.getName()} extends Strategy`);
    assert.ok(strategy.requiredIndicators().length > 0);
  }
});
