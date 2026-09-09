import { useCallback, useEffect, useState } from 'react';
import {
  fetchStrategyStatus,
  startStrategyRequest,
  stopStrategyRequest,
} from '../utils/api/strategy.js';

/**
 * Owns the strategy control surface.
 *
 * Everything the UI renders — which strategies exist, their parameter names and
 * defaults — comes from /api/strategy/status. Nothing about strategies is
 * hardcoded here, so adding one on the server makes it appear in the dropdown.
 */
export const useStrategyControl = () => {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await fetchStrategyStatus());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Wraps a mutation so every path clears the previous error and the busy flag. */
  const run = useCallback(async (action) => {
    setBusy(true);
    setError(null);

    try {
      setStatus(await action());
      return true;
    } catch (err) {
      setError(err.message);
      // Server state is unchanged on a rejected start, but re-read it rather
      // than assume — the UI must show what IS running, not what we hoped.
      await load();
      return false;
    } finally {
      setBusy(false);
    }
  }, [load]);

  const start = useCallback(
    (name, params) => run(() => startStrategyRequest(name, params)),
    [run]
  );

  const stop = useCallback(() => run(() => stopStrategyRequest()), [run]);

  return { status, error, busy, start, stop, refresh: load };
};
