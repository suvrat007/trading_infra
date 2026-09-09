import { useEffect, useRef, useState } from 'react';
import { CONNECTION_STATUS, WS_URL } from '../constants/websocket.js';
import { backoffDelay } from '../utils/stream/backoff.js';
import {
  isAccountMessage,
  isCandleMessage,
  isSignalMessage,
  isTickMessage,
  parseStreamMessage,
} from '../utils/stream/message.js';

/**
 * Holds one WebSocket to the broadcast server for the life of the component,
 * reconnecting with backoff when it drops.
 *
 * @param {(candle: object) => void} onCandle   called per CLOSED candle
 * @param {(tick: object) => void} [onTick]     called per forming-bar update
 * @param {() => void} [onReconnect]            called after a *re*connect, so the
 *   caller can backfill candles missed while the socket was down
 */
export const useCandleStream = ({ onCandle, onTick, onSignal, onAccount, onReconnect }) => {
  const [status, setStatus] = useState(CONNECTION_STATUS.CONNECTING);

  // Callbacks live in refs so that a parent re-render (which creates new
  // function identities) does not tear down and rebuild the socket.
  // Every callback lives in a ref so a parent re-render cannot rebuild the socket.
  const handlers = useRef({});
  handlers.current = { onCandle, onTick, onSignal, onAccount, onReconnect };

  useEffect(() => {
    let socket = null;
    let retryTimer = null;
    let attempt = 0;
    let hasConnectedBefore = false;
    let disposed = false; // guards against React StrictMode's double-mount

    const connect = () => {
      if (disposed) return;

      socket = new WebSocket(WS_URL);

      socket.onopen = () => {
        attempt = 0;
        setStatus(CONNECTION_STATUS.LIVE);

        // Only on a RE-connect: candles may have closed while we were away,
        // and the broadcast server has no replay buffer. Refetch history so
        // the chart does not keep a permanent hole in it.
        if (hasConnectedBefore) handlers.current.onReconnect?.();
        hasConnectedBefore = true;
      };

      socket.onmessage = (event) => {
        const message = parseStreamMessage(event.data);
        const { onCandle: c, onTick: t, onSignal: s, onAccount: a } = handlers.current;

        if (isCandleMessage(message)) c?.(message.data);
        else if (isTickMessage(message)) t?.(message.data);
        else if (isSignalMessage(message)) s?.(message.data);
        else if (isAccountMessage(message)) a?.(message.data);
      };

      // 'error' is always followed by 'close', so reconnect logic lives in one
      // place only — otherwise every failure would schedule two reconnects.
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
    };

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
};
