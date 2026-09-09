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

/** A strategy decision, whether or not the broker filled it. */
export const buildSignalMessage = ({ signal, symbol, price, openTime, strategy, result }) => ({
  type: WS_MESSAGE_TYPE.SIGNAL,
  data: {
    signal,
    symbol,
    price,
    open_time: openTime,
    strategy,
    accepted: result.accepted,
    reason: result.reason ?? null,
    detail: result.detail ?? null,
    quantity: result.quantity ?? null,
  },
});

/** Full account state. Sent after any fill, and to every new client. */
export const buildAccountMessage = (broker) => ({
  type: WS_MESSAGE_TYPE.ACCOUNT,
  data: {
    ...broker.getSummary(),
    positions: broker.getPositions(),
  },
});

/** The bar currently forming. Same shape as a candle, plus closed: false. */
export const buildTickMessage = (tick) => ({
  type: WS_MESSAGE_TYPE.TICK,
  data: tick,
});
