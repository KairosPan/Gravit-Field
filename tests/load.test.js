// tests/load.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCommitted, loadRuntime } from '../js/data/load.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIX = fileURLToPath(new URL('./fixtures', import.meta.url));

test('the committed catalogue: six seeds, ids equal file names, every shelf id exists, four featured', () => {
  const { plugins, shelves } = loadCommitted(ROOT);
  assert.deepEqual(plugins.map(p => p.id), ['coingecko', 'cryptowisser', 'pmpicks', 'ryufin', 'secedgar', 'stocklens']);
  for (const p of plugins) assert.match(p.url, /^https:\/\//);
  const ids = new Set(plugins.map(p => p.id));
  for (const [shelf, list] of Object.entries(shelves)) for (const id of list) assert.ok(ids.has(id), `${shelf} names ${id}`);
  assert.equal(shelves.featured.length, 4);
  assert.deepEqual(shelves.Monitors, []);
});

test('the fixtures load with allowLoopback; without it the http URLs are refused as invalid committed files', () => {
  const { plugins, shelves } = loadCommitted(FIX, { allowLoopback: true });
  assert.deepEqual(plugins.map(p => p.id), ['alpha', 'beta', 'gamma']);
  assert.equal(plugins[1].by, '@beta');
  assert.deepEqual(shelves.featured, ['beta', 'alpha']);
  assert.throws(() => loadCommitted(FIX), /alpha\.json: url/);
});

test('a committed file whose id differs from its name, or that breaks a rule, throws with the file named', () => {
  const root = mkdtempSync(join(tmpdir(), 'gf-'));
  mkdirSync(join(root, 'plugins'));
  writeFileSync(join(root, 'plugins', 'one.json'), JSON.stringify({ id: 'two', name: 'x', kind: 'Data', blurb: 'y', url: 'https://a.example/mcp', by: '@a', needs: 'none' }));
  assert.throws(() => loadCommitted(root), /one\.json: id two does not match/);
  writeFileSync(join(root, 'plugins', 'one.json'), JSON.stringify({ id: 'one', name: 'x', kind: 'Nope', blurb: 'y', url: 'https://a.example/mcp', by: '@a', needs: 'none' }));
  assert.throws(() => loadCommitted(root), /one\.json: kind: one of/);
  const empty = mkdtempSync(join(tmpdir(), 'gf-'));
  mkdirSync(join(empty, 'plugins'));
  assert.deepEqual(loadCommitted(empty), { plugins: [], shelves: { featured: [], Data: [], Monitors: [], Bots: [], Crypto: [], Quant: [] } });
});

test('a runtime dir: wrappers and bare manifests load; a corrupt or invalid file is skipped and logged; a missing dir is created', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'gf-')), 'approved');
  const logged = [];
  assert.deepEqual(loadRuntime(dir, { log: m => logged.push(m) }), []);
  writeFileSync(join(dir, 'ww.json'), JSON.stringify({ manifest: { id: 'ww', name: 'W', kind: 'Quant', blurb: 'wrapped', url: 'https://a.example/mcp', by: '@a', needs: 'none' }, probe: { ok: true } }));
  writeFileSync(join(dir, 'bb.json'), JSON.stringify({ id: 'bb', name: 'B', kind: 'Bots', blurb: 'bare', url: 'https://a.example/mcp', by: '@b', needs: 'none' }));
  writeFileSync(join(dir, 'cc.json'), '{not json');
  writeFileSync(join(dir, 'dd.json'), JSON.stringify({ id: 'dd', name: 'D', kind: 'Nope', blurb: 'bad kind', url: 'https://a.example/mcp', by: '@d', needs: 'none' }));
  const out = loadRuntime(dir, { log: m => logged.push(m) });
  assert.deepEqual(out.map(p => p.id), ['bb', 'ww']);
  assert.equal(logged.length, 2);
  assert.match(logged[0], /cc\.json/);
  assert.match(logged[1], /dd\.json: kind/);
});
