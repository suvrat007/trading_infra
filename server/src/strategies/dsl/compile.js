import { CROSS, } from '../../constants/strategies.js';
import { NODE, OPERAND, VERDICT } from '../../constants/dsl.js';
import { createCrossTracker } from '../../utils/strategies/cross.js';
import { conditionKind, operandKind } from './schema.js';

/**
 * Compiles a VALIDATED tree into a closure tree, once, at construction.
 * Evaluating then costs one call per node instead of re-inspecting the shape per candle.
 */

const numeric = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const compileOperand = (operand, params) => {
  const kind = operandKind(operand);
  const value = operand[kind];

  switch (kind) {
    case OPERAND.INDICATOR:
      return (candle, indicators) => numeric(indicators?.[value]);

    case OPERAND.PRICE:
      return (candle) => numeric(Number(candle?.[value]));

    case OPERAND.CONST: {
      const constant = value;
      return () => constant;
    }

    case OPERAND.PARAM: {
      // Params are fixed for the life of the strategy, so resolve now, not per candle.
      const resolved = numeric(params[value]);
      return () => resolved;
    }

    default:
      throw new TypeError(`compile: unknown operand "${kind}" — validator should have caught this`);
  }
};

const COMPARATORS = {
  '>': (a, b) => a > b,
  '<': (a, b) => a < b,
  '>=': (a, b) => a >= b,
  '<=': (a, b) => a <= b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
};

/**
 * Three-valued logic. `all` is false the moment any child is false even if
 * another is unknown — we already know the answer.
 */
const compileAll = (children) => (candle, indicators) => {
  let unknown = false;

  for (const child of children) {
    const verdict = child(candle, indicators);
    if (verdict === VERDICT.FALSE) return VERDICT.FALSE;
    if (verdict === VERDICT.UNKNOWN) unknown = true;
  }

  return unknown ? VERDICT.UNKNOWN : VERDICT.TRUE;
};

const compileAny = (children) => (candle, indicators) => {
  let unknown = false;

  for (const child of children) {
    const verdict = child(candle, indicators);
    if (verdict === VERDICT.TRUE) return VERDICT.TRUE;
    if (verdict === VERDICT.UNKNOWN) unknown = true;
  }

  return unknown ? VERDICT.UNKNOWN : VERDICT.FALSE;
};

const compileNot = (child) => (candle, indicators) => {
  const verdict = child(candle, indicators);
  return verdict === VERDICT.UNKNOWN ? VERDICT.UNKNOWN : !verdict;
};

const compileCompare = (op, left, right) => {
  const comparator = COMPARATORS[op];

  return (candle, indicators) => {
    const a = left(candle, indicators);
    const b = right(candle, indicators);
    if (a === null || b === null) return VERDICT.UNKNOWN;
    return comparator(a, b);
  };
};

/**
 * Each cross node owns its tracker — sharing one across nodes makes both fire at random.
 * A null operand must NOT advance it, or the first real value looks like a cross.
 */
const compileCross = (direction, left, right, trackers, path) => {
  const tracker = createCrossTracker();
  trackers.set(path, tracker);

  const wanted = direction === 'above' ? CROSS.UP : CROSS.DOWN;

  return (candle, indicators) => {
    const a = left(candle, indicators);
    const b = right(candle, indicators);
    if (a === null || b === null) return VERDICT.UNKNOWN;
    return tracker.update(a, b) === wanted;
  };
};

const compileCondition = (node, path, params, trackers) => {
  const kind = conditionKind(node);

  switch (kind) {
    case NODE.ALL:
    case NODE.ANY: {
      const children = node[kind].map((child, i) =>
        compileCondition(child, `${path}.${kind}[${i}]`, params, trackers));
      return kind === NODE.ALL ? compileAll(children) : compileAny(children);
    }

    case NODE.NOT:
      return compileNot(compileCondition(node[kind], `${path}.${NODE.NOT}`, params, trackers));

    case NODE.COMPARE:
      return compileCompare(
        node[kind],
        compileOperand(node.left, params),
        compileOperand(node.right, params),
      );

    case NODE.CROSS:
      return compileCross(
        node[kind],
        compileOperand(node.left, params),
        compileOperand(node.right, params),
        trackers,
        path,
      );

    default:
      throw new TypeError(`compile: unknown node "${kind}" — validator should have caught this`);
  }
};

/** @returns {{evaluate(candle, indicators): true|false|null, reset(): void, trackerPaths: string[]}} */

export const compileTree = (root, { params = {}, path = '' } = {}) => {
  const trackers = new Map();
  const evaluate = compileCondition(root, path, params, trackers);

  return {
    evaluate,
    reset: () => { for (const tracker of trackers.values()) tracker.reset(); },
    trackerPaths: [...trackers.keys()],
  };
};

/** Compiles both trees of a validated document. */

export const compileDocument = (document) => ({
  entry: compileTree(document.entry, { params: document.params ?? {}, path: 'entry' }),
  exit: compileTree(document.exit, { params: document.params ?? {}, path: 'exit' }),
});
