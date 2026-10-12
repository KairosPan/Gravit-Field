// tests/client.test.js — boot() against a fake window: what the person sees after typing, clicking, pressing keys and coming back
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, KEY } from '../js/client.js';
import { fakeWindow, memoryStorage } from './helpers/fake-dom.js';
import { makeCatalogue } from '../js/data/catalogue.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const P = (id, kind, extra = {}) => ({ id, name: id[0].toUpperCase() + id.slice(1), kind, blurb: `${id} in one line`, url: `https://${id}.example/mcp`, homepage: null, by: `@${id}`, icon: null, needs: 'none', writes: ['message'], asks: [], tools: ['echo'], server: null, toolList: [{ name: 'echo', description: '', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }], status: 'up', probedAt: 1, latencyMs: 1, ...extra });
const catalogue = makeCatalogue({ plugins: [P('alpha', 'Data'), P('beta', 'Crypto')], shelves: { featured: ['alpha'], Data: ['alpha'], Crypto: ['beta'] }, origin: 'http://127.0.0.1:4840', now: 2 }).toJSON();

test('boot renders the shelves from the embedded catalogue; the route comes from the path', () => {
  const f = fakeWindow({ catalogue });
  const store = boot(f.win);
  assert.match(f.html(), /class="shelf-title">Featured</);
  assert.equal(f.writes, 1);
  assert.deepEqual(store.get().route, { shelf: null, plugin: null });
  const g = fakeWindow({ catalogue, path: '/p/beta' });
  boot(g.win);
  assert.match(g.html(), /<aside class="drawer" aria-label="Beta">/);
  store.timers.clear();
});

test('typing in the search re-renders a results grid and keeps the focus in the search box', () => {
  const f = fakeWindow({ catalogue });
  const dq = f.withId('dq', { tagName: 'INPUT', dataset: { action: 'query' } });
  const store = boot(f.win);
  dq.focus();
  dq.value = 'bet';
  f.fire('root', 'input', { target: dq });
  assert.equal(store.get().query, 'bet');
  assert.match(f.html(), /class="grid-title">1 result</);
  assert.equal(f.doc.activeElement, dq, 'the box keeps focus across the render');
  store.timers.clear();
});

test('a card opens its drawer and pushes /p/<id>; Escape closes it and pushes /; a nav link pushes its path; popstate follows the browser back', () => {
  const f = fakeWindow({ catalogue });
  const close = f.withSelector('.drawer .close-key', { tagName: 'BUTTON', presentIf: /<aside class="drawer"/ });
  const store = boot(f.win);
  f.click({ dataset: { action: 'openPlugin', id: 'alpha' } });
  assert.equal(store.get().drawer, 'alpha');
  assert.equal(f.doc.activeElement, close, 'the drawer that just opened takes focus on its close key');
  assert.deepEqual(f.pushed, ['/p/alpha']);
  assert.match(f.html(), /<aside class="drawer" aria-label="Alpha">/);
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.equal(store.get().drawer, null);
  assert.deepEqual(f.pushed, ['/p/alpha', '/']);
  assert.doesNotMatch(f.html(), /<aside/);
  f.click({ nav: true, href: '/discover/crypto' });
  assert.equal(f.pathname, '/discover/crypto');
  assert.match(f.html(), /class="grid-title">Crypto</);
  f.popTo('/');
  assert.equal(store.get().route.shelf, null);
  assert.match(f.html(), /class="shelf-title">Featured</);
  assert.deepEqual(f.pushed, ['/p/alpha', '/', '/discover/crypto'], 'coming back pushes nothing');
  store.timers.clear();
});

test('install is remembered across a reboot with the same storage and raises a toast that leaves; a stale or throwing storage boots fresh', async () => {
  const storage = memoryStorage();
  const f = fakeWindow({ catalogue, storage });
  const store = boot(f.win, { toastMs: 20 });
  f.click({ dataset: { action: 'install', id: 'alpha' } });
  assert.deepEqual(store.get().installed, ['alpha']);
  assert.match(f.html(), /class="toast" role="status">Alpha installed</);
  assert.deepEqual(JSON.parse(storage.getItem(KEY)), { v: 1, theme: 'system', installed: ['alpha'], client: 'Claude Code' });
  await sleep(40);
  assert.doesNotMatch(f.html(), /class="toast"/);
  const g = fakeWindow({ catalogue, storage });
  const again = boot(g.win);
  assert.deepEqual(again.get().installed, ['alpha']);
  assert.match(g.html(), /class="pkey-done"/);
  const stale = fakeWindow({ catalogue, storage: memoryStorage({ [KEY]: JSON.stringify({ v: 0, installed: ['alpha'] }) }) });
  assert.deepEqual(boot(stale.win).get().installed, []);
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  const t = fakeWindow({ catalogue, storage: throwing });
  const ts = boot(t.win);
  f.click({ dataset: { action: 'install', id: 'beta' } });
  assert.match(t.html(), /Featured/);
  store.timers.clear(); again.timers.clear(); ts.timers.clear();
});

test('the theme key sets the document attribute and remembers it; copy writes the clipboard and shows Copied for a moment; the client switch sticks', async () => {
  const storage = memoryStorage();
  const f = fakeWindow({ catalogue, storage });
  const store = boot(f.win, { copiedMs: 20 });
  f.click({ dataset: { action: 'setTheme', value: 'black' } });
  assert.equal(f.doc.documentElement.dataset.theme, 'black');
  assert.equal(storage.getItem('gravity-field.theme'), 'black');
  assert.match(f.html(), /data-value="cream"/);
  f.click({ dataset: { action: 'setTheme', value: 'system' } });
  assert.equal(f.doc.documentElement.dataset.theme, undefined);
  assert.equal(storage.getItem('gravity-field.theme'), null);
  f.click({ dataset: { action: 'openPlugin', id: 'alpha' } });
  f.click({ dataset: { action: 'copy', key: 'line', copy: 'claude mcp add --transport http gravity-field http://127.0.0.1:4840/mcp' } });
  assert.deepEqual(f.clipboard, ['claude mcp add --transport http gravity-field http://127.0.0.1:4840/mcp']);
  assert.match(f.html(), /data-key="line" data-copy="[^"]+">Copied</);
  await sleep(40);
  assert.match(f.html(), /data-key="line" data-copy="[^"]+">Copy</);
  f.fire('root', 'change', { target: { dataset: { action: 'setClient' }, value: 'Codex' } });
  assert.equal(store.get().client, 'Codex');
  assert.match(f.html(), /snippet-file mono">~\/\.codex\/config\.toml/);
  assert.equal(JSON.parse(storage.getItem(KEY)).client, 'Codex');
  store.timers.clear();
});

test('Create opens over the page and Escape closes it first; opening it from a drawer closes the drawer and pushes /', () => {
  const f = fakeWindow({ catalogue, path: '/p/alpha' });
  const close = f.withSelector('.modal .close-key', { tagName: 'BUTTON', presentIf: /modal-scrim/ });
  const store = boot(f.win);
  f.click({ dataset: { action: 'openCreate' } });
  assert.deepEqual(store.get().create, {});
  assert.equal(f.doc.activeElement, close, 'the dialog takes focus on its close key');
  assert.equal(store.get().drawer, null);
  assert.deepEqual(f.pushed, ['/']);
  assert.match(f.html(), /aria-label="Gravity Field MCP"/);
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.equal(store.get().create, null);
  assert.doesNotMatch(f.html(), /modal-scrim/);
  store.timers.clear();
});

test('Enter or Space on a focused card opens it, as a button would; keys on a real button or an input are left to the browser', () => {
  const f = fakeWindow({ catalogue });
  const store = boot(f.win);
  f.fire('root', 'keydown', { key: 'Enter', target: { tagName: 'DIV', dataset: { action: 'openPlugin', id: 'alpha' } } });
  assert.equal(store.get().drawer, 'alpha');
  f.fire('doc', 'keydown', { key: 'Escape' });
  f.fire('root', 'keydown', { key: ' ', target: { tagName: 'DIV', dataset: { action: 'openPlugin', id: 'beta' } } });
  assert.equal(store.get().drawer, 'beta');
  f.fire('doc', 'keydown', { key: 'Escape' });
  f.fire('root', 'keydown', { key: 'Enter', target: { tagName: 'BUTTON', dataset: { action: 'install', id: 'alpha' } } });
  f.fire('root', 'keydown', { key: 'Enter', target: { tagName: 'INPUT', dataset: { action: 'query' } } });
  assert.deepEqual(store.get().installed, [], 'a native button fires its own click');
  store.timers.clear();
});

test('typing through an input method does not re-render mid-composition; the composed text searches when it ends', () => {
  const f = fakeWindow({ catalogue });
  const dq = f.withId('dq', { tagName: 'INPUT', dataset: { action: 'query' } });
  const store = boot(f.win);
  const before = f.writes;
  dq.value = '比';
  f.fire('root', 'input', { target: dq, isComposing: true });
  assert.equal(f.writes, before, 'a render now would replace the input under the input method');
  assert.equal(store.get().query, '');
  dq.value = 'beta';
  f.fire('root', 'compositionend', { target: dq });
  assert.equal(store.get().query, 'beta');
  assert.match(f.html(), /class="grid-title">1 result</);
  store.timers.clear();
});
