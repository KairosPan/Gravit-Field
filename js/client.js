// js/client.js — the browser's boot: the catalogue from the page, the store, one render per change, delegation on data-action, paths in the history
import { createStore } from './store.js';
import { reducers, initialState, persist, accept } from './reducers/discover.js';
import { makeCatalogue } from './data/catalogue.js';
import { renderDiscover } from './render/discover.js';
import { parsePath, toPath } from './routes.js';
import { THEME_KEY } from './render/page.js';

export const KEY = 'gravity-field.state';
export const COPIED_MS = 1500;
export const TOAST_MS = 6000;

export function boot(win, { copiedMs = COPIED_MS, toastMs = TOAST_MS } = {}) {
  const doc = win.document;
  const root = doc.getElementById('app');
  let data = {};
  try { data = JSON.parse(doc.getElementById('catalogue')?.textContent || '{}'); } catch { data = {}; }
  const cat = makeCatalogue({ ...data, now: Date.now() });
  const route = parsePath(win.location.pathname) ?? { shelf: null, plugin: null };
  const store = createStore({
    initial: initialState({ route }), reducers, storage: win.localStorage, key: KEY,
    accept, persist, hydrate: saved => initialState({ ...saved, route }),
  });
  const timers = new Set();
  const after = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };

  function applyTheme(t) {
    if (t === 'cream' || t === 'black') doc.documentElement.dataset.theme = t; else delete doc.documentElement.dataset.theme;
    try { if (t === 'system') win.localStorage?.removeItem(THEME_KEY); else win.localStorage?.setItem(THEME_KEY, t); } catch { /* storage may be unavailable */ }
  }

  // a render replaces the nodes: the search keeps its focus and caret, shelves and the drawer keep their scroll
  let lastOverlay = null;
  function render() {
    const q = doc.getElementById('dq');
    const hadFocus = q && doc.activeElement === q;
    const caret = q?.selectionStart ?? 0;
    const shelves = [...root.querySelectorAll('.shelf-row')].map(e => e.scrollLeft);
    const drawerTop = root.querySelector('.drawer-body')?.scrollTop ?? 0;
    const s = store.get();
    const overlay = s.create ? 'modal' : s.drawer ? 'drawer' : null;
    root.innerHTML = renderDiscover(s, cat);
    // an overlay that just opened takes focus on its close key (spec §5.7); Escape closes it
    if (overlay && overlay !== lastOverlay) root.querySelector(overlay === 'modal' ? '.modal .close-key' : '.drawer .close-key')?.focus();
    lastOverlay = overlay;
    root.querySelectorAll('.shelf-row').forEach((e, i) => { e.scrollLeft = shelves[i] ?? 0; });
    const d = root.querySelector('.drawer-body');
    if (d) d.scrollTop = drawerTop;
    if (hadFocus) { const nq = doc.getElementById('dq'); nq?.focus(); try { nq?.setSelectionRange(caret, caret); } catch { /* not every input has a caret */ } }
  }
  store.subscribe(render);

  // the route moves the state and the address together; the same path is never pushed twice
  const go = route => {
    store.dispatch('nav', route);
    const path = toPath(route);
    if (win.location.pathname !== path) win.history.pushState(null, '', path);
  };

  const ACTIONS = {
    openPlugin: el => go({ shelf: store.get().route.shelf, plugin: el.dataset.id }),
    closeDrawer: () => go({ shelf: store.get().route.shelf, plugin: null }),
    install: el => {
      const p = cat.byId(el.dataset.id);
      if (!p || p.pending) return;
      store.dispatch('install', { id: p.id, name: p.name });
      after(toastMs, () => store.dispatch('dismissToast'));
    },
    uninstall: el => store.dispatch('uninstall', el.dataset.id),
    toggleInstalledOnly: () => store.dispatch('toggleInstalledOnly'),
    openCreate: () => { if (store.get().drawer) go({ shelf: store.get().route.shelf, plugin: null }); store.dispatch('openCreate'); },
    closeCreate: () => store.dispatch('closeCreate'),
    dismissToast: () => store.dispatch('dismissToast'),
    toggleTools: () => store.dispatch('toggleTools'),
    setTheme: el => { store.dispatch('setTheme', el.dataset.value); applyTheme(el.dataset.value); },
    copy: el => {
      try { win.navigator?.clipboard?.writeText(el.dataset.copy)?.catch?.(() => {}); } catch { /* no clipboard: the label still answers */ }
      store.dispatch('setCopied', el.dataset.key);
      after(copiedMs, () => { if (store.get().copied === el.dataset.key) store.dispatch('setCopied', null); });
    },
  };

  root.addEventListener('click', ev => {
    const nav = ev.target.closest('a[data-nav]');
    if (nav) {
      ev.preventDefault();
      const r = parsePath(new URL(nav.href, win.location.origin).pathname);
      if (r) go({ shelf: r.shelf, plugin: r.plugin });
      return;
    }
    const el = ev.target.closest('[data-action]');
    if (el && ACTIONS[el.dataset.action]) ACTIONS[el.dataset.action](el);
  });
  // an input method composes in place: a render mid-composition would replace the input under it, so the search waits for compositionend
  root.addEventListener('input', ev => { if (!ev.isComposing && ev.target?.dataset?.action === 'query') store.dispatch('setQuery', ev.target.value); });
  root.addEventListener('compositionend', ev => { if (ev.target?.dataset?.action === 'query') store.dispatch('setQuery', ev.target.value); });
  // a card is a div with role=button: Enter and Space open it, as they would a button; real buttons, links and fields act on their own
  const NATIVE = new Set(['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT']);
  root.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const el = ev.target;
    if (!el?.dataset?.action || NATIVE.has(el.tagName) || !ACTIONS[el.dataset.action]) return;
    ev.preventDefault();
    ACTIONS[el.dataset.action](el);
  });
  root.addEventListener('change', ev => { if (ev.target?.dataset?.action === 'setClient') store.dispatch('setClient', ev.target.value); });
  doc.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape') return;
    const s = store.get();
    if (s.create) store.dispatch('closeCreate');
    else if (s.drawer) ACTIONS.closeDrawer();
  });
  win.addEventListener('popstate', () => {
    const r = parsePath(win.location.pathname);
    if (r) store.dispatch('nav', { shelf: r.shelf, plugin: r.plugin });
  });

  applyTheme(store.get().theme);
  render();
  store.timers = { clear: () => { for (const t of timers) clearTimeout(t); timers.clear(); } };
  return store;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && document.getElementById('app') && document.getElementById('catalogue')) boot(window);
