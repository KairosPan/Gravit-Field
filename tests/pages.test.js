// tests/pages.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testApp } from './helpers/http.js';
import { safeJson, renderDocument, renderNotFound } from '../js/render/page.js';

const probeOk = { ok: true, server: { name: 's', version: '1' }, toolList: [{ name: 'echo', description: '', inputSchema: { type: 'object' } }], latencyMs: 1, transport: 'http', missing: [] };

test('safeJson can sit inside a script tag; renderDocument carries fonts, tokens, the theme script, the data and the client; the 404 page loads no script', () => {
  assert.equal(safeJson({ a: '</script><b>' }), '{"a":"\\u003c/script>\\u003cb>"}');
  assert.equal(safeJson('x\u2028y'), '"x\\u2028y"');
  assert.equal(safeJson(undefined), 'null');
  const doc = renderDocument({ title: 'T <1>', body: '<main>x</main>', data: { k: '<' } });
  assert.match(doc, /^<!doctype html>\n<html lang="en">/);
  assert.match(doc, /<title>T &lt;1&gt;<\/title>/);
  assert.match(doc, /fonts\.googleapis\.com\/css2\?family=Manrope/);
  assert.match(doc, /<link rel="stylesheet" href="\/css\/tokens\.css">\n<link rel="stylesheet" href="\/css\/app\.css">/);
  assert.match(doc, /localStorage\.getItem\('gravity-field\.theme'\)/);
  assert.match(doc, /<div id="app" class="app"><main>x<\/main><\/div>/);
  assert.match(doc, /<script type="application\/json" id="catalogue">\{"k":"\\u003c"\}<\/script>/);
  assert.match(doc, /<script type="module" src="\/js\/client\.js"><\/script>/);
  const nf = renderDocument({ title: 'Not found', body: renderNotFound(), script: null });
  assert.doesNotMatch(nf, /type="module"|id="catalogue"/);
  assert.match(nf, /class="grid-title">Not found</);
});

test('the shelves page, a shelf grid and a plugin page are rendered on the server with the catalogue embedded, escaped', async () => {
  const { base, close } = await testApp();
  try {
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.equal(home.headers.get('content-type'), 'text/html; charset=utf-8');
    const h = await home.text();
    assert.match(h, /<title>Gravity Field<\/title>/);
    assert.match(h, /<h1 class="head-title">Gravity Field<\/h1>/);
    assert.match(h, /class="shelf-title">Featured</);
    const json = h.match(/<script type="application\/json" id="catalogue">([\s\S]*?)<\/script>/)[1];
    assert.doesNotMatch(json, /<\//, 'no closing tag can hide in the data');
    const data = JSON.parse(json);
    assert.deepEqual(data.plugins.map(p => p.id), ['alpha', 'beta', 'gamma']);
    assert.equal(data.plugins[1].blurb, 'Beta </script><img src=x onerror=alert(1)> prices', 'the data round-trips intact');
    assert.equal(data.origin, base);
    assert.ok(data.now > 0);
    assert.doesNotMatch(h.replace(json, ''), /<img src=x/, 'and the markup around it is escaped');
    const data2 = await (await fetch(`${base}/discover/data`)).text();
    assert.match(data2, /<title>Data · Gravity Field<\/title>/);
    assert.match(data2, /<a class="back-link" data-nav href="\/">‹ Gravity Field<\/a><div class="grid-title">Data<\/div>/);
    const one = await fetch(`${base}/p/alpha`);
    assert.equal(one.status, 200);
    const o = await one.text();
    assert.match(o, /<title>Alpha Data · Gravity Field<\/title>/);
    assert.match(o, /<main class="main disc with-drawer">/);
    assert.match(o, /<aside class="drawer" aria-label="Alpha Data">/);
    assert.match(o, /class="pcard pressed" data-action="openPlugin" data-id="alpha"/);
    assert.equal((await fetch(`${base}/`, { method: 'HEAD' })).status, 200);
  } finally {
    await close();
  }
});

test('an unknown plugin, an unknown shelf and a stray path are 404 pages without the client script; a pending submission has a page', async () => {
  const { app, base, close } = await testApp();
  try {
    for (const path of ['/p/nope', '/p/Bad', '/discover/zzz', '/x/y']) {
      const r = await fetch(`${base}${path}`);
      assert.equal(r.status, 404, path);
      const t = await r.text();
      assert.match(t, /class="grid-title">Not found</, path);
      assert.doesNotMatch(t, /type="module"/, path);
    }
    app.services.submissions.add({ manifest: { id: 'pend', name: 'Pending One', kind: 'Data', blurb: 'waits', url: 'https://p.example/mcp', homepage: null, by: '@p', icon: null, needs: 'none', writes: ['message'], asks: [], tools: [] }, probe: probeOk, via: 'form' });
    const r = await fetch(`${base}/p/pend`);
    assert.equal(r.status, 200);
    const t = await r.text();
    assert.match(t, /class="dim">Data · In review</);
    assert.match(t, /class="pkey-wait"/);
  } finally {
    await close();
  }
});
