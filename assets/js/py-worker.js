/* Classic Web Worker that hosts Pyodide + pandas.
 * Running Python here (not on the main thread) means an infinite loop can be
 * killed with worker.terminate() without freezing the page.
 *
 * Protocol (main -> worker):
 *   {type: 'init', indexURL}
 *   {type: 'run', id, code, tablesJson, tableOrder, entry}
 * Protocol (worker -> main):
 *   {type: 'status', message}
 *   {type: 'ready'} | {type: 'init-error', error}
 *   {type: 'result', id, payload}   payload is the JSON string from the harness
 */

const HARNESS = String.raw`
import json, io, traceback, contextlib, datetime, math
import numpy as np
import pandas as pd

_INT_TYPES = {"TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT", "UTINYINT", "USMALLINT", "UINTEGER", "UBIGINT"}
_FLOAT_TYPES = {"FLOAT", "REAL", "DOUBLE"}

def _build_tables(tables_json, order):
    data = json.loads(tables_json)
    frames = []
    for name in order:
        t = data[name]
        df = pd.DataFrame(t["rows"], columns=t["columns"])
        for col, typ in zip(t["columns"], t["types"]):
            typ = str(typ).upper()
            s = df[col]
            if typ in _INT_TYPES:
                df[col] = s.astype("float64") if s.isna().any() else s.astype("int64")
            elif typ in _FLOAT_TYPES or typ.startswith("DECIMAL"):
                df[col] = s.astype("float64")
            elif typ == "DATE" or typ.startswith("TIMESTAMP"):
                df[col] = pd.to_datetime(s)
            elif typ == "BOOLEAN":
                df[col] = s if s.isna().any() else s.astype("bool")
            else:
                df[col] = s.astype("object").where(s.notna(), None)
        frames.append(df)
    return frames

def _plain(v):
    if v is None:
        return None
    if isinstance(v, (bool, np.bool_)):
        return bool(v)
    if isinstance(v, (int, np.integer)):
        return int(v)
    if isinstance(v, (float, np.floating)):
        f = float(v)
        if math.isnan(f):
            return None
        if math.isinf(f):
            return "Infinity" if f > 0 else "-Infinity"
        return f
    if isinstance(v, str):
        return v
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(v, (pd.Timestamp, datetime.datetime)):
        ts = pd.Timestamp(v)
        if ts.hour == 0 and ts.minute == 0 and ts.second == 0 and ts.microsecond == 0 and ts.nanosecond == 0:
            return ts.strftime("%Y-%m-%d")
        s = ts.strftime("%Y-%m-%d %H:%M:%S")
        if ts.microsecond:
            s += ".%06d" % ts.microsecond
        return s
    if isinstance(v, datetime.date):
        return v.isoformat()
    if isinstance(v, (pd.Timedelta, datetime.timedelta)):
        return str(pd.Timedelta(v))
    return str(v)

def _to_frame(res):
    if res is None:
        raise TypeError("solve() returned None. Return a pandas DataFrame (did you forget 'return'?).")
    if isinstance(res, pd.Series):
        res = res.to_frame()
    if not isinstance(res, pd.DataFrame):
        if np.isscalar(res):
            res = pd.DataFrame({"value": [res]})
        else:
            raise TypeError("solve() must return a pandas DataFrame, got %s." % type(res).__name__)
    idx = res.index
    is_default = isinstance(idx, pd.RangeIndex) and idx.name is None
    if not is_default and (isinstance(idx, pd.MultiIndex) or idx.name is not None):
        # A named index (e.g. from groupby) is treated as data columns.
        res = res.reset_index()
    if isinstance(res.columns, pd.MultiIndex):
        res.columns = ["_".join(str(p) for p in c if str(p) != "") for c in res.columns]
    return res

def _payload(df):
    cols = [str(c) for c in df.columns]
    types = [str(t) for t in df.dtypes]
    rows = [[_plain(v) for v in row] for row in df.itertuples(index=False, name=None)]
    return {"columns": cols, "types": types, "rows": rows}

def _format_error(e):
    frames = [f for f in traceback.extract_tb(e.__traceback__) if f.filename == "<solution>"]
    lines = []
    if frames:
        lines.append("Traceback (your code):")
        lines.extend(traceback.format_list(frames))
    lines.extend(traceback.format_exception_only(type(e), e))
    return "".join(lines).rstrip()

def __run_solution(code, tables_json, order_json, entry, stdout_limit):
    out = io.StringIO()
    order = json.loads(order_json)
    try:
        frames = _build_tables(tables_json, order)
    except Exception as e:
        return json.dumps({"ok": False, "stdout": "", "error": "Internal error building DataFrames: " + repr(e)})
    ns = {"pd": pd, "np": np, "__name__": "__solution__"}
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            exec(compile(code, "<solution>", "exec"), ns)
            fn = ns.get(entry)
            if not callable(fn):
                raise NameError("Define a function named %s(%s)." % (entry, ", ".join(order)))
            res = fn(*frames)
            df = _to_frame(res)
        payload = _payload(df)
        stdout = out.getvalue()
        return json.dumps({"ok": True, "stdout": stdout[:stdout_limit], "truncated": len(stdout) > stdout_limit, **payload})
    except BaseException as e:
        stdout = out.getvalue()
        return json.dumps({"ok": False, "stdout": stdout[:stdout_limit], "error": _format_error(e)})
`;

let pyodide = null;

async function init(indexURL) {
  try {
    postMessage({ type: 'status', message: 'Downloading Python runtime (Pyodide)…' });
    importScripts(indexURL + 'pyodide.js');
    pyodide = await self.loadPyodide({ indexURL });
    postMessage({ type: 'status', message: 'Loading pandas…' });
    await pyodide.loadPackage(['pandas']);
    pyodide.runPython(HARNESS);
    postMessage({ type: 'ready', pythonVersion: pyodide.runPython('import sys, pandas; sys.version.split()[0] + " / pandas " + pandas.__version__') });
  } catch (err) {
    postMessage({ type: 'init-error', error: String(err && err.message ? err.message : err) });
  }
}

self.onmessage = (e) => {
  const msg = e.data || {};
  if (msg.type === 'init') {
    init(msg.indexURL);
  } else if (msg.type === 'run') {
    let payload;
    try {
      const fn = pyodide.globals.get('__run_solution');
      payload = fn(msg.code, msg.tablesJson, JSON.stringify(msg.tableOrder), msg.entry || 'solve', msg.stdoutLimit || 20000);
      fn.destroy();
    } catch (err) {
      payload = JSON.stringify({ ok: false, stdout: '', error: 'Python runtime error: ' + String(err && err.message ? err.message : err) });
    }
    postMessage({ type: 'result', id: msg.id, payload });
  }
};
