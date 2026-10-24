# SQL & Python Practice

A LeetCode/DataLemur-style practice site for analytics and data-engineering interviews. Everything runs in your browser:

- **SQL** runs on [DuckDB-WASM](https://duckdb.org/docs/api/wasm/overview) (DuckDB dialect).
- **Python** runs on [Pyodide](https://pyodide.org) with pandas, inside a Web Worker so infinite loops can be stopped.
- **Grading** is deterministic: your output is compared with the reference solution's output on the visible data and on a hidden dataset full of edge cases.
- **AI review** is optional. You bring your own Anthropic API key and the browser calls the API directly. The AI explains the grader's verdict; it never changes it.

There is no backend and no build step. Libraries load from jsDelivr at exact pinned versions (`assets/js/config.js`): DuckDB-WASM 1.32.0, Pyodide 0.29.5 (Python 3.13, pandas 2.3.3), Monaco Editor 0.52.2, marked 15.0.12, DOMPurify 3.2.6.

## Run locally

The pages use ES modules and `fetch`, so they must be served over HTTP (opening `index.html` from disk will not work):

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static server works (`npx serve`, etc.). The first visit downloads DuckDB (about 35 MB of WebAssembly) and, on Python questions, Pyodide plus pandas (about 20 MB). The browser caches both after that. An internet connection is required because the libraries come from the CDN.

## Using it

- **List page** (`index.html`): filter by difficulty, language, tag, solved/unsolved, or search. Filters are kept in the URL hash. Solved status lives only in this browser's localStorage.
- **Question page** (`question.html?id=...`): prompt, the tables with their sample rows and column types, hints, and an editor.
  - **Run** (Ctrl/Cmd+Enter) executes your code on the visible data and shows the result, stdout, errors and run time.
  - **Submit** (Ctrl/Cmd+Shift+Enter) grades on the visible and hidden datasets and reports pass/fail per dataset. For the visible data you see missing and unexpected rows. For the hidden data you only see a failure category (wrong row count, wrong values, wrong order, error type, timeout), never rows, counts or raw error messages.
  - **Stop** cancels a run. Runs are also cut off after 15 seconds. Stopping terminates the DuckDB or Python worker; the next run starts a fresh one, which takes a few seconds for Python.
  - Your code is auto-saved per question in localStorage. **Reset code** restores the starter.
  - The explanation unlocks after you pass. **Show solution** reveals the reference at any time.

### Grading rules

- Column **names are ignored**; the number and order of columns matter.
- Row order is ignored unless the question sets `"ordered": true` (the prompt then says how to order).
- NULL equals NULL and nothing else. In Python, `NaN`/`NaT`/`None`/`pd.NA` all count as NULL.
- Numbers compare with an absolute tolerance (default `1e-6`, overridable per question; questions that ask for rounding use a looser tolerance) and `3 == 3.0`.
- A DATE and a TIMESTAMP at exactly midnight compare equal (`2024-01-05` vs `2024-01-05 00:00:00`).
- SQL: you may write several statements; the last one must return the result.
- Python: define the function named in the prompt (always `solve`). It receives one pandas DataFrame per table, in the order the tables are listed, and must return a DataFrame. A Series is converted with `to_frame()`. A named index or MultiIndex (e.g. from `groupby`) is turned back into columns with `reset_index()`.

## AI review: your key, your bill, your browser

Open **Settings** on any question page and paste an Anthropic API key. Then use **Review my answer (AI)**, or turn on "review automatically on every Submit".

How the key is handled:

- It is stored only in your browser: in localStorage if "Remember on this device" is checked, otherwise only in page memory until you reload. **Clear key** removes it.
- It is sent only to `https://api.anthropic.com/v1/messages`, directly from your browser, with the headers `anthropic-version: 2023-06-01` and `anthropic-dangerous-direct-browser-access: true`. The pages' Content-Security-Policy limits `connect-src` to the site itself, jsDelivr and `api.anthropic.com`.
- It is never in this repository, never in a URL, and never sent to any other server by this code.

What that does not protect against, so you can judge the risk:

- Anything that can run script on this origin can read localStorage: a browser extension with page access, a compromised CDN library (they load without Subresource Integrity, because jsDelivr's `+esm` bundles are generated dynamically), or **another page on the same origin**. On GitHub Pages every project site of a user shares the origin `https://<user>.github.io`, so any other project page you publish there could read the key. A custom domain gives the site its own origin.
- The CSP is a meta tag and allows `'unsafe-eval'` (needed by the WebAssembly runtimes). It is defense in depth, not a guarantee.

Recommendation: create a **dedicated key with a low monthly spend limit** in the Anthropic Console, and clear it when you are done.

**Cost:** every review is a normal, billed API call **charged to your own Anthropic account**. Each request sends the question, both datasets' seed SQL, the reference solution, your code and the grader verdict, and asks for a short answer from `claude-sonnet-5-5` with `effort: medium`. Expect a few thousand input tokens and up to a few hundred output tokens per review, plus thinking tokens (also billed as output). Auto-review is off by default.

What the AI sees and is told:

- The reference solution and the hidden dataset are included so it can spot the missed edge case. The system prompt tells it not to quote hidden rows and not to reproduce the reference solution or write a full corrected solution unless you have clicked **Show solution**. Those are instructions to a model, not hard guarantees.
- The deterministic verdict is final. If you ask for a review of code you have changed since your last Submit, it is labelled as an unsubmitted review.
- Errors are handled explicitly: no key, rejected key (401/403), rate limit (429), overloaded (529/503), network or CORS failure, safety refusal, and other API errors each show a specific message.
- Requests opt into server-side refusal fallback (`fallbacks: "default"`, beta header `server-side-fallback-2026-07-01`).

## Question format

One JSON file per question in `questions/`, plus `questions/index.json`, which lists `{id, title, difficulty, language, tags}` for each question (it must match the files).

| field | type | notes |
|---|---|---|
| `id` | string | lowercase, digits, dashes; equals the file name |
| `title` | string | |
| `difficulty` | `"easy" \| "medium" \| "hard" \| "extreme"` | |
| `language` | `"sql" \| "python"` | |
| `tags` | string[] | used by the tag filter |
| `prompt` | markdown | must state every rule the reference relies on |
| `tables` | `[{name, columns: [{name, type}]}]` | DuckDB types; must match what the seeds create |
| `seed` | SQL | creates and fills the visible tables |
| `hidden_seed` | SQL | same schema, different rows, the edge cases |
| `solution` | SQL or Python | the reference |
| `ordered` | boolean | `true` if row order is graded |
| `tolerance` | number, optional | absolute numeric tolerance (default `1e-6`) |
| `python` | `{entry, signature}` | Python only; `entry` is the function name (`"solve"`) |
| `hints` | markdown[] | |
| `explanation` | markdown | shown after solving |
| `starter` | string | initial editor contents |
| `trap_solutions` | `[{note, code}]`, optional | plausible wrong answers; the browser validator checks that each one fails |

**Python data:** Python questions use the same SQL seeds. DuckDB runs the seed, and each table becomes a DataFrame: integer columns become `int64` (`float64` if they contain NULLs), DOUBLE becomes `float64`, DATE and TIMESTAMP become `datetime64[ns]`, and VARCHAR becomes `object` with `None` for NULL.

### Adding a question

1. Copy an existing file in `questions/`, change it, and add the entry to `questions/index.json`.
2. Put the tricky cases in `hidden_seed`, and add one or two `trap_solutions` that should fail.
3. Run the static checks: `node scripts/validate_questions.mjs`
4. Serve the site and open `http://localhost:8000/validate.html?autorun=1`. Every question must show PASS.

### What each validator checks

`scripts/validate_questions.mjs` (Node 18+, no dependencies) is **static only**: JSON parses, required fields and types, enums, unique ids, id matches the file name, `index.json` matches the files, each declared table is created by `CREATE TABLE` in both seeds, the hidden seed differs from the visible one, and Python solution and starter define the entry function. It **does not run any SQL or Python**, so it cannot tell whether a seed or the reference solution works.

`validate.html` runs in the browser with the same engines and grader as the app. For each question it checks that both seeds run; that the declared column names and types match what DuckDB created; that the reference solution runs and returns at least one row on both datasets; that the starter code runs; that the reference passes when graded against itself; and that every `trap_solutions` entry fails at least one dataset. It also prints the reference outputs, hidden ones included, for review. It **does not prove** that the prompt and the reference agree; that still needs a human read of the prompt next to the printed outputs.

## Deploy to GitHub Pages

1. Push the repository to GitHub.
2. Settings → Pages → "Deploy from a branch" → branch `main`, folder `/ (root)`.
3. The site is served at `https://<user>.github.io/<repo>/`. All paths are relative, so the subpath works. No build or Actions workflow is needed.

Before publishing, read the shared-origin note in the AI section above.

## Project layout

```
index.html              question list
question.html           question page (editor, run, submit, AI review, settings)
validate.html           author tool: executes every question in the browser
assets/css/style.css
assets/js/
  config.js             pinned versions, CDN URLs, AI settings, limits
  sql-engine.js         DuckDB-WASM: fresh catalog per run, timeout/stop
  py-engine.js          main-thread controller for the Pyodide worker
  py-worker.js          Pyodide + pandas harness (runs solve())
  grader.js, compare.js deterministic grading
  ai.js                 Anthropic Messages API call and error handling
  editor.js             Monaco, with a <textarea> fallback
  question.js, list.js, validate.js, ui.js, storage.js, theme.js, markdown.js, questions.js, sql-utils.js
questions/              one JSON file per question, plus index.json
scripts/validate_questions.mjs
```

## Known limitations

- Needs a modern desktop or mobile browser and network access to jsDelivr. Monaco is usable but not great on phones; if Monaco fails to load, a plain textarea is used.
- Reference solutions and hidden data are in the public JSON files. This is a practice tool, not an exam.
- SQL is DuckDB's dialect. Most standard SQL works, but date functions differ from Postgres, Snowflake or BigQuery.
- The comparison ignores column names and compares strings exactly (no case folding or trimming).

## License

MIT, see [LICENSE](LICENSE).
