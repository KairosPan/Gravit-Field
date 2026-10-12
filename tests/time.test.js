// tests/time.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ago, MIN, HOUR, DAY } from '../js/time.js';

test('ago reads as the drawer\'s Checked line: just now, minutes, hours, days', () => {
  const now = 1_000_000_000_000;
  assert.equal(ago(now, now), 'just now');
  assert.equal(ago(now - 30_000, now), 'just now');
  assert.equal(ago(now - 3 * MIN, now), '3 min ago');
  assert.equal(ago(now - 59 * MIN, now), '59 min ago');
  assert.equal(ago(now - 2 * HOUR, now), '2 h ago');
  assert.equal(ago(now - 3 * DAY, now), '3 d ago');
  assert.equal(ago(now + MIN, now), 'just now', 'a clock skew never reads as the future');
});
