import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { CandlestickSeries, createChart } from 'lightweight-charts';
import {
  CANDLESTICK_OPTIONS,
  CHART_OPTIONS,
  PRICE_FORMAT,
} from '../constants/chart.js';
import { toChartCandle, toChartCandles } from '../utils/chart/candle.js';

/**
 * The chart is created ONCE and then driven imperatively.
 *
 * This is deliberate. lightweight-charts owns a canvas and its own internal
 * state; React must not try to reconcile it. So the component renders one empty
 * <div> that never changes, and all updates go through the ref handle below —
 * meaning a new candle costs zero React renders, zero diffing, and zero
 * component work. It is the whole reason appending stays cheap at 1 render/hour
 * instead of 1 per tick.
 */
export const CandleChart = forwardRef(function CandleChart(_props, ref) {
  const containerRef = useRef(null);
  const seriesRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    const chart = createChart(containerRef.current, CHART_OPTIONS);
    const series = chart.addSeries(CandlestickSeries, {
      ...CANDLESTICK_OPTIONS,
      priceFormat: PRICE_FORMAT,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      // Must run: the chart holds a canvas, and in StrictMode this effect fires
      // twice in development. Without remove() you leak a chart per mount.
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    /** Replace the whole series — initial load and post-reconnect backfill. */
    setCandles(candles) {
      seriesRef.current?.setData(toChartCandles(candles));
      chartRef.current?.timeScale().fitContent();
    },

    /**
     * Append or replace the most recent bar.
     * update() touches only the last bar; setData() would rebuild all 200
     * points and reset the user's pan/zoom on every single candle.
     */
    appendCandle(candle) {
      seriesRef.current?.update(toChartCandle(candle));
    },
  }), []);

  return <div ref={containerRef} className="chart-container" />;
});
