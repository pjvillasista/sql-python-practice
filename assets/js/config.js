// Single place for pinned third-party versions, CDN URLs, and runtime limits.
// Bump a version here and nowhere else.

export const VERSIONS = Object.freeze({
  duckdbWasm: '1.32.0',
  pyodide: '0.29.5', // ships pandas 2.3.3, Python 3.13
  monaco: '0.52.2',
  marked: '15.0.12',
  dompurify: '3.2.6',
});

export const CDN = Object.freeze({
  duckdb: `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${VERSIONS.duckdbWasm}/+esm`,
  pyodideIndex: `https://cdn.jsdelivr.net/pyodide/v${VERSIONS.pyodide}/full/`,
  monacoBase: `https://cdn.jsdelivr.net/npm/monaco-editor@${VERSIONS.monaco}/min`,
  marked: `https://cdn.jsdelivr.net/npm/marked@${VERSIONS.marked}/lib/marked.esm.js`,
  dompurify: `https://cdn.jsdelivr.net/npm/dompurify@${VERSIONS.dompurify}/dist/purify.es.mjs`,
});

export const AI = Object.freeze({
  endpoint: 'https://api.anthropic.com/v1/messages',
  model: 'claude-sonnet-5-5',
  apiVersion: '2023-06-01',
  // Server-side fallback when a safety classifier declines a request.
  fallbackBeta: 'server-side-fallback-2026-07-01',
  effort: 'medium',
  maxTokens: 8000,
});

export const LIMITS = Object.freeze({
  sqlTimeoutMs: 15000,
  pyTimeoutMs: 15000,
  displayRows: 500,
  stdoutChars: 20000,
});

export const DEFAULT_TOLERANCE = 1e-6;
