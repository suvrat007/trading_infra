import test from 'node:test';
import assert from 'node:assert/strict';

import { sma, ema, wma, dema } from '../src/indicators/trend.js';
import { rsi, macd, roc, momentum, stochastic, williamsR, cci } from '../src/indicators/momentum.js';
import {
  stdDev, bollingerBands, trueRange, atr, keltnerChannels, historicalVolatility,
} from '../src/indicators/volatility.js';
import {
  obv, rollingVwap, mfi, accumulationDistribution, chaikinMoneyFlow, volumeSma,
} from '../src/indicators/volume.js';

const close = (actual, expected, tolerance = 1e-9, message = '') =>
  assert.ok(
    actual !== null && Math.abs(actual - expected) <= tolerance,
    `${message} expected ~${expected}, got ${actual}`
  );

const ramp = Array.from({ length: 10 }, (_, i) => i + 1); // 1..10
const rampCandles = ramp.map((v, i) => ({ high: v + 1, low: v - 1, close: v, volume: 10 + i }));
const flat = new Array(30).fill(100);

// ---------------------------------------------------------------------------

test('alignment contract: every indicator returns one slot per input candle', () => {
  const lengths = [
    sma(ramp, 5), ema(ramp, 5), wma(ramp, 5), dema(ramp, 3),
    rsi(ramp, 5), roc(ramp, 3), momentum(ramp, 3), stdDev(ramp, 5),
    macd(ramp, 2, 4, 3).macd, macd(ramp, 2, 4, 3).signal, macd(ramp, 2, 4, 3).histogram,
    bollingerBands(ramp, 5).upper, bollingerBands(ramp, 5).percentB,
    stochastic(rampCandles, 5).k, stochastic(rampCandles, 5).d,
    williamsR(rampCandles, 5), cci(rampCandles, 5), atr(rampCandles, 5),
    trueRange(rampCandles), keltnerChannels(rampCandles, 5).upper,
    historicalVolatility(ramp, 5), obv(rampCandles), rollingVwap(rampCandles, 5),
    mfi(rampCandles, 5), accumulationDistribution(rampCandles),
    chaikinMoneyFlow(rampCandles, 5), volumeSma(rampCandles, 5),
  ].map((series) => series.length);

  assert.ok(lengths.every((l) => l === ramp.length), `got lengths ${lengths}`);
});

test('sma: warmup nulls then arithmetic mean of the window', () => {
  const result = sma(ramp, 5);
  assert.equal(result[3], null, 'index 3 has only 4 points behind it');
  close(result[4], 3, 1e-9, 'mean(1..5)');
  close(result[9], 8, 1e-9, 'mean(6..10)');
});

test('ema: seeded with the SMA of the first period, then smoothed', () => {
  const result = ema(ramp, 5);
  close(result[4], 3, 1e-9, 'seed = sma(1..5)');
  close(result[5], 4, 1e-9, '(6-3)*(2/6)+3');
  close(result[9], 8, 1e-9);
});

test('wma: linear weights, heavier on the most recent close', () => {
  // window 1..5 with weights 5,4,3,2,1 -> (1*1+2*2+3*3+4*4+5*5)/15 = 55/15
  close(wma(ramp, 5)[4], 55 / 15, 1e-9);
});

test('rsi: matches hand-computed Wilder arithmetic', () => {
  const wilder = [
    44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08,
    45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64,
    46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57,
    43.42, 42.66, 43.13,
  ];
  const result = rsi(wilder, 14);

  assert.equal(result[13], null, 'n prices yield only n-1 changes, so first value is at index 14');

  // Hand-derived: gains over changes 1..14 sum to 3.34, losses to 1.40.
  //   avgGain = 3.34/14 = 0.2385714,  avgLoss = 1.40/14 = 0.1
  //   RS = 2.3857143  ->  RSI = 100 - 100/3.3857143 = 70.46414
  close(result[14], 70.46414, 1e-4, 'first RSI');

  // Next step, Wilder-smoothed: change is -0.28.
  //   avgGain = (0.2385714*13 + 0)/14   = 0.2215306
  //   avgLoss = (0.1*13 + 0.28)/14      = 0.1128571
  //   RS = 1.9629...  ->  RSI = 66.2496
  close(result[15], 66.2496, 1e-3, 'second RSI');
});

test('rsi: bounded extremes, and a flat market reads neutral', () => {
  const rising = Array.from({ length: 30 }, (_, i) => 100 + i);
  const falling = Array.from({ length: 30 }, (_, i) => 100 - i);

  close(rsi(rising, 14).at(-1), 100, 1e-9, 'only gains');
  close(rsi(falling, 14).at(-1), 0, 1e-9, 'only losses');
  close(rsi(flat, 14).at(-1), 50, 1e-9, 'no movement is neutral, not overbought');
});

test('macd: signal line starts where an EMA of the dense macd line would', () => {
  const wave = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.1);
  const { macd: line, signal, histogram } = macd(wave, 12, 26, 9);

  assert.equal(line.findIndex((v) => v !== null), 25, 'macd begins at slowPeriod - 1');
  assert.equal(signal.findIndex((v) => v !== null), 33, 'signal begins 9 values later');

  close(histogram[40], line[40] - signal[40], 1e-12, 'histogram is the difference');
  assert.ok(line.every((v, i) => v !== null || signal[i] === null), 'no signal without a macd value');
});

test('bollingerBands: population standard deviation, not sample', () => {
  const bands = bollingerBands(ramp, 5, 2);

  // window 1..5 -> mean 3, population sd = sqrt(2) = 1.41421 (sample sd would be 1.58114)
  close(bands.middle[4], 3, 1e-9);
  close(bands.upper[4], 3 + 2 * Math.SQRT2, 1e-9);
  close(bands.lower[4], 3 - 2 * Math.SQRT2, 1e-9);
  close((bands.upper[4] - bands.middle[4]) / 2, Math.SQRT2, 1e-9, 'sd used');
});

test('bollingerBands: derived readings survive degenerate windows', () => {
  const bands = bollingerBands(flat, 20, 2);
  close(bands.upper.at(-1) - bands.lower.at(-1), 0, 1e-9, 'zero volatility -> zero width');
  close(bands.percentB.at(-1), 0.5, 1e-9, 'no band span -> mid by convention');

  close(bollingerBands([1, 1, 1, 1, 5], 5).percentB[4], 1, 1e-9, 'price at upper band');
});

test('trueRange: includes the gap from the previous close', () => {
  const gapped = [
    { high: 10, low: 9, close: 9.5, volume: 1 },
    { high: 20, low: 19, close: 19.5, volume: 1 },
  ];
  const ranges = trueRange(gapped);

  close(ranges[0], 1, 1e-9, 'first bar has no previous close');
  close(ranges[1], 10.5, 1e-9, '|20 - 9.5| beats high-low of 1');
});

test('atr: Wilder-smoothed, first value at period - 1', () => {
  const steady = Array.from({ length: 20 }, () => ({ high: 11, low: 9, close: 10, volume: 1 }));
  const result = atr(steady, 14);
  assert.equal(result[12], null);
  close(result[13], 2, 1e-9, 'constant 2-wide range');
});

test('stochastic and williamsR: same geometry, different scale', () => {
  const box = Array.from({ length: 20 }, () => ({ high: 110, low: 90, close: 100, volume: 5 }));
  close(stochastic(box, 14).k.at(-1), 50, 1e-9, 'close mid-range');
  close(williamsR(box, 14).at(-1), -50, 1e-9);

  const atHigh = box.map((c) => ({ ...c, close: 110 }));
  close(stochastic(atHigh, 14).k.at(-1), 100, 1e-9);
  close(williamsR(atHigh, 14).at(-1), 0, 1e-9);

  const noRange = Array.from({ length: 20 }, () => ({ high: 100, low: 100, close: 100, volume: 5 }));
  close(stochastic(noRange, 14).k.at(-1), 50, 1e-9, 'zero range must not divide by zero');
});

test('cci: uses mean absolute deviation, so a flat window reads zero', () => {
  const box = Array.from({ length: 25 }, () => ({ high: 101, low: 99, close: 100, volume: 1 }));
  close(cci(box, 20).at(-1), 0, 1e-9);
});

test('obv: direction of the close decides the sign, flat contributes nothing', () => {
  const candles = [
    { high: 11, low: 9, close: 10, volume: 100 },
    { high: 12, low: 10, close: 11, volume: 200 },
    { high: 11, low: 9, close: 10, volume: 150 },
    { high: 11, low: 9, close: 10, volume: 300 },
  ];
  assert.deepEqual(obv(candles), [0, 200, 50, 50]);
});

test('accumulationDistribution: close position within the bar, not just direction', () => {
  close(accumulationDistribution([{ high: 10, low: 0, close: 10, volume: 100 }])[0], 100, 1e-9);
  close(accumulationDistribution([{ high: 10, low: 0, close: 0, volume: 100 }])[0], -100, 1e-9);
  close(accumulationDistribution([{ high: 10, low: 0, close: 5, volume: 100 }])[0], 0, 1e-9);
});

test('chaikinMoneyFlow: normalized to -1..1', () => {
  const candles = Array.from({ length: 25 }, (_, i) => ({
    high: 110, low: 90, close: i % 2 ? 105 : 95, volume: 100,
  }));
  const value = chaikinMoneyFlow(candles, 20).at(-1);
  assert.ok(Math.abs(value) <= 1, `expected within [-1,1], got ${value}`);
});

test('rollingVwap: weights price by volume', () => {
  const candles = [
    { high: 10, low: 10, close: 10, volume: 1 },
    { high: 20, low: 20, close: 20, volume: 3 },
  ];
  close(rollingVwap(candles, 2)[1], 17.5, 1e-9, '(10*1 + 20*3) / 4');
});

test('mfi: volume-weighted RSI shape, neutral when nothing moves', () => {
  const still = Array.from({ length: 20 }, () => ({ high: 11, low: 9, close: 10, volume: 100 }));
  close(mfi(still, 14).at(-1), 50, 1e-9);
});

test('validation: bad parameters throw, insufficient data does not', () => {
  assert.throws(() => sma([1, 2, 3], 0), TypeError, 'period must be >= 1');
  assert.throws(() => sma([1, 2, 3], 2.5), TypeError, 'period must be an integer');
  assert.throws(() => sma([1, NaN, 3], 2), TypeError, 'NaN is not a price');
  assert.throws(() => sma(['1', '2', '3'], 2), TypeError, 'strings must be converted by the caller');
  assert.throws(() => bollingerBands([1, 2, 3], 2, 0), TypeError, 'multiplier must be positive');
  assert.throws(() => macd([1, 2, 3], 26, 12, 9), TypeError, 'fast must be shorter than slow');
  assert.throws(() => stochastic([{ high: 1, low: 1, close: 'x' }], 2), TypeError);

  assert.ok(sma([1, 2], 20).every((v) => v === null), 'short series returns nulls, not an error');
  assert.deepEqual(sma([], 20), [], 'empty in, empty out');
});

test('purity: inputs are never mutated', () => {
  const prices = [...ramp];
  const candles = rampCandles.map((c) => ({ ...c }));

  sma(prices, 5); ema(prices, 5); rsi(prices, 5); macd(prices, 2, 4, 3);
  bollingerBands(prices, 5); stochastic(candles, 5); obv(candles);
  accumulationDistribution(candles); mfi(candles, 5);

  assert.deepEqual(prices, ramp, 'price array untouched');
  assert.deepEqual(candles, rampCandles, 'candle array untouched');
});
