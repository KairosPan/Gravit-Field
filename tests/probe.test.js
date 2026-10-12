// tests/probe.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedUrl, probe, withTimeout } from '../js/probe.js';
import { startUpstream, startSilent } from './helpers/fake-upstream.js';

test('allowedUrl: https public hosts pass; loopback only with allowLoopback; private, link-local, credentials and plain http never', () => {
  assert.deepEqual(allowedUrl('https://mcp.api.coingecko.com/mcp'), { ok: true });
  assert.deepEqual(allowedUrl('http://127.0.0.1:4999/mcp'), { ok: false, error: 'a loopback address' });
  assert.deepEqual(allowedUrl('http://127.0.0.1:4999/mcp', { allowLoopback: true }), { ok: true });
  assert.deepEqual(allowedUrl('http://localhost:4999/mcp', { allowLoopback: true }), { ok: true });
  assert.equal(allowedUrl('https://127.0.0.1/mcp').ok, false);
  for (const u of ['https://10.0.0.8/mcp', 'https://192.168.1.1/mcp', 'https://172.16.0.1/mcp', 'https://172.31.9.9/mcp', 'https://169.254.169.254/latest', 'https://[fd00::1]/mcp', 'https://[fe80::1]/mcp', 'https://db.internal/mcp', 'https://printer.local/mcp']) {
    assert.deepEqual(allowedUrl(u, { allowLoopback: true }), { ok: false, error: 'an address inside a network' }, u);
  }
  assert.equal(allowedUrl('https://172.32.0.1/mcp').ok, true, '172.32 is public');
  assert.deepEqual(allowedUrl('https://user:pw@host.example/mcp'), { ok: false, error: 'not an https URL' });
  assert.deepEqual(allowedUrl('http://host.example/mcp'), { ok: false, error: 'not an https URL' });
  assert.deepEqual(allowedUrl('garbage'), { ok: false, error: 'not an https URL' });
});

test('probe lists a live upstream: server, tools with one-line descriptions and schemas, latency, transport', async () => {
  const up = await startUpstream({ name: 'alpha-server', version: '2.0.0' });
  try {
    const r = await probe(up.url, { allowLoopback: true });
    assert.equal(r.ok, true);
    assert.deepEqual(r.server, { name: 'alpha-server', version: '2.0.0' });
    assert.deepEqual(r.toolList.map(t => t.name), ['echo', 'boom', 'slow']);
    assert.equal(r.toolList[0].description, 'Echoes the text back');
    assert.equal(r.toolList[0].inputSchema.type, 'object');
    assert.deepEqual(r.toolList[0].inputSchema.required, ['text']);
    assert.ok(Number.isInteger(r.latencyMs) && r.latencyMs >= 0);
    assert.equal(r.transport, 'http');
  } finally {
    await up.close();
  }
});

test('probe refuses a disallowed address without connecting, and reports a closed port as not ok', async () => {
  assert.deepEqual(await probe('http://127.0.0.1:1/mcp'), { ok: false, error: 'a loopback address' });
  const r = await probe('http://127.0.0.1:1/mcp', { allowLoopback: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /ECONNREFUSED|fetch failed|connect/i);
});

test('probe gives up on a silent server within the timeout', async () => {
  const silent = await startSilent();
  try {
    const t0 = Date.now();
    const r = await probe(silent.url, { allowLoopback: true, timeoutMs: 300 });
    assert.equal(r.ok, false);
    assert.match(r.error, /timed out/);
    assert.ok(Date.now() - t0 < 2500, 'two transports, 300 ms each, plus slack');
  } finally {
    await silent.close();
  }
  await assert.rejects(withTimeout(new Promise(() => {}), 20, 'x'), /x timed out after 20 ms/);
});
