import { useCallback, useEffect, useRef, useState } from 'react';
import { CandleChart } from './components/CandleChart.jsx';
import { ChartLegend } from './components/ChartLegend.jsx';
import { ConnectionStatus } from './components/ConnectionStatus.jsx';
import { IndicatorToggles } from './components/IndicatorToggles.jsx';
import { DEFAULT_INTERVAL, DEFAULT_SYMBOL } from './constants/api.js';
import { useCandleHistory } from './hooks/useCandleHistory.js';
import { useCandleStream } from './hooks/useCandleStream.js';
import { useCandleContinuity } from './hooks/useCandleContinuity.js';
import { useIndicatorVisibility } from './hooks/useIndicatorVisibility.js';

/** Series arrays -> the scalar tail of each, matching a live candle's shape. */
const latestOf = (series) => {
  if (!series) return null;

  return Object.fromEntries(
    Object.entries(series).map(([key, values]) => [key, values.at(-1) ?? null])
  );
};

const App = () => {
  const chartRef = useRef(null);
  const [lastPrice, setLastPrice] = useState(null);
  const [indicatorValues, setIndicatorValues] = useState(null);

  const { history, error, loading, refetch } = useCandleHistory();
  const { visibility, toggle } = useIndicatorVisibility(chartRef);

  // A detected gap repairs itself by reloading history, which is also what a
  // reconnect does — one recovery path for both.
  const { accept, syncTo } = useCandleContinuity({
    interval: DEFAULT_INTERVAL,
    onGap: useCallback((missing) => {
      console.warn(`[stream] ${missing} candle(s) missing — refetching history`);
      refetch();
    }, [refetch]),
  });

  // Seed the chart once history arrives, and again after a reconnect or a gap
  // repair. syncTo re-anchors continuity to what is now actually on screen.
  useEffect(() => {
    if (!history?.candles?.length) return;

    chartRef.current?.setHistory(history.candles, history.indicators);

    const newest = history.candles.at(-1);
    syncTo(newest.open_time);
    setLastPrice(newest.close);
    setIndicatorValues(latestOf(history.indicators));
  }, [history, syncTo]);

  /**
   * Chart data goes straight to the canvas through the ref — no setState, so
   * ten series are redrawn without React being involved at all.
   *
   * The continuity check runs first and can veto: an out-of-order candle is
   * dropped rather than handed to the chart, which would throw partway through
   * the series loop and leave the panes disagreeing with each other.
   */
  const handleCandle = useCallback((candle) => {
    const { drawable, order, missing } = accept(candle.open_time);

    if (!drawable) {
      console.warn(`[stream] dropped ${order} candle at ${candle.open_time}`);
      return;
    }

    if (missing > 0) {
      console.warn(`[stream] gap of ${missing} candle(s) before ${candle.open_time}`);
    }

    chartRef.current?.appendCandle(candle);

    setLastPrice(candle.close);
    if (candle.indicators) setIndicatorValues(candle.indicators);
  }, [accept]);

  const { status } = useCandleStream({ onCandle: handleCandle, onReconnect: refetch });

  return (
    <div className="app">
      <header className="header">
        <div className="header__symbol">
          <h1>{DEFAULT_SYMBOL}</h1>
          <span className="header__interval">{DEFAULT_INTERVAL}</span>
        </div>
        <div className="header__right">
          {lastPrice && <span className="header__price">{Number(lastPrice).toFixed(2)}</span>}
          <ConnectionStatus status={status} />
        </div>
      </header>

      <IndicatorToggles visibility={visibility} onToggle={toggle} />

      <main className="chart-wrapper">
        {/* The chart mounts immediately and stays mounted; overlays sit on top
            so loading or an error never unmounts and rebuilds the canvas. */}
        <CandleChart ref={chartRef} />
        <ChartLegend values={indicatorValues} visibility={visibility} />

        {loading && !history && <div className="overlay">Loading candles…</div>}
        {error && (
          <div className="overlay overlay--error">
            <p>{error}</p>
            <button type="button" onClick={refetch}>Retry</button>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
