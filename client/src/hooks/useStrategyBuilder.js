import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createStrategy,
  deleteStrategy,
  listStrategies,
  startStrategy,
  updateStrategy,
  validateStrategy,
} from '../utils/api/strategies.js';
import {
  documentToDraft,
  draftToDocument,
  emptyDraft,
  emptyRow,
  errorsByRow,
  isEditable,
} from '../utils/strategy/builder.js';

const VALIDATE_DEBOUNCE_MS = 400;

/** Draft state for the rule builder, plus the saved-strategy list. */
export function useStrategyBuilder({ timeframe = '1m' } = {}) {
  const [saved, setSaved] = useState([]);
  const [draft, setDraft] = useState(() => emptyDraft(timeframe));
  const [editingId, setEditingId] = useState(null);
  const [errors, setErrors] = useState([]);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const abortRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const { strategies } = await listStrategies();
      setSaved(strategies);
    } catch (err) {
      setStatus({ kind: 'error', message: err.message });
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Debounced so typing a threshold does not fire a request per keystroke, and
  // aborted so a slow earlier check cannot land after a faster later one.
  useEffect(() => {
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const result = await validateStrategy(draftToDocument(draft), controller.signal);
        setErrors(result.errors);
      } catch (err) {
        if (err.name !== 'AbortError') setErrors([]);
      }
    }, VALIDATE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [draft]);

  const update = useCallback((mutate) => {
    setDraft((current) => {
      const next = structuredClone(current);
      mutate(next);
      return next;
    });
  }, []);

  const setField = useCallback((field, value) => update((d) => { d[field] = value; }), [update]);

  const setCombinator = useCallback((side, combinator) =>
    update((d) => { d[side].combinator = combinator; }), [update]);

  const setRowField = useCallback((side, rowId, field, value) =>
    update((d) => {
      const row = d[side].rows.find((r) => r.rowId === rowId);
      if (row) row[field] = value;
    }), [update]);

  const addRow = useCallback((side, indicator) =>
    update((d) => { d[side].rows.push(emptyRow(indicator)); }), [update]);

  const removeRow = useCallback((side, rowId) =>
    update((d) => {
      // Never leave a section empty — the validator rejects an empty all/any.
      if (d[side].rows.length > 1) d[side].rows = d[side].rows.filter((r) => r.rowId !== rowId);
    }), [update]);

  const reset = useCallback(() => {
    setDraft(emptyDraft(timeframe));
    setEditingId(null);
    setStatus(null);
  }, [timeframe]);

  const load = useCallback((strategy) => {
    if (!isEditable(strategy.document)) {
      setStatus({ kind: 'error', message: `"${strategy.name}" nests deeper than this editor supports` });
      return;
    }
    setDraft(documentToDraft(strategy.document));
    setEditingId(strategy.id);
    setStatus(null);
  }, []);

  const run = useCallback(async (action, successMessage) => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await action();
      setStatus({ kind: 'ok', message: successMessage });
      await refresh();
      return result;
    } catch (err) {
      setStatus({ kind: 'error', message: err.message });
      if (err.details?.length) setErrors(err.details);
      return null;
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const save = useCallback(async () => {
    const document = draftToDocument(draft);

    const result = await run(
      () => (editingId ? updateStrategy(editingId, document) : createStrategy(document)),
      editingId ? 'Updated' : 'Saved',
    );

    if (result) setEditingId(result.id);
    return result;
  }, [draft, editingId, run]);

  const remove = useCallback(async (id) => {
    const result = await run(() => deleteStrategy(id), 'Deleted');
    if (result && id === editingId) reset();
    return result;
  }, [editingId, reset, run]);

  const start = useCallback((id) => run(() => startStrategy(id), 'Running'), [run]);

  return {
    saved,
    draft,
    editingId,
    errors,
    rowErrors: errorsByRow(errors, draft),
    valid: errors.length === 0 && draft.name.trim() !== '',
    status,
    busy,
    setField,
    setCombinator,
    setRowField,
    addRow,
    removeRow,
    load,
    reset,
    save,
    remove,
    start,
  };
}
