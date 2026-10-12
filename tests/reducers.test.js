// tests/reducers.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reducers as R, initialState, persist, accept, SEED_VERSION } from '../js/reducers/discover.js';

test('initialState: defaults, the route carried in, the drawer open on the route\'s plugin, bad saved values sanitised', () => {
  const s = initialState();
  assert.deepEqual(s, { v: 1, theme: 'system', route: { shelf: null, plugin: null }, query: '', installedOnly: false, drawer: null, create: null, toast: null, installed: [], client: 'Claude Code', copied: null, toolsExpanded: false });
  const r = initialState({ theme: 'black', installed: ['a', 7, 'b'], client: 'Cursor', route: { shelf: 'data', plugin: 'a' } });
  assert.equal(r.theme, 'black');
  assert.deepEqual(r.installed, ['a', 'b']);
  assert.equal(r.client, 'Cursor');
  assert.deepEqual(r.route, { shelf: 'data', plugin: 'a' });
  assert.equal(r.drawer, 'a');
  assert.equal(initialState({ theme: 'neon', client: 'Vim', installed: 'x' }).theme, 'system');
  assert.equal(initialState({ theme: 'neon', client: 'Vim', installed: 'x' }).client, 'Claude Code');
  assert.deepEqual(initialState({ installed: 'x' }).installed, []);
  assert.deepEqual(persist({ ...s, theme: 'cream', installed: ['a'], client: 'Codex', query: 'secret', drawer: 'a' }), { v: 1, theme: 'cream', installed: ['a'], client: 'Codex' });
  assert.equal(accept({ v: SEED_VERSION }), true);
  assert.equal(accept({ v: 0 }), false);
  assert.equal(accept(null), false);
});

test('nav sets the route and the drawer and closes Create; openPlugin and closeDrawer keep the route in step', () => {
  const s = initialState();
  const d = R.nav({ ...s, create: {} }, { shelf: 'data', plugin: 'a' });
  assert.deepEqual([d.route, d.drawer, d.create], [{ shelf: 'data', plugin: 'a' }, 'a', null]);
  const o = R.openPlugin(s, 'b');
  assert.deepEqual([o.route, o.drawer], [{ shelf: null, plugin: 'b' }, 'b']);
  assert.equal(R.openPlugin(o, 'b'), o, 'the same drawer again changes nothing');
  const c = R.closeDrawer(o);
  assert.deepEqual([c.route, c.drawer], [{ shelf: null, plugin: null }, null]);
  assert.equal(R.closeDrawer(c), c);
  assert.equal(R.openPlugin({ ...o, toolsExpanded: true }, 'c').toolsExpanded, false, 'a new drawer starts folded');
});

test('install and uninstall keep the local list and raise a toast; a repeat is a no-op', () => {
  const s = initialState();
  const i = R.install(s, { id: 'a', name: 'Alpha' });
  assert.deepEqual(i.installed, ['a']);
  assert.deepEqual(i.toast, { text: 'Alpha installed' });
  assert.equal(R.install(i, { id: 'a', name: 'Alpha' }), i);
  const u = R.uninstall(i, 'a');
  assert.deepEqual(u.installed, []);
  assert.equal(u.toast, null);
  assert.equal(R.uninstall(u, 'a'), u);
  assert.equal(R.dismissToast(i).toast, null);
  assert.equal(R.dismissToast(u), u);
});

test('query, My plugins, Create, client, copied, theme and the tool fold', () => {
  const s = initialState();
  assert.equal(R.setQuery(s, 'btc').query, 'btc');
  assert.equal(R.setQuery(s, 'x'.repeat(300)).query.length, 200);
  assert.equal(R.setQuery(s, ''), s);
  assert.equal(R.setQuery(s, null), s);
  assert.equal(R.toggleInstalledOnly(s).installedOnly, true);
  const open = R.openCreate(R.openPlugin(s, 'a'));
  assert.deepEqual(open.create, {});
  assert.equal(open.drawer, null, 'one overlay at a time');
  assert.equal(open.route.plugin, null);
  assert.equal(R.closeCreate(open).create, null);
  assert.equal(R.closeCreate(s), s);
  assert.equal(R.setClient(s, 'Codex').client, 'Codex');
  assert.equal(R.setClient(s, 'Vim'), s);
  assert.equal(R.setClient(s, 'Claude Code'), s);
  assert.equal(R.setCopied(s, 'line').copied, 'line');
  assert.equal(R.setCopied(R.setCopied(s, 'line'), null).copied, null);
  assert.equal(R.setCopied(s, null), s);
  assert.equal(R.setTheme(s, 'black').theme, 'black');
  assert.equal(R.setTheme(s, 'neon'), s);
  assert.equal(R.setTheme(s, 'system'), s);
  assert.equal(R.toggleTools(s).toolsExpanded, true);
});
