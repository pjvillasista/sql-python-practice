import { loadIndex, DIFFICULTIES } from './questions.js';
import { getProgress } from './storage.js';
import { initTheme } from './theme.js';

initTheme(document.getElementById('theme-toggle'));

const els = {
  form: document.getElementById('filters'),
  search: document.getElementById('f-search'),
  difficulty: document.getElementById('f-difficulty'),
  language: document.getElementById('f-language'),
  tag: document.getElementById('f-tag'),
  status: document.getElementById('f-status'),
  body: document.getElementById('qbody'),
  progress: document.getElementById('progress-line'),
};

let questions = [];

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

// Filters are mirrored into the URL hash so a filtered view can be bookmarked.
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  for (const k of ['search', 'difficulty', 'language', 'tag', 'status']) {
    if (p.has(k)) els[k].value = p.get(k);
  }
}

function writeHash() {
  const p = new URLSearchParams();
  for (const k of ['search', 'difficulty', 'language', 'tag', 'status']) {
    if (els[k].value) p.set(k, els[k].value);
  }
  const h = p.toString();
  history.replaceState(null, '', h ? '#' + h : location.pathname + location.search);
}

function render() {
  const progress = getProgress();
  const q = els.search.value.trim().toLowerCase();
  const rows = questions.filter((x) => {
    if (els.difficulty.value && x.difficulty !== els.difficulty.value) return false;
    if (els.language.value && x.language !== els.language.value) return false;
    if (els.tag.value && !x.tags.includes(els.tag.value)) return false;
    const solved = Boolean(progress[x.id]?.solved);
    if (els.status.value === 'solved' && !solved) return false;
    if (els.status.value === 'unsolved' && solved) return false;
    if (q && !(x.title.toLowerCase().includes(q) || x.tags.some((t) => t.includes(q)))) return false;
    return true;
  });

  els.body.textContent = '';
  if (rows.length === 0) {
    els.body.append(el('tr', {}, el('td', { colspan: '5', class: 'empty' }, 'No questions match these filters.')));
  }
  for (const x of rows) {
    const solved = Boolean(progress[x.id]?.solved);
    const tags = el('div', { class: 'tags' });
    x.tags.forEach((t) => tags.append(el('span', { class: 'tag' }, t)));
    els.body.append(
      el(
        'tr',
        {},
        el('td', { class: solved ? 'status-solved' : 'status-unsolved' }, solved ? 'Solved' : 'Unsolved'),
        el('td', {}, el('a', { href: `question.html?id=${encodeURIComponent(x.id)}` }, x.title)),
        el('td', {}, el('span', { class: 'badge lang' }, x.language === 'sql' ? 'SQL' : 'Python')),
        el('td', {}, el('span', { class: `badge ${x.difficulty}` }, x.difficulty)),
        el('td', {}, tags),
      ),
    );
  }
  const solvedCount = questions.filter((x) => progress[x.id]?.solved).length;
  els.progress.textContent = `Showing ${rows.length} of ${questions.length} questions. Solved ${solvedCount} of ${questions.length}.`;
}

async function main() {
  try {
    questions = await loadIndex();
  } catch (err) {
    els.body.textContent = '';
    els.body.append(el('tr', {}, el('td', { colspan: '5', class: 'empty' }, String(err.message))));
    return;
  }
  questions.sort(
    (a, b) => DIFFICULTIES.indexOf(a.difficulty) - DIFFICULTIES.indexOf(b.difficulty) || a.title.localeCompare(b.title),
  );
  const tags = [...new Set(questions.flatMap((x) => x.tags))].sort();
  for (const t of tags) els.tag.append(el('option', { value: t }, t));
  readHash();
  els.form.addEventListener('submit', (e) => e.preventDefault());
  els.form.addEventListener('input', () => {
    writeHash();
    render();
  });
  render();
}

main();
