import { memo, useEffect, useRef } from 'react';
import { AreaSeries, createChart } from 'lightweight-charts';
import { PNL_CHART_OPTIONS, PNL_SERIES_OPTIONS } from '../constants/chart.js';
import { toPnlSeries } from '../utils/chart/pnl.js';

/**
 * Cumulative realized PnL.
 *
 * Derived from the trade list rather than accumulated from WebSocket messages:
 * a missed frame would leave a running total permanently wrong, while
 * recomputing from the trades table is self-correcting on every update.
 *
 * Redrawn with setData rather than update() because a new trade can change the
 * curve's baseline and scale — and it happens a few times an hour, not per
 * candle, so the O(n) rebuild costs nothing.
 */
const PnlChartImpl = ({ trades }) => {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  useEffect(() => {
    const chart = createChart(containerRef.current, PNL_CHART_OPTIONS);
    const series = chart.addSeries(AreaSeries, PNL_SERIES_OPTIONS);

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const points = toPnlSeries(trades);
    seriesRef.current?.setData(points);

    if (points.length > 0) chartRef.current?.timeScale().fitContent();
  }, [trades]);

  return (
    <section className="panel panel--chart">
      <h2 className="panel__title">Cumulative PnL</h2>
      <div ref={containerRef} className="pnl-chart" />
    </section>
  );
};

export const PnlChart = memo(PnlChartImpl);
