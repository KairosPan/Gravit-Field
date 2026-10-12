// tests/vercel.test.js — the Vercel entry as Vercel runs it: one handler, the repository's own plugins, /tmp for data
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.GF_PROBE = '0';
process.env.GF_DATA_DIR = mkdtempSync(join(tmpdir(), 'gf-vercel-'));
const { default: handler } = await import('../api/index.js');

async function serve() {
  const srv = createServer(handler);
  const port = await new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
  return { port, base: `http://127.0.0.1:${port}`, close: () => new Promise(r => { srv.closeAllConnections(); srv.close(() => r()); }) };
}
// fetch drops a Host header it is given; node:http sends it, as the platform's proxy does
function get(port, path, headers) {
  return new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port, path, headers }, res => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, body: t })); }).on('error', reject).end();
  });
}
const vercel = { host: 'gravit-field.vercel.app', 'x-forwarded-for': '203.0.113.9', 'x-forwarded-proto': 'https' };

test('the entry serves the shelves of the six committed plugins on the platform\'s domain, with the https origin in Create', async () => {
  const { port, close } = await serve();
  try {
    const health = JSON.parse((await get(port, '/healthz', vercel)).body);
    assert.equal(health.plugins, 6);
    const page = (await get(port, '/', vercel)).body;
    assert.match(page, /<h1 class="head-title">Gravity Field<\/h1>/);
    assert.match(page, /&quot;origin&quot;:&quot;https:\/\/gravit-field\.vercel\.app&quot;|"origin":"https:\/\/gravit-field\.vercel\.app"/);
  } finally {
    await close();
  }
});

test('the entry keeps admin closed without a token, refuses cross-site writes, and answers the MCP face', async () => {
  const { base, close } = await serve();
  try {
    assert.equal((await fetch(`${base}/admin`, { headers: vercel })).status, 403);
    assert.equal((await fetch(`${base}/api/submissions`, { method: 'POST', headers: { ...vercel, origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' })).status, 403);
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { ...vercel, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).result.tools.map(t => t.name).sort(), ['plugin_call', 'shop_get', 'shop_publish', 'shop_search']);
  } finally {
    await close();
  }
});
