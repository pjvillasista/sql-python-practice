// Code editor: Monaco from the CDN, with a plain <textarea> fallback if Monaco
// cannot load (offline, blocked CDN). Both expose the same small interface.

import { CDN } from './config.js';
import { currentTheme, onThemeChange } from './theme.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}

function loadCss(href) {
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
  document.head.appendChild(l);
}

let monacoPromise = null;
function loadMonaco() {
  if (monacoPromise) return monacoPromise;
  const base = CDN.monacoBase;
  monacoPromise = (async () => {
    // Workers must be same-origin; bootstrap them from a data: URL.
    window.MonacoEnvironment = {
      getWorkerUrl() {
        const src = `self.MonacoEnvironment={baseUrl:${JSON.stringify(base + '/')}};importScripts(${JSON.stringify(base + '/vs/base/worker/workerMain.js')});`;
        return 'data:text/javascript;charset=utf-8,' + encodeURIComponent(src);
      },
    };
    loadCss(`${base}/vs/editor/editor.main.css`);
    await loadScript(`${base}/vs/loader.js`);
    window.require.config({ paths: { vs: `${base}/vs` } });
    return new Promise((resolve, reject) => window.require(['vs/editor/editor.main'], () => resolve(window.monaco), reject));
  })();
  return monacoPromise;
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('Editor load timed out')), ms))]);
}

/**
 * Create an editor inside `container`.
 * Returns {getValue, setValue, focus, onChange(fn), addRunShortcuts({run, submit}), kind}.
 */
export async function createEditor(container, { value, language, ariaLabel }) {
  try {
    const monaco = await withTimeout(loadMonaco(), 20000);
    container.textContent = '';
    const editor = monaco.editor.create(container, {
      value,
      language: language === 'python' ? 'python' : 'sql',
      theme: currentTheme() === 'dark' ? 'vs-dark' : 'vs',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 14,
      tabSize: 4,
      insertSpaces: true,
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      ariaLabel,
      accessibilitySupport: 'auto',
      renderLineHighlight: 'line',
      fixedOverflowWidgets: true,
    });
    onThemeChange((t) => monaco.editor.setTheme(t === 'dark' ? 'vs-dark' : 'vs'));
    return {
      kind: 'monaco',
      getValue: () => editor.getValue(),
      setValue: (v) => editor.setValue(v),
      focus: () => editor.focus(),
      onChange: (fn) => editor.onDidChangeModelContent(() => fn(editor.getValue())),
      addRunShortcuts({ run, submit }) {
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, run);
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, submit);
      },
    };
  } catch (err) {
    console.warn('Monaco unavailable, using textarea fallback:', err);
    container.textContent = '';
    const ta = document.createElement('textarea');
    ta.className = 'editor-fallback';
    ta.value = value;
    ta.spellcheck = false;
    ta.setAttribute('aria-label', ariaLabel);
    container.appendChild(ta);
    return {
      kind: 'textarea',
      getValue: () => ta.value,
      setValue: (v) => {
        ta.value = v;
      },
      focus: () => ta.focus(),
      onChange: (fn) => ta.addEventListener('input', () => fn(ta.value)),
      addRunShortcuts({ run, submit }) {
        ta.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) submit();
            else run();
          }
        });
      },
    };
  }
}
