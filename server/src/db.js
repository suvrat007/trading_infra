import pg from 'pg';
import { DB_CONFIG, PG_OID_INT8 } from './constants/postgres.js';
import { SQL_HEALTHCHECK } from './constants/sql.js';
import { LOG_DB } from './constants/logging.js';

// Prices stay strings end to end: Binance sends them as strings, and the pg
// default parser leaves NUMERIC as a string. Both are deliberate — the moment
// a price becomes a JS float you have accepted rounding error into money.
// int8 is the exception: open_time in ms is far below MAX_SAFE_INTEGER, and
// lightweight-charts wants a number.
pg.types.setTypeParser(PG_OID_INT8, (v) => (v === null ? null : Number(v)));

const { Pool } = pg;

export const pool = new Pool(DB_CONFIG);

// A pool error surfaces on an *idle* client (server restart, network drop) and
// would otherwise be an unhandled 'error' event that kills the process.
pool.on('error', (err) => {
  console.error(`${LOG_DB} idle client error:`, err.message);
});

export async function assertDbReady() {
  const { rows } = await pool.query(SQL_HEALTHCHECK);
  console.log(`${LOG_DB} connected to "${rows[0].db}"`);
}
