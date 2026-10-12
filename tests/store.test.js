// tests/store.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';

const reducers = { inc: (s, n = 1) => ({ ...s, n: s.n + n }), same: s => s };

function memoryStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k), map: m };
}

test('dispatch runs the reducer, notifies once per change, and ignores a reducer that returns the same state', () => {
  const store = createStore({ initial: { n: 0 }, reducers });
  const seen = [];
  store.subscribe((s, type) => seen.push([type, s.n]));
  store.dispatch('inc', 2);
  store.dispatch('same');
  assert.deepEqual(seen, [['inc', 2]]);
  assert.throws(() => store.dispatch('nope'), /unknown action nope/);
});

test('persist decides what is written; hydrate rebuilds a state from what was saved; accept refuses a stale one', () => {
  const storage = memoryStorage();
  const a = createStore({ initial: { v: 1, n: 0, secret: 'x' }, reducers, storage, key: 'k', persist: s => ({ v: s.v, n: s.n }) });
  a.dispatch('inc', 5);
  assert.equal(storage.getItem('k'), '{"v":1,"n":5}');
  const b = createStore({ initial: { v: 1, n: 0, secret: 'x' }, reducers, storage, key: 'k', accept: saved => saved.v === 1, hydrate: saved => ({ v: 1, n: saved.n, secret: 'fresh' }) });
  assert.deepEqual(b.get(), { v: 1, n: 5, secret: 'fresh' });
  storage.setItem('k', '{"v":0,"n":9}');
  const c = createStore({ initial: { v: 1, n: 0 }, reducers, storage, key: 'k', accept: saved => saved.v === 1 });
  assert.deepEqual(c.get(), { v: 1, n: 0 }, 'a state from another version boots the initial one');
});

test('a storage that throws or holds garbage never breaks the store', () => {
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const a = createStore({ initial: { n: 0 }, reducers, storage: throwing, key: 'k' });
  a.dispatch('inc');
  assert.equal(a.get().n, 1);
  const b = createStore({ initial: { n: 0 }, reducers, storage: memoryStorage({ k: '{not json' }), key: 'k' });
  assert.equal(b.get().n, 0);
});
