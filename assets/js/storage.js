// localStorage wrappers. Every access is wrapped in try/catch: storage can be
// disabled (private mode, blocked site data) and the app must still work.

const PREFIX = 'sqlpp:v1:';
const memory = new Map(); // fallback when localStorage is unavailable

function rawGet(key) {
  try {
    const v = window.localStorage.getItem(PREFIX + key);
    return v === null ? (memory.has(key) ? memory.get(key) : null) : v;
  } catch {
    return memory.has(key) ? memory.get(key) : null;
  }
}

function rawSet(key, value) {
  memory.set(key, value);
  try {
    window.localStorage.setItem(PREFIX + key, value);
    return true;
  } catch {
    return false;
  }
}

function rawRemove(key) {
  memory.delete(key);
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

function getJSON(key, fallback) {
  const raw = rawGet(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// ---- progress -------------------------------------------------------------

export function getProgress() {
  const p = getJSON('progress', {});
  return p && typeof p === 'object' ? p : {};
}

export function isSolved(id) {
  return Boolean(getProgress()[id]?.solved);
}

export function recordAttempt(id, passed) {
  const p = getProgress();
  const entry = p[id] || { solved: false, attempts: 0 };
  entry.attempts = (entry.attempts || 0) + 1;
  if (passed) {
    entry.solved = true;
    entry.solvedAt = entry.solvedAt || new Date().toISOString();
  }
  p[id] = entry;
  rawSet('progress', JSON.stringify(p));
  return entry;
}

export function resetProgress() {
  rawRemove('progress');
}

// ---- drafts ---------------------------------------------------------------

export function getDraft(id) {
  return rawGet('draft:' + id);
}

export function setDraft(id, code) {
  rawSet('draft:' + id, code);
}

export function clearDraft(id) {
  rawRemove('draft:' + id);
}

// ---- settings -------------------------------------------------------------

export function getSettings() {
  return { autoReview: false, ...getJSON('settings', {}) };
}

export function setSettings(s) {
  rawSet('settings', JSON.stringify(s));
}

export function getTheme() {
  return rawGet('theme'); // 'light' | 'dark' | null (follow system)
}

export function setTheme(t) {
  if (t) rawSet('theme', t);
  else rawRemove('theme');
}

// ---- API key ----------------------------------------------------------------
// The key lives either in localStorage ("remember on this device") or only in
// this page's memory (gone on reload). It is never written anywhere else.

let sessionKey = null;

export function getApiKey() {
  if (sessionKey) return sessionKey;
  try {
    return window.localStorage.getItem(PREFIX + 'anthropicKey');
  } catch {
    return null;
  }
}

export function isKeyRemembered() {
  try {
    return window.localStorage.getItem(PREFIX + 'anthropicKey') !== null;
  } catch {
    return false;
  }
}

export function setApiKey(key, remember) {
  clearApiKey();
  if (!key) return;
  if (remember) {
    try {
      window.localStorage.setItem(PREFIX + 'anthropicKey', key);
      return;
    } catch {
      /* fall through to memory-only */
    }
  }
  sessionKey = key;
}

export function clearApiKey() {
  sessionKey = null;
  try {
    window.localStorage.removeItem(PREFIX + 'anthropicKey');
  } catch {
    /* ignore */
  }
}
