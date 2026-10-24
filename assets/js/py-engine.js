// Main-thread controller for the Pyodide worker: lazy start, per-run timeout,
// Stop (terminates the worker; the next run starts a fresh one).

import { CDN, LIMITS } from './config.js';
import { TimeoutError, StoppedError } from './sql-engine.js';

let worker = null;
let readyPromise = null;
let pending = null; // {id, resolve, reject, timer}
let nextId = 1;
let statusListener = null;

export function onPythonStatus(fn) {
  statusListener = fn;
}

function workerUrl() {
  return new URL('./py-worker.js', import.meta.url);
}

export function ensurePython() {
  if (readyPromise) return readyPromise;
  worker = new Worker(workerUrl());
  readyPromise = new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.type === 'status') statusListener?.(msg.message);
      else if (msg.type === 'ready') {
        statusListener?.(`Python ready (${msg.pythonVersion}).`);
        resolve(msg);
      } else if (msg.type === 'init-error') {
        kill();
        reject(new Error(`Could not load Pyodide: ${msg.error}`));
      } else if (msg.type === 'result' && pending && msg.id === pending.id) {
        const p = pending;
        pending = null;
        clearTimeout(p.timer);
        try {
          p.resolve(JSON.parse(msg.payload));
        } catch (err) {
          p.reject(new Error('Could not parse Python result: ' + err.message));
        }
      }
    };
    worker.onerror = (e) => {
      const err = new Error(`Python worker error: ${e.message || 'unknown'}`);
      if (pending) {
        pending.reject(err);
        pending = null;
      }
      kill();
      reject(err);
    };
  });
  worker.postMessage({ type: 'init', indexURL: CDN.pyodideIndex });
  return readyPromise;
}

function kill() {
  if (worker) worker.terminate();
  worker = null;
  readyPromise = null;
}

/** Terminate the running Python (if any). */
export function stopPython() {
  if (pending) {
    const p = pending;
    pending = null;
    clearTimeout(p.timer);
    kill();
    p.reject(new StoppedError());
  }
}

/**
 * Run `code` (which must define `entry`) against the given tables.
 * tables: {[name]: {columns, types, rows}}; tableOrder: names in argument order.
 * Resolves to {ok, stdout, columns?, rows?, error?, elapsedMs}.
 * The timeout clock starts after Pyodide is loaded.
 */
export async function runPython(code, tables, tableOrder, { entry = 'solve', timeoutMs = LIMITS.pyTimeoutMs } = {}) {
  await ensurePython();
  if (pending) throw new Error('A Python run is already in progress.');
  const id = nextId++;
  const t0 = performance.now();
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending && pending.id === id) {
        pending = null;
        kill();
        reject(new TimeoutError(timeoutMs));
      }
    }, timeoutMs);
    pending = { id, resolve, reject, timer };
    worker.postMessage({
      type: 'run',
      id,
      code,
      tablesJson: JSON.stringify(tables),
      tableOrder,
      entry,
      stdoutLimit: LIMITS.stdoutChars,
    });
  });
  result.elapsedMs = performance.now() - t0;
  return result;
}
