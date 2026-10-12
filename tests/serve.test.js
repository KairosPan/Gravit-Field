// tests/serve.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, contentType } from '../serve.js';
import { testApp } from './helpers/http.js';

function listen(app) {
  return new Promise(resolve => app.listen(0, '127.0.0.1', () => resolve(app.address().port)));
}

test('contentType maps the files the site serves', () => {
  assert.equal(contentType('x.html'), 'text/html; charset=utf-8');
  assert.equal(contentType('js/client.js'), 'text/javascript; charset=utf-8');
  assert.equal(contentType('css/app.css'), 'text/css; charset=utf-8');
  assert.equal(contentType('x.bin'), 'application/octet-stream');
});

test('static files under css/ and js/ are served with no cache; anything else under them is 404; the root is not reachable through them', async () => {
  const app = createApp({ probeOnBoot: false });
  const port = await listen(app);
  try {
    const css = await fetch(`http://127.0.0.1:${port}/css/tokens.css`);
    assert.equal(css.status, 200);
    assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8');
    assert.equal(css.headers.get('cache-control'), 'no-store');
    assert.match(await css.text(), /--surface: #ffffff/);
    assert.equal((await fetch(`http://127.0.0.1:${port}/js/nope.js`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/css/../package.json`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/css/%2e%2e/package.json`)).status, 404);
  } finally {
    app.close();
  }
});

test('healthz answers ok; a malformed escape is 400 and the server keeps serving; an unknown route is 404', async () => {
  const app = createApp({ probeOnBoot: false });
  const port = await listen(app);
  try {
    const h = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(h.status, 200);
    assert.equal((await h.json()).ok, true);
    assert.equal((await fetch(`http://127.0.0.1:${port}/%E0%A4%A`)).status, 400);
    assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${port}/nope`)).status, 404);
  } finally {
    app.close();
  }
});

test('createApp exposes its services and a ready promise; healthz counts the plugins by status', async () => {
  const { app, base, close } = await testApp();
  try {
    await app.ready;
    for (const k of ['registry', 'submissions', 'ledger', 'gateway', 'limiters', 'probe', 'origin', 'catalogue']) assert.ok(app.services[k], k);
    assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), { ok: true, plugins: 3, up: 0, down: 3 }, 'nothing probed yet: the fixtures are down until a probe passes');
    app.services.registry.setStatus('alpha', 'up');
    assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), { ok: true, plugins: 3, up: 1, down: 2 });
  } finally {
    await close();
  }
});

test('the request bucket answers 429 with retry-after once it is empty', async () => {
  const { base, close } = await testApp({ limits: { requests: [3, 60_000] } });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await fetch(`${base}/healthz`)).status, 200);
    const r = await fetch(`${base}/healthz`);
    assert.equal(r.status, 429);
    assert.equal(r.headers.get('retry-after'), '20');
  } finally {
    await close();
  }
});

test('the catalogue a request sees: fixtures, pending entries, calls, and the origin from the Host header or GF_PUBLIC_ORIGIN', async () => {
  const { app, close } = await testApp();
  try {
    const req = { headers: { host: '127.0.0.1:9' } };
    const cat = app.services.catalogue(req);
    assert.deepEqual(cat.all.map(p => p.id), ['alpha', 'beta', 'gamma']);
    assert.equal(cat.origin, 'http://127.0.0.1:9');
    assert.equal(app.services.origin({ headers: { host: 'h', 'x-forwarded-proto': 'https' } }), 'http://h', 'the forwarded proto counts only behind a trusted proxy');
    app.services.options.trustProxy = true;
    assert.equal(app.services.origin({ headers: { host: 'h', 'x-forwarded-proto': 'https' } }), 'https://h');
    app.services.options.publicOrigin = 'https://gravity.example';
    assert.equal(app.services.origin(req), 'https://gravity.example');
  } finally {
    await close();
  }
});
