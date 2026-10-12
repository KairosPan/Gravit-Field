// tests/submit.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSubmit } from '../js/render/submit.js';
import { testApp } from './helpers/http.js';
import { startUpstream } from './helpers/fake-upstream.js';

const form = (base, fields, headers = {}) => fetch(`${base}/submit`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(fields).toString() });
const good = url => ({ name: 'Moat Score', blurb: 'Moat scores, ask by ticker', kind: 'Data', url, homepage: 'https://moat.example', by: 'you', icon: 'shield', asks: '“Is KO wide?”\n“Compare KO and PEP”' });

test('the form: eight labelled fields, the five kinds, the icon pick with the initial first, Submit; no helper sentences', () => {
  const h = renderSubmit({ values: { name: 'Moat' } });
  assert.match(h, /<h1 class="head-title">Submit a plugin<\/h1>/);
  const labels = [...h.matchAll(/class="field-label">([^<]+)</g)].map(m => m[1]);
  assert.deepEqual(labels, ['Name', 'One line', 'Kind', 'MCP address', 'Homepage', 'Your handle', 'Icon', 'What you can ask it']);
  assert.match(h, /<form class="submit-form" method="post" action="\/submit">/);
  assert.equal((h.match(/type="radio" name="kind"/g) ?? []).length, 5);
  assert.match(h, /type="radio" name="kind" value="Data" checked/);
  assert.match(h, /<select class="input" id="f-icon" name="icon"><option value="">M<\/option><option value="chat">chat<\/option>/);
  assert.match(h, /<input class="input" id="f-name" name="name" value="Moat" maxlength="40" required>/);
  assert.match(h, /<button type="submit" class="btn-primary">Submit<\/button>/);
  assert.doesNotMatch(h, /<p[ >]|placeholder="[^"]{9,}"/, 'labels and controls only');
  assert.doesNotMatch(h, /type="module"|field-error/);
});

test('GET shows the form; a good POST shows the card in review and the tools the probe found; the submission is stored', async () => {
  const up = await startUpstream();
  const { app, base, close } = await testApp();
  try {
    const g = await fetch(`${base}/submit`);
    assert.equal(g.status, 200);
    assert.match(await g.text(), /<title>Submit · Gravity Field<\/title>[\s\S]*submit-form/);
    const r = await form(base, good(up.url));
    assert.equal(r.status, 200);
    const t = await r.text();
    assert.match(t, /class="grid-title">In review</);
    assert.match(t, /class="pcard in-grid" data-action="openPlugin" data-id="moat-score"/);
    assert.match(t, /class="pkey-wait" role="img" aria-label="In review"/);
    assert.match(t, /class="pcard-name">Moat Score</);
    assert.match(t, /Tools found<\/div><div class="dsec-line"><span class="mono">echo<\/span> <span class="dim">Echoes the text back<\/span><\/div><div class="dsec-line"><span class="mono">boom<\/span>/);
    assert.doesNotMatch(t, /submit-form/, 'the form has done its job');
    const rec = app.services.submissions.get('moat-score');
    assert.equal(rec.via, 'form');
    assert.deepEqual(rec.manifest.asks, ['“Is KO wide?”', '“Compare KO and PEP”']);
    assert.equal(rec.manifest.by, '@you');
    assert.equal(rec.manifest.icon, 'shield');
    assert.deepEqual(rec.manifest.tools, []);
    assert.equal((await fetch(`${base}/p/moat-score`)).status, 200, 'and it has a page at once');
  } finally {
    await close();
    await up.close();
  }
});

test('a bad POST keeps the values and names the rule under its field; a probe that fails still stores and says so; the bucket holds', async () => {
  const { app, base, close } = await testApp({ limits: { submissions: [3, 3_600_000] } });
  try {
    const bad = await form(base, { ...good('https://m.example/mcp'), kind: 'Nope', name: 'Keep Me' });
    assert.equal(bad.status, 400);
    const t = await bad.text();
    assert.match(t, /name="name" value="Keep Me"/);
    assert.match(t, /Kind<\/span>[\s\S]*?<\/div><div class="field-error">one of Data · Monitors · Bots · Crypto · Quant<\/div>/);
    assert.equal(app.services.submissions.list().length, 0);
    const clash = await form(base, { ...good('https://m.example/mcp'), name: 'Alpha' });
    assert.equal(clash.status, 400);
    assert.match(await clash.text(), /class="field-error">an approved plugin already has this id</);
    const dead = await form(base, good('http://127.0.0.1:1/mcp'));
    assert.equal(dead.status, 200);
    const d = await dead.text();
    assert.match(d, /class="pcard in-grid down"/);
    assert.match(d, /Probe<\/div><div class="dsec-line"><span class="chip down">down<\/span> <span class="dim">/);
    assert.equal((await form(base, good('http://127.0.0.1:1/mcp'))).status, 429);
  } finally {
    await close();
  }
});

test('the form door names the source of a submission', async () => {
  const up = await startUpstream();
  const { app, base, close } = await testApp();
  try {
    assert.equal((await form(base, good(up.url))).status, 200);
    assert.equal(app.services.submissions.get('moat-score').from, app.services.sourceOf('127.0.0.1'));
  } finally {
    await close();
    await up.close();
  }
});
