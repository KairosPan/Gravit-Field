// tests/ledger.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLedger } from '../js/ledger.js';

const clock = (t0 = 1_000_000) => { let t = t0; return { now: () => t, tick: ms => { t += ms; } }; };

test('records, counts per plugin and per tool, the last hour window, perPlugin and forPlugin', () => {
  const c = clock();
  const l = createLedger({ now: c.now });
  l.record({ plugin: 'a', tool: 'x', ok: true, ms: 12.4 });
  l.record({ plugin: 'a', tool: 'y', ok: false, ms: 3 });
  c.tick(3_600_000 + 1);
  l.record({ plugin: 'b', tool: 'x', ok: true, ms: 0 });
  const k = l.counts();
  assert.equal(k.total, 3);
  assert.equal(k.lastHour, 1);
  assert.deepEqual(k.plugins.a, { total: 2, lastHour: 0, tools: { x: 1, y: 1 } });
  assert.deepEqual(l.perPlugin(), { a: 2, b: 1 });
  assert.equal(l.forPlugin('a'), 2);
  assert.equal(l.forPlugin('zzz'), 0);
  assert.deepEqual(l.record({ plugin: 'c', tool: 't', ok: 1, ms: -5 }), { at: c.now(), plugin: 'c', tool: 't', ok: true, ms: 0 });
});

test('writes JSONL, reads it back on the next boot, and skips a torn last line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gf-'));
  const file = join(dir, 'data', 'ledger.jsonl');
  const a = createLedger({ file, now: () => 7 });
  a.record({ plugin: 'a', tool: 'x', ok: true, ms: 1 });
  a.record({ plugin: 'a', tool: 'x', ok: true, ms: 2 });
  assert.equal(readFileSync(file, 'utf8'), '{"at":7,"plugin":"a","tool":"x","ok":true,"ms":1}\n{"at":7,"plugin":"a","tool":"x","ok":true,"ms":2}\n');
  writeFileSync(file, readFileSync(file, 'utf8') + '{"at":7,"plugin":"a","to', { flag: 'w' });
  const b = createLedger({ file, now: () => 8 });
  assert.equal(b.size(), 2);
  assert.equal(b.forPlugin('a'), 2);
});

test('the file rotates at rotateBytes and the counts carry on', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gf-'));
  const file = join(dir, 'ledger.jsonl');
  const l = createLedger({ file, rotateBytes: 120, now: () => 1_700_000_000_000 });
  for (let i = 0; i < 6; i++) l.record({ plugin: 'a', tool: 'x', ok: true, ms: i });
  const files = readdirSync(dir).sort();
  assert.ok(files.length >= 2, `rotated: ${files}`);
  assert.ok(files.some(f => /^ledger\.2023-11-14.*\.jsonl$/.test(f)), `a dated file: ${files}`);
  assert.equal(l.size(), 6);
  assert.equal(l.forPlugin('a'), 6);
});
