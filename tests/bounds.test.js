// tests/bounds.test.js — an upstream's answer is bounded in bytes, in tools, in schema size and in content, wherever it lands
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { z } from 'zod';
import { guardedFetch } from '../js/netguard.js';
import { probe, MAX_TOOLS, MAX_SCHEMA } from '../js/probe.js';
import { createGateway, trimContent, MAX_TEXT, MAX_ITEMS } from '../js/gateway.js';
import { startUpstream } from './helpers/fake-upstream.js';
import { testApp, manifest } from './helpers/http.js';

test('guardedFetch errors past maxBytes and stops reading', async () => {
  const srv = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('x'.repeat(50_000)); });
  const port = await new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
  try {
    const small = await guardedFetch({ allowLoopback: true, maxBytes: 100_000 })(`http://127.0.0.1:${port}/`);
    assert.equal((await small.text()).length, 50_000);
    const big = await guardedFetch({ allowLoopback: true, maxBytes: 1000 })(`http://127.0.0.1:${port}/`);
    await assert.rejects(big.text(), e => e.code === 'EBIG' || e.cause?.code === 'EBIG');
  } finally {
    srv.close();
  }
});

test('a probe whose answer passes its byte cap fails as answer too large', async () => {
  const up = await startUpstream({ extraTools: [{ name: 'huge', description: 'd'.repeat(3_000_000) }] });
  try {
    assert.deepEqual(await probe(up.url, { allowLoopback: true }), { ok: false, error: 'answer too large' });
  } finally {
    await up.close();
  }
});

test('a probe keeps at most MAX_TOOLS tools, drops names over 64 characters, replaces a schema over MAX_SCHEMA, and cuts the server name', async () => {
  const wide = Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`p${i}`, z.string().describe('d'.repeat(30))]));
  const extraTools = [
    { name: 'n'.repeat(70) },
    { name: 'wide', inputSchema: wide },
    ...Array.from({ length: 100 }, (_, i) => ({ name: `t${i}` })),
  ];
  const up = await startUpstream({ name: 's'.repeat(200), extraTools });
  try {
    const r = await probe(up.url, { allowLoopback: true });
    assert.equal(r.ok, true);
    assert.equal(r.toolList.length, MAX_TOOLS);
    assert.ok(!r.toolList.some(t => t.name.length > 64));
    const w = r.toolList.find(t => t.name === 'wide');
    assert.deepEqual(w.inputSchema, { type: 'object' });
    assert.ok(r.toolList.every(t => JSON.stringify(t.inputSchema).length <= MAX_SCHEMA));
    assert.equal(r.server.name.length, 80);
  } finally {
    await up.close();
  }
});

test('the gateway answers a too-large reply as a tool error without marking the plugin down, and trims every kind of content', async () => {
  const up = await startUpstream({ extraTools: [
    { name: 'flood', answer: () => [{ type: 'text', text: 'x'.repeat(5_000_000) }] },
    { name: 'img', answer: () => [{ type: 'image', data: 'A'.repeat(MAX_TEXT + 10), mimeType: 'image/png' }] },
    { name: 'many', answer: () => Array.from({ length: MAX_ITEMS + 5 }, (_, i) => ({ type: 'text', text: String(i) })) },
  ] });
  const down = [];
  const gw = createGateway({ allowLoopback: true, timeoutMs: 5000, onDown: id => down.push(id) });
  const entry = { id: 'alpha', url: up.url, tools: [], toolList: [{ name: 'flood' }, { name: 'img' }, { name: 'many' }, { name: 'echo' }] };
  try {
    const flood = await gw.call(entry, 'flood', {});
    assert.equal(flood.isError, true);
    assert.match(flood.content[0].text, /^the answer was larger than \d+ bytes$/);
    assert.deepEqual(down, [], 'a large answer is not a dead line');
    const img = await gw.call(entry, 'img', {});
    assert.deepEqual(img.content, [{ type: 'text', text: `[image omitted: ${MAX_TEXT + 10} characters of data, more than ${MAX_TEXT}]` }]);
    const many = await gw.call(entry, 'many', {});
    assert.equal(many.content.length, MAX_ITEMS + 1);
    assert.deepEqual(many.content.at(-1), { type: 'text', text: '[5 more items omitted]' });
    assert.deepEqual((await gw.call(entry, 'echo', { text: 'still here' })).content, [{ type: 'text', text: 'echo:still here' }]);
    assert.deepEqual(trimContent([{ type: 'resource', resource: { uri: 'x:1', blob: 'B'.repeat(MAX_TEXT + 1) } }]), [{ type: 'text', text: `[resource x:1 omitted: ${MAX_TEXT + 1} characters of data, more than ${MAX_TEXT}]` }]);
  } finally {
    await gw.close();
    await up.close();
  }
});

test('a page embeds tool names, one-line descriptions and argument hints, never whole schemas, so a crowded queue stays a small page', async () => {
  const { app, base, close } = await testApp();
  try {
    const schema = { type: 'object', properties: { ticker: { type: 'string', description: 'd'.repeat(15_000) } }, required: ['ticker'] };
    const toolList = Array.from({ length: MAX_TOOLS }, (_, i) => ({ name: `t${i}`, description: 'one line', inputSchema: schema }));
    for (const id of ['big-one', 'big-two', 'big-three']) app.services.submissions.add({ manifest: manifest(id, 'https://a.example/mcp', { tools: [] }), probe: { ok: true, server: { name: 's', version: '1' }, toolList, latencyMs: 1, transport: 'http', missing: [] }, via: 'form' });
    const page = await (await fetch(`${base}/`)).text();
    const json = page.match(/<script type="application\/json" id="catalogue">([\s\S]*?)<\/script>/)[1];
    assert.doesNotMatch(json, /inputSchema/);
    assert.ok(page.length < 200_000, `the page is ${page.length} bytes`);
    assert.deepEqual(JSON.parse(json).pending[0].toolList[0], { name: 't0', description: 'one line', hint: 'ticker' });
    const one = await (await fetch(`${base}/p/big-one`)).text();
    assert.match(one, /plugin_call\(&quot;big-one&quot;, &quot;t0&quot;, \{ &quot;ticker&quot;: &quot;&lt;ticker&gt;&quot; \}\)/, 'the drawer still shows the hint');
  } finally {
    await close();
  }
});
