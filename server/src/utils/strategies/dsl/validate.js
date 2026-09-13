import { INDICATOR_KEYS } from '../../../constants/indicators.js';
import { TIMEFRAME_IDS } from '../../../constants/timeframes.js';
import {
  COMPARE_OPS,
  CROSS_DIRECTIONS,
  DSL_ERROR,
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PARAMS,
  MAX_TREE_DEPTH,
  MAX_TREE_NODES,
  NODE,
  OPERAND,
  PARAM_NAME_PATTERN,
  PRICE_FIELDS,
} from '../../../constants/dsl.js';
import {
  DOCUMENT_FIELDS,
  REQUIRED_DOCUMENT_FIELDS,
  childConditions,
  conditionKind,
  isAmbiguousCondition,
  isAmbiguousOperand,
  isLogicList,
  isPlainObject,
  isNot,
  operandKind,
  takesOperands,
} from '../../../strategies/dsl/schema.js';

/** Validates a strategy document. Collects every error, each tagged with its path. */

const KNOWN_INDICATORS = new Set(INDICATOR_KEYS);
const KNOWN_TIMEFRAMES = new Set(TIMEFRAME_IDS);

const fail = (errors, path, code, message) => errors.push({ path, code, message });

/**
 * Depth and size, measured iteratively with an explicit stack.
 * Must run before the recursive pass or a deep document blows the call stack.
 */
const measureTree = (root) => {
  const stack = [[root, 1]];
  let nodes = 0;
  let depth = 0;

  while (stack.length > 0) {
    const [node, level] = stack.pop();

    nodes += 1;
    if (level > depth) depth = level;

    if (nodes > MAX_TREE_NODES || depth > MAX_TREE_DEPTH) break;

    for (const child of childConditions(node)) stack.push([child, level + 1]);
  }

  return { nodes, depth };
};

const validateOperand = (operand, path, params, errors) => {
  if (!isPlainObject(operand)) {
    fail(errors, path, DSL_ERROR.UNKNOWN_OPERAND, 'operand must be an object');
    return;
  }

  if (isAmbiguousOperand(operand)) {
    fail(errors, path, DSL_ERROR.AMBIGUOUS_NODE, 'operand names more than one kind');
    return;
  }

  const kind = operandKind(operand);
  const value = operand[kind];

  switch (kind) {
    case OPERAND.INDICATOR:
      if (!KNOWN_INDICATORS.has(value)) {
        fail(errors, path, DSL_ERROR.UNKNOWN_INDICATOR,
          `unknown indicator "${value}"; the engine computes ${INDICATOR_KEYS.length} others`);
      }
      break;

    case OPERAND.CONST:
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        fail(errors, path, DSL_ERROR.BAD_VALUE, 'const must be a finite number');
      }
      break;

    case OPERAND.PRICE:
      if (!PRICE_FIELDS.includes(value)) {
        fail(errors, path, DSL_ERROR.UNKNOWN_PRICE_FIELD,
          `price must be one of: ${PRICE_FIELDS.join(', ')}`);
      }
      break;

    case OPERAND.PARAM:
      if (!params.has(value)) {
        fail(errors, path, DSL_ERROR.UNKNOWN_PARAM,
          `param "${value}" is not declared in params`);
      }
      break;

    default:
      fail(errors, path, DSL_ERROR.UNKNOWN_OPERAND,
        'operand must be one of: indicator, const, price, param');
  }
};

const validateCondition = (node, path, params, errors) => {
  if (!isPlainObject(node)) {
    fail(errors, path, DSL_ERROR.UNKNOWN_NODE, 'condition must be an object');
    return;
  }

  if (isAmbiguousCondition(node)) {
    fail(errors, path, DSL_ERROR.AMBIGUOUS_NODE, 'condition names more than one kind');
    return;
  }

  const kind = conditionKind(node);

  if (kind === null) {
    fail(errors, path, DSL_ERROR.UNKNOWN_NODE,
      'condition must be one of: all, any, not, cross, compare');
    return;
  }

  if (isLogicList(kind)) {
    const children = node[kind];

    if (!Array.isArray(children)) {
      fail(errors, path, DSL_ERROR.BAD_VALUE, `${kind} must be an array`);
      return;
    }
    if (children.length === 0) {
      fail(errors, path, DSL_ERROR.EMPTY_LIST, `${kind} must have at least one condition`);
      return;
    }

    children.forEach((child, i) => validateCondition(child, `${path}.${kind}[${i}]`, params, errors));
    return;
  }

  if (isNot(kind)) {
    validateCondition(node[kind], `${path}.${NODE.NOT}`, params, errors);
    return;
  }

  if (kind === NODE.CROSS && !CROSS_DIRECTIONS.includes(node[kind])) {
    fail(errors, path, DSL_ERROR.BAD_DIRECTION,
      `cross must be one of: ${CROSS_DIRECTIONS.join(', ')}`);
  }

  if (kind === NODE.COMPARE && !COMPARE_OPS.includes(node[kind])) {
    fail(errors, path, DSL_ERROR.BAD_OPERATOR,
      `compare must be one of: ${COMPARE_OPS.join(', ')}`);
  }

  if (takesOperands(kind)) {
    for (const side of ['left', 'right']) {
      if (!Object.hasOwn(node, side)) {
        fail(errors, `${path}.${side}`, DSL_ERROR.MISSING_FIELD, `${kind} needs a ${side} operand`);
        continue;
      }
      validateOperand(node[side], `${path}.${side}`, params, errors);
    }

    // Two constants can never cross, so the rule provably never fires.
    if (kind === NODE.CROSS
      && operandKind(node.left) === OPERAND.CONST
      && operandKind(node.right) === OPERAND.CONST) {
      fail(errors, path, DSL_ERROR.BAD_VALUE, 'cross between two constants can never fire');
    }
  }
};

const validateTree = (root, path, params, errors) => {
  const { nodes, depth } = measureTree(root);

  if (depth > MAX_TREE_DEPTH) {
    fail(errors, path, DSL_ERROR.TOO_DEEP, `nesting deeper than ${MAX_TREE_DEPTH}`);
    return;
  }
  if (nodes > MAX_TREE_NODES) {
    fail(errors, path, DSL_ERROR.TOO_MANY_NODES, `more than ${MAX_TREE_NODES} conditions`);
    return;
  }

  validateCondition(root, path, params, errors);
};

const validateParams = (raw, errors) => {
  const names = new Set();

  if (raw === undefined) return names;

  if (!isPlainObject(raw)) {
    fail(errors, 'params', DSL_ERROR.BAD_VALUE, 'params must be an object');
    return names;
  }

  const entries = Object.entries(raw);

  if (entries.length > MAX_PARAMS) {
    fail(errors, 'params', DSL_ERROR.TOO_LONG, `at most ${MAX_PARAMS} params`);
    return names;
  }

  for (const [name, value] of entries) {
    if (!PARAM_NAME_PATTERN.test(name)) {
      fail(errors, `params.${name}`, DSL_ERROR.BAD_VALUE,
        'param name must start with a letter and contain only letters, digits or underscore');
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      fail(errors, `params.${name}`, DSL_ERROR.BAD_VALUE, 'param must be a finite number');
      continue;
    }
    names.add(name);
  }

  return names;
};

const validateText = (value, path, max, errors) => {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(errors, path, DSL_ERROR.BAD_VALUE, `${path} must be a non-empty string`);
    return;
  }
  if (value.length > max) fail(errors, path, DSL_ERROR.TOO_LONG, `${path} exceeds ${max} characters`);
};

/** @returns {{valid: boolean, errors: Array<{path, code, message}>}} */
export const validateStrategyDocument = (document) => {
  const errors = [];

  if (!isPlainObject(document)) {
    fail(errors, '', DSL_ERROR.NOT_AN_OBJECT, 'strategy must be an object');
    return { valid: false, errors };
  }

  for (const field of Object.keys(document)) {
    if (!DOCUMENT_FIELDS.includes(field)) {
      fail(errors, field, DSL_ERROR.UNKNOWN_FIELD, `unknown field "${field}"`);
    }
  }

  for (const field of REQUIRED_DOCUMENT_FIELDS) {
    if (!Object.hasOwn(document, field)) {
      fail(errors, field, DSL_ERROR.MISSING_FIELD, `${field} is required`);
    }
  }

  if (Object.hasOwn(document, 'name')) validateText(document.name, 'name', MAX_NAME_LENGTH, errors);

  if (document.description !== undefined) {
    validateText(document.description, 'description', MAX_DESCRIPTION_LENGTH, errors);
  }

  if (Object.hasOwn(document, 'timeframe') && !KNOWN_TIMEFRAMES.has(document.timeframe)) {
    fail(errors, 'timeframe', DSL_ERROR.UNKNOWN_TIMEFRAME,
      `timeframe must be one of: ${TIMEFRAME_IDS.join(', ')}`);
  }

  const params = validateParams(document.params, errors);

  for (const side of ['entry', 'exit']) {
    if (Object.hasOwn(document, side)) validateTree(document[side], side, params, errors);
  }

  return { valid: errors.length === 0, errors };
};

/** Throws on the first error. For constructors, where a bad document is not recoverable. */
export const assertValidStrategyDocument = (document) => {
  const { valid, errors } = validateStrategyDocument(document);
  if (valid) return document;

  const [first] = errors;
  const where = first.path ? ` at ${first.path}` : '';
  throw new TypeError(`invalid strategy${where}: ${first.message}`);
};
