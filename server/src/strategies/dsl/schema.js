import {
  CONDITION_KEYS,
  LOGIC_LIST_KEYS,
  NODE,
  OPERAND,
  OPERAND_KEYS,
} from '../../constants/dsl.js';

/**
 * Shape of a strategy document and predicates for its parts.
 * Validation lives in utils/strategies/dsl/validate.js, behaviour in compile.js.
 *
 *   { name, description?, timeframe, params?, entry: <condition>, exit: <condition> }
 *
 *   condition : { all: [...] } | { any: [...] } | { not: {...} }
 *             | { cross: 'above'|'below', left, right }
 *             | { compare: '>'|'<'|'>='|'<='|'=='|'!=', left, right }
 *   operand   : { indicator } | { const } | { price } | { param }
 */

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const keysPresent = (node, allowed) =>
  isPlainObject(node) ? allowed.filter((key) => Object.hasOwn(node, key)) : [];

/** null when unknown OR ambiguous — picking one would run a rule nobody wrote. */
export const conditionKind = (node) => {
  const found = keysPresent(node, CONDITION_KEYS);
  return found.length === 1 ? found[0] : null;
};

export const operandKind = (node) => {
  const found = keysPresent(node, OPERAND_KEYS);
  return found.length === 1 ? found[0] : null;
};

export const isAmbiguousCondition = (node) => keysPresent(node, CONDITION_KEYS).length > 1;
export const isAmbiguousOperand = (node) => keysPresent(node, OPERAND_KEYS).length > 1;

export const isLogicList = (kind) => LOGIC_LIST_KEYS.includes(kind);
export const isNot = (kind) => kind === NODE.NOT;
export const takesOperands = (kind) => kind === NODE.CROSS || kind === NODE.COMPARE;

export const childConditions = (node) => {
  const kind = conditionKind(node);
  if (isLogicList(kind)) return Array.isArray(node[kind]) ? node[kind] : [];
  if (isNot(kind)) return [node[kind]];
  return [];
};

export const operandsOf = (node) => {
  const kind = conditionKind(node);
  if (!takesOperands(kind)) return [];
  return [['left', node.left], ['right', node.right]];
};

/** Yields [path, node]. Paths are stable, so a cross node can key its state by one. */
export function* walkConditions(node, path = '') {
  yield [path, node];

  const kind = conditionKind(node);

  if (isLogicList(kind)) {
    const children = Array.isArray(node[kind]) ? node[kind] : [];
    for (const [index, child] of children.entries()) {
      yield* walkConditions(child, `${path}.${kind}[${index}]`);
    }
    return;
  }

  if (isNot(kind)) yield* walkConditions(node[kind], `${path}.${NODE.NOT}`);
};

const namesOfKind = (node, wanted) => {
  const found = new Set();

  for (const [, condition] of walkConditions(node)) {
    for (const [, operand] of operandsOf(condition)) {
      if (operandKind(operand) === wanted) found.add(operand[wanted]);
    }
  }

  return [...found];
};

export const indicatorsIn = (node) => namesOfKind(node, OPERAND.INDICATOR);
export const paramsIn = (node) => namesOfKind(node, OPERAND.PARAM);

export const DOCUMENT_FIELDS = Object.freeze([
  'name', 'description', 'timeframe', 'params', 'entry', 'exit',
]);

export const REQUIRED_DOCUMENT_FIELDS = Object.freeze(['name', 'timeframe', 'entry', 'exit']);

export { isPlainObject };
