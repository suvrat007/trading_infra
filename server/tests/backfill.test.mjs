import test from 'node:test';
import assert from 'node:assert/strict';

import {
  countCandlesBetween,
  intervalToMs,
  latestClosedOpenTime,
} from '../src/utils/shared/interval.js';
import { chunkRange, groupIntoRanges, planRequests } from '../src/utils/backfill/ranges.js';
import { buildKlinesUrl, restKlineToRow } from '../src/utils/backfill/klines.js';

const MIN = 60_000;

test('intervalToMs: every supported unit', () => {
  assert.equal(intervalToMs('1s'), 1_000);
  assert.equal(intervalToMs('1m'), 60_000);
  assert.equal(intervalToMs('15m'), 900_000);
  assert.equal(intervalToMs('4h'), 14_400_000);
  assert.equal(intervalToMs('1d'), 86_400_000);
  assert.equal(intervalToMs('1w'), 604_800_000);
});

test('intervalToMs: monthly is rejected rather than approximated', () => {
  assert.throws(() => intervalToMs('1M'), /not a fixed-length grid/);
  assert.throws(() => intervalToMs('bogus'), TypeError);
  assert.throws(() => intervalToMs(''), TypeError);
});

test('latestClosedOpenTime: the forming bar is not missing, it has not happened', () => {
  // 10:30:45 on a 1m grid -> the 10:30 bar is still forming, 10:29 is the last closed one.
  const now = Date.UTC(2026, 0, 1, 10, 30, 45);
  assert.equal(latestClosedOpenTime(MIN, now), Date.UTC(2026, 0, 1, 10, 29, 0));

  // Exactly on a boundary: the bar that just opened is forming too.
  const onBoundary = Date.UTC(2026, 0, 1, 10, 30, 0);
  assert.equal(latestClosedOpenTime(MIN, onBoundary), Date.UTC(2026, 0, 1, 10, 29, 0));
});

test('countCandlesBetween: inclusive of both ends, zero when inverted', () => {
  assert.equal(countCandlesBetween(0, 0, MIN), 1);
  assert.equal(countCandlesBetween(0, 4 * MIN, MIN), 5);
  assert.equal(countCandlesBetween(4 * MIN, 0, MIN), 0);
});

test('groupIntoRanges: consecutive timestamps collapse into one range', () => {
  const missing = [10 * MIN, 11 * MIN, 12 * MIN];
  assert.deepEqual(groupIntoRanges(missing, MIN), [{ start: 10 * MIN, end: 12 * MIN }]);
});

test('groupIntoRanges: a break starts a new range', () => {
  const missing = [10 * MIN, 11 * MIN, 20 * MIN, 30 * MIN, 31 * MIN];

  assert.deepEqual(groupIntoRanges(missing, MIN), [
    { start: 10 * MIN, end: 11 * MIN },
    { start: 20 * MIN, end: 20 * MIN },
    { start: 30 * MIN, end: 31 * MIN },
  ]);
});

test('groupIntoRanges: empty in, empty out', () => {
  assert.deepEqual(groupIntoRanges([], MIN), []);
});

test('groupIntoRanges: a 3-hour outage is ONE request, not 180', () => {
  const missing = Array.from({ length: 180 }, (_, i) => (1000 + i) * MIN);
  const ranges = groupIntoRanges(missing, MIN);

  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].start, 1000 * MIN);
  assert.equal(ranges[0].end, 1179 * MIN);
});

test('chunkRange: splits at the API limit so no response is silently truncated', () => {
  const range = { start: 0, end: 2499 * MIN };
  const chunks = chunkRange(range, MIN, 1000);

  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks.map((c) => c.count), [1000, 1000, 500]);

  // Contiguous and non-overlapping: each chunk starts one interval after the last ends.
  assert.equal(chunks[0].end + MIN, chunks[1].start);
  assert.equal(chunks[1].end + MIN, chunks[2].start);
  assert.equal(chunks[2].end, range.end);
});

test('chunkRange: a single missing candle is a chunk of one', () => {
  const chunks = chunkRange({ start: 5 * MIN, end: 5 * MIN }, MIN, 1000);
  assert.deepEqual(chunks, [{ start: 5 * MIN, end: 5 * MIN, count: 1 }]);
});

test('planRequests: caps a run and defers the rest', () => {
  const missing = Array.from({ length: 6000 }, (_, i) => i * MIN);

  const plan = planRequests(missing, MIN, { maxCandles: 5000, maxRequests: 10 });

  assert.equal(plan.chunks.length, 5, '5 full chunks of 1000 fit inside the 5000 cap');
  assert.equal(plan.candles, 5000);
  assert.equal(plan.deferred, 1, 'the sixth chunk waits for the next run');
});

test('planRequests: request cap binds before the candle cap when gaps are scattered', () => {
  // 20 isolated single-candle gaps: tiny in candles, expensive in requests.
  const missing = Array.from({ length: 20 }, (_, i) => i * 10 * MIN);

  const plan = planRequests(missing, MIN, { maxCandles: 5000, maxRequests: 10 });

  assert.equal(plan.chunks.length, 10);
  assert.equal(plan.candles, 10);
  assert.equal(plan.deferred, 10);
});

test('planRequests: oldest first, so repeated runs make forward progress', () => {
  const missing = [500 * MIN, 100 * MIN, 300 * MIN].sort((a, b) => a - b);
  const plan = planRequests(missing, MIN, { maxCandles: 5000, maxRequests: 2 });

  assert.equal(plan.chunks[0].start, 100 * MIN);
  assert.equal(plan.chunks[1].start, 300 * MIN);
  assert.equal(plan.deferred, 1);
});

test('restKlineToRow: positional array -> insert tuple, prices untouched', () => {
  const kline = [
    1788000000000, '78000.10000000', '78200.00000000', '77900.50000000',
    '78150.25000000', '12.34500000', 1788000059999, '964000.00', 1234,
  ];

  assert.deepEqual(restKlineToRow(kline, 'BTCUSDT', '1m'), [
    'BTCUSDT', '1m', 1788000000000,
    '78000.10000000', '78200.00000000', '77900.50000000', '78150.25000000', '12.34500000',
  ]);
});

test('restKlineToRow: prices stay strings, exactly as the live path stores them', () => {
  const row = restKlineToRow([1, '0.10000000', '0.2', '0.05', '0.15', '1.0'], 'X', '1m');

  for (const value of row.slice(3)) {
    assert.equal(typeof value, 'string', 'a float here would break NUMERIC exactness');
  }
});

test('buildKlinesUrl: inclusive bounds and an explicit limit', () => {
  const url = new URL(buildKlinesUrl({
    symbol: 'BTCUSDT', interval: '1m', startTime: 1000, endTime: 2000,
  }));

  assert.equal(url.origin + url.pathname, 'https://api.binance.com/api/v3/klines');
  assert.equal(url.searchParams.get('symbol'), 'BTCUSDT');
  assert.equal(url.searchParams.get('interval'), '1m');
  assert.equal(url.searchParams.get('startTime'), '1000');
  assert.equal(url.searchParams.get('endTime'), '2000');
  assert.equal(url.searchParams.get('limit'), '1000');
});
