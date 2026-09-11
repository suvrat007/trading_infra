/**
 * Per-stage timing of the candle hot path, to answer one question: how fast a
 * candle rate can this system take before it saturates?
 *
 *   node scripts/benchmark-stages.mjs [iterations]
 *
 * Measures each stage a candle passes through, separately, with percentiles.
 *
 * SAFETY: writes go to a throwaway symbol (BENCHUSDT) and are deleted at the
 * end. Reads use the real BTCUSDT series, which is never modified.
 */
import { pool } from '../src/db.js';
import { SQL_INSERT_CANDLE, SQL_SELECT_RECENT_CANDLES } from '../src/constants/sql.js';
import { INDICATOR_LOOKBACK } from '../src/constants/indicators.js';
import { MAX_CANDLES_PER_SERIES } from '../src/constants/retention.js';
import { pruneSeries } from '../src/retention.js';
import { toNumericCandles } from '../src/utils/indicators/convert.js';
import { computeIndicators } from '../src/utils/indicators/registry.js';
import { buildCandleMessage } from '../src/utils/broadcast/message.js';
import { createStrategy } from '../src/utils/strategies/factory.js';
import { klineToCandle } from '../src/utils/ingest/kline.js';

const N = Number(process.argv[2] || 200);
const WARMUP = 20;

const BENCH_SYMBOL = 'BENCHUSDT';
const REAL_SYMBOL = 'BTCUSDT';
const INTERVAL = '1m';

const ns = () => process.hrtime.bigint();

const stats = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    n: sorted.length,
    min: sorted[0],
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted.at(-1),
    mean: sorted.reduce((s, v) => s + v, 0) / sorted.length,
  };
};

/** Microseconds, one decimal — everything here is measured in ns internally. */
const us = (nanos) => (nanos / 1000).toFixed(1);

const results = [];
const record = (stage, samples, note) => {
  results.push({ stage, ...stats(samples), note });
};

// ---------------------------------------------------------------------------
// A realistic raw Binance kline frame, for the parse stage.
// ---------------------------------------------------------------------------
const rawFrame = JSON.stringify({
  e: 'kline', E: 1788725460000, s: 'BTCUSDT',
  k: {
    t: 1788725400000, T: 1788725459999, s: 'BTCUSDT', i: '1m',
    f: 100, L: 200, o: '79776.60000000', c: '79802.45000000',
    h: '79810.00000000', l: '79770.10000000', v: '12.48310000',
    n: 350, x: true, q: '996000.00000000',
    V: '6.20000000', Q: '494000.00000000', B: '0',
  },
});

console.log(`\nStage timing — ${N} iterations each (first ${WARMUP} discarded)\n`);

// ---------------------------------------------------------------------------
// 1. Parse the Binance frame
// ---------------------------------------------------------------------------
{
  const samples = [];
  for (let i = 0; i < N; i += 1) {
    const t0 = ns();
    const msg = JSON.parse(rawFrame);
    klineToCandle(msg.k);
    const t1 = ns();
    if (i >= WARMUP) samples.push(Number(t1 - t0));
  }
  record('1 parse frame', samples, 'JSON.parse + klineToCandle');
}

// ---------------------------------------------------------------------------
// 2. INSERT — into the throwaway series
// ---------------------------------------------------------------------------
{
  const samples = [];
  const base = 1600000000000;

  for (let i = 0; i < N; i += 1) {
    const openTime = base + i * 60000;
    // Same 8 columns klineToRow() produces: symbol, interval, open_time,
    // open, high, low, close, volume.
    const params = [
      BENCH_SYMBOL, INTERVAL, openTime,
      '79776.60000000', '79810.00000000', '79770.10000000', '79802.45000000',
      '12.48310000',
    ];

    const t0 = ns();
    await pool.query(SQL_INSERT_CANDLE, params);
    const t1 = ns();
    if (i >= WARMUP) samples.push(Number(t1 - t0));
  }
  record('2 INSERT candle', samples, 'ON CONFLICT DO NOTHING');
}

// ---------------------------------------------------------------------------
// 3. PRUNE — the retention delete, run against the throwaway series
// ---------------------------------------------------------------------------
{
  const samples = [];
  for (let i = 0; i < N; i += 1) {
    const t0 = ns();
    await pruneSeries(BENCH_SYMBOL, INTERVAL);
    const t1 = ns();
    if (i >= WARMUP) samples.push(Number(t1 - t0));
  }
  record('3 PRUNE', samples, `cap ${MAX_CANDLES_PER_SERIES}, nothing to delete`);
}

// ---------------------------------------------------------------------------
// 4. SELECT 200 candles — against the REAL series (read only)
// ---------------------------------------------------------------------------
let realRows = [];
{
  const samples = [];
  for (let i = 0; i < N; i += 1) {
    const t0 = ns();
    const { rows } = await pool.query(SQL_SELECT_RECENT_CANDLES, [REAL_SYMBOL, INTERVAL, INDICATOR_LOOKBACK]);
    const t1 = ns();
    if (i >= WARMUP) samples.push(Number(t1 - t0));
    realRows = rows;
  }
  record('4 SELECT 200', samples, `lookback ${INDICATOR_LOOKBACK}`);
}

// ---------------------------------------------------------------------------
// 5. Indicators — 29 of them over those 200 candles
// ---------------------------------------------------------------------------
let numeric = [];
{
  const samples = [];
  for (let i = 0; i < N; i += 1) {
    const t0 = ns();
    numeric = toNumericCandles(realRows);
    computeIndicators(numeric);
    const t1 = ns();
    if (i >= WARMUP) samples.push(Number(t1 - t0));
  }
  record('5 indicators', samples, '29 indicators, stateless recompute');
}

// ---------------------------------------------------------------------------
// 6. Strategy decision
// ---------------------------------------------------------------------------
{
  const { latest } = computeIndicators(numeric);
  const candle = { ...realRows[realRows.length - 1], indicators: latest };
  const strategy = createStrategy('ema', { fastPeriod: 9, slowPeriod: 21 });

  const samples = [];
  for (let i = 0; i < N; i += 1) {
    const t0 = ns();
    strategy.onCandle(candle, candle.indicators);
    const t1 = ns();
    if (i >= WARMUP) samples.push(Number(t1 - t0));
  }
  record('6 strategy (JS)', samples, 'EMA crossover');
}

// ---------------------------------------------------------------------------
// 7. Serialise the broadcast frame
// ---------------------------------------------------------------------------
{
  const { latest } = computeIndicators(numeric);
  const candle = { ...realRows[realRows.length - 1], indicators: latest };

  const samples = [];
  let bytes = 0;
  for (let i = 0; i < N; i += 1) {
    const t0 = ns();
    const encoded = JSON.stringify(buildCandleMessage(candle));
    const t1 = ns();
    bytes = encoded.length;
    if (i >= WARMUP) samples.push(Number(t1 - t0));
  }
  record('7 serialise frame', samples, `${bytes} bytes`);
}

// ---------------------------------------------------------------------------
// Clean up the throwaway series. The real BTCUSDT data is untouched.
// ---------------------------------------------------------------------------
const { rowCount } = await pool.query('DELETE FROM candles WHERE symbol = $1', [BENCH_SYMBOL]);
const check = await pool.query('SELECT count(*)::int AS c FROM candles WHERE symbol = $1', [REAL_SYMBOL]);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const pad = (v, w) => String(v).padStart(w);

console.log(`  ${'stage'.padEnd(18)} ${pad('p50 us', 9)} ${pad('p95 us', 9)} ${pad('p99 us', 9)} ${pad('max us', 9)}   note`);
console.log('  ' + '-'.repeat(88));

let totalP50 = 0;
let totalP99 = 0;

for (const r of results) {
  totalP50 += r.p50;
  totalP99 += r.p99;
  console.log(
    `  ${r.stage.padEnd(18)} ${pad(us(r.p50), 9)} ${pad(us(r.p95), 9)} ${pad(us(r.p99), 9)} ${pad(us(r.max), 9)}   ${r.note}`
  );
}

console.log('  ' + '-'.repeat(88));
console.log(`  ${'TOTAL'.padEnd(18)} ${pad(us(totalP50), 9)} ${pad('', 9)} ${pad(us(totalP99), 9)}`);

const totalUs = totalP50 / 1000;
const totalUs99 = totalP99 / 1000;

console.log(`\n  hot path p50 = ${totalUs.toFixed(0)} us,  p99 = ${totalUs99.toFixed(0)} us\n`);

// ---------------------------------------------------------------------------
// The scaling table — this is the actual answer
// ---------------------------------------------------------------------------
const RATES = [
  ['1m  (today)', 60_000_000],
  ['15s', 15_000_000],
  ['5s', 5_000_000],
  ['1s', 1_000_000],
  ['500ms  (2/s)', 500_000],
  ['100ms (10/s)', 100_000],
  ['50ms  (20/s)', 50_000],
  ['10ms (100/s)', 10_000],
  ['5ms  (200/s)', 5_000],
  ['1ms (1000/s)', 1_000],
];

console.log(`  ${'candle rate'.padEnd(14)} ${pad('budget us', 11)} ${pad('p50 duty', 10)} ${pad('p99 duty', 10)}   verdict`);
console.log('  ' + '-'.repeat(72));

for (const [label, budget] of RATES) {
  const duty = (totalUs / budget) * 100;
  const duty99 = (totalUs99 / budget) * 100;

  const verdict =
    duty99 > 100 ? 'IMPOSSIBLE — falls behind'
    : duty99 > 70 ? 'saturated'
    : duty99 > 30 ? 'tight'
    : duty99 > 5 ? 'comfortable'
    : 'idle';

  console.log(
    `  ${label.padEnd(14)} ${pad(budget.toLocaleString(), 11)} ${pad(duty.toFixed(3) + '%', 10)} ${pad(duty99.toFixed(3) + '%', 10)}   ${verdict}`
  );
}

const maxRateP50 = 1_000_000 / totalUs;
const maxRateP99 = 1_000_000 / totalUs99;

console.log(`\n  ceiling at 100% duty : ${maxRateP50.toFixed(0)} candles/sec (p50), ${maxRateP99.toFixed(0)}/sec (p99)`);
console.log(`  safe at 30% duty     : ${(maxRateP50 * 0.3).toFixed(0)} candles/sec (p50), ${(maxRateP99 * 0.3).toFixed(0)}/sec (p99)`);

console.log(`\n  cleanup: removed ${rowCount} bench rows; real ${REAL_SYMBOL} rows intact: ${check.rows[0].c}\n`);

await pool.end();
