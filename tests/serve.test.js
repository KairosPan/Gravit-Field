// tests/serve.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, contentType } from '../serve.js';

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
