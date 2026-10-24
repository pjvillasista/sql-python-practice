// Theme: follows prefers-color-scheme by default; a toggle can pin light/dark.
import { getTheme, setTheme } from './storage.js';

const listeners = new Set();

export function currentTheme() {
  const pinned = document.documentElement.dataset.theme;
  if (pinned === 'light' || pinned === 'dark') return pinned;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function onThemeChange(fn) {
  listeners.add(fn);
}

function emit() {
  const t = currentTheme();
  listeners.forEach((fn) => fn(t));
}

export function initTheme(button) {
  const saved = getTheme();
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', emit);
  if (!button) return;
  const label = () => {
    const pinned = document.documentElement.dataset.theme;
    button.textContent = pinned === 'dark' ? 'Theme: dark' : pinned === 'light' ? 'Theme: light' : 'Theme: auto';
  };
  label();
  button.addEventListener('click', () => {
    // auto -> light -> dark -> auto
    const pinned = document.documentElement.dataset.theme;
    const next = !pinned ? 'light' : pinned === 'light' ? 'dark' : null;
    if (next) document.documentElement.dataset.theme = next;
    else delete document.documentElement.dataset.theme;
    setTheme(next);
    label();
    emit();
  });
}
