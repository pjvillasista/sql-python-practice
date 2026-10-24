// Run (visible data only) and Submit (visible + hidden, compared to the reference).

import { runSql, loadTables, TimeoutError, StoppedError } from './sql-engine.js';
import { runPython } from './py-engine.js';
import { compareResults } from './compare.js';
import { DEFAULT_TOLERANCE } from './config.js';

export const DATASETS = [
  { key: 'visible', label: 'Visible data', seedField: 'seed' },
  { key: 'hidden', label: 'Hidden data', seedField: 'hidden_seed' },
];

function tableNames(q) {
  return q.tables.map((t) => t.name);
}

/** Execute code against one seed. Returns {ok, columns, rows, types, stdout, error, elapsedMs, note}. */
export async function execute(q, seedSql, code) {
  if (q.language === 'sql') {
    try {
      const r = await runSql(seedSql, code);
      return { ok: true, ...r };
    } catch (err) {
      if (err instanceof StoppedError) throw err;
      return { ok: false, error: err.message || String(err), timeout: err instanceof TimeoutError };
    }
  }
  const tables = await loadTables(seedSql, tableNames(q));
  try {
    return await runPython(code, tables, tableNames(q), { entry: q.python?.entry || 'solve' });
  } catch (err) {
    if (err instanceof StoppedError) throw err;
    return { ok: false, stdout: '', error: err.message || String(err), timeout: err instanceof TimeoutError };
  }
}

/** Short, data-free description of an error (used for the hidden dataset). */
export function redactError(q, message) {
  if (!message) return 'Error';
  if (/Stopped after/.test(message)) return 'Time limit exceeded';
  if (q.language === 'python') {
    const lines = message.trim().split('\n');
    const last = lines[lines.length - 1];
    const m = /^([A-Za-z_][\w.]*)(:|$)/.exec(last);
    return m ? m[1] : 'Python error';
  }
  const m = /^([A-Za-z ]+Error)\b/.exec(message.trim());
  return m ? m[1] : 'SQL error';
}

/**
 * Grade: run reference and user code on both datasets.
 * Returns {pass, datasets:[{key,label,pass,reason,compare?,error?,errorRedacted?,expected?,actual?}]}.
 * `expected`/`actual` are only included for the visible dataset.
 */
export async function grade(q, code, onProgress) {
  const datasets = [];
  for (const ds of DATASETS) {
    const seedSql = q[ds.seedField];
    onProgress?.(`${ds.label}: running reference solution…`);
    const expected = await execute(q, seedSql, q.solution);
    if (!expected.ok) {
      throw new Error(`The reference solution failed on ${ds.label.toLowerCase()} (this is a bug in the question file): ${expected.error}`);
    }
    onProgress?.(`${ds.label}: running your code…`);
    const actual = await execute(q, seedSql, code);
    const isVisible = ds.key === 'visible';
    if (!actual.ok) {
      datasets.push({
        key: ds.key,
        label: ds.label,
        pass: false,
        reason: actual.timeout ? 'timeout' : 'error',
        error: isVisible ? actual.error : undefined,
        errorRedacted: redactError(q, actual.error),
        stdout: isVisible ? actual.stdout : undefined,
        expected: isVisible ? expected : undefined,
      });
      continue;
    }
    const cmp = compareResults(expected, actual, {
      ordered: Boolean(q.ordered),
      tolerance: typeof q.tolerance === 'number' ? q.tolerance : DEFAULT_TOLERANCE,
    });
    datasets.push({
      key: ds.key,
      label: ds.label,
      pass: cmp.pass,
      reason: cmp.reason,
      compare: isVisible
        ? cmp
        : { reason: cmp.reason, pass: cmp.pass }, // hidden: no rows, no counts
      expected: isVisible ? expected : undefined,
      actual: isVisible ? actual : undefined,
      stdout: isVisible ? actual.stdout : undefined,
    });
  }
  return { pass: datasets.every((d) => d.pass), datasets };
}
