import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_INTERVAL, DEFAULT_LIMIT, DEFAULT_SYMBOL } from '../constants/api.js';
import { fetchCandles } from '../utils/api/candles.js';

/**
 * Loads the historical window that seeds the chart, with its indicator series.
 *
 * Also exposes refetch(), which the stream uses after a reconnect to repair any
 * candles that closed while the socket was down.
 *
 * Candles and indicators are held in ONE state object, updated in one call.
 * Splitting them into two useState values would let a render land between the
 * two updates, drawing new candles against stale indicator lines.
 */
export function useCandleHistory({
  symbol = DEFAULT_SYMBOL,
  interval = DEFAULT_INTERVAL,
  limit = DEFAULT_LIMIT,
  indicators = true,
} = {}) {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // Lets a newer request cancel the one in flight, so a slow earlier response
  // cannot land after a faster later one and show stale data.
  const abortRef = useRef(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const result = await fetchCandles({
        symbol,
        interval,
        limit,
        indicators,
        signal: controller.signal,
      });
      setHistory(result);
    } catch (err) {
      if (err.name === 'AbortError') return; // superseded or unmounted: not an error
      setError(err.message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [symbol, interval, limit, indicators]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  return { history, error, loading, refetch: load };
}
