// Drives the C++ engine over ZeroMQ: pushes a synthetic crossover sequence to
// 5555, reads signals back off 5556, checks them against what the JS strategy
// would produce, and reports round-trip latency.
import { Push, Pull } from 'zeromq';

const IN = 'tcp://127.0.0.1:5555';
const OUT = 'tcp://127.0.0.1:5556';

const nowMicros = () => Math.round((performance.timeOrigin + performance.now()) * 1000);

// {ema9, ema21, expected}
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

const push = new Push();
const pull = new Pull();

await push.connect(IN);
await pull.connect(OUT);

// ZeroMQ connect is asynchronous; sending before the handshake completes queues
// the message rather than losing it, but the first round trip would include the
// connect time and pollute the numbers.
await new Promise((resolve) => setTimeout(resolve, 300));

const received = [];
const roundTrips = [];

const reader = (async () => {
  for await (const [frame] of pull) {
    const signal = JSON.parse(frame.toString());
    roundTrips.push(nowMicros() - signal.sent_back_probe);
    received.push(signal);
    if (received.length === STEPS.length) break;
  }
})();

const sentAt = [];
for (let i = 0; i < STEPS.length; i += 1) {
  const [fast, slow] = STEPS[i];
  const openTime = 1788725400000 + i * 60000;

  const indicators = { sma20: 79788.0, rsi14: 61.2 };
  if (fast !== null) {
    indicators.ema9 = fast;
    indicators.ema21 = slow;
  }

  const t = nowMicros();
  sentAt.push(t);

  await push.send(JSON.stringify({
    candle: {
      symbol: 'BTCUSDT',
      interval: '1m',
      open_time: openTime,
      open: '79776.60000000',
      high: '79810.00000000',
      low: '79770.10000000',
      close: `798${String(2 + i).padStart(2, '0')}.45000000`,
      volume: '12.48310000',
    },
    indicators,
    sent_at_us: t,
  }));
}

const timeout = setTimeout(() => {
  console.error('timed out waiting for signals');
  process.exit(1);
}, 10000);

await reader;
clearTimeout(timeout);

console.log('\n-- signals returned --');
let bad = 0;
received.forEach((signal, i) => {
  const expected = STEPS[i][2];
  const ok = signal.action === expected;
  if (!ok) bad += 1;
  const rtt = nowMicros() - sentAt[i];
  console.log(
    `  ${ok ? 'MATCH ' : 'DIFFER'} ${String(i).padStart(2)}  ` +
    `got=${signal.action.padEnd(4)} want=${expected.padEnd(4)}  ` +
    `price=${signal.price}  engine=${signal.engine_latency_us}us`
  );
});

const engineUs = received.map((s) => s.engine_latency_us).sort((a, b) => a - b);
const trip = received.map((s, i) => s.engine_sent_at_us - sentAt[i]).sort((a, b) => a - b);

const p = (arr, q) => arr[Math.min(arr.length - 1, Math.floor(q * arr.length))];

console.log('\n-- latency --');
console.log(`  engine in->out    min=${engineUs[0]}us  p50=${p(engineUs, 0.5)}us  max=${engineUs.at(-1)}us`);
console.log(`  node->engine->out min=${trip[0]}us  p50=${p(trip, 0.5)}us  max=${trip.at(-1)}us`);
console.log(`\n  price echoed exactly: ${received[0].price === '79802.45000000'}`);
console.log(bad === 0 ? '\nALL MATCH' : `\n${bad} DIVERGENCE(S)`);

push.close();
pull.close();
process.exit(bad === 0 ? 0 : 1);
