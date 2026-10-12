// tests/mcp.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { testApp, rootWith, manifest } from './helpers/http.js';
import { startUpstream, startSilent } from './helpers/fake-upstream.js';
import { TOOL_NAMES } from '../js/data/clients.js';

async function connect(base) {
  const client = new Client({ name: 'test-client', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  return client;
}
const textOf = r => JSON.parse(r.content[0].text);

test('the face: name, instructions naming the reserved tools, exactly the four tools', async () => {
  const { base, close } = await testApp();
  let client;
  try {
    client = await connect(base);
    assert.equal(client.getServerVersion().name, 'gravity-field');
    assert.match(client.getInstructions(), /shop_install, shop_uninstall, shop_mine are reserved/);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(), [...TOOL_NAMES].sort());
    for (const t of tools) assert.match(t.name, /^[A-Za-z0-9_-]{1,64}$/, 'a legal tool name');
  } finally {
    await client?.close();
    await close();
  }
});

test('shop_search: everything in shelf order, by text, by kind; shop_get: one plugin or an error', async () => {
  const { base, close } = await testApp();
  let client;
  try {
    client = await connect(base);
    const all = textOf(await client.callTool({ name: 'shop_search', arguments: {} }));
    assert.deepEqual(all.plugins.map(p => p.id), ['beta', 'alpha', 'gamma'], 'featured first, then the kinds');
    assert.deepEqual(Object.keys(all.plugins[0]), ['id', 'name', 'kind', 'blurb', 'by', 'tools', 'status']);
    assert.deepEqual(textOf(await client.callTool({ name: 'shop_search', arguments: { q: 'gamma' } })).plugins.map(p => p.id), ['gamma']);
    assert.deepEqual(textOf(await client.callTool({ name: 'shop_search', arguments: { kind: 'Data' } })).plugins.map(p => p.id), ['alpha']);
    assert.deepEqual(textOf(await client.callTool({ name: 'shop_search', arguments: { q: 'zzz' } })).plugins, []);
    const one = textOf(await client.callTool({ name: 'shop_get', arguments: { id: 'alpha' } }));
    assert.equal(one.name, 'Alpha Data');
    assert.deepEqual(one.tools, ['echo']);
    assert.equal(one.pending, false);
    const none = await client.callTool({ name: 'shop_get', arguments: { id: 'nope' } });
    assert.equal(none.isError, true);
    assert.equal(none.content[0].text, 'unknown plugin');
  } finally {
    await client?.close();
    await close();
  }
});

test('shop_publish lands in review and shows as such; its plugin cannot be called yet; a bad manifest names the rule', async () => {
  const up = await startUpstream();
  const { app, base, close } = await testApp();
  let client;
  try {
    client = await connect(base);
    const r = textOf(await client.callTool({ name: 'shop_publish', arguments: { manifest: manifest('zeta', up.url) } }));
    assert.equal(r.status, 'review');
    assert.deepEqual(r.probe.toolList.map(t => t.name), ['echo', 'boom', 'slow']);
    assert.equal(app.services.submissions.has('zeta'), true);
    const found = textOf(await client.callTool({ name: 'shop_search', arguments: { q: 'zeta' } })).plugins[0];
    assert.equal(found.status, 'review');
    const call = await client.callTool({ name: 'plugin_call', arguments: { id: 'zeta', tool: 'echo', args: { text: 'x' } } });
    assert.equal(call.isError, true);
    assert.equal(call.content[0].text, 'in review');
    const bad = await client.callTool({ name: 'shop_publish', arguments: { manifest: { ...manifest('eta', up.url), kind: 'Nope' } } });
    assert.equal(bad.isError, true);
    assert.equal(bad.content[0].text, 'kind: one of Data · Monitors · Bots · Crypto · Quant');
  } finally {
    await client?.close();
    await close();
    await up.close();
  }
});

test('plugin_call forwards to a live plugin, writes a ledger line, refuses undeclared tools and unknown plugins, and is rate limited', async () => {
  const up = await startUpstream();
  const root = rootWith([manifest('live', up.url, { tools: ['echo'] })], { featured: ['live'], Data: ['live'] });
  const { base, close } = await testApp({ root, limits: { calls: [2, 60_000] } });
  let client;
  try {
    client = await connect(base);
    const r = await client.callTool({ name: 'plugin_call', arguments: { id: 'live', tool: 'echo', args: { text: 'hi' } } });
    assert.deepEqual(r.content, [{ type: 'text', text: 'echo:hi' }]);
    assert.equal(!!r.isError, false);
    assert.deepEqual(up.calls, [['echo', 'hi']]);
    const ledger = await (await fetch(`${base}/api/ledger`)).json();
    assert.equal(ledger.total, 1);
    assert.deepEqual(ledger.plugins.live.tools, { echo: 1 });
    const no = await client.callTool({ name: 'plugin_call', arguments: { id: 'live', tool: 'boom' } });
    assert.equal(no.isError, true);
    assert.equal(no.content[0].text, 'tool not offered');
    assert.equal((await (await fetch(`${base}/api/ledger`)).json()).total, 1, 'a refused tool is not a call');
    const unk = await client.callTool({ name: 'plugin_call', arguments: { id: 'nope', tool: 'echo' } });
    assert.equal(unk.content[0].text, 'unknown plugin');
    await client.callTool({ name: 'plugin_call', arguments: { id: 'live', tool: 'echo', args: { text: 'two' } } });
    const limited = await client.callTool({ name: 'plugin_call', arguments: { id: 'live', tool: 'echo', args: { text: 'three' } } });
    assert.equal(limited.isError, true);
    assert.equal(limited.content[0].text, 'rate limited');
    assert.equal((await (await fetch(`${base}/api/ledger`)).json()).total, 2);
    assert.equal((await (await fetch(`${base}/api/plugins/live`)).json()).calls, 2, 'the drawer\'s count follows');
  } finally {
    await client?.close();
    await close();
    await up.close();
  }
});

test('a plain POST without a session works in stateless JSON mode, so curl can list the tools', async () => {
  const { base, close } = await testApp();
  try {
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.deepEqual(body.result.tools.map(t => t.name).sort(), [...TOOL_NAMES].sort());
  } finally {
    await close();
  }
});

test('the face reads at most 1 MB of a request and refuses a larger one before the SDK sees it', async () => {
  const { base, close } = await testApp();
  try {
    const big = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'shop_search', arguments: { q: 'x'.repeat(1_100_000) } } });
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: big });
    assert.equal(r.status, 413);
    const bad = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{not json' });
    assert.equal(bad.status, 400);
  } finally {
    await close();
  }
});

test('shop_publish records its source; two plugin_calls from one source share its single in-flight place', async () => {
  const up = await startUpstream();
  const silent = await startSilent();
  const root = rootWith([manifest('slow', silent.url, { tools: ['echo'] })], { featured: ['slow'], Data: ['slow'] });
  const { app, base, close } = await testApp({ root, upstreamTimeoutMs: 600, inflight: { callsPerSource: 1 } });
  let client;
  try {
    client = await connect(base);
    await client.callTool({ name: 'shop_publish', arguments: { manifest: manifest('zeta', up.url) } });
    assert.equal(app.services.submissions.get('zeta').from, app.services.sourceOf('127.0.0.1'));
    const call = () => client.callTool({ name: 'plugin_call', arguments: { id: 'slow', tool: 'echo', args: { text: 'x' } } });
    const texts = (await Promise.all([call(), call()])).map(r => r.content[0].text).sort();
    assert.deepEqual(texts, ['busy', 'upstream unreachable']);
  } finally {
    await client?.close();
    await close();
    await up.close();
    await silent.close();
  }
});

test('the face is stateless: GET and DELETE answer 405 with Allow: POST, so no stream is held open; idle sockets time out', async () => {
  const { app, base, close } = await testApp();
  try {
    const g = await fetch(`${base}/mcp`, { headers: { accept: 'text/event-stream' }, signal: AbortSignal.timeout(3000) });
    assert.equal(g.status, 405);
    assert.equal(g.headers.get('allow'), 'POST');
    assert.equal((await fetch(`${base}/mcp`, { method: 'DELETE', signal: AbortSignal.timeout(3000) })).status, 405);
    assert.equal(app.timeout, 3 * app.services.options.upstreamTimeoutMs + 5000);
  } finally {
    await close();
  }
});

test('plugin_call to a plugin whose tools are not known yet probes it on demand, then calls', async () => {
  const up = await startUpstream();
  const root = rootWith([manifest('fresh', up.url, { tools: [] })], { featured: ['fresh'], Data: ['fresh'] });
  const { base, close } = await testApp({ root });
  let client;
  try {
    client = await connect(base);
    const r = await client.callTool({ name: 'plugin_call', arguments: { id: 'fresh', tool: 'echo', args: { text: 'late' } } });
    assert.deepEqual(r.content, [{ type: 'text', text: 'echo:late' }]);
    const no = await client.callTool({ name: 'plugin_call', arguments: { id: 'fresh', tool: 'nope' } });
    assert.equal(no.content[0].text, 'tool not offered');
  } finally {
    await client?.close();
    await close();
    await up.close();
  }
});
