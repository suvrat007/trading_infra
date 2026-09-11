import { DECISION_HISTORY } from '../../constants/engine.js';

/**
 * Shared ledger of what each engine decided, keyed by candle open time.
 *
 * It lives here rather than inside either engine because both write to it and
 * neither owns the other: the JavaScript runner records its decision as it
 * makes one, the ZeroMQ bridge records the C++ decision whenever it arrives,
 * and whichever lands second does the comparison.
 *
 * That ordering is the reason this is a ledger and not a direct call. The two
 * paths are asynchronous relative to each other — the C++ answer for candle N
 * may arrive before or after JavaScript finishes candle N — so neither can
 * simply ask the other "what did you decide?".
 */

const decisions = new Map();

const stats = {
  compared: 0,
  agreed: 0,
  diverged: 0,
  divergences: [],
};

/** Keyed by open time, so it grows without a bound unless it is trimmed. */
const trim = () => {
  while (decisions.size > DECISION_HISTORY) {
    const oldest = decisions.keys().next().value;
    decisions.delete(oldest);
  }
};

const entryFor = (openTime) => {
  let entry = decisions.get(openTime);

  if (!entry) {
    entry = { openTime, node: null, cpp: null, compared: false };
    decisions.set(openTime, entry);
    trim();
  }

  return entry;
};

/**
 * Compare only once both sides are in, and only once per candle.
 *
 * Returns the comparison, or null if the other side has not reported yet.
 */
const compare = (entry) => {
  if (entry.compared || !entry.node || !entry.cpp) return null;

  entry.compared = true;
  stats.compared += 1;

  const agreed = entry.node.action === entry.cpp.action;

  if (agreed) {
    stats.agreed += 1;
  } else {
    stats.diverged += 1;
    // Bounded for the same reason the ledger is: an unbounded array of
    // divergences would be a slow leak in exactly the failure case where the
    // process most needs to stay up.
    stats.divergences.push({
      openTime: entry.openTime,
      node: entry.node.action,
      cpp: entry.cpp.action,
    });
    if (stats.divergences.length > DECISION_HISTORY) stats.divergences.shift();
  }

  return {
    openTime: entry.openTime,
    agreed,
    node: entry.node,
    cpp: entry.cpp,
  };
};

/** @returns the comparison if this completed a pair, else null. */
export const recordNodeDecision = ({ openTime, action, strategyUs }) => {
  const entry = entryFor(openTime);
  entry.node = { action, strategyUs };
  return compare(entry);
};

/** @returns the comparison if this completed a pair, else null. */
export const recordCppDecision = ({ openTime, action, engineLatencyUs, roundTripUs }) => {
  const entry = entryFor(openTime);
  entry.cpp = { action, engineLatencyUs, roundTripUs };
  return compare(entry);
};

export const getComparisonStats = () => ({
  ...stats,
  divergences: [...stats.divergences],
  pending: [...decisions.values()].filter((entry) => !entry.compared).length,
});

export const resetComparison = () => {
  decisions.clear();
  stats.compared = 0;
  stats.agreed = 0;
  stats.diverged = 0;
  stats.divergences = [];
};
