# Known issues (from the first QA pass)

Found by an independent browser QA pass (Brave via puppeteer, served under a subpath).
Not yet fixed. Items 1-5 are the next work.

## To fix
1. **One SQL statement poisons later runs.** `SET memory_limit='1MB'` (also `SET default_null_order`, `DETACH DATABASE memory`) persists on the shared DuckDB instance, so every later Run/Submit fails, even the reference. Only reload or Stop/timeout recovers. See `assets/js/sql-engine.js` (`withFreshCatalog`). Direction: reset the DB after each user run, or on every Submit.
2. **Hidden data does not exercise some stated rules, so wrong answers pass.**
   - `concurrent-sessions`: dropping same-start or same-end pairs (`a.start_ts <> b.start_ts`) passes. Add sessions sharing only a start, and only an end.
   - `clickstream-sessionization`: counting purchase events instead of sessions with a purchase passes. Add a session with 2+ purchases.
   - `regional-revenue-pivot`: dropping NULL amounts before the merge passes; add an 'Unknown'-region order with a NULL amount.
   - `clean-signup-list`: `str.title()` passes; add mixed-case names.
   - Rounding questions (`monthly-cohort-retention`, `rolling-7-day-units`, `campaign-roas-fanout`): tolerances accept unrounded or wrongly rounded values although the prompts say "rounded to N decimals".
3. **Valid pandas answer rejected.** Returning `df.set_index('email', drop=False)[[...]]` raises "cannot insert email, already exists" (`_to_frame` in `assets/js/py-worker.js`). Use `reset_index(drop=True)` when the index name collides with a column.
4. **Python interpreter state persists across runs.** Patching pandas at module level changes the hidden reference run too. Direction: new worker per Submit.
5. **Smaller bugs**
   - "Remember on this device" is ticked by default (`question.html`, `question.js`).
   - SQL statement splitter has no `$$...$$` or `E'..'` support (`sql-utils.js`).
   - BIGINT/HUGEINT pass through DOUBLE and lose precision above 2^53.
   - Grading a Python infinite loop takes about 32 s (both datasets wait the full timeout).
   - AI review: aborted request overwrites the new "Asking..." text and re-enables the button early (`question.js`); thinking-only response truncated by `max_tokens` is reported as "no text".
   - On a 375px phone the editor is about three screens below the prompt.

## Known and accepted while answers are public
- Reference solutions and hidden datasets are public JSON, and the AI review request includes them. A learner's code could try to make the model reveal them (prompt injection).
- A SQL `CREATE TABLE`/`COPY` or a Python write to the in-memory filesystem can carry hidden rows into a later Run.
- Python user code can make cross-origin requests; the meta-tag CSP does not apply inside the worker. The API key is not reachable from the worker.
- The CSP allows `'unsafe-eval'` (WebAssembly runtimes) and the whole of cdn.jsdelivr.net; CDN libraries have no SRI.

## Not tested
Real Anthropic API calls (no key available; request shape was checked against the claude-api skill, not live), `python3 -m http.server` (did not accept connections on the dev machine; Node server used), GitHub Pages itself, Firefox, Safari, real phones, screen readers.
