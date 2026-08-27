import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_INTERVAL, DEFAULT_LIMIT, DEFAULT_SYMBOL } from '../constants/api.js';
import { fetchCandles } from '../utils/api/candles.js';

/**
 * Loads the historical window that seeds the chart.
 * Also exposes refetch(), which the stream uses after a reconnect to repair
 * any candles that closed while the socket was down.
 */
export function useCandleHistory({
  symbol = DEFAULT_SYMBOL,
  interval = DEFAULT_INTERVAL,
  limit = DEFAULT_LIMIT,
} = {}) {
  const [candles, setCandles] = useState(null);
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
      const rows = await fetchCandles({ symbol, interval, limit, signal: controller.signal });
      setCandles(rows);
    } catch (err) {
      if (err.name === 'AbortError') return; // superseded or unmounted: not an error
      setError(err.message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [symbol, interval, limit]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  return { candles, error, loading, refetch: load };
}
