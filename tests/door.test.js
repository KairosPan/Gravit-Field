// tests/door.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submitManifest, approveSubmission, rejectSubmission, manifestFromForm } from '../js/door.js';
import { testApp, manifest } from './helpers/http.js';
import { startUpstream } from './helpers/fake-upstream.js';

test('submitManifest validates, refuses collisions, probes, and stores with the missing tools listed', async () => {
  const up = await startUpstream();
  const { app, close } = await testApp();
  try {
    const bad = await submitManifest(app.services, { ...manifest('zeta', up.url), kind: 'Nope' }, 'form');
    assert.deepEqual(bad.error.field, 'kind');
    assert.deepEqual((await submitManifest(app.services, manifest('alpha', up.url), 'form')).error, { field: 'id', rule: 'an approved plugin already has this id' });
    const r = await submitManifest(app.services, manifest('zeta', up.url, { tools: ['echo', 'nope'] }), 'mcp');
    assert.equal(r.ok, true);
    assert.equal(r.id, 'zeta');
    assert.equal(r.status, 'review');
    assert.deepEqual(r.probe.toolList.map(t => t.name), ['echo', 'boom', 'slow']);
    assert.deepEqual(r.probe.missing, ['nope']);
    assert.equal(r.record.via, 'mcp');
    assert.equal(app.services.submissions.has('zeta'), true);
    assert.deepEqual((await submitManifest(app.services, manifest('zeta', up.url), 'form')).error, { field: 'id', rule: 'a pending submission already has this id' });
    const dead = await submitManifest(app.services, manifest('eta', 'http://127.0.0.1:1/mcp'), 'form');
    assert.equal(dead.ok, true, 'a failed probe is stored, not refused');
    assert.equal(dead.probe.ok, false);
    assert.deepEqual(dead.probe.missing, []);
    const outside = await submitManifest(app.services, manifest('theta', 'https://10.0.0.8/mcp'), 'form');
    assert.equal(outside.ok, true);
    assert.equal(outside.probe.error, 'an address inside a network', 'the probe refused it without connecting; the operator sees why');
  } finally {
    await close();
    await up.close();
  }
});

test('approveSubmission probes again and needs every claimed tool; then the plugin is in the registry; reject moves the file', async () => {
  const up = await startUpstream();
  const { app, close } = await testApp();
  try {
    await submitManifest(app.services, manifest('zeta', up.url, { tools: ['echo', 'nope'] }), 'form');
    const no = await approveSubmission(app.services, 'zeta');
    assert.deepEqual(no, { ok: false, error: 'the server does not list: nope' });
    assert.equal(app.services.submissions.has('zeta'), true, 'still pending');
    await submitManifest(app.services, manifest('eta', up.url), 'form');
    const yes = await approveSubmission(app.services, 'eta');
    assert.equal(yes.ok, true);
    assert.equal(yes.record.approvedAt > 0, true);
    assert.equal(app.services.registry.has('eta'), true);
    assert.equal(app.services.registry.byId('eta').status, 'up');
    assert.deepEqual(app.services.registry.byId('eta').toolList.map(t => t.name), ['echo', 'boom', 'slow']);
    assert.equal(app.services.submissions.has('eta'), false);
    assert.deepEqual(await approveSubmission(app.services, 'eta'), { ok: false, error: 'no such submission' });
    await submitManifest(app.services, manifest('iota', 'http://127.0.0.1:1/mcp'), 'form');
    const down = await approveSubmission(app.services, 'iota');
    assert.equal(down.ok, false);
    assert.match(down.error, /^the probe failed: /);
    const rj = rejectSubmission(app.services, 'iota', 'no such server');
    assert.equal(rj.ok, true);
    assert.equal(rj.record.reason, 'no such server');
    assert.deepEqual(rejectSubmission(app.services, 'iota', 'x'), { ok: false, error: 'no such submission' });
  } finally {
    await close();
    await up.close();
  }
});

test('manifestFromForm: the id is the name\'s slug, asks split by line, tools empty, needs none', () => {
  const m = manifestFromForm(new URLSearchParams('name= Moat Score! &kind=Data&blurb=Moat scores, ask by ticker&url=https://moat.example/mcp&homepage=&by=you&icon=&asks=“Is KO wide?”%0A%0A“Compare KO and PEP”'));
  assert.deepEqual(m, { id: 'moat-score', name: 'Moat Score!', kind: 'Data', blurb: 'Moat scores, ask by ticker', url: 'https://moat.example/mcp', homepage: null, by: 'you', icon: null, needs: 'none', writes: ['message'], asks: ['“Is KO wide?”', '“Compare KO and PEP”'], tools: [] });
  assert.equal(manifestFromForm({ name: '123 Go' }).id, 'go', 'a slug starts with a letter');
  assert.equal(manifestFromForm({ name: '' }).id, '');
});

test('the door carries the source: the probe runs under its share, the record keeps it, and a full queue or a full share answers by rule', async () => {
  const up = await startUpstream();
  const seen = [];
  const { app, close } = await testApp({ probe: async (url, o) => { seen.push(o); return { ok: true, server: { name: 's', version: '1' }, toolList: [{ name: 'echo', description: '', inputSchema: { type: 'object' } }], latencyMs: 1, transport: 'http' }; } });
  try {
    const r = await submitManifest(app.services, manifest('zeta', up.url), 'form', { from: 'k1' });
    assert.equal(r.ok, true);
    assert.equal(app.services.submissions.get('zeta').from, 'k1');
    for (const id of ['eta', 'theta']) assert.equal((await submitManifest(app.services, manifest(id, up.url), 'form', { from: 'k1' })).ok, true);
    assert.deepEqual((await submitManifest(app.services, manifest('iota', up.url), 'form', { from: 'k1' })).error, { field: 'manifest', rule: '3 of your submissions are already in review' });
    assert.equal(app.services.submissions.has('iota'), false);
    const full = { ...app.services, submissions: { ...app.services.submissions, add: () => { throw Object.assign(new Error('the review queue is full'), { code: 'EFULL' }); } } };
    assert.deepEqual((await submitManifest(full, manifest('kappa', up.url), 'form', { from: 'k2' })).error, { field: 'manifest', rule: 'the review queue is full' });
  } finally {
    await close();
    await up.close();
  }
});

test('the api door names the source of a submission without storing the address', async () => {
  const up = await startUpstream();
  const { app, base, close } = await testApp();
  try {
    const r = await fetch(`${base}/api/submissions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(manifest('zeta', up.url)) });
    assert.equal(r.status, 202);
    const rec = app.services.submissions.get('zeta');
    assert.equal(rec.from, app.services.sourceOf('127.0.0.1'));
    assert.doesNotMatch(JSON.stringify(rec), /127\.0\.0\.1(?!:)/, 'the stored record holds a digest, not the address');
  } finally {
    await close();
    await up.close();
  }
});

test('two submissions racing for one id: one is stored, the other is refused, and the first is never overwritten', async () => {
  const slow = async () => { await new Promise(r => setTimeout(r, 50)); return { ok: true, server: { name: 's', version: '1' }, toolList: [{ name: 'echo', description: '', inputSchema: { type: 'object' } }], latencyMs: 50, transport: 'http' }; };
  const { app, close } = await testApp({ probe: slow });
  try {
    const [a, b] = await Promise.all([
      submitManifest(app.services, manifest('zeta', 'https://first.example/mcp'), 'form', { from: 'k1' }),
      submitManifest(app.services, manifest('zeta', 'https://second.example/mcp'), 'form', { from: 'k2' }),
    ]);
    assert.deepEqual([a.ok, b.ok], [true, false]);
    assert.deepEqual(b.error, { field: 'id', rule: 'a pending submission already has this id' });
    assert.equal(app.services.submissions.get('zeta').manifest.url, 'https://first.example/mcp');
    assert.equal(app.services.submissions.reserve('zeta'), false, 'the reservation gave way to the stored file');
  } finally {
    await close();
  }
});

test('a plugin approved while a submission of its id was probing is not shadowed by it', async () => {
  let approve;
  const gate = new Promise(r => { approve = r; });
  const probe = async url => { if (url.includes('late')) await gate; return { ok: true, server: { name: 's', version: '1' }, toolList: [{ name: 'echo', description: '', inputSchema: { type: 'object' } }], latencyMs: 1, transport: 'http' }; };
  const { app, close } = await testApp({ probe });
  try {
    await submitManifest(app.services, manifest('omega', 'https://early.example/mcp'), 'form');
    app.services.submissions.reject('omega', 'x');
    const racing = submitManifest(app.services, manifest('omega', 'https://late.example/mcp'), 'form');
    const has = app.services.registry.has;
    app.services.registry.has = id => id === 'omega' || has(id);
    approve();
    assert.deepEqual((await racing).error, { field: 'id', rule: 'an approved plugin already has this id' });
    assert.equal(app.services.submissions.has('omega'), false);
  } finally {
    await close();
  }
});

test('an approval whose submission was rejected while it probed answers no such submission and lists nothing', async () => {
  let go;
  const gate = new Promise(r => { go = r; });
  let n = 0;
  const probe = async () => { if (n++ === 1) await gate; return { ok: true, server: { name: 's', version: '1' }, toolList: [{ name: 'echo', description: '', inputSchema: { type: 'object' } }], latencyMs: 1, transport: 'http' }; };
  const { app, close } = await testApp({ probe });
  try {
    await submitManifest(app.services, manifest('psi', 'https://p.example/mcp'), 'form');
    const approving = approveSubmission(app.services, 'psi');
    rejectSubmission(app.services, 'psi', 'x');
    go();
    assert.deepEqual(await approving, { ok: false, error: 'no such submission' });
    assert.equal(app.services.registry.has('psi'), false);
  } finally {
    await close();
  }
});
