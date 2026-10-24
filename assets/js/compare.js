// Deterministic result-set comparison. Pure module: importable from Node.
//
// Rules (documented in README):
// - Column NAMES are ignored; column COUNT and POSITION matter.
// - Row order is ignored unless `ordered` is true (multiset comparison).
// - NULL equals NULL; NULL never equals a value. NaN is treated as NULL.
// - Numbers are equal within `tolerance` (absolute) or 1e-9 relative.
//   Integers and floats compare numerically (3 == 3.0).
// - Strings compare exactly, except that a timestamp at exactly midnight
//   ("2024-01-05 00:00:00") is treated as the date "2024-01-05", so a DATE and
//   a midnight TIMESTAMP compare equal.

const MIDNIGHT = /^(\d{4}-\d{2}-\d{2})[ T]00:00:00(?:\.0+)?$/;

export function normalizeValue(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number') return Number.isNaN(v) ? null : v;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const m = MIDNIGHT.exec(v);
    return m ? m[1] : v;
  }
  return String(v);
}

export function valuesEqual(a, b, tolerance) {
  a = normalizeValue(a);
  b = normalizeValue(b);
  if (a === null || b === null) return a === null && b === null;
  if (typeof a === 'number' && typeof b === 'number') {
    if (a === b) return true; // covers +/-Infinity
    const diff = Math.abs(a - b);
    return diff <= tolerance || diff <= 1e-9 * Math.max(Math.abs(a), Math.abs(b));
  }
  return typeof a === typeof b && a === b;
}

function rowsEqual(r1, r2, tolerance) {
  if (r1.length !== r2.length) return false;
  for (let i = 0; i < r1.length; i++) {
    if (!valuesEqual(r1[i], r2[i], tolerance)) return false;
  }
  return true;
}

/**
 * Compare two results of shape {columns: string[], rows: any[][]}.
 * Returns {pass, reason, missing, unexpected, expectedRowCount, actualRowCount,
 *          expectedColCount, actualColCount}.
 * `missing`: expected rows not found in actual. `unexpected`: actual rows not
 * matched by any expected row. Each is capped at `maxExamples`.
 */
export function compareResults(expected, actual, { ordered = false, tolerance = 1e-6, maxExamples = 10 } = {}) {
  const exp = expected.rows || [];
  const act = actual.rows || [];
  const expectedColCount = (expected.columns || []).length;
  const actualColCount = (actual.columns || []).length;
  const base = {
    expectedRowCount: exp.length,
    actualRowCount: act.length,
    expectedColCount,
    actualColCount,
    missing: [],
    unexpected: [],
  };

  if (expectedColCount !== actualColCount) {
    return { ...base, pass: false, reason: 'column_count' };
  }

  if (ordered) {
    const n = Math.max(exp.length, act.length);
    let firstMismatch = -1;
    for (let i = 0; i < n; i++) {
      if (i >= exp.length || i >= act.length || !rowsEqual(exp[i], act[i], tolerance)) {
        firstMismatch = i;
        break;
      }
    }
    if (firstMismatch === -1) return { ...base, pass: true, reason: null };
    // Distinguish "right rows, wrong order" from "wrong rows".
    const unordered = compareResults(expected, actual, { ordered: false, tolerance, maxExamples });
    if (unordered.pass) return { ...base, pass: false, reason: 'row_order', firstMismatch };
    return { ...unordered, pass: false, reason: unordered.reason, firstMismatch };
  }

  // Unordered: greedy multiset matching (inputs are small).
  const used = new Array(act.length).fill(false);
  const missing = [];
  for (const er of exp) {
    let found = -1;
    for (let j = 0; j < act.length; j++) {
      if (!used[j] && rowsEqual(er, act[j], tolerance)) {
        found = j;
        break;
      }
    }
    if (found === -1) missing.push(er);
    else used[found] = true;
  }
  const unexpected = act.filter((_, j) => !used[j]);
  const pass = missing.length === 0 && unexpected.length === 0;
  let reason = null;
  if (!pass) reason = exp.length !== act.length ? 'row_count' : 'values';
  return {
    ...base,
    pass,
    reason,
    missing: missing.slice(0, maxExamples),
    unexpected: unexpected.slice(0, maxExamples),
    missingCount: missing.length,
    unexpectedCount: unexpected.length,
  };
}

export const REASON_TEXT = {
  column_count: 'Wrong number of columns.',
  row_count: 'Wrong number of rows.',
  values: 'Same number of rows, but some values differ.',
  row_order: 'Correct rows, but in the wrong order (this question requires a specific ORDER).',
  error: 'Your code raised an error on this dataset.',
};
