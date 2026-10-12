// tests/gateway.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGateway, trimContent, allowedTools, MAX_TEXT } from '../js/gateway.js';
import { startUpstream, startSilent } from './helpers/fake-upstream.js';

const entry = (url, extra = {}) => ({ id: 'alpha', name: 'Alpha', url, tools: ['echo', 'slow'], toolList: [], ...extra });

test('forwards a declared tool, passes the answer through, caches one client per plugin', async () => {
  const up = await startUpstream();
  const gw = createGateway({ timeoutMs: 5000, allowLoopback: true });
  try {
    const r = await gw.call(entry(up.url), 'echo', { text: 'hi' });
    assert.deepEqual(r.content, [{ type: 'text', text: 'echo:hi' }]);
    assert.equal(r.isError, false);
    assert.ok(r.ms >= 0);
    assert.deepEqual(up.calls, [['echo', 'hi']]);
    await gw.call(entry(up.url), 'echo', { text: 'again' });
    assert.equal(gw.size(), 1, 'the second call rode the first connection');
  } finally {
    await gw.close();
    await up.close();
  }
});

test('a tool the manifest does not declare is refused before any connection; an empty manifest list admits every listed tool', async () => {
  const up = await startUpstream();
  const gw = createGateway({ allowLoopback: true });
  try {
    assert.deepEqual(await gw.call(entry(up.url), 'boom', {}), { error: 'tool not offered', ms: 0 });
    assert.equal(gw.size(), 0);
    const r = await gw.call(entry(up.url, { tools: [], toolList: [{ name: 'boom' }] }), 'boom', {});
    assert.equal(r.isError, true, 'the upstream\'s own isError passes through');
    assert.deepEqual(r.content, [{ type: 'text', text: 'it broke' }]);
    assert.deepEqual(allowedTools({ tools: ['a'], toolList: [{ name: 'b' }] }), ['a']);
    assert.deepEqual(allowedTools({ tools: [], toolList: [{ name: 'b' }] }), ['b']);
  } finally {
    await gw.close();
    await up.close();
  }
});

test('an unreachable upstream is reported, marks the plugin down, and never hangs', async () => {
  const down = [];
  const gw = createGateway({ onDown: (id, why) => down.push([id, why]), timeoutMs: 1000, allowLoopback: true });
  const r = await gw.call(entry('http://127.0.0.1:1/mcp'), 'echo', { text: 'x' });
  assert.equal(r.error, 'upstream unreachable');
  assert.equal(down.length, 1);
  assert.equal(down[0][0], 'alpha');
  await gw.close();
});

test('a slow upstream times out as unreachable, the client is dropped, and the next call reconnects', async () => {
  const up = await startUpstream();
  const down = [];
  const gw = createGateway({ timeoutMs: 300, onDown: id => down.push(id), allowLoopback: true });
  try {
    const t0 = Date.now();
    const r = await gw.call(entry(up.url), 'slow', { ms: 2000 });
    assert.equal(r.error, 'upstream unreachable');
    assert.ok(Date.now() - t0 < 1500);
    assert.deepEqual(down, ['alpha']);
    assert.equal(gw.size(), 0);
    const again = await gw.call(entry(up.url), 'echo', { text: 'back' });
    assert.deepEqual(again.content, [{ type: 'text', text: 'echo:back' }]);
    assert.equal(gw.size(), 1);
  } finally {
    await gw.close();
    await up.close();
  }
});

test('the upstream\'s own MCP error is the caller\'s tool error, not a line down; a huge text answer is cut at MAX_TEXT', async () => {
  const up = await startUpstream();
  const down = [];
  const gw = createGateway({ onDown: id => down.push(id), timeoutMs: 5000, allowLoopback: true });
  try {
    const r = await gw.call(entry(up.url, { tools: [], toolList: [{ name: 'nope' }] }), 'nope', {});
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /nope/);
    assert.deepEqual(down, []);
    const big = await gw.call(entry(up.url), 'echo', { text: 'x'.repeat(MAX_TEXT + 1000) });
    assert.ok(big.content[0].text.length < MAX_TEXT + 100);
    assert.match(big.content[0].text, /\[cut at 262144 characters\]$/);
    assert.deepEqual(trimContent([{ type: 'image', data: 'x'.repeat(10), mimeType: 'image/png' }]), [{ type: 'image', data: 'x'.repeat(10), mimeType: 'image/png' }]);
    assert.deepEqual(trimContent(undefined), []);
  } finally {
    await gw.close();
    await up.close();
  }
});

test('a silent upstream at connect time is unreachable within the timeout', async () => {
  const silent = await startSilent();
  const gw = createGateway({ timeoutMs: 300, allowLoopback: true });
  try {
    const t0 = Date.now();
    const r = await gw.call(entry(silent.url), 'echo', { text: 'x' });
    assert.equal(r.error, 'upstream unreachable');
    assert.ok(Date.now() - t0 < 2500);
  } finally {
    await gw.close();
    await silent.close();
  }
});

test('a plugin whose name now resolves inside a network is refused at connect time; loopback only when allowed', async () => {
  const up = await startUpstream();
  const down = [];
  const rebound = createGateway({ timeoutMs: 1000, onDown: id => down.push(id), resolve: (h, o, cb) => cb(null, [{ address: '169.254.169.254', family: 4 }]) });
  const strict = createGateway({ timeoutMs: 1000 });
  try {
    assert.equal((await rebound.call(entry('https://rebind.example/mcp'), 'echo', { text: 'x' })).error, 'upstream unreachable');
    assert.deepEqual(down, ['alpha']);
    assert.equal((await strict.call(entry(up.url), 'echo', { text: 'x' })).error, 'upstream unreachable', 'the fake upstream is loopback, refused without allowLoopback');
    assert.deepEqual(up.calls, []);
  } finally {
    await rebound.close();
    await strict.close();
    await up.close();
  }
});
