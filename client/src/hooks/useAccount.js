import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchBalance, fetchPositions, fetchTrades } from '../utils/api/strategy.js';

/**
 * Cash, positions and closed trades.
 *
 * Split by transport on purpose. The WebSocket `account` frame carries the live
 * summary and positions, so those need no polling. It does NOT carry trades —
 * so an account update triggers one small refetch of /api/trades, keeping the
 * blotter identical to the database rather than reconstructed from messages
 * that may have been missed.
 */
export const useAccount = () => {
  const [account, setAccount] = useState(null);
  const [trades, setTrades] = useState([]);
  const [error, setError] = useState(null);

  const inFlight = useRef(false);

  const loadTrades = useCallback(async () => {
    if (inFlight.current) return; // trades are rare; never stack refetches
    inFlight.current = true;

    try {
      const { trades: rows } = await fetchTrades(200);
      setTrades(rows);
    } catch (err) {
      setError(err.message);
    } finally {
      inFlight.current = false;
    }
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [balance, positions] = await Promise.all([fetchBalance(), fetchPositions()]);
      setAccount({ ...balance, positions: positions.positions });
      setError(null);
    } catch (err) {
      setError(err.message);
    }

    await loadTrades();
  }, [loadTrades]);

  useEffect(() => { loadAll(); }, [loadAll]);

  /** From the WebSocket: authoritative for cash and positions, right now. */
  const applyAccountMessage = useCallback((data) => {
    setAccount((current) => ({ ...current, ...data }));
    loadTrades();
  }, [loadTrades]);

  return { account, trades, error, applyAccountMessage, refresh: loadAll };
};
