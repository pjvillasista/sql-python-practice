# CLAUDE.md

Static site, no build step: plain HTML, CSS and ES modules. Runtime libraries load from jsDelivr at exact versions pinned in `assets/js/config.js`; change versions only there.

- SQL runs in DuckDB-WASM (`assets/js/sql-engine.js`). Each run gets a fresh in-memory catalog.
- Python runs in Pyodide inside a Web Worker (`assets/js/py-worker.js`). DataFrames are built from the question's SQL seed via DuckDB.
- Grading is `assets/js/grader.js` + `assets/js/compare.js` (pure; importable from Node). AI review (`assets/js/ai.js`) explains the verdict and never changes it.

## Rules

- **Never commit API keys or secrets.** The Anthropic key exists only in the user's browser (localStorage or memory) and is sent only to `api.anthropic.com`. Do not add a backend, proxy, analytics, or any other network destination; the CSP `connect-src` in the HTML pages enforces this.
- Hidden-dataset details (rows, counts, raw error text) must not reach the UI. Visible-dataset diffs are fine.
- Wrap every `localStorage` access in try/catch (see `storage.js`).

## Adding a question

1. Add `questions/<id>.json` (copy an existing one; fields are described in README.md) and an entry in `questions/index.json`.
2. `node scripts/validate_questions.mjs` (static checks).
3. Serve the repo and open `/validate.html?autorun=1` (executes seeds, the reference, the starter, and every `trap_solutions` entry in the real engines). Both must pass.
4. The prompt must state every rule the reference solution relies on (NULLs, ties, boundaries, ordering). Put edge cases in `hidden_seed`.
