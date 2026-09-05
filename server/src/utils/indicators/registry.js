import { INDICATOR_KEYS, PERIODS } from '../../constants/indicators.js';
import { ema, sma } from '../../indicators/trend.js';
import { cci, macd, roc, rsi, stochastic, williamsR } from '../../indicators/momentum.js';
import { atr, bollingerBands, historicalVolatility, stdDev } from '../../indicators/volatility.js';
import {
  accumulationDistribution,
  chaikinMoneyFlow,
  mfi,
  obv,
  rollingVwap,
  volumeSma,
} from '../../indicators/volume.js';
import { closesOf, round, roundSeries } from './convert.js';

export { INDICATOR_KEYS };

const DEFINITIONS = [
  {
    id: 'movingAverages',
    compute: ({ closes }) => ({
      sma20: sma(closes, PERIODS.SMA_FAST),
      sma50: sma(closes, PERIODS.SMA_SLOW),
      ema20: ema(closes, PERIODS.EMA_FAST),
      ema50: ema(closes, PERIODS.EMA_SLOW),
    }),
  },
  {
    id: 'rsi',
    compute: ({ closes }) => ({ rsi14: rsi(closes, PERIODS.RSI) }),
  },
  {
    id: 'macd',
    compute: ({ closes }) => {
      const result = macd(closes, PERIODS.MACD_FAST, PERIODS.MACD_SLOW, PERIODS.MACD_SIGNAL);
      return {
        macd: result.macd,
        macdSignal: result.signal,
        macdHistogram: result.histogram,
      };
    },
  },
  {
    id: 'bollinger',
    compute: ({ closes }) => {
      const bands = bollingerBands(closes, PERIODS.BOLLINGER, PERIODS.BOLLINGER_STDDEV);
      return {
        bbUpper: bands.upper,
        bbMiddle: bands.middle,
        bbLower: bands.lower,
        bbBandwidth: bands.bandwidth,
        bbPercentB: bands.percentB,
      };
    },
  },
  {
    id: 'volatility',
    compute: ({ closes, candles }) => ({
      atr14: atr(candles, PERIODS.ATR),
      stdDev20: stdDev(closes, PERIODS.STDDEV),
      historicalVolatility20: historicalVolatility(closes, PERIODS.HISTORICAL_VOLATILITY),
    }),
  },
  {
    id: 'oscillators',
    compute: ({ closes, candles }) => {
      const stoch = stochastic(candles, PERIODS.STOCHASTIC, PERIODS.STOCHASTIC_SIGNAL);
      return {
        stochK: stoch.k,
        stochD: stoch.d,
        williamsR14: williamsR(candles, PERIODS.WILLIAMS_R),
        cci20: cci(candles, PERIODS.CCI),
        roc12: roc(closes, PERIODS.ROC),
      };
    },
  },
  {
    id: 'volume',
    compute: ({ candles }) => ({
      obv: obv(candles),
      vwap20: rollingVwap(candles, PERIODS.VWAP),
      mfi14: mfi(candles, PERIODS.MFI),
      adLine: accumulationDistribution(candles),
      cmf20: chaikinMoneyFlow(candles, PERIODS.CMF),
      volumeSma20: volumeSma(candles, PERIODS.VOLUME_SMA),
    }),
  },
];

/**
 * Run every indicator over one window of candles.
 *
 * Returns BOTH shapes from a single pass, because the two consumers need
 * different things and recomputing for each would be wasteful:
 *
 *   series — full arrays aligned 1:1 with the input candles. What the chart
 *            needs to draw a line across history.
 *   latest — the last value of each series as a scalar. What a live WebSocket
 *            frame needs; sending 200 points to append one candle would be
 *            absurd.
 */
export function computeIndicators(candles) {
  const closes = closesOf(candles);
  const input = { candles, closes };

  const series = {};
  const latest = {};

  for (const definition of DEFINITIONS) {
    const produced = definition.compute(input);

    for (const [key, values] of Object.entries(produced)) {
      series[key] = roundSeries(values);
      latest[key] = round(values.length ? values[values.length - 1] : null);
    }
  }

  return { series, latest };
}
