import path from 'node:path';
import { SERVER_ROOT } from './env.js';

/**
 * How signals are produced.
 *
 *   node   — the JavaScript strategy trades. The C++ engine is not started.
 *   shadow — both run. JavaScript trades; C++ decisions are compared against it
 *            and timed, but never reach the broker.
 *   cpp    — C++ trades. JavaScript still computes a decision, purely so the
 *            two can be compared, but does not execute.
 *
 * `node` is the default deliberately: a C++ process that fails to start, or is
 * not built on this machine, must not stop the system from trading.
 *
 * The three modes ARE the strangler fig. The old path keeps running while the
 * new one is proven beside it on live data, and the switch is one environment
 * variable — in both directions.
 */
export const EXECUTION_MODES = Object.freeze({
  NODE: 'node',
  SHADOW: 'shadow',
  CPP: 'cpp',
});

const requestedMode = (process.env.EXECUTION_MODE || EXECUTION_MODES.NODE).toLowerCase();

export const EXECUTION_MODE = Object.values(EXECUTION_MODES).includes(requestedMode)
  ? requestedMode
  : EXECUTION_MODES.NODE;

export const ENGINE_ENABLED = EXECUTION_MODE !== EXECUTION_MODES.NODE;

/** True when C++ signals reach the broker. Only one path may ever trade. */
export const ENGINE_TRADES = EXECUTION_MODE === EXECUTION_MODES.CPP;

/**
 * Node connects; the engine binds. Loopback rather than 0.0.0.0, so the
 * strategy port is not reachable from the network — unlike the WebSocket, this
 * one would let anyone inject trade signals.
 */
export const ENGINE_PUSH_ENDPOINT = process.env.ENGINE_PUSH || 'tcp://127.0.0.1:5555';
export const ENGINE_PULL_ENDPOINT = process.env.ENGINE_PULL || 'tcp://127.0.0.1:5556';

/** Built by engine/build.ps1. Absolute, so cwd never changes behaviour. */
export const ENGINE_BINARY = process.env.ENGINE_BINARY
  || path.join(SERVER_ROOT, '..', 'engine', 'build', 'bin', 'trading_engine.exe');

/** Spawn the engine as a child process, or expect one already running. */
export const ENGINE_AUTOSTART = process.env.ENGINE_AUTOSTART !== 'false';

/** Passed through to the engine so both sides agree on the periods. */
export const ENGINE_FAST_PERIOD = Number(process.env.ENGINE_FAST_PERIOD || 9);
export const ENGINE_SLOW_PERIOD = Number(process.env.ENGINE_SLOW_PERIOD || 21);

/** Actions the engine can return. HOLD is a value, not silence — see types.h. */
export const ENGINE_ACTION = Object.freeze({
  BUY: 'BUY',
  SELL: 'SELL',
  HOLD: 'HOLD',
});

/**
 * How many recent JavaScript decisions to keep for comparison.
 *
 * Bounded because it is keyed by candle open time and would otherwise grow for
 * the life of the process. 500 candles is over eight hours of 1m bars, far more
 * than any plausible engine delay.
 */
export const DECISION_HISTORY = 500;

/** Give a spawned engine this long to bind before the first candle is pushed. */
export const ENGINE_STARTUP_GRACE_MS = 500;

export const LOG_ENGINE = '[engine]';
export const LOG_ENGINE_OUT = '[engine:cpp]';
