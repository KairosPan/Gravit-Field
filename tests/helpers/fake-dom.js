// tests/helpers/fake-dom.js — just enough of a window and document to run boot() under node:test: gravit-ui's, with paths instead of hashes.
// It does not parse HTML. Elements are registered by id or by selector; an innerHTML write behaves like the browser replacing
// the nodes: scroll positions go to 0, typed values go back to what the markup says, focus falls to <body>.
export function fakeWindow({ path = '/', storage = null, catalogue = null } = {}) {
  const byId = new Map();
  const bySelector = new Map();
  const listeners = { root: {}, doc: {}, win: {} };
  const clipboard = [];
  const pushed = [];
  const body = { tagName: 'BODY' };
  let html = '';
  let writes = 0;
  let pathname = path;

  const element = (props = {}) => ({
    id: '', tagName: 'DIV', value: '', rendered: '', dataset: {}, scrollTop: 0, scrollLeft: 0, selectionStart: 0, selectionEnd: 0,
    focus() { doc.activeElement = this; },
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
    ...props,
  });
  const present = el => !el.presentIf || el.presentIf.test(html);

  const root = {
    id: 'app',
    get innerHTML() { return html; },
    set innerHTML(v) {
      html = v;
      writes++;
      for (const el of [...byId.values(), ...[...bySelector.values()].flat()]) { el.scrollTop = 0; el.scrollLeft = 0; el.value = el.rendered; }
      doc.activeElement = body;
    },
    querySelectorAll(sel) { return (bySelector.get(sel) ?? []).filter(present); },
    querySelector(sel) { return (bySelector.get(sel) ?? []).find(present) ?? null; },
    addEventListener(type, fn) { (listeners.root[type] ??= []).push(fn); },
  };
  const catalogueEl = { textContent: catalogue ? JSON.stringify(catalogue) : '' };
  const doc = {
    activeElement: body,
    documentElement: { dataset: {} },
    getElementById(id) {
      if (id === 'app') return root;
      if (id === 'catalogue') return catalogue ? catalogueEl : null;
      const el = byId.get(id);
      return el && present(el) ? el : null;
    },
    addEventListener(type, fn) { (listeners.doc[type] ??= []).push(fn); },
  };
  const win = {
    document: doc,
    localStorage: storage,
    location: { get pathname() { return pathname; }, origin: 'http://127.0.0.1:4840' },
    history: { pushState(_s, _t, p) { pathname = p; pushed.push(p); } },
    navigator: { clipboard: { writeText(t) { clipboard.push(t); return Promise.resolve(); } } },
    addEventListener(type, fn) { (listeners.win[type] ??= []).push(fn); },
  };

  return {
    win, doc, root, body, clipboard, pushed,
    get writes() { return writes; },
    get pathname() { return pathname; },
    html: () => html,
    withId(id, props = {}) { const el = element({ id, ...props }); byId.set(id, el); return el; },
    withSelector(sel, props = {}) { const el = element(props); bySelector.set(sel, [...(bySelector.get(sel) ?? []), el]); return el; },
    fire(target, type, event = {}) { for (const fn of listeners[target][type] ?? []) fn({ preventDefault() {}, ...event }); },
    // a click the way delegation sees it: closest('a[data-nav]') is the element only when it is a nav link
    click(el) { this.fire('root', 'click', { target: { closest: sel => (sel.includes('data-nav') ? (el.nav ? el : null) : el) } }); },
    // the browser moving through history: the path changes, then popstate fires
    popTo(p) { pathname = p; this.fire('win', 'popstate'); },
  };
}

export function memoryStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), map: m };
}
