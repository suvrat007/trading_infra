import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccountPanel } from './components/AccountPanel.jsx';
import { CandleChart } from './components/CandleChart.jsx';
import { ChartLegend } from './components/ChartLegend.jsx';
import { ConnectionStatus } from './components/ConnectionStatus.jsx';
import { IndicatorToggles } from './components/IndicatorToggles.jsx';
import { PnlChart } from './components/PnlChart.jsx';
import { StrategyControls } from './components/StrategyControls.jsx';
import { TimeframeSelector } from './components/TimeframeSelector.jsx';
import { TradeBlotter } from './components/TradeBlotter.jsx';
import { DEFAULT_INTERVAL, DEFAULT_SYMBOL } from './constants/api.js';
import { useAccount } from './hooks/useAccount.js';
import { useCandleContinuity } from './hooks/useCandleContinuity.js';
import { useCandleHistory } from './hooks/useCandleHistory.js';
import { useCandleStream } from './hooks/useCandleStream.js';
import { useIndicatorVisibility } from './hooks/useIndicatorVisibility.js';
import { useStrategyControl } from './hooks/useStrategyControl.js';
import { useTimeframes } from './hooks/useTimeframes.js';
import { intervalToMs } from './utils/stream/continuity.js';
import { toTradeMarkers } from './utils/chart/pnl.js';
import { toChartTime } from './utils/chart/candle.js';

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
  const [liveSignals, setLiveSignals] = useState([]);

  // The server decides which timeframes exist and which is default; this is
  // seeded from it rather than from a constant in the frontend.
  const { timeframes, selected: interval, select: selectTimeframe } = useTimeframes();

  // Refetches automatically whenever `interval` changes — the hook already
  // aborts the in-flight request, so switching quickly cannot land an older
  // response after a newer one.
  const { history, error, loading, refetch } = useCandleHistory({
    interval: interval ?? DEFAULT_INTERVAL,
  });
  const { visibility, toggle } = useIndicatorVisibility(chartRef);
  const { account, trades, applyAccountMessage } = useAccount();
  const strategy = useStrategyControl();

  const { accept, syncTo } = useCandleContinuity({
    interval: interval ?? DEFAULT_INTERVAL,
    onGap: useCallback((missing) => {
      console.warn(`[stream] ${missing} candle(s) missing — refetching history`);
      refetch();
    }, [refetch]),
  });

  useEffect(() => {
    if (!history?.candles?.length) return;

    chartRef.current?.setHistory(history.candles, history.indicators);

    const newest = history.candles.at(-1);
    syncTo(newest.open_time);
    setLastPrice(newest.close);
    setIndicatorValues(latestOf(history.indicators));
  }, [history, syncTo]);

  /**
   * Markers come from persisted trades PLUS signals seen this session.
   *
   * Trades survive a reload but only mark filled orders; live signals also show
   * the ones the broker rejected, which is exactly what you want to see when a
   * strategy is signalling but never filling.
   */
  const markers = useMemo(
    () => [...toTradeMarkers(trades, intervalToMs(interval ?? DEFAULT_INTERVAL)), ...liveSignals],
    [trades, liveSignals, interval]
  );

  useEffect(() => { chartRef.current?.setSignals(markers); }, [markers]);

  const handleCandle = useCallback((candle) => {
    // One socket now carries all five timeframes. Anything that is not the one
    // on screen must be dropped HERE, before continuity sees it — a 1d candle
    // fed into a 1m continuity check reads as a gap of 1,439 bars and would
    // trigger an endless refetch loop.
    if (candle.interval !== interval) return;

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
  }, [accept, interval]);

  /** Forming bar. Chart and price only — never continuity, never the strategy. */
  const handleTick = useCallback((tick) => {
    if (tick.interval !== interval) return;

    chartRef.current?.updateTick(tick);
    setLastPrice(tick.close);
  }, [interval]);

  const handleSignal = useCallback((signal) => {
    setLiveSignals((current) => [
      ...current,
      { time: toChartTime(signal.open_time), side: signal.signal },
    ]);
  }, []);

  const { status } = useCandleStream({
    onCandle: handleCandle,
    onTick: handleTick,
    onSignal: handleSignal,
    onAccount: applyAccountMessage,
    onReconnect: refetch,
  });

  return (
    <div className="app">
      <header className="header">
        <div className="header__symbol">
          <h1>{DEFAULT_SYMBOL}</h1>
          <TimeframeSelector
            timeframes={timeframes}
            selected={interval}
            onSelect={selectTimeframe}
          />
        </div>
        <div className="header__right">
          {lastPrice && <span className="header__price">{Number(lastPrice).toFixed(2)}</span>}
          <ConnectionStatus status={status} />
        </div>
      </header>

      <IndicatorToggles visibility={visibility} onToggle={toggle} />

      <div className="dashboard">
        <main className="dashboard__main">
          <div className="chart-wrapper">
            <CandleChart ref={chartRef} />
            <ChartLegend values={indicatorValues} visibility={visibility} />

            {loading && !history && <div className="overlay">Loading candles…</div>}
            {error && (
              <div className="overlay overlay--error">
                <p>{error}</p>
                <button type="button" onClick={refetch}>Retry</button>
              </div>
            )}
          </div>

          <PnlChart trades={trades} />
        </main>

        <aside className="dashboard__side">
          <StrategyControls
            status={strategy.status}
            error={strategy.error}
            busy={strategy.busy}
            onStart={strategy.start}
            onStop={strategy.stop}
          />
          <AccountPanel account={account} />
          <TradeBlotter trades={trades} />
        </aside>
      </div>
    </div>
  );
};

export default App;
