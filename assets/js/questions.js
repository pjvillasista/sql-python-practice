// Load question metadata and files (relative URLs so GitHub Pages subpaths work).

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'extreme'];

export async function loadIndex() {
  const res = await fetch('questions/index.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load questions/index.json (${res.status})`);
  const data = await res.json();
  return data.questions;
}

export async function loadQuestion(id) {
  if (!/^[a-z0-9-]+$/.test(id || '')) throw new Error('Invalid question id.');
  const res = await fetch(`questions/${id}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Question "${id}" not found (${res.status}).`);
  return res.json();
}
