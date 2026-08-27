import { WS_MESSAGE_TYPE } from '../../constants/websocket.js';

/** Never let a malformed frame throw inside a WebSocket event handler. */
export function parseStreamMessage(raw) {
  try {
    const message = JSON.parse(raw);
    return typeof message?.type === 'string' ? message : null;
  } catch {
    return null;
  }
}

export function isCandleMessage(message) {
  return message?.type === WS_MESSAGE_TYPE.CANDLE && Boolean(message.data);
}
