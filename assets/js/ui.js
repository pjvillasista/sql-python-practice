// Small DOM helpers shared by pages.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c);
  }
  return node;
}

function formatCell(v) {
  if (v === null || v === undefined) return { text: 'NULL', cls: 'null' };
  if (typeof v === 'number') {
    const text = Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
    return { text, cls: 'num' };
  }
  if (typeof v === 'boolean') return { text: v ? 'true' : 'false', cls: '' };
  return { text: String(v), cls: '' };
}

/**
 * Render a result/data table.
 * columns: string[]; types: string[] | undefined; rows: any[][].
 */
export function dataTable({ caption, columns, types, rows, maxRows = 500 }) {
  const table = el('table', { class: 'data' });
  if (caption) table.append(el('caption', {}, caption));
  const thead = el('thead');
  const tr = el('tr');
  columns.forEach((c, i) => {
    const th = el('th', { scope: 'col' }, String(c));
    if (types && types[i]) th.append(el('span', { class: 'type' }, String(types[i]).toLowerCase()));
    tr.append(th);
  });
  thead.append(tr);
  table.append(thead);
  const tbody = el('tbody');
  rows.slice(0, maxRows).forEach((r) => {
    const row = el('tr');
    r.forEach((v) => {
      const { text, cls } = formatCell(v);
      row.append(el('td', { class: cls || undefined }, text));
    });
    tbody.append(row);
  });
  if (rows.length === 0) {
    tbody.append(el('tr', {}, el('td', { colspan: String(Math.max(1, columns.length)), class: 'null' }, '(no rows)')));
  }
  table.append(tbody);
  const wrap = el('div', { class: 'data-table-wrap' }, table);
  const frag = document.createDocumentFragment();
  frag.append(wrap);
  if (rows.length > maxRows) frag.append(el('p', { class: 'result-meta' }, `Showing first ${maxRows} of ${rows.length} rows.`));
  return frag;
}

export function formatMs(ms) {
  if (ms === undefined || ms === null) return '';
  return ms < 1000 ? `${ms.toFixed(1)} ms` : `${(ms / 1000).toFixed(2)} s`;
}
