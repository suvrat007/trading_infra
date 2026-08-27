import { WS_MESSAGE_TYPE } from '../../constants/websocket.js';

/**
 * Every frame is a tagged envelope rather than a bare candle. The client
 * switches on `type`, so adding trades or an order book later is additive
 * instead of a breaking change to the wire format.
 */
export function buildWelcomeMessage({ symbol, interval }) {
  return {
    type: WS_MESSAGE_TYPE.WELCOME,
    data: { symbol, interval, serverTime: Date.now() },
  };
}

export function buildCandleMessage(candle) {
  return { type: WS_MESSAGE_TYPE.CANDLE, data: candle };
}
