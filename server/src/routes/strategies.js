import { Router } from 'express';
import { ERROR_CODE, HTTP_STATUS } from '../constants/http.js';
import {
  SQL_DELETE_STRATEGY,
  SQL_INSERT_STRATEGY,
  SQL_SELECT_STRATEGIES,
  SQL_SELECT_STRATEGY,
  SQL_UPDATE_STRATEGY,
} from '../constants/sql.js';
import { pool } from '../db.js';
import { indicatorsIn } from '../strategies/dsl/schema.js';
import { asyncHandler } from '../utils/http/asyncHandler.js';
import { ApiError } from '../utils/http/errors.js';
import { validateStrategyDocument } from '../utils/strategies/dsl/validate.js';
import { startStrategy } from '../strategyRunner.js';

export const strategiesRouter = Router();

/** Postgres unique-violation. Raced inserts land here rather than 500ing. */
const UNIQUE_VIOLATION = '23505';

const parseId = (raw) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw ApiError.badRequest(ERROR_CODE.INVALID_BODY, 'id must be a positive integer');
  }
  return id;
};

/**
 * Validated on WRITE only. Once a row is in the table it is trusted, so reads
 * stay a plain select — and a document that somehow became invalid still loads,
 * which is what lets you open and fix it.
 */
const assertValid = (document) => {
  const { valid, errors } = validateStrategyDocument(document);
  if (valid) return;

  const error = ApiError.badRequest(ERROR_CODE.INVALID_DOCUMENT, errors[0].message);
  error.details = errors;
  throw error;
};

const shape = (row) => ({
  id: Number(row.id),
  name: row.name,
  document: row.document,
  indicators: [...new Set([
    ...indicatorsIn(row.document.entry),
    ...indicatorsIn(row.document.exit),
  ])],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Check a draft without saving it — what the builder calls as you type. */
strategiesRouter.post('/strategies/validate', (req, res) => {
  res.status(HTTP_STATUS.OK).json(validateStrategyDocument(req.body));
});

strategiesRouter.get('/strategies', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(SQL_SELECT_STRATEGIES);
  res.status(HTTP_STATUS.OK).json({ count: rows.length, strategies: rows.map(shape) });
}));

strategiesRouter.get('/strategies/:id', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(SQL_SELECT_STRATEGY, [parseId(req.params.id)]);
  if (rows.length === 0) throw ApiError.notFound(`No strategy with id ${req.params.id}`);
  res.status(HTTP_STATUS.OK).json(shape(rows[0]));
}));

strategiesRouter.post('/strategies', asyncHandler(async (req, res) => {
  const document = req.body;
  assertValid(document);

  try {
    const { rows } = await pool.query(SQL_INSERT_STRATEGY, [document.name, document]);
    res.status(HTTP_STATUS.OK).json(shape(rows[0]));
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      throw ApiError.badRequest(ERROR_CODE.DUPLICATE_NAME, `A strategy named "${document.name}" already exists`);
    }
    throw err;
  }
}));

strategiesRouter.put('/strategies/:id', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const document = req.body;
  assertValid(document);

  try {
    const { rows } = await pool.query(SQL_UPDATE_STRATEGY, [id, document.name, document]);
    if (rows.length === 0) throw ApiError.notFound(`No strategy with id ${id}`);
    res.status(HTTP_STATUS.OK).json(shape(rows[0]));
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      throw ApiError.badRequest(ERROR_CODE.DUPLICATE_NAME, `A strategy named "${document.name}" already exists`);
    }
    throw err;
  }
}));

strategiesRouter.delete('/strategies/:id', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const { rows } = await pool.query(SQL_DELETE_STRATEGY, [id]);
  if (rows.length === 0) throw ApiError.notFound(`No strategy with id ${id}`);
  res.status(HTTP_STATUS.OK).json({ deleted: id });
}));

/** Load a saved rule and make it the running strategy. */
strategiesRouter.post('/strategies/:id/start', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const { rows } = await pool.query(SQL_SELECT_STRATEGY, [id]);
  if (rows.length === 0) throw ApiError.notFound(`No strategy with id ${id}`);

  try {
    res.status(HTTP_STATUS.OK).json(startStrategy({ name: 'rule', params: rows[0].document }));
  } catch (err) {
    // A saved document can go stale — an indicator removed from the engine since.
    if (err instanceof TypeError) throw ApiError.badRequest(ERROR_CODE.INVALID_DOCUMENT, err.message);
    throw err;
  }
}));
