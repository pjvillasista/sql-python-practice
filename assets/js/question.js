import { loadIndex, loadQuestion, DIFFICULTIES } from './questions.js';
import { renderMarkdown } from './markdown.js';
import { createEditor } from './editor.js';
import { getDb, loadTables, stopSql } from './sql-engine.js';
import { ensurePython, onPythonStatus, stopPython } from './py-engine.js';
import { execute, grade } from './grader.js';
import { REASON_TEXT } from './compare.js';
import { requestReview, AiError } from './ai.js';
import { AI, LIMITS } from './config.js';
import * as store from './storage.js';
import { initTheme } from './theme.js';
import { el, dataTable, formatMs } from './ui.js';

initTheme(document.getElementById('theme-toggle'));

const $ = (id) => document.getElementById(id);
const ui = {
  meta: $('q-meta'),
  title: $('q-title'),
  prompt: $('q-prompt'),
  tables: $('q-tables'),
  hints: $('q-hints'),
  solution: $('q-solution'),
  explanation: $('q-explanation'),
  solutionLocked: $('solution-locked'),
  showSolution: $('show-solution-btn'),
  nav: $('q-nav'),
  contract: $('contract'),
  editor: $('editor'),
  run: $('run-btn'),
  submit: $('submit-btn'),
  stop: $('stop-btn'),
  reset: $('reset-btn'),
  ai: $('ai-btn'),
  status: $('status'),
  output: $('output'),
  aiOutput: $('ai-output'),
  settingsBtn: $('settings-btn'),
  dialog: $('settings-dialog'),
};

const state = {
  q: null,
  editor: null,
  busy: false,
  engineReady: false,
  lastGrade: null,
  lastGradedCode: null,
  solutionRevealed: false,
  aiController: null,
};

function setStatus(msg) {
  ui.status.textContent = msg || '';
}

function setBusy(busy) {
  state.busy = busy;
  ui.run.disabled = busy || !state.engineReady;
  ui.submit.disabled = busy || !state.engineReady;
  ui.stop.disabled = !busy;
  ui.reset.disabled = busy;
}

// ---------------------------------------------------------------- rendering

async function renderQuestion(q) {
  document.title = `${q.title} · SQL & Python Practice`;
  ui.title.textContent = q.title;
  ui.meta.textContent = '';
  ui.meta.append(
    el('span', { class: 'badge lang' }, q.language === 'sql' ? 'SQL' : 'Python'),
    el('span', { class: `badge ${q.difficulty}` }, q.difficulty),
    ...q.tags.map((t) => el('span', { class: 'tag' }, t)),
    store.isSolved(q.id) ? el('span', { class: 'status-solved' }, 'Solved') : '',
  );
  ui.prompt.innerHTML = await renderMarkdown(q.prompt);

  const grading = [
    'Grading: column names are ignored but column order matters',
    q.ordered ? 'row order matters' : 'row order is ignored',
    'NULL equals NULL',
    typeof q.tolerance === 'number' ? `numbers match within ${q.tolerance}` : 'numbers match within 1e-6',
  ].join('; ');
  ui.prompt.append(el('p', { class: 'hint-text' }, grading + '.'));

  if (q.language === 'python') {
    ui.contract.textContent = `Define ${q.python.signature}. Arguments are pandas DataFrames built from the tables below, in that order. Return a DataFrame. pandas is available as pd, numpy as np.`;
  } else {
    ui.contract.textContent = 'DuckDB SQL. You may write several statements; the last one must return the result.';
  }

  // Tables: schema first (instant), sample rows once DuckDB is up.
  ui.tables.textContent = '';
  for (const t of q.tables) {
    ui.tables.append(
      dataTable({
        caption: t.name,
        columns: t.columns.map((c) => c.name),
        types: t.columns.map((c) => c.type),
        rows: [],
      }),
    );
  }

  ui.hints.textContent = '';
  if (!q.hints?.length) ui.hints.append(el('p', { class: 'hint-text' }, 'No hints for this one.'));
  q.hints?.forEach((h, i) => {
    const d = el('details', {}, el('summary', {}, `Hint ${i + 1}`));
    const body = el('div', { class: 'prompt' });
    renderMarkdown(h).then((html) => (body.innerHTML = html));
    d.append(body);
    ui.hints.append(d);
  });

  if (store.isSolved(q.id)) await revealExplanation();
}

async function renderSampleTables(q) {
  const data = await loadTables(q.seed, q.tables.map((t) => t.name));
  ui.tables.textContent = '';
  for (const t of q.tables) {
    const d = data[t.name];
    ui.tables.append(
      dataTable({
        caption: `${t.name} (${d.rows.length} rows)`,
        columns: d.columns,
        types: t.columns.map((c) => c.type),
        rows: d.rows,
        maxRows: 50,
      }),
    );
  }
}

async function revealExplanation() {
  ui.solutionLocked.hidden = true;
  ui.explanation.hidden = false;
  ui.explanation.innerHTML = '<h3>Explanation</h3>' + (await renderMarkdown(state.q.explanation));
}

async function revealSolution() {
  state.solutionRevealed = true;
  ui.solution.hidden = false;
  ui.solution.textContent = '';
  ui.solution.append(el('h3', {}, 'Reference solution'), el('pre', {}, el('code', {}, state.q.solution)));
  ui.showSolution.hidden = true;
  await revealExplanation();
}

async function renderNav(q) {
  try {
    const all = await loadIndex();
    all.sort(
      (a, b) => DIFFICULTIES.indexOf(a.difficulty) - DIFFICULTIES.indexOf(b.difficulty) || a.title.localeCompare(b.title),
    );
    const i = all.findIndex((x) => x.id === q.id);
    const prev = all[i - 1];
    const next = all[i + 1];
    ui.nav.textContent = '';
    ui.nav.append(
      prev ? el('a', { href: `question.html?id=${prev.id}` }, `← ${prev.title}`) : el('span'),
      next ? el('a', { href: `question.html?id=${next.id}` }, `${next.title} →`) : el('span'),
    );
  } catch {
    ui.nav.hidden = true;
  }
}

function renderRunResult(r) {
  ui.output.textContent = '';
  const meta = el('p', { class: 'result-meta' });
  if (r.ok) {
    meta.textContent = `Ran on visible data in ${formatMs(r.elapsedMs)}. ${r.rows ? `${r.rows.length} row(s).` : ''}`;
    ui.output.append(meta);
    if (r.note) ui.output.append(el('p', { class: 'hint-text' }, r.note));
    if (r.stdout) ui.output.append(el('h3', {}, 'stdout'), el('div', { class: 'stdout-box' }, r.stdout + (r.truncated ? '\n… (truncated)' : '')));
    if (r.columns && r.columns.length) {
      ui.output.append(el('h3', {}, 'Result'), dataTable({ columns: r.columns, types: r.types, rows: r.rows, maxRows: LIMITS.displayRows }));
    }
  } else {
    if (r.stdout) ui.output.append(el('h3', {}, 'stdout'), el('div', { class: 'stdout-box' }, r.stdout));
    ui.output.append(el('h3', {}, 'Error'), el('div', { class: 'error-box', role: 'alert' }, r.error));
  }
}

function reasonText(d) {
  if (d.reason === 'timeout') return 'Time limit exceeded.';
  if (d.reason === 'error') return `${REASON_TEXT.error}${d.errorRedacted ? ` (${d.errorRedacted})` : ''}`;
  return REASON_TEXT[d.reason] || 'Output differs.';
}

function renderGrade(g) {
  ui.output.textContent = '';
  ui.output.append(
    el(
      'div',
      { class: `verdict ${g.pass ? 'pass' : 'fail'}`, role: 'alert' },
      g.pass ? 'Accepted: matches the reference on visible and hidden data.' : 'Not accepted yet.',
    ),
  );
  for (const d of g.datasets) {
    const box = el('div', { class: 'dataset' });
    box.append(
      el('h3', {}, `${d.label}: `, el('span', { class: d.pass ? 'pass-text' : 'fail-text' }, d.pass ? 'pass' : 'fail')),
    );
    if (!d.pass) box.append(el('p', {}, reasonText(d)));
    if (d.key === 'hidden' && !d.pass) {
      box.append(el('p', { class: 'hint-text' }, 'Hidden data is not shown. Re-read the prompt for edge cases (NULLs, ties, boundaries, duplicates).'));
    }
    if (d.key === 'visible' && !d.pass) {
      if (d.error) box.append(el('div', { class: 'error-box' }, d.error));
      const c = d.compare;
      if (c && c.reason && c.reason !== 'error') {
        box.append(
          el(
            'p',
            { class: 'result-meta' },
            `Expected ${c.expectedRowCount} row(s) × ${c.expectedColCount} column(s); yours has ${c.actualRowCount} row(s) × ${c.actualColCount} column(s).`,
          ),
        );
        if (c.missing?.length) {
          box.append(
            el('h4', {}, `Expected rows missing from your output${c.missingCount > c.missing.length ? ` (first ${c.missing.length} of ${c.missingCount})` : ''}`),
            dataTable({ columns: d.expected.columns, rows: c.missing }),
          );
        }
        if (c.unexpected?.length) {
          box.append(
            el('h4', {}, `Rows in your output that are not expected${c.unexpectedCount > c.unexpected.length ? ` (first ${c.unexpected.length} of ${c.unexpectedCount})` : ''}`),
            dataTable({ columns: d.actual.columns, rows: c.unexpected }),
          );
        }
      }
      if (d.expected) {
        const det = el('details', {}, el('summary', {}, 'Expected output on visible data'));
        det.append(dataTable({ columns: d.expected.columns, rows: d.expected.rows }));
        box.append(det);
      }
      if (d.actual) {
        const det = el('details', {}, el('summary', {}, 'Your output on visible data'));
        det.append(dataTable({ columns: d.actual.columns, rows: d.actual.rows }));
        box.append(det);
      }
    }
    ui.output.append(box);
  }
}

// ---------------------------------------------------------------- actions

async function onRun() {
  if (state.busy || !state.engineReady) return;
  setBusy(true);
  setStatus('Running on visible data…');
  try {
    const r = await execute(state.q, state.q.seed, state.editor.getValue());
    renderRunResult(r);
    setStatus(r.ok ? 'Done.' : 'Finished with an error.');
  } catch (err) {
    renderRunResult({ ok: false, error: err.message || String(err) });
    setStatus('Stopped.');
  } finally {
    setBusy(false);
  }
}

async function onSubmit() {
  if (state.busy || !state.engineReady) return;
  const code = state.editor.getValue();
  setBusy(true);
  try {
    const g = await grade(state.q, code, setStatus);
    state.lastGrade = g;
    state.lastGradedCode = code;
    store.recordAttempt(state.q.id, g.pass);
    renderGrade(g);
    setStatus(g.pass ? 'Accepted.' : 'Not accepted.');
    if (g.pass) {
      await revealExplanation();
      renderQuestionMetaSolved();
    }
    if (store.getSettings().autoReview && store.getApiKey()) onReview();
  } catch (err) {
    ui.output.textContent = '';
    ui.output.append(el('div', { class: 'error-box', role: 'alert' }, err.message || String(err)));
    setStatus('Submission did not complete.');
  } finally {
    setBusy(false);
  }
}

function renderQuestionMetaSolved() {
  if (!ui.meta.querySelector('.status-solved')) ui.meta.append(el('span', { class: 'status-solved' }, 'Solved'));
}

function onStop() {
  stopSql();
  stopPython();
  setStatus('Stopping…');
}

async function onReview() {
  const code = state.editor.getValue();
  const gradeResult = state.lastGradedCode === code ? state.lastGrade : null;
  state.aiController?.abort();
  state.aiController = new AbortController();
  ui.aiOutput.textContent = '';
  ui.aiOutput.append(el('p', { class: 'hint-text' }, `Asking ${AI.model}…`));
  ui.ai.disabled = true;
  try {
    const res = await requestReview({
      apiKey: store.getApiKey(),
      question: state.q,
      code,
      gradeResult,
      solutionRevealed: state.solutionRevealed,
      signal: state.aiController.signal,
    });
    ui.aiOutput.textContent = '';
    if (!gradeResult) {
      ui.aiOutput.append(el('p', { class: 'warning' }, 'This review is of unsubmitted code, so there is no grader verdict behind it. Submit for a verdict.'));
    }
    const body = el('div', { class: 'ai-output prompt' });
    body.innerHTML = await renderMarkdown(res.text);
    ui.aiOutput.append(body);
    const usage = res.usage ? ` · ${res.usage.input_tokens ?? '?'} in / ${res.usage.output_tokens ?? '?'} out tokens` : '';
    ui.aiOutput.append(
      el('p', { class: 'hint-text' }, `AI feedback from ${res.model || AI.model}${usage}. It explains the verdict; it does not change it.${res.truncated ? ' (Response was cut off at the token limit.)' : ''}`),
    );
  } catch (err) {
    ui.aiOutput.textContent = '';
    const msg = err instanceof AiError ? err.message : `Unexpected error: ${err.message || err}`;
    ui.aiOutput.append(el('div', { class: err.kind === 'no-key' ? 'warning' : 'error-box', role: 'alert' }, msg));
    if (err.kind === 'no-key' || err.kind === 'auth') {
      ui.aiOutput.append(el('p', {}, el('button', { type: 'button', onclick: openSettings }, 'Open Settings')));
    }
  } finally {
    ui.ai.disabled = false;
  }
}

function onReset() {
  if (!confirm('Replace your code with the starter code? Your current draft will be lost.')) return;
  state.editor.setValue(state.q.starter);
  store.clearDraft(state.q.id);
}

async function onShowSolution() {
  if (!confirm('Reveal the reference solution? Trying a bit longer (or using a hint) is usually worth it.')) return;
  await revealSolution();
}

// ---------------------------------------------------------------- settings

function openSettings() {
  const key = store.getApiKey();
  $('api-key').value = '';
  $('key-state').textContent = key
    ? `A key is set (${store.isKeyRemembered() ? 'remembered on this device' : 'memory only'}), ending in …${key.slice(-4)}. Leave blank to keep it.`
    : 'No key set.';
  $('remember-key').checked = key ? store.isKeyRemembered() : true;
  $('auto-review').checked = Boolean(store.getSettings().autoReview);
  $('model-line').textContent = `Model: ${AI.model}. Requests go to ${AI.endpoint}.`;
  ui.dialog.showModal();
  $('api-key').focus();
}

function wireSettings() {
  ui.settingsBtn.addEventListener('click', openSettings);
  $('cancel-settings-btn').addEventListener('click', () => ui.dialog.close());
  $('settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const newKey = $('api-key').value.trim();
    const remember = $('remember-key').checked;
    const existing = store.getApiKey();
    if (newKey) store.setApiKey(newKey, remember);
    else if (existing && remember !== store.isKeyRemembered()) store.setApiKey(existing, remember);
    store.setSettings({ ...store.getSettings(), autoReview: $('auto-review').checked });
    ui.dialog.close();
    setStatus('Settings saved.');
  });
  $('clear-key-btn').addEventListener('click', () => {
    store.clearApiKey();
    $('key-state').textContent = 'Key cleared.';
  });
  $('reset-progress-btn').addEventListener('click', () => {
    if (confirm('Clear solved status for all questions in this browser?')) {
      store.resetProgress();
      $('key-state').textContent = 'Progress reset.';
    }
  });
}

// ---------------------------------------------------------------- boot

async function main() {
  wireSettings();
  const id = new URLSearchParams(location.search).get('id');
  let q;
  try {
    q = await loadQuestion(id);
  } catch (err) {
    ui.title.textContent = 'Question not found';
    ui.prompt.append(el('p', {}, err.message), el('p', {}, el('a', { href: './' }, 'Back to all questions')));
    return;
  }
  state.q = q;
  await renderQuestion(q);
  renderNav(q);

  const draft = store.getDraft(q.id);
  state.editor = await createEditor(ui.editor, {
    value: draft ?? q.starter,
    language: q.language,
    ariaLabel: `${q.language === 'sql' ? 'SQL' : 'Python'} code editor`,
  });
  let saveTimer;
  state.editor.onChange((v) => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.setDraft(q.id, v), 400);
  });
  state.editor.addRunShortcuts({ run: onRun, submit: onSubmit });

  ui.run.addEventListener('click', onRun);
  ui.submit.addEventListener('click', onSubmit);
  ui.stop.addEventListener('click', onStop);
  ui.reset.addEventListener('click', onReset);
  ui.ai.addEventListener('click', onReview);
  ui.showSolution.addEventListener('click', onShowSolution);

  // Engines: DuckDB always (it also builds the Python DataFrames), Pyodide for Python questions.
  setStatus('Loading DuckDB…');
  try {
    await getDb(setStatus);
    await renderSampleTables(q);
    if (q.language === 'python') {
      onPythonStatus(setStatus);
      await ensurePython();
    }
    state.engineReady = true;
    setBusy(false);
    setStatus('Ready.');
  } catch (err) {
    setStatus('');
    ui.output.textContent = '';
    ui.output.append(el('div', { class: 'error-box', role: 'alert' }, `Engine failed to load: ${err.message || err}`));
  }
}

main();
