// tests/submissions.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSubmissions, pendingEntry } from '../js/submissions.js';

const manifest = id => ({ id, name: id.toUpperCase(), kind: 'Data', blurb: 'a thing', url: 'https://a.example/mcp', homepage: null, by: '@a', icon: null, needs: 'none', writes: ['message'], asks: [], tools: [] });
const probeOk = { ok: true, server: { name: 's', version: '1' }, toolList: [{ name: 'echo', description: '', inputSchema: { type: 'object' } }], latencyMs: 5, transport: 'http', missing: [] };

test('add, list newest first, get, has; approve and reject move the file; the three dirs exist', () => {
  let t = 100;
  const dataDir = mkdtempSync(join(tmpdir(), 'gf-'));
  const s = createSubmissions({ dataDir, now: () => t });
  for (const k of ['submissions', 'approved', 'rejected']) assert.ok(existsSync(join(dataDir, k)), k);
  const a = s.add({ manifest: manifest('aa'), probe: probeOk, via: 'form' });
  t = 200;
  s.add({ manifest: manifest('bb'), probe: { ok: false, error: 'nope' }, via: 'mcp' });
  assert.deepEqual(a, { manifest: manifest('aa'), probe: probeOk, via: 'form', at: 100 });
  assert.deepEqual(s.list().map(r => r.manifest.id), ['bb', 'aa']);
  assert.equal(s.has('aa'), true);
  assert.equal(s.has('zz'), false);
  assert.equal(s.get('zz'), null);
  t = 300;
  const ap = s.approve('aa', { probe: probeOk });
  assert.equal(ap.approvedAt, 300);
  assert.ok(existsSync(join(dataDir, 'approved', 'aa.json')));
  assert.equal(s.has('aa'), false);
  assert.deepEqual(s.approved().map(r => r.manifest.id), ['aa']);
  const rj = s.reject('bb', 'no such server');
  assert.equal(rj.reason, 'no such server');
  assert.ok(existsSync(join(dataDir, 'rejected', 'bb.json')));
  assert.deepEqual(s.list(), []);
  assert.equal(s.approve('bb', { probe: probeOk }), null, 'gone');
  assert.equal(s.reject('zz', 'x'), null);
});

test('an id that fails the rule never becomes a path; a corrupt file is skipped and logged', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'gf-'));
  const logged = [];
  const s = createSubmissions({ dataDir, log: m => logged.push(m) });
  assert.throws(() => s.get('../etc'), /invalid id/);
  assert.throws(() => s.add({ manifest: manifest('../etc'), probe: probeOk, via: 'form' }), /invalid id/);
  assert.throws(() => s.has('A'), /invalid id/);
  assert.deepEqual(readdirSync(join(dataDir, 'submissions')), []);
  writeFileSync(join(dataDir, 'submissions', 'cc.json'), '{not json');
  assert.deepEqual(s.list(), []);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /cc\.json/);
});

test('pendingEntry shows a submission the way the catalogue needs it', () => {
  const rec = { manifest: manifest('aa'), probe: probeOk, via: 'form', at: 100 };
  assert.deepEqual(pendingEntry(rec), { ...manifest('aa'), server: { name: 's', version: '1' }, toolList: probeOk.toolList, status: 'up', probedAt: 100, latencyMs: 5, at: 100 });
  const bad = pendingEntry({ manifest: manifest('bb'), probe: { ok: false, error: 'x' }, via: 'mcp', at: 5 });
  assert.equal(bad.status, 'down');
  assert.deepEqual(bad.toolList, []);
  assert.equal(bad.server, null);
});

test('the queue holds at most maxPending submissions; a file put beside them is listed; listing does not re-read what it has read', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'gf-'));
  const logged = [];
  let t = 100;
  const s = createSubmissions({ dataDir, maxPending: 2, log: m => logged.push(m), now: () => t });
  s.add({ manifest: manifest('aa'), probe: probeOk, via: 'form' });
  t = 200;
  s.add({ manifest: manifest('bb'), probe: probeOk, via: 'form' });
  assert.throws(() => s.add({ manifest: manifest('cc'), probe: probeOk, via: 'form' }), e => e.code === 'EFULL' && e.message === 'the review queue is full');
  assert.equal(s.has('cc'), false);
  writeFileSync(join(dataDir, 'submissions', 'dd.json'), JSON.stringify({ manifest: manifest('dd'), probe: probeOk, via: 'form', at: 5 }));
  writeFileSync(join(dataDir, 'submissions', 'ee.json'), '{not json');
  assert.deepEqual(s.list().map(r => r.manifest.id), ['bb', 'aa', 'dd']);
  s.list();
  s.list();
  assert.equal(logged.length, 1, 'the corrupt file is read and logged once, not on every listing');
  s.reject('dd', 'x');
  assert.deepEqual(s.list().map(r => r.manifest.id), ['bb', 'aa']);
});

test('one source holds at most maxPerSource places in the queue, others still get in, and a reviewed one frees its place', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'gf-'));
  const s = createSubmissions({ dataDir, maxPerSource: 2 });
  s.add({ manifest: manifest('aa'), probe: probeOk, via: 'form', from: 'k1' });
  s.add({ manifest: manifest('bb'), probe: probeOk, via: 'form', from: 'k1' });
  assert.throws(() => s.add({ manifest: manifest('cc'), probe: probeOk, via: 'form', from: 'k1' }), e => e.code === 'ESOURCE' && e.message === '2 of your submissions are already in review');
  assert.equal(s.add({ manifest: manifest('dd'), probe: probeOk, via: 'form', from: 'k2' }).from, 'k2');
  s.reject('aa', 'x');
  assert.equal(s.add({ manifest: manifest('ee'), probe: probeOk, via: 'form', from: 'k1' }).manifest.id, 'ee');
  assert.equal('from' in s.add({ manifest: manifest('ff'), probe: probeOk, via: 'form' }), false, 'no source, nothing recorded and nothing counted');
});
