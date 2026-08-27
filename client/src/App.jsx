import { useCallback, useEffect, useRef, useState } from 'react';
import { CandleChart } from './components/CandleChart.jsx';
import { ConnectionStatus } from './components/ConnectionStatus.jsx';
import { DEFAULT_INTERVAL, DEFAULT_SYMBOL } from './constants/api.js';
import { useCandleHistory } from './hooks/useCandleHistory.js';
import { useCandleStream } from './hooks/useCandleStream.js';

export default function App() {
  const chartRef = useRef(null);
  const [lastPrice, setLastPrice] = useState(null);

  const { candles, error, loading, refetch } = useCandleHistory();

  // Seed the chart once history arrives, and again after a reconnect backfill.
  useEffect(() => {
    if (!candles?.length) return;
    chartRef.current?.setCandles(candles);
    setLastPrice(candles.at(-1).close);
  }, [candles]);

  // Straight to the chart's imperative handle — no setState, so a new candle
  // does not re-render this component or anything under it.
  const handleCandle = useCallback((candle) => {
    chartRef.current?.appendCandle(candle);
    setLastPrice(candle.close); // the header is the only React-rendered readout
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

      <main className="chart-wrapper">
        {/* The chart mounts immediately and stays mounted; overlays sit on top
            so loading or an error never unmounts and rebuilds the canvas. */}
        <CandleChart ref={chartRef} />

        {loading && !candles && <div className="overlay">Loading candles…</div>}
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
