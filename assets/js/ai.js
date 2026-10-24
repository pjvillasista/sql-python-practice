// Optional AI review via the Anthropic Messages API, called directly from the
// browser with the user's own key. The key is sent only to AI.endpoint.
// The AI never changes the pass/fail verdict; it only explains it.

import { AI } from './config.js';

export class AiError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // 'no-key' | 'auth' | 'rate-limit' | 'overloaded' | 'network' | 'bad-request' | 'refusal' | 'unknown'
  }
}

const SYSTEM_PROMPT = `You are a concise interview coach for SQL (DuckDB dialect) and Python/pandas, reviewing a learner's answer on a practice site.

Rules:
- A deterministic grader already compared the learner's output to the reference output on a visible dataset and a hidden dataset. Its verdict is final. Never claim the answer is correct if the grader failed it, or wrong if the grader passed it. Your job is to explain the verdict.
- If the grader failed the answer, find the most likely cause: the semantic rule in the prompt the code violates, or the edge case it mishandles.
- You are given the hidden dataset only so you can tell which edge cases matter. Describe those edge cases in general terms (for example "sessions that share the same start and end time"). Never quote hidden rows, ids, or values.
- {SOLUTION_RULE}
- Keep it short: at most about 250 words. Use Markdown with these headings, in order: "Verdict" (one line restating the grader result), "Correctness", "Edge cases", "Efficiency and style", "Next step" (one concrete hint).
- Short fragments of the learner's own code may be quoted. Do not invent requirements that are not in the prompt; if the prompt is ambiguous on a point, say so.`;

const RULE_HIDDEN =
  'The learner has NOT revealed the reference solution. Do not reproduce it, paraphrase it line by line, or write a complete corrected solution. Hints, the name of the right technique, and small fixes to the learner\'s own lines are fine.';
const RULE_REVEALED =
  'The learner has revealed the reference solution, so you may quote it and show a corrected version of their code.';

function fence(lang, text) {
  return '```' + lang + '\n' + String(text ?? '').replace(/```/g, '`​``') + '\n```';
}

function summarizeGrade(gradeResult) {
  if (!gradeResult) return 'The learner has not submitted yet (no grader verdict). Review the code against the prompt only.';
  const lines = [`Overall: ${gradeResult.pass ? 'PASSED' : 'FAILED'}`];
  for (const d of gradeResult.datasets) {
    let line = `- ${d.label}: ${d.pass ? 'pass' : 'fail'}`;
    if (!d.pass) line += ` (reason: ${d.reason}${d.errorRedacted ? `, error type: ${d.errorRedacted}` : ''})`;
    lines.push(line);
    if (d.key === 'visible' && !d.pass) {
      if (d.error) lines.push(`  Error message on visible data: ${d.error.slice(0, 1500)}`);
      if (d.compare && d.compare.missing) {
        lines.push(`  Expected ${d.compare.expectedRowCount} rows x ${d.compare.expectedColCount} cols; got ${d.compare.actualRowCount} rows x ${d.compare.actualColCount} cols.`);
        if (d.compare.missing.length) lines.push(`  Example expected rows missing from learner output: ${JSON.stringify(d.compare.missing.slice(0, 5))}`);
        if (d.compare.unexpected.length) lines.push(`  Example unexpected rows in learner output: ${JSON.stringify(d.compare.unexpected.slice(0, 5))}`);
      }
    }
  }
  return lines.join('\n');
}

export function buildRequest(q, code, gradeResult, solutionRevealed) {
  const schema = q.tables
    .map((t) => `${t.name}(${t.columns.map((c) => `${c.name} ${c.type}`).join(', ')})`)
    .join('\n');
  const contract =
    q.language === 'python'
      ? `Python contract: define ${q.python?.signature || 'solve(...)'}; arguments are pandas DataFrames in the table order above; return a DataFrame.`
      : 'SQL dialect: DuckDB. The last statement must be a query returning the result.';
  const userText = [
    `# Question: ${q.title} (${q.difficulty}, ${q.language})`,
    q.prompt,
    `## Tables\n${schema}`,
    contract,
    `Grading: column names ignored; row order ${q.ordered ? 'MATTERS' : 'ignored'}; NULL-aware; numeric tolerance ${q.tolerance ?? 1e-6}.`,
    `## Visible dataset (seed SQL)\n${fence('sql', q.seed)}`,
    `## Hidden dataset (seed SQL) - for your reasoning only, never quote it\n${fence('sql', q.hidden_seed)}`,
    `## Reference solution\n${fence(q.language === 'python' ? 'python' : 'sql', q.solution)}`,
    `## Learner's code\n${fence(q.language === 'python' ? 'python' : 'sql', code)}`,
    `## Grader verdict\n${summarizeGrade(gradeResult)}`,
  ].join('\n\n');

  return {
    model: AI.model,
    max_tokens: AI.maxTokens,
    system: SYSTEM_PROMPT.replace('{SOLUTION_RULE}', solutionRevealed ? RULE_REVEALED : RULE_HIDDEN),
    messages: [{ role: 'user', content: userText }],
    output_config: { effort: AI.effort },
    fallbacks: 'default',
  };
}

export async function requestReview({ apiKey, question, code, gradeResult, solutionRevealed, signal }) {
  if (!apiKey) throw new AiError('no-key', 'No API key set. Open Settings to add your Anthropic API key.');
  const body = buildRequest(question, code, gradeResult, solutionRevealed);
  let res;
  try {
    res = await fetch(AI.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': AI.apiVersion,
        'anthropic-beta': AI.fallbackBeta,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal,
      referrerPolicy: 'no-referrer',
      credentials: 'omit',
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw new AiError('aborted', 'Request cancelled.');
    throw new AiError('network', 'Network error: could not reach api.anthropic.com (offline, blocked by an extension or firewall, or CORS).');
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }

  if (!res.ok) {
    const apiMsg = data?.error?.message || res.statusText || 'Unknown error';
    if (res.status === 401) throw new AiError('auth', `Your API key was rejected (401: ${apiMsg}). Check it in Settings.`);
    if (res.status === 403) throw new AiError('auth', `This key is not allowed to make this request (403: ${apiMsg}).`);
    if (res.status === 429) {
      const retry = res.headers.get('retry-after');
      throw new AiError('rate-limit', `Rate limited (429). ${retry ? `Try again in ~${retry}s.` : 'Wait a bit and try again.'} ${apiMsg}`);
    }
    if (res.status === 529 || res.status === 503) throw new AiError('overloaded', `The API is overloaded right now (${res.status}). Try again shortly.`);
    if (res.status >= 500) throw new AiError('unknown', `API server error (${res.status}): ${apiMsg}`);
    throw new AiError('bad-request', `The API rejected the request (${res.status}): ${apiMsg}`);
  }

  if (data?.stop_reason === 'refusal') {
    throw new AiError('refusal', 'The model declined to review this answer. The grader verdict above still stands.');
  }
  const text = (data?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n\n')
    .trim();
  if (!text) throw new AiError('unknown', 'The API returned no text.');
  return {
    text,
    truncated: data.stop_reason === 'max_tokens',
    model: data.model,
    usage: data.usage,
  };
}
