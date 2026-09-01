import { useEffect, useRef, useState } from 'react';
import { CONNECTION_STATUS, WS_URL } from '../constants/websocket.js';
import { backoffDelay } from '../utils/stream/backoff.js';
import { isCandleMessage, parseStreamMessage } from '../utils/stream/message.js';

/**
 * Holds one WebSocket to the broadcast server for the life of the component,
 * reconnecting with backoff when it drops.
 *
 * @param {(candle: object) => void} onCandle   called per live candle
 * @param {() => void} [onReconnect]            called after a *re*connect, so the
 *   caller can backfill candles missed while the socket was down
 */

export function useCandleStream({ onCandle, onReconnect }) {
  const [status, setStatus] = useState(CONNECTION_STATUS.CONNECTING);

  const onCandleRef = useRef(onCandle);
  const onReconnectRef = useRef(onReconnect);
  onCandleRef.current = onCandle;
  onReconnectRef.current = onReconnect;

  useEffect(() => {
    let socket = null;
    let retryTimer = null;
    let attempt = 0;
    let hasConnectedBefore = false;
    let disposed = false; // guards against React 18 StrictMode's double-mount

    function connect() {
      if (disposed) return;

      socket = new WebSocket(WS_URL);

      socket.onopen = () => {
        attempt = 0;
        setStatus(CONNECTION_STATUS.LIVE);

        // Only on a RE-connect: candles may have closed while we were away,
        // and the broadcast server has no replay buffer. Refetch history so
        // the chart does not keep a permanent hole in it.
        if (hasConnectedBefore) onReconnectRef.current?.();
        hasConnectedBefore = true;
      };

      socket.onmessage = (event) => {
        const message = parseStreamMessage(event.data);
        if (isCandleMessage(message)) onCandleRef.current?.(message.data);
      };

      // 'error' is always followed by 'close', so reconnect logic lives in one
      socket.onerror = () => {};

      socket.onclose = () => {
        if (disposed) return;

        setStatus(
          hasConnectedBefore ? CONNECTION_STATUS.RECONNECTING : CONNECTION_STATUS.OFFLINE
        );

        const delay = backoffDelay(attempt);
        attempt += 1;
        retryTimer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      // Remove the handler first: closing fires onclose, which would otherwise
      // schedule a reconnect for a component that is going away.
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, []);

  return { status };
}
