// tests/admin.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { testApp, manifest } from './helpers/http.js';
import { startUpstream } from './helpers/fake-upstream.js';
import { submitManifest } from '../js/door.js';

const far = { 'x-forwarded-for': '203.0.113.9' };

test('loopback sees the queue: empty, then a submission as a card with its table and keys; the ledger at the foot', async () => {
  const up = await startUpstream();
  const { app, base, close } = await testApp();
  try {
    const empty = await (await fetch(`${base}/admin`)).text();
    assert.match(empty, /<title>Admin · Gravity Field<\/title>/);
    assert.match(empty, /class="grid-title">In review<\/div><div class="empty">Nothing in review<\/div>/);
    assert.match(empty, /class="grid-title">Ledger<\/div><div class="kv-list"><div class="kv"><span class="kv-k">Calls<\/span><span class="kv-v">0<\/span>/);
    assert.doesNotMatch(empty, /type="module"/);
    await submitManifest(app.services, manifest('zeta', up.url, { tools: ['echo', 'nope'] }), 'mcp');
    const h = await (await fetch(`${base}/admin`)).text();
    assert.match(h, /class="pcard in-grid" data-action="openPlugin" data-id="zeta"/);
    assert.match(h, /<span class="kv-k">Via<\/span><span class="kv-v">mcp</);
    assert.match(h, /<span class="kv-k">Probe<\/span><span class="kv-v"><span class="chip up">up<\/span> fake-upstream 0\.1\.0 · \d+ ms</);
    assert.match(h, /<span class="kv-k">Tools found<\/span><span class="kv-v"><span class="mono">echo · boom · slow<\/span>/);
    assert.match(h, /<span class="kv-k">Claimed<\/span><span class="kv-v"><span class="mono">echo · <span class="down">nope<\/span><\/span>/);
    assert.match(h, /<form method="post" action="\/api\/admin\/zeta\/approve"><button type="submit" class="btn-primary small">Approve<\/button><\/form>/);
    assert.match(h, /<form method="post" action="\/api\/admin\/zeta\/reject" class="reject"><input class="input small" name="reason" aria-label="Reason" placeholder="Reason"><button type="submit" class="btn-danger">Reject<\/button><\/form>/);
    assert.match(await (await fetch(`${base}/admin?error=the+probe+failed`)).text(), /<div class="field-error">the probe failed<\/div>/);
  } finally {
    await close();
    await up.close();
  }
});

test('the gate: not loopback is 403 without a token; a token visit sets the cookie; the cookie then admits; a wrong token does not', async () => {
  const { base, close } = await testApp({ trustProxy: true });
  try {
    assert.equal((await fetch(`${base}/admin`, { headers: far })).status, 403);
    assert.equal((await fetch(`${base}/admin?token=abc`, { headers: far })).status, 403, 'no token is configured, so none can match');
  } finally {
    await close();
  }
  const withToken = await testApp({ trustProxy: true, adminToken: 's3cret' });
  try {
    const { base } = withToken;
    assert.equal((await fetch(`${base}/admin`, { headers: far })).status, 403);
    assert.equal((await fetch(`${base}/admin?token=wrong`, { headers: far })).status, 403);
    const ok = await fetch(`${base}/admin?token=s3cret`, { headers: far });
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get('set-cookie');
    assert.match(cookie, /^gf_admin=s3cret; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Lax$/);
    assert.equal((await fetch(`${base}/admin`, { headers: { ...far, cookie: 'gf_admin=s3cret' } })).status, 200);
    assert.equal((await fetch(`${base}/admin`, { headers: { ...far, cookie: 'gf_admin=nope' } })).status, 403);
    assert.equal((await fetch(`${base}/api/admin/zeta/approve`, { method: 'POST', headers: far })).status, 403);
    assert.equal((await fetch(`${base}/admin`)).status, 200, 'loopback needs no token');
  } finally {
    await withToken.close();
  }
});

test('approve and reject: JSON for a client, a redirect for a browser; the approved plugin joins the catalogue', async () => {
  const up = await startUpstream();
  const { app, base, close } = await testApp();
  try {
    await submitManifest(app.services, manifest('zeta', up.url, { tools: ['echo', 'nope'] }), 'mcp');
    await submitManifest(app.services, manifest('eta', up.url), 'form');
    await submitManifest(app.services, manifest('iota', up.url), 'form');
    const no = await fetch(`${base}/api/admin/zeta/approve`, { method: 'POST' });
    assert.equal(no.status, 409);
    assert.deepEqual(await no.json(), { ok: false, error: 'the server does not list: nope' });
    const yes = await fetch(`${base}/api/admin/eta/approve`, { method: 'POST' });
    assert.equal(yes.status, 200);
    assert.deepEqual(await yes.json(), { ok: true, id: 'eta' });
    const listed = (await (await fetch(`${base}/api/plugins`)).json()).plugins.find(p => p.id === 'eta');
    assert.equal(listed.pending, false);
    assert.equal(listed.status, 'up');
    assert.ok(existsSync(join(app.services.options.dataDir, 'approved', 'eta.json')));
    assert.match(await (await fetch(`${base}/admin`)).text(), /class="grid-title">Approved here<\/div><div class="kv-list"><div class="kv"><span class="kv-k">eta<\/span><span class="kv-v"><span class="mono">[^<]*approved\/eta\.json<\/span>/);
    const browser = await fetch(`${base}/api/admin/zeta/approve`, { method: 'POST', headers: { accept: 'text/html' }, redirect: 'manual' });
    assert.equal(browser.status, 303);
    assert.equal(browser.headers.get('location'), '/admin?error=the%20server%20does%20not%20list%3A%20nope');
    const rj = await fetch(`${base}/api/admin/iota/reject`, { method: 'POST', headers: { accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded' }, body: 'reason=no+such+server', redirect: 'manual' });
    assert.equal(rj.status, 303);
    assert.equal(rj.headers.get('location'), '/admin');
    assert.ok(existsSync(join(app.services.options.dataDir, 'rejected', 'iota.json')));
    assert.equal(app.services.submissions.has('iota'), false);
    assert.deepEqual(await (await fetch(`${base}/api/admin/nope/approve`, { method: 'POST' })).json(), { ok: false, error: 'no such submission' });
    assert.equal((await fetch(`${base}/api/admin/BAD/approve`, { method: 'POST' })).status, 404);
  } finally {
    await close();
    await up.close();
  }
});

test('a request a proxy on this machine forwarded is not local, even when no proxy is trusted', async () => {
  const { base, close } = await testApp();
  try {
    assert.equal((await fetch(`${base}/admin`, { headers: { 'x-forwarded-for': '203.0.113.9' } })).status, 403);
    assert.equal((await fetch(`${base}/admin`, { headers: { forwarded: 'for=203.0.113.9' } })).status, 403);
    assert.equal((await fetch(`${base}/admin`)).status, 200);
  } finally {
    await close();
  }
});
