import test from 'node:test';
import assert from 'node:assert/strict';

import { CANDLE_ORDER, classifyCandle } from '../src/utils/shared/continuity.js';

const MIN = 60_000;
const base = 1788000000000;

test('classifyCandle: nothing seen yet', () => {
  assert.deepEqual(classifyCandle(base, null, MIN), { order: CANDLE_ORDER.FIRST, missing: 0 });
  assert.deepEqual(classifyCandle(base, undefined, MIN), { order: CANDLE_ORDER.FIRST, missing: 0 });
});

test('classifyCandle: the normal case is exactly one interval on', () => {
  assert.deepEqual(classifyCandle(base + MIN, base, MIN), { order: CANDLE_ORDER.NEXT, missing: 0 });
});

test('classifyCandle: a replayed candle is a duplicate, not a gap', () => {
  assert.deepEqual(classifyCandle(base, base, MIN), { order: CANDLE_ORDER.DUPLICATE, missing: 0 });
});

test('classifyCandle: an earlier timestamp is stale, never a gap', () => {
  assert.deepEqual(classifyCandle(base - MIN, base, MIN), { order: CANDLE_ORDER.STALE, missing: 0 });
  assert.deepEqual(classifyCandle(base - 500 * MIN, base, MIN), {
    order: CANDLE_ORDER.STALE,
    missing: 0,
  });
});

test('classifyCandle: gap size counts the bars that were skipped', () => {
  assert.deepEqual(classifyCandle(base + 2 * MIN, base, MIN), { order: CANDLE_ORDER.GAP, missing: 1 });
  assert.deepEqual(classifyCandle(base + 5 * MIN, base, MIN), { order: CANDLE_ORDER.GAP, missing: 4 });
  assert.deepEqual(classifyCandle(base + 181 * MIN, base, MIN), {
    order: CANDLE_ORDER.GAP,
    missing: 180,
  });
});

test('classifyCandle: works on any interval, not just 1m', () => {
  const HOUR = 3_600_000;
  assert.equal(classifyCandle(base + HOUR, base, HOUR).order, CANDLE_ORDER.NEXT);
  assert.equal(classifyCandle(base + 3 * HOUR, base, HOUR).missing, 2);
});

test('classifyCandle: is pure — same inputs, same answer, no state', () => {
  const first = classifyCandle(base + 3 * MIN, base, MIN);
  const second = classifyCandle(base + 3 * MIN, base, MIN);
  assert.deepEqual(first, second);
});
