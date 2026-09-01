import { useCallback, useEffect, useRef, useState } from 'react';
import { CandleChart } from './components/CandleChart.jsx';
import { ChartLegend } from './components/ChartLegend.jsx';
import { ConnectionStatus } from './components/ConnectionStatus.jsx';
import { IndicatorToggles } from './components/IndicatorToggles.jsx';
import { DEFAULT_INTERVAL, DEFAULT_SYMBOL } from './constants/api.js';
import { useCandleHistory } from './hooks/useCandleHistory.js';
import { useCandleStream } from './hooks/useCandleStream.js';
import { useIndicatorVisibility } from './hooks/useIndicatorVisibility.js';

/** Series arrays -> the scalar tail of each, matching a live candle's shape. */
function latestOf(series) {
  if (!series) return null;

  return Object.fromEntries(
    Object.entries(series).map(([key, values]) => [key, values.at(-1) ?? null])
  );
}

export default function App() {
  const chartRef = useRef(null);
  const [lastPrice, setLastPrice] = useState(null);
  const [indicatorValues, setIndicatorValues] = useState(null);

  const { history, error, loading, refetch } = useCandleHistory();
  const { visibility, toggle } = useIndicatorVisibility(chartRef);

  // Seed the chart once history arrives, and again after a reconnect backfill.
  useEffect(() => {
    if (!history?.candles?.length) return;

    chartRef.current?.setHistory(history.candles, history.indicators);
    setLastPrice(history.candles.at(-1).close);
    setIndicatorValues(latestOf(history.indicators));
  }, [history]);

  /**
   * Chart data goes straight to the canvas through the ref — no setState, so
   * nine series are redrawn without React being involved at all.
   *
   * The two setState calls below drive only the small text readouts in the
   * header and legend. CandleChart is memoized and takes no props, so it never
   * re-renders when they change.
   */
  const handleCandle = useCallback((candle) => {
    chartRef.current?.appendCandle(candle);

    setLastPrice(candle.close);
    if (candle.indicators) setIndicatorValues(candle.indicators);
  }, []);

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
}
