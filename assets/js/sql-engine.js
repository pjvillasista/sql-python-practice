// DuckDB-WASM wrapper. One AsyncDuckDB instance (in its own Web Worker) is
// reused; every run gets a brand-new in-memory catalog (ATTACH ':memory:') and
// a brand-new connection, so runs never see each other's tables.

import { CDN, LIMITS } from './config.js';
import { splitSqlStatements, plainCastExpr, quoteIdent } from './sql-utils.js';

let dbPromise = null;
let dbInstance = null;
let runCounter = 0;

export class TimeoutError extends Error {
  constructor(ms) {
    super(`Stopped after ${Math.round(ms / 1000)}s (time limit). Check for infinite loops, runaway recursion or huge cross joins.`);
    this.name = 'TimeoutError';
  }
}

export class StoppedError extends Error {
  constructor() {
    super('Stopped by user.');
    this.name = 'StoppedError';
  }
}

async function createDb(onStatus) {
  onStatus?.('Loading DuckDB-WASM…');
  const duckdb = await import(CDN.duckdb);
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  // Cross-origin workers are not allowed, so wrap the CDN worker script in a
  // same-origin blob that imports it.
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts(${JSON.stringify(bundle.mainWorker)});`], { type: 'text/javascript' }),
  );
  const worker = new Worker(workerUrl);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
  dbInstance = db;
  onStatus?.('DuckDB ready.');
  return db;
}

export function getDb(onStatus) {
  if (!dbPromise) {
    dbPromise = createDb(onStatus).catch((err) => {
      dbPromise = null;
      throw new Error(`Could not load DuckDB-WASM (${err.message || err}). Check your connection or ad blocker.`);
    });
  }
  return dbPromise;
}

/** Kill the DuckDB worker (used for timeouts / Stop). Next call re-creates it. */
export async function resetDb() {
  const db = dbInstance;
  dbInstance = null;
  dbPromise = null;
  if (db) {
    try {
      await db.terminate();
    } catch {
      /* ignore */
    }
  }
}

// Stop support: the active run registers a rejecter here.
let activeAbort = null;
export function stopSql() {
  if (activeAbort) activeAbort(new StoppedError());
}

function arrowToPlain(table) {
  const fields = table.schema.fields;
  const columns = fields.map((f) => f.name);
  const types = fields.map((f) => String(f.type));
  const cols = fields.map((_, i) => table.getChildAt(i));
  const rows = [];
  for (let r = 0; r < table.numRows; r++) {
    const row = new Array(cols.length);
    for (let c = 0; c < cols.length; c++) {
      let v = cols[c] ? cols[c].get(r) : null;
      if (typeof v === 'bigint') v = Number(v);
      else if (v !== null && typeof v === 'object') v = typeof v.toString === 'function' ? v.toString() : JSON.stringify(v);
      row[c] = v === undefined ? null : v;
    }
    rows.push(row);
  }
  return { columns, types, rows };
}

/** Materialize the result into a temp table, then read it back with casts to plain JS types. */
async function readNormalized(conn, tableName) {
  const desc = await conn.query(`DESCRIBE ${quoteIdent(tableName)}`);
  const d = arrowToPlain(desc);
  const nameIdx = d.columns.indexOf('column_name');
  const typeIdx = d.columns.indexOf('column_type');
  const colNames = d.rows.map((r) => r[nameIdx]);
  const colTypes = d.rows.map((r) => r[typeIdx]);
  const select = colNames.map((n, i) => plainCastExpr(n, colTypes[i])).join(', ');
  const res = arrowToPlain(await conn.query(`SELECT ${select} FROM ${quoteIdent(tableName)}`));
  return { columns: colNames, types: colTypes, rows: res.rows };
}

async function withFreshCatalog(fn) {
  const db = await getDb();
  const conn = await db.connect();
  const name = `run_${Date.now()}_${++runCounter}`;
  try {
    await conn.query(`ATTACH ':memory:' AS ${name}`);
    await conn.query(`USE ${name}`);
    return await fn(conn);
  } finally {
    try {
      await conn.query('USE memory');
      await conn.query(`DETACH ${name}`);
    } catch {
      /* ignore */
    }
    try {
      await conn.close();
    } catch {
      /* ignore */
    }
  }
}

async function runStatements(conn, sql) {
  for (const stmt of splitSqlStatements(sql)) await conn.query(stmt);
}

function withTimeout(promise, ms) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    activeAbort = reject;
  });
  return Promise.race([promise, guard]).finally(() => {
    clearTimeout(timer);
    activeAbort = null;
  });
}

/**
 * Seed a fresh catalog and run user SQL.
 * Returns {columns, types, rows, elapsedMs, note?}; throws on SQL error.
 * `elapsedMs` covers the user's statements only (not seeding).
 */
export async function runSql(seedSql, userSql, { timeoutMs = LIMITS.sqlTimeoutMs } = {}) {
  await getDb();
  const work = withFreshCatalog(async (conn) => {
    await runStatements(conn, seedSql);
    const stmts = splitSqlStatements(userSql);
    if (stmts.length === 0) throw new Error('Nothing to run: the editor contains no SQL statements.');
    const t0 = performance.now();
    for (const s of stmts.slice(0, -1)) await conn.query(s);
    const last = stmts[stmts.length - 1];
    let result;
    try {
      // Materializing lets us DESCRIBE the result and cast exotic types.
      await conn.query(`CREATE TABLE __result AS\n${last}\n`);
      result = await readNormalized(conn, '__result');
    } catch {
      // Not a query (or a shape CTAS rejects): run it as-is so the user sees the real error.
      const raw = await conn.query(last);
      result = raw ? arrowToPlain(raw) : { columns: [], types: [], rows: [] };
      if (result.columns.length === 0) result.note = 'Statement executed; it returned no result set.';
    }
    result.elapsedMs = performance.now() - t0;
    return result;
  });
  try {
    return await withTimeout(work, timeoutMs);
  } catch (err) {
    if (err instanceof TimeoutError || err instanceof StoppedError) await resetDb();
    throw err;
  }
}

/**
 * Seed a fresh catalog and read back the given tables as plain values.
 * Returns {[name]: {columns, types, rows}}.
 */
export async function loadTables(seedSql, tableNames, { timeoutMs = LIMITS.sqlTimeoutMs } = {}) {
  await getDb();
  const work = withFreshCatalog(async (conn) => {
    await runStatements(conn, seedSql);
    const out = {};
    for (const name of tableNames) out[name] = await readNormalized(conn, name);
    return out;
  });
  try {
    return await withTimeout(work, timeoutMs);
  } catch (err) {
    if (err instanceof TimeoutError || err instanceof StoppedError) await resetDb();
    throw err;
  }
}
