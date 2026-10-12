// tests/origin.test.js — a page in the visitor's own browser cannot drive this server: no foreign Host on loopback, no cross-site writes
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { testApp } from './helpers/http.js';

// node:http lets a test write the Host header fetch would not
function raw(port, { method = 'GET', path = '/healthz', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, res => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, body: t })); });
    req.on('error', reject);
    req.end(body ?? undefined);
  });
}
const rpc = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
const mcpHeaders = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

test('on loopback a foreign Host is refused on every route, so a rebound name cannot reach this server', async () => {
  const { port, close } = await testApp();
  try {
    assert.equal((await raw(port, { headers: { host: 'evil.example' } })).status, 403);
    assert.equal((await raw(port, { path: '/admin', headers: { host: `evil.example:${port}` } })).status, 403);
    assert.equal((await raw(port, { method: 'POST', path: '/mcp', headers: { ...mcpHeaders, host: 'evil.example' }, body: rpc })).status, 403);
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]) assert.equal((await raw(port, { headers: { host } })).status, 200, host);
  } finally {
    await close();
  }
});

test('a write from another site is refused: a foreign Origin, Origin null, or Sec-Fetch-Site cross-site; no Origin is a client, not a browser', async () => {
  const { port, base, close } = await testApp();
  try {
    const own = { host: `127.0.0.1:${port}` };
    assert.equal((await raw(port, { method: 'POST', path: '/mcp', headers: { ...mcpHeaders, ...own, origin: 'https://evil.example' }, body: rpc })).status, 403);
    assert.equal((await raw(port, { method: 'POST', path: '/api/admin/zeta/approve', headers: { ...own, origin: 'https://evil.example' } })).status, 403, 'a cross-site form cannot drive the loopback admin');
    assert.equal((await raw(port, { method: 'POST', path: '/submit', headers: { ...own, origin: 'null', 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=x' })).status, 403);
    assert.equal((await raw(port, { method: 'POST', path: '/api/submissions', headers: { ...own, 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await raw(port, { method: 'POST', path: '/mcp', headers: { ...mcpHeaders, ...own, origin: base }, body: rpc })).status, 200, 'the site\'s own origin');
    assert.equal((await raw(port, { method: 'POST', path: '/mcp', headers: { ...mcpHeaders, ...own }, body: rpc })).status, 200, 'an MCP client sends no Origin');
    assert.equal((await raw(port, { headers: { ...own, origin: 'https://evil.example' } })).status, 200, 'a read is not a write');
  } finally {
    await close();
  }
});

test('with GF_PUBLIC_ORIGIN the public host and origin are the site\'s own, also through a proxy on this machine', async () => {
  const { port, close } = await testApp({ publicOrigin: 'https://gravity.example' });
  try {
    assert.equal((await raw(port, { headers: { host: 'gravity.example' } })).status, 200);
    assert.equal((await raw(port, { method: 'POST', path: '/mcp', headers: { ...mcpHeaders, host: 'gravity.example', origin: 'https://gravity.example' }, body: rpc })).status, 200);
    assert.equal((await raw(port, { headers: { host: 'other.example' } })).status, 403);
  } finally {
    await close();
  }
});
