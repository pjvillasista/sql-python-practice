// Markdown -> sanitized HTML. Question text is trusted, AI output is not;
// both go through DOMPurify so there is one code path.

import { CDN } from './config.js';

let libs = null;

async function load() {
  if (!libs) {
    libs = Promise.all([import(CDN.marked), import(CDN.dompurify)]).then(([m, p]) => ({
      marked: m.marked,
      purify: p.default,
    }));
  }
  return libs;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export async function renderMarkdown(md) {
  try {
    const { marked, purify } = await load();
    const html = marked.parse(String(md ?? ''), { gfm: true, breaks: false });
    return purify.sanitize(html, { USE_PROFILES: { html: true } });
  } catch {
    // CDN unavailable: show plain text rather than nothing.
    return `<pre class="md-fallback">${escapeHtml(md)}</pre>`;
  }
}
