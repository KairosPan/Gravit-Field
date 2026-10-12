// tests/registry.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegistry } from '../js/registry.js';

const FIX = fileURLToPath(new URL('./fixtures', import.meta.url));
const probeOk = (name = 'srv') => ({ ok: true, server: { name, version: '1' }, toolList: [{ name: 'echo', description: '', inputSchema: { type: 'object' } }], latencyMs: 3, transport: 'http' });

function dataDirWith(files) {
  const dataDir = mkdtempSync(join(tmpdir(), 'gf-'));
  mkdirSync(join(dataDir, 'approved'));
  for (const [name, json] of Object.entries(files)) writeFileSync(join(dataDir, 'approved', name), JSON.stringify(json));
  return dataDir;
}

test('reload: the committed catalogue plus runtime approvals, committed winning on an id clash; bare entries until a probe', () => {
  const dataDir = dataDirWith({
    'ww.json': { manifest: { id: 'ww', name: 'W', kind: 'Quant', blurb: 'wrapped', url: 'https://a.example/mcp', by: '@a', needs: 'none' }, probe: { ok: true } },
    'alpha.json': { manifest: { id: 'alpha', name: 'IMPOSTOR', kind: 'Data', blurb: 'x', url: 'https://a.example/mcp', by: '@a', needs: 'none' } },
  });
  const r = createRegistry({ root: FIX, dataDir, probe: async () => probeOk(), allowLoopback: true });
  r.reload();
  assert.deepEqual(r.list().map(p => p.id), ['alpha', 'beta', 'gamma', 'ww']);
  assert.equal(r.byId('alpha').name, 'Alpha Data');
  assert.deepEqual(r.byId('ww'), { id: 'ww', name: 'W', kind: 'Quant', blurb: 'wrapped', url: 'https://a.example/mcp', homepage: null, by: '@a', icon: null, needs: 'none', writes: ['message'], asks: [], tools: [], server: null, toolList: [], status: 'unknown', probedAt: null, latencyMs: null });
  assert.equal(r.has('ww'), true);
  assert.equal(r.has('zz'), false);
  assert.equal(r.byId('zz'), null);
  assert.deepEqual(r.shelves().featured, ['beta', 'alpha']);
});

test('setProbe records up and down; a down keeps the last tool list; setStatus flips status alone; probeAll runs the injected probe over every entry', async () => {
  const seen = [];
  let t = 50;
  const r = createRegistry({ root: FIX, dataDir: mkdtempSync(join(tmpdir(), 'gf-')), probe: async (url, opts) => { seen.push([url, opts.allowLoopback]); return probeOk(url); }, allowLoopback: true, now: () => t });
  r.reload();
  r.setProbe('alpha', probeOk('alpha-srv'));
  let a = r.byId('alpha');
  assert.equal(a.status, 'up');
  assert.equal(a.server.name, 'alpha-srv');
  assert.equal(a.probedAt, 50);
  assert.equal(a.latencyMs, 3);
  assert.equal(a.toolList.length, 1);
  t = 60;
  r.setProbe('alpha', { ok: false, error: 'boom' });
  a = r.byId('alpha');
  assert.equal(a.status, 'down');
  assert.equal(a.probedAt, 60);
  assert.equal(a.toolList.length, 1, 'the last known tools stay while the line is down');
  assert.equal(a.error, 'boom');
  r.setStatus('alpha', 'up');
  assert.equal(r.byId('alpha').status, 'up');
  await r.probeAll();
  assert.deepEqual(seen.map(s => s[1]), [true, true, true]);
  assert.deepEqual(r.list().map(p => p.status), ['up', 'up', 'up']);
  assert.equal(r.byId('beta').server.name, 'http://127.0.0.1:1/mcp');
});

test('the registry logs each failed probe with its detail, for the operator, and can probe one plugin on demand', async () => {
  const logged = [];
  let n = 0;
  const probe = async url => (n++ === 0 ? { ok: false, error: 'the server answered HTTP 403', detail: 'SSE error: Non-200 status code (403)' } : { ok: true, server: { name: 's', version: '1' }, toolList: [{ name: 'echo', description: '', inputSchema: { type: 'object' } }], latencyMs: 1, transport: 'http' });
  const r = createRegistry({ root: FIX, dataDir: mkdtempSync(join(tmpdir(), 'gf-')), probe, allowLoopback: true, log: m => logged.push(m) });
  r.reload();
  r.setProbe('alpha', await probe('x'));
  assert.equal(logged.length, 1);
  assert.match(logged[0], /^probe alpha: the server answered HTTP 403 · SSE error: Non-200 status code \(403\)$/);
  await r.probeOne('alpha');
  assert.equal(r.byId('alpha').status, 'up');
  assert.deepEqual(r.byId('alpha').toolList.map(t => t.name), ['echo']);
  assert.equal(await r.probeOne('nope'), null);
});
