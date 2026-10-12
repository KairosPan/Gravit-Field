// tests/api.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testApp, manifest } from './helpers/http.js';
import { startUpstream } from './helpers/fake-upstream.js';

const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('the catalogue as JSON: the list, one plugin, search by text and kind, the ledger counts, and 404s', async () => {
  const { base, close } = await testApp();
  try {
    const all = await (await fetch(`${base}/api/plugins`)).json();
    assert.deepEqual(all.plugins.map(p => p.id), ['alpha', 'beta', 'gamma']);
    assert.deepEqual(Object.keys(all.plugins[0]).sort(), ['asks', 'blurb', 'by', 'calls', 'homepage', 'icon', 'id', 'kind', 'latencyMs', 'name', 'needs', 'pending', 'probedAt', 'server', 'status', 'toolList', 'tools', 'url', 'writes']);
    const one = await fetch(`${base}/api/plugins/alpha`);
    assert.equal(one.status, 200);
    assert.equal((await one.json()).name, 'Alpha Data');
    assert.equal((await fetch(`${base}/api/plugins/nope`)).status, 404);
    assert.equal((await fetch(`${base}/api/plugins/Bad`)).status, 404);
    assert.deepEqual((await (await fetch(`${base}/api/search?q=beta`)).json()).plugins.map(p => p.id), ['beta']);
    assert.deepEqual((await (await fetch(`${base}/api/search?kind=Monitors`)).json()).plugins.map(p => p.id), ['gamma']);
    assert.deepEqual((await (await fetch(`${base}/api/search?q=&kind=Data`)).json()).plugins.map(p => p.id), ['alpha']);
    assert.deepEqual(await (await fetch(`${base}/api/ledger`)).json(), { total: 0, lastHour: 0, plugins: {} });
    const zz = await fetch(`${base}/api/zzz`);
    assert.equal(zz.status, 404);
    assert.deepEqual(await zz.json(), { error: 'not found' });
    assert.equal((await fetch(`${base}/api/admin/x/approve`, { method: 'POST' })).status, 404, 'admin paths are not the api\'s; without the admin handler they fall through');
  } finally {
    await close();
  }
});

test('POST /api/submissions: the door, its refusals, the body limit and its own bucket', async () => {
  const up = await startUpstream();
  const { base, close } = await testApp({ limits: { submissions: [2, 3_600_000] } });
  try {
    const r = await post(`${base}/api/submissions`, { manifest: manifest('zeta', up.url) });
    assert.equal(r.status, 202);
    const body = await r.json();
    assert.equal(body.id, 'zeta');
    assert.equal(body.status, 'review');
    assert.deepEqual(body.probe.toolList.map(t => t.name), ['echo', 'boom', 'slow']);
    const listed = (await (await fetch(`${base}/api/plugins`)).json()).plugins.find(p => p.id === 'zeta');
    assert.equal(listed.pending, true);
    assert.equal(listed.status, 'up');
    const dup = await post(`${base}/api/submissions`, manifest('zeta', up.url));
    assert.equal(dup.status, 400);
    assert.deepEqual(await dup.json(), { error: { field: 'id', rule: 'a pending submission already has this id' } });
    const third = await post(`${base}/api/submissions`, manifest('eta', up.url));
    assert.equal(third.status, 429, 'two submissions an hour from one address in this test');
    assert.ok(Number(third.headers.get('retry-after')) >= 1);
  } finally {
    await close();
    await up.close();
  }
});

test('POST /api/submissions with bad JSON is 400, over 64 KB is 413, an approved id is 400 with the rule', async () => {
  const { base, close } = await testApp();
  try {
    const bad = await post(`${base}/api/submissions`, '{not json');
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: 'invalid JSON' });
    const big = await post(`${base}/api/submissions`, JSON.stringify({ manifest: { blurb: 'x'.repeat(70 * 1024) } }));
    assert.equal(big.status, 413);
    const taken = await post(`${base}/api/submissions`, { manifest: manifest('alpha', 'https://a.example/mcp') });
    assert.equal(taken.status, 400);
    assert.deepEqual(await taken.json(), { error: { field: 'id', rule: 'an approved plugin already has this id' } });
  } finally {
    await close();
  }
});
