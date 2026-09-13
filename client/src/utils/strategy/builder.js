/**
 * Translates between the editor's flat rows and the nested rule document.
 *
 * The DSL allows arbitrary nesting; this editor exposes ONE level — a list of
 * conditions joined by all/any. That covers nearly every hand-written strategy
 * and keeps the UI a table instead of a tree. A document the editor cannot
 * represent still loads and runs; it is just shown as read-only JSON.
 */

export const OPERATORS = [
  { id: 'cross:above', label: 'crosses above' },
  { id: 'cross:below', label: 'crosses below' },
  { id: '>', label: 'is greater than' },
  { id: '<', label: 'is less than' },
  { id: '>=', label: 'is at least' },
  { id: '<=', label: 'is at most' },
];

export const PRICE_FIELDS = ['open', 'high', 'low', 'close', 'volume'];

export const OPERAND_KINDS = [
  { id: 'indicator', label: 'indicator' },
  { id: 'price', label: 'price' },
  { id: 'const', label: 'number' },
];

let nextRowId = 1;

export const emptyRow = (indicator = '') => ({
  rowId: nextRowId++,
  leftKind: 'indicator',
  leftValue: indicator,
  op: 'cross:above',
  rightKind: 'indicator',
  rightValue: '',
});

const toOperand = (kind, value) => {
  if (kind === 'const') return { const: Number(value) };
  return { [kind]: value };
};

const fromOperand = (operand) => {
  const [kind, value] = Object.entries(operand ?? {})[0] ?? ['indicator', ''];
  return { kind, value: String(value) };
};

export const rowToNode = (row) => {
  const left = toOperand(row.leftKind, row.leftValue);
  const right = toOperand(row.rightKind, row.rightValue);

  if (row.op.startsWith('cross:')) {
    return { cross: row.op.slice('cross:'.length), left, right };
  }
  return { compare: row.op, left, right };
};

const nodeToRow = (node) => {
  const left = fromOperand(node.left);
  const right = fromOperand(node.right);

  return {
    rowId: nextRowId++,
    leftKind: left.kind,
    leftValue: left.value,
    op: node.cross ? `cross:${node.cross}` : node.compare,
    rightKind: right.kind,
    rightValue: right.value,
  };
};

/** A tree this editor can round-trip: one all/any of cross/compare nodes. */
const isFlatTree = (tree) => {
  if (!tree || typeof tree !== 'object') return false;

  const key = ['all', 'any'].find((k) => Array.isArray(tree[k]));
  if (!key) return false;

  return tree[key].every((node) => Boolean(node.cross || node.compare));
};

export const isEditable = (document) =>
  isFlatTree(document?.entry) && isFlatTree(document?.exit);

const treeToSection = (tree) => {
  const combinator = Array.isArray(tree?.any) ? 'any' : 'all';
  return { combinator, rows: (tree?.[combinator] ?? []).map(nodeToRow) };
};

export const sectionToTree = (section) => ({
  [section.combinator]: section.rows.map(rowToNode),
});

export const emptyDraft = (timeframe = '1m') => ({
  name: '',
  timeframe,
  entry: { combinator: 'all', rows: [emptyRow()] },
  exit: { combinator: 'any', rows: [emptyRow()] },
});

export const documentToDraft = (document) => ({
  name: document.name,
  timeframe: document.timeframe,
  entry: treeToSection(document.entry),
  exit: treeToSection(document.exit),
});

export const draftToDocument = (draft) => ({
  name: draft.name.trim(),
  timeframe: draft.timeframe,
  entry: sectionToTree(draft.entry),
  exit: sectionToTree(draft.exit),
});

/** Validation errors keyed by the row they belong to, e.g. 'entry.all[1]'. */
export const errorsByRow = (errors, draft) => {
  const map = { entry: {}, exit: {}, document: [] };

  for (const error of errors) {
    const match = /^(entry|exit)\.(all|any)\[(\d+)\]/.exec(error.path ?? '');

    if (!match) {
      map.document.push(error);
      continue;
    }

    const [, side, , index] = match;
    const row = draft[side].rows[Number(index)];
    if (!row) continue;

    (map[side][row.rowId] ??= []).push(error);
  }

  return map;
};
