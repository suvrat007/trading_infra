import { useEffect, useState } from 'react';
import { DEFAULT_SYMBOL } from '../constants/api.js';
import { fetchTimeframes } from '../utils/api/timeframes.js';

/**
 * The timeframe list, and which one is selected.
 *
 * Selection is held here rather than in App so the "which timeframes exist"
 * question and the "which is chosen" answer cannot disagree — the selection is
 * always seeded from the server's own default, and is never a value the server
 * does not serve.
 */
export function useTimeframes({ symbol = DEFAULT_SYMBOL } = {}) {
  const [timeframes, setTimeframes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();

    fetchTimeframes({ symbol, signal: controller.signal })
      .then((data) => {
        setTimeframes(data.timeframes);
        // Only seed once. A later refetch must not yank the chart back to the
        // default while someone is looking at another timeframe.
        setSelected((current) => current ?? data.default);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setError(err.message);
      });

    return () => controller.abort();
  }, [symbol]);

  return { timeframes, selected, select: setSelected, error };
}
