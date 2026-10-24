// Pure helpers (no DOM, no DuckDB) so they can also be imported from Node.

/**
 * Split SQL text into statements on top-level semicolons, respecting
 * '...' strings, "..." identifiers, -- line comments and /* block comments *\/.
 * Returns statements with surrounding whitespace trimmed; statements that are
 * empty or contain only comments are dropped.
 */
export function splitSqlStatements(sql) {
  const out = [];
  let buf = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === "'" || c === '"') {
      const quote = c;
      buf += c;
      i++;
      while (i < n) {
        buf += sql[i];
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            buf += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') buf += sql[i++];
      continue;
    }
    if (c === '/' && next === '*') {
      buf += '/*';
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) buf += sql[i++];
      if (i < n) {
        buf += '*/';
        i += 2;
      }
      continue;
    }
    if (c === ';') {
      out.push(buf);
      buf = '';
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  out.push(buf);
  return out.map((s) => s.trim()).filter((s) => stripSqlComments(s).trim() !== '');
}

/** Remove comments (not inside strings). Used only to detect empty statements. */
export function stripSqlComments(sql) {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      const q = c;
      out += c;
      i++;
      while (i < n) {
        out += sql[i];
        if (sql[i] === q) {
          if (sql[i + 1] === q) {
            out += sql[++i];
            i++;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Quote an identifier for DuckDB. */
export function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

/**
 * Given a DuckDB column type string, return a SQL expression that converts the
 * column into something that crosses the Arrow -> JS boundary as a plain
 * number / string / boolean / null.
 */
export function plainCastExpr(colName, duckType) {
  const q = quoteIdent(colName);
  const t = String(duckType).toUpperCase();
  if (/^(TINYINT|SMALLINT|INTEGER|UTINYINT|USMALLINT|FLOAT|REAL|DOUBLE|BOOLEAN|VARCHAR)$/.test(t)) return q;
  if (/^(BIGINT|HUGEINT|UBIGINT|UINTEGER|UHUGEINT)$/.test(t) || t.startsWith('DECIMAL')) {
    return `CAST(${q} AS DOUBLE) AS ${q}`;
  }
  return `CAST(${q} AS VARCHAR) AS ${q}`;
}
