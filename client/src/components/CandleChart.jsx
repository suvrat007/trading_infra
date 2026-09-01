import { forwardRef, memo, useEffect, useImperativeHandle, useRef } from 'react';
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
} from 'lightweight-charts';
import { CANDLESTICK_OPTIONS, CHART_OPTIONS, PRICE_FORMAT } from '../constants/chart.js';
import {
  ALL_INDICATOR_SERIES,
  PANEL_DEFINITIONS,
  PRICE_PANE,
} from '../constants/indicators.js';
import { toChartCandle, toChartCandles, toChartTime } from '../utils/chart/candle.js';
import {
  toFixedScaleOptions,
  toPriceLineOptions,
  toSeriesData,
  toSeriesOptions,
  toSeriesPoint,
} from '../utils/chart/indicator.js';

const SERIES_CONSTRUCTORS = {
  line: LineSeries,
  histogram: HistogramSeries,
};

/**
 * One chart, three PANES: price on top, RSI and MACD below.
 *
 * Panes rather than three separate charts. Separate charts would each own their
 * own time scale, so keeping them aligned means subscribing to one chart's
 * visible-range changes and pushing them into the others — a well-known source
 * of feedback loops and drift. Panes share one time axis and one crosshair by
 * construction, so pan, zoom and hover are synchronised with no code at all.
 *
 * The chart is created ONCE and driven imperatively. lightweight-charts owns a
 * canvas and its own state; React must not try to reconcile it. So this renders
 * one <div> that never changes and every update goes through the ref handle —
 * nine series redraw per candle with zero React renders.
 */

const CandleChartImpl = forwardRef(function CandleChart(_props, ref) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);

  // key -> { series, definition }. A Map rather than state: these are canvas
  // handles, not rendered values, and must never trigger a React update.
  const seriesRef = useRef(new Map());

  useEffect(() => {
    const chart = createChart(containerRef.current, CHART_OPTIONS);

    const candleSeries = chart.addSeries(
      CandlestickSeries,
      { ...CANDLESTICK_OPTIONS, priceFormat: PRICE_FORMAT },
      PRICE_PANE
    );

    // Every series is created up front, empty, on its declared pane. Creating
    // them lazily when data arrives would change draw order between sessions
    // and make visibility (Step 5) a create/destroy problem instead of a flag.
    const registry = new Map();

    for (const definition of ALL_INDICATOR_SERIES) {
      const Constructor = SERIES_CONSTRUCTORS[definition.type] ?? LineSeries;
      const panel = PANEL_DEFINITIONS.find((p) => p.id === definition.group);

      const series = chart.addSeries(
        Constructor,
        { ...toSeriesOptions(definition), ...toFixedScaleOptions(panel?.fixedScale) },
        definition.paneIndex
      );

      registry.set(definition.key, { series, definition });
    }

    // Threshold markers (RSI 70/30, MACD zero) are attached to the panel's
    // FIRST series, so they inherit that pane's scale automatically.
    for (const panel of PANEL_DEFINITIONS) {
      const anchor = registry.get(panel.series[0].key)?.series;
      if (!anchor) continue;

      for (const line of panel.priceLines ?? []) {
        anchor.createPriceLine(toPriceLineOptions(line));
      }
    }

    // Panes only exist once a series has been added to them.
    const panes = chart.panes();
    for (const panel of PANEL_DEFINITIONS) {
      if (panel.height && panes[panel.paneIndex]) {
        panes[panel.paneIndex].setHeight(panel.height);
      }
    }

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    seriesRef.current = registry;

    return () => {
      // Must run: the chart holds a canvas, and StrictMode mounts twice in dev.
      // remove() disposes every series and pane it owns, so those need no
      // individual cleanup — but the Map must be dropped so nothing holds a
      // handle to a destroyed series.
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      seriesRef.current = new Map();
    };
  }, []);

  useImperativeHandle(ref, () => ({
    /**
     * Replace everything — initial load and post-reconnect backfill.
     * Indicators are optional: candles still render if the backend could not
     * compute them.
     */
    setHistory(candles, indicators) {
      candleSeriesRef.current?.setData(toChartCandles(candles));

      for (const [key, { series, definition }] of seriesRef.current) {
        series.setData(toSeriesData(candles, indicators?.[key], definition));
      }

      chartRef.current?.timeScale().fitContent();
    },

    /**
     * Append or replace the most recent bar, plus one point on every series.
     *
     * update() touches only the last point; setData() would rebuild all 200
     * points across nine series and reset the user's pan and zoom every minute.
     */
    appendCandle(candle) {
      candleSeriesRef.current?.update(toChartCandle(candle));

      const values = candle.indicators;
      if (!values) return; // indicators failed server-side; leave the series alone

      // Same conversion the candle itself used, so bars and lines cannot
      // disagree about which second this is.
      const time = toChartTime(candle.open_time);

      for (const [key, { series, definition }] of seriesRef.current) {
        const value = values[key];
        // A warming-up indicator sends null. Skip rather than write a gap, so
        // the series starts cleanly at its first real value.
        if (value === null || value === undefined || !Number.isFinite(value)) continue;

        series.update(toSeriesPoint(time, value, definition));
      }
    },

    /**
     * Show or hide one group. Visibility is a FLAG, never a rebuild: the series
     * keep their data while hidden, so toggling back on is instant and costs no
     * network request and no recomputation.
     */
    setGroupVisible(groupId, visible) {
      for (const { series, definition } of seriesRef.current.values()) {
        if (definition.group !== groupId) continue;
        series.applyOptions({ visible });
      }

      // A hidden overlay simply disappears from the price pane. A hidden PANEL
      // would leave its pane behind as an empty band with an axis, so the pane
      // is collapsed too and restored to its configured height when shown.
      const panel = PANEL_DEFINITIONS.find((definition) => definition.id === groupId);
      if (!panel) return;

      const pane = chartRef.current?.panes()[panel.paneIndex];
      if (!pane) return;

      try {
        pane.setHeight(visible ? panel.height : 0);
      } catch {
        // Some versions clamp pane height to a minimum. Losing the collapse is
        // cosmetic; it must not break the toggle.
      }
    },
  }), []);

  return <div ref={containerRef} className="chart-container" />;
});

/**
 * Memoized and prop-less on purpose
 */
export const CandleChart = memo(CandleChartImpl);
