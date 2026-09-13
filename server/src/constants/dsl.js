/**
 * The vocabulary of a user-defined strategy — everything a user may express.
 * A rule is data, not code: never eval or Function() a user string.
 */

export const NODE = Object.freeze({
  ALL: 'all',
  ANY: 'any',
  NOT: 'not',
  CROSS: 'cross',
  COMPARE: 'compare',
});

export const CONDITION_KEYS = Object.freeze(Object.values(NODE));

export const LOGIC_LIST_KEYS = Object.freeze([NODE.ALL, NODE.ANY]);

export const OPERAND = Object.freeze({
  INDICATOR: 'indicator',
  CONST: 'const',
  PRICE: 'price',
  PARAM: 'param',
});

export const OPERAND_KEYS = Object.freeze(Object.values(OPERAND));

/** open_time and symbol are excluded — comparing a timestamp to a price is always a bug. */
export const PRICE_FIELDS = Object.freeze(['open', 'high', 'low', 'close', 'volume']);

export const CROSS_DIRECTION = Object.freeze({ ABOVE: 'above', BELOW: 'below' });

export const CROSS_DIRECTIONS = Object.freeze(Object.values(CROSS_DIRECTION));

export const COMPARE_OPS = Object.freeze(['>', '<', '>=', '<=', '==', '!=']);

/** DoS guard, not style: a recursive validator blows the stack on a deep document. */
export const MAX_TREE_DEPTH = 8;
export const MAX_TREE_NODES = 64;

export const MAX_NAME_LENGTH = 80;
export const MAX_DESCRIPTION_LENGTH = 500;
export const MAX_PARAMS = 16;
export const MAX_PARAM_NAME_LENGTH = 40;

export const PARAM_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;

/** null means "warming up", which is not false — see Strategy.readIndicators. */
export const VERDICT = Object.freeze({ TRUE: true, FALSE: false, UNKNOWN: null });

export const DSL_ERROR = Object.freeze({
  NOT_AN_OBJECT: 'NOT_AN_OBJECT',
  MISSING_FIELD: 'MISSING_FIELD',
  UNKNOWN_FIELD: 'UNKNOWN_FIELD',
  UNKNOWN_NODE: 'UNKNOWN_NODE',
  AMBIGUOUS_NODE: 'AMBIGUOUS_NODE',
  UNKNOWN_OPERAND: 'UNKNOWN_OPERAND',
  UNKNOWN_INDICATOR: 'UNKNOWN_INDICATOR',
  UNKNOWN_TIMEFRAME: 'UNKNOWN_TIMEFRAME',
  UNKNOWN_PRICE_FIELD: 'UNKNOWN_PRICE_FIELD',
  UNKNOWN_PARAM: 'UNKNOWN_PARAM',
  BAD_OPERATOR: 'BAD_OPERATOR',
  BAD_DIRECTION: 'BAD_DIRECTION',
  EMPTY_LIST: 'EMPTY_LIST',
  TOO_DEEP: 'TOO_DEEP',
  TOO_MANY_NODES: 'TOO_MANY_NODES',
  TOO_LONG: 'TOO_LONG',
  BAD_VALUE: 'BAD_VALUE',
});
