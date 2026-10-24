// In-browser question validator (validate.html). Uses the same engines and
// grader as the app, so a pass here means the question works in the app.

import { loadIndex, loadQuestion } from './questions.js';
import { loadTables, getDb } from './sql-engine.js';
import { ensurePython, onPythonStatus } from './py-engine.js';
import { execute, grade, DATASETS } from './grader.js';
import { el, dataTable } from './ui.js';

const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const setStatus = (m) => (statusEl.textContent = m);

function normType(t) {
  return String(t).toUpperCase().replace(/\s+/g, ' ').trim();
}

async function validateQuestion(q) {
  const checks = []; // {name, ok, detail}
  const add = (name, ok, detail = '') => checks.push({ name, ok, detail });
  const outputs = {};

  for (const ds of DATASETS) {
    let tables;
    try {
      tables = await loadTables(q[ds.seedField], q.tables.map((t) => t.name));
      add(`${ds.key}: seed runs`, true);
    } catch (err) {
      add(`${ds.key}: seed runs`, false, err.message);
      continue;
    }
    for (const t of q.tables) {
      const actual = tables[t.name];
      const declared = t.columns.map((c) => `${c.name}:${normType(c.type)}`).join(', ');
      const got = actual.columns.map((c, i) => `${c}:${normType(actual.types[i])}`).join(', ');
      add(`${ds.key}: ${t.name} schema matches declaration`, declared === got, declared === got ? '' : `declared [${declared}] vs DuckDB [${got}]`);
      add(`${ds.key}: ${t.name} has rows`, actual.rows.length > 0, `${actual.rows.length} rows`);
    }
    const ref = await execute(q, q[ds.seedField], q.solution);
    add(`${ds.key}: reference runs`, ref.ok, ref.ok ? '' : ref.error);
    if (ref.ok) {
      add(`${ds.key}: reference returns rows`, ref.rows.length > 0, `${ref.rows.length} rows x ${ref.columns.length} cols`);
      outputs[ds.key] = ref;
    }
  }

  const starter = await execute(q, q.seed, q.starter);
  add('starter code runs on visible data', starter.ok, starter.ok ? '' : starter.error);

  try {
    const self = await grade(q, q.solution);
    add('reference graded against itself passes', self.pass, self.pass ? '' : JSON.stringify(self.datasets.map((d) => [d.key, d.reason])));
  } catch (err) {
    add('reference graded against itself passes', false, err.message);
  }

  for (const [i, trap] of (q.trap_solutions || []).entries()) {
    try {
      const g = await grade(q, trap.code);
      const summary = g.datasets.map((d) => `${d.key}=${d.pass ? 'pass' : d.reason}`).join(', ');
      add(`trap ${i + 1} fails (${trap.note})`, !g.pass, summary);
    } catch (err) {
      add(`trap ${i + 1} fails (${trap.note})`, false, err.message);
    }
  }
  return { id: q.id, ok: checks.every((c) => c.ok), checks, outputs };
}

function renderResult(q, r) {
  const det = el('details', { open: r.ok ? undefined : true });
  det.append(el('summary', { class: r.ok ? 'vrow-ok' : 'vrow-bad' }, `${r.ok ? 'PASS' : 'FAIL'}  ${q.id} (${q.language}, ${q.difficulty})`));
  const ul = el('ul');
  for (const c of r.checks) {
    ul.append(el('li', { class: c.ok ? 'vrow-ok' : 'vrow-bad' }, `${c.ok ? 'ok' : 'FAIL'}: ${c.name}${c.detail ? ` (${c.detail})` : ''}`));
  }
  det.append(ul);
  for (const [k, out] of Object.entries(r.outputs)) {
    det.append(el('h4', {}, `Reference output: ${k}`), dataTable({ columns: out.columns, types: out.types, rows: out.rows }));
  }
  resultsEl.append(det);
}

async function run() {
  resultsEl.textContent = '';
  const only = document.getElementById('only').value.trim();
  const summary = { done: false, ok: false, results: [] };
  window.__validation = summary;
  try {
    let index = await loadIndex();
    if (only) index = index.filter((x) => x.id === only);
    await getDb(setStatus);
    if (index.some((x) => x.language === 'python')) {
      onPythonStatus(setStatus);
      await ensurePython();
    }
    for (const meta of index) {
      setStatus(`Validating ${meta.id}…`);
      let q;
      try {
        q = await loadQuestion(meta.id);
      } catch (err) {
        const r = { id: meta.id, ok: false, checks: [{ name: 'load', ok: false, detail: err.message }], outputs: {} };
        summary.results.push(r);
        renderResult(meta, r);
        continue;
      }
      const r = await validateQuestion(q);
      summary.results.push({ id: r.id, ok: r.ok, checks: r.checks, outputs: r.outputs });
      renderResult(q, r);
    }
    summary.ok = summary.results.length > 0 && summary.results.every((r) => r.ok);
    setStatus(`${summary.results.filter((r) => r.ok).length} of ${summary.results.length} questions passed validation.`);
  } catch (err) {
    summary.error = err.message || String(err);
    setStatus(`Validator crashed: ${summary.error}`);
  } finally {
    summary.done = true;
  }
}

document.getElementById('start').addEventListener('click', run);
if (new URLSearchParams(location.search).has('autorun')) run();
