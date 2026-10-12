// tests/ratelimit.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, clientIp, isLoopback, isLocalRequest } from '../js/ratelimit.js';

test('a bucket admits limit calls, refuses with a retry-after of at least one second, and refills with time', () => {
  let t = 0;
  const l = createLimiter({ limit: 3, perMs: 1000, now: () => t });
  assert.deepEqual([l.take('a'), l.take('a'), l.take('a')].map(r => r.ok), [true, true, true]);
  assert.deepEqual(l.take('a'), { ok: false, retryAfterSec: 1 });
  assert.equal(l.take('b').ok, true, 'another key has its own bucket');
  t = 334;
  assert.equal(l.take('a').ok, true, 'a third of the window refilled one token');
  assert.equal(l.take('a').ok, false);
  t = 5000;
  assert.deepEqual([l.take('a'), l.take('a'), l.take('a'), l.take('a')].map(r => r.ok), [true, true, true, false], 'never more than limit, however long the wait');
  t = 10_000;
  l.sweep();
  assert.equal(l.size(), 0, 'idle buckets are swept');
});

test('clientIp is the socket, or the first forwarded hop only when the proxy is trusted; isLoopback knows the three spellings', () => {
  const req = { socket: { remoteAddress: '203.0.113.9' }, headers: { 'x-forwarded-for': '198.51.100.1, 10.0.0.1' } };
  assert.equal(clientIp(req), '203.0.113.9');
  assert.equal(clientIp(req, { trustProxy: true }), '10.0.0.1', 'the hop the trusted proxy appended; the first is whatever the client wrote');
  assert.equal(clientIp({ socket: { remoteAddress: '::1' }, headers: {} }, { trustProxy: true }), '::1', 'no header, the socket');
  assert.equal(clientIp({ headers: {} }), '');
  for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(isLoopback(ip), true, ip);
  assert.equal(isLoopback('203.0.113.9'), false);
  assert.equal(isLoopback(''), false);
});

test('a request is local only when its socket is loopback and nothing forwarded it', () => {
  assert.equal(isLocalRequest({ socket: { remoteAddress: '127.0.0.1' }, headers: {} }), true);
  assert.equal(isLocalRequest({ socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: {} }), true);
  assert.equal(isLocalRequest({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '203.0.113.9' } }), false, 'a local proxy forwarded it');
  assert.equal(isLocalRequest({ socket: { remoteAddress: '::1' }, headers: { forwarded: 'for=198.51.100.7' } }), false);
  assert.equal(isLocalRequest({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-real-ip': '198.51.100.7' } }), false);
  assert.equal(isLocalRequest({ socket: { remoteAddress: '203.0.113.9' }, headers: {} }), false);
  assert.equal(isLocalRequest({ headers: {} }), false);
});

test('a limiter holds at most maxKeys buckets, dropping the oldest', () => {
  const l = createLimiter({ limit: 1, perMs: 60_000, now: () => 0, maxKeys: 2 });
  l.take('a'); l.take('b'); l.take('c');
  assert.equal(l.size(), 2);
  assert.equal(l.take('a').ok, true, 'a was dropped, so it starts full again');
});
