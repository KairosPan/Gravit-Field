// tests/netguard.test.js — where an upstream may live: by address at connect time, not by name (spec §9)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { blockedReason, guardedLookup, checkHost, guardedFetch } from '../js/netguard.js';
import { startUpstream } from './helpers/fake-upstream.js';

const resolveTo = (...addresses) => (host, opts, cb) => cb(null, addresses.map(a => ({ address: a, family: a.includes(':') ? 6 : 4 })));
const listInit = { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) };

test('blockedReason names loopback and the ranges inside a network, by address, IPv4 written as IPv6 included', () => {
  for (const ip of ['127.0.0.1', '127.9.9.9', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '[::1]']) assert.equal(blockedReason(ip), 'a loopback address', ip);
  for (const ip of ['127.0.0.1', '::1', '::ffff:7f00:1']) assert.equal(blockedReason(ip, { allowLoopback: true }), null, ip);
  for (const ip of ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.169.254', '100.64.0.1', '100.127.255.255', '0.0.0.0', '198.18.0.1', '224.0.0.1', '255.255.255.255', '::', 'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1', '::ffff:10.0.0.1', '::ffff:a9fe:a9fe', '64:ff9b::a00:1']) {
    assert.equal(blockedReason(ip, { allowLoopback: true }), 'an address inside a network', ip);
  }
  for (const ip of ['93.184.216.34', '172.32.0.1', '100.128.0.1', '8.8.8.8', '2606:4700::1111']) assert.equal(blockedReason(ip), null, ip);
  assert.equal(blockedReason('not-an-ip'), 'not an address');
});

test('checkHost resolves a name and refuses it when any of its addresses is inside; a literal needs no lookup; a name that does not resolve is not found', async () => {
  assert.deepEqual(await checkHost('evil.example', { resolve: resolveTo('93.184.216.34', '10.0.0.8') }), { ok: false, error: 'an address inside a network' });
  assert.deepEqual(await checkHost('good.example', { resolve: resolveTo('93.184.216.34') }), { ok: true });
  assert.deepEqual(await checkHost('[::ffff:7f00:1]', { resolve: () => assert.fail('a literal is not looked up') }), { ok: false, error: 'a loopback address' });
  const nowhere = (h, o, cb) => cb(Object.assign(new Error('getaddrinfo ENOTFOUND nowhere.example'), { code: 'ENOTFOUND' }));
  assert.deepEqual(await checkHost('nowhere.example', { resolve: nowhere }), { ok: false, error: 'host not found' });
});

test('guardedLookup answers in both shapes the socket asks for, and refuses a blocked answer with EBLOCKED', async () => {
  const lookup = guardedLookup({ resolve: resolveTo('93.184.216.34') });
  assert.deepEqual(await new Promise(r => lookup('x.example', {}, (err, address, family) => r([err, address, family]))), [null, '93.184.216.34', 4]);
  assert.deepEqual(await new Promise(r => lookup('x.example', { all: true }, (err, list) => r([err, list]))), [null, [{ address: '93.184.216.34', family: 4 }]]);
  const bad = await new Promise(r => guardedLookup({ resolve: resolveTo('169.254.169.254') })('x.example', {}, err => r(err)));
  assert.equal(bad.code, 'EBLOCKED');
  assert.equal(bad.message, 'an address inside a network');
});

test('guardedFetch connects through its own lookup: a name pinned to the fake upstream reaches it, a name that resolves inside never connects', async () => {
  const up = await startUpstream();
  try {
    const pinned = guardedFetch({ allowLoopback: true, resolve: resolveTo('127.0.0.1') });
    const r = await pinned(`http://fake-upstream.test:${up.port}/mcp`, listInit);
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).result.tools.map(t => t.name), ['echo', 'boom', 'slow']);
    await assert.rejects(guardedFetch({ resolve: resolveTo('10.0.0.8') })(`http://evil.test:${up.port}/mcp`, listInit), e => e instanceof TypeError && e.cause?.code === 'EBLOCKED');
    await assert.rejects(guardedFetch({ resolve: resolveTo('127.0.0.1') })(`http://fake-upstream.test:${up.port}/mcp`, listInit), e => e.cause?.message === 'a loopback address');
    await assert.rejects(guardedFetch()(`http://127.0.0.1:${up.port}/mcp`, listInit), e => e.cause?.message === 'a loopback address', 'a literal is refused before any connection');
  } finally {
    await up.close();
  }
});

test('guardedFetch answers a redirect as it is and never follows it', async () => {
  const srv = createServer((req, res) => { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); res.end(); });
  const port = await new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
  try {
    const r = await guardedFetch({ allowLoopback: true })(`http://127.0.0.1:${port}/mcp`, { method: 'POST', body: '{}' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), 'http://169.254.169.254/latest/meta-data/');
  } finally {
    srv.close();
  }
});
