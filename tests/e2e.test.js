// tests/e2e.test.js — the whole story once: publish from a client, see it in review, approve as the operator, call it, see the count, export it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { testApp, manifest } from './helpers/http.js';
import { startUpstream } from './helpers/fake-upstream.js';

const EXPORT = fileURLToPath(new URL('../scripts/export.js', import.meta.url));

test('publish → in review → approve → call → counted → exported', async () => {
  const up = await startUpstream({ name: 'moat-server', version: '3.1' });
  const { app, base, close } = await testApp();
  const client = new Client({ name: 'claude-code-standin', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  try {
    // a developer publishes from their client
    const pub = JSON.parse((await client.callTool({ name: 'shop_publish', arguments: { manifest: manifest('moat', up.url, { name: 'Moat score', kind: 'Data', blurb: 'Moat scores, ask by ticker', tools: ['echo'] }) } })).content[0].text);
    assert.equal(pub.status, 'review');
    // the site shows it first on its shelf with the clock key, and the operator sees it in the queue
    const home = await (await fetch(`${base}/`)).text();
    assert.match(home, /shelf-title">Data<\/div>[\s\S]*?<div class="shelf-row"><div class="pcard" data-action="openPlugin" data-id="moat"[\s\S]*?class="pkey-wait"/);
    assert.match(await (await fetch(`${base}/admin`)).text(), /data-id="moat"[\s\S]*?Approve/);
    // calling it is refused while it waits
    assert.equal((await client.callTool({ name: 'plugin_call', arguments: { id: 'moat', tool: 'echo', args: { text: 'early' } } })).content[0].text, 'in review');
    // the operator approves from loopback
    const ok = await fetch(`${base}/api/admin/moat/approve`, { method: 'POST' });
    assert.deepEqual(await ok.json(), { ok: true, id: 'moat' });
    const got = JSON.parse((await client.callTool({ name: 'shop_get', arguments: { id: 'moat' } })).content[0].text);
    assert.equal(got.pending, false);
    assert.equal(got.status, 'up');
    assert.deepEqual(got.server, { name: 'moat-server', version: '3.1' });
    // the call goes through the gateway to the plugin's own server
    const r = await client.callTool({ name: 'plugin_call', arguments: { id: 'moat', tool: 'echo', args: { text: 'KO' } } });
    assert.deepEqual(r.content, [{ type: 'text', text: 'echo:KO' }]);
    assert.deepEqual(up.calls, [['echo', 'KO']]);
    // the count reaches the drawer and the ledger
    const page = await (await fetch(`${base}/p/moat`)).text();
    assert.match(page, /class="dim">Data · 3 tools · 1 call</);
    assert.deepEqual((await (await fetch(`${base}/api/ledger`)).json()).plugins.moat, { total: 1, lastHour: 1, tools: { echo: 1 } });
    // and the export prints the file to move into plugins/
    const out = execFileSync(process.execPath, [EXPORT], { env: { ...process.env, GF_DATA_DIR: app.services.options.dataDir }, encoding: 'utf8' });
    assert.match(out, /^# plugins\/moat\.json/m);
    assert.match(out, /"id": "moat"/);
    assert.match(out, /"url": "http:\/\/127\.0\.0\.1:\d+\/mcp"/);
    const none = execFileSync(process.execPath, [EXPORT], { env: { ...process.env, GF_DATA_DIR: `${app.services.options.dataDir}-empty` }, encoding: 'utf8' });
    assert.match(none, /nothing approved at runtime/);
  } finally {
    await client.close();
    await close();
    await up.close();
  }
});
