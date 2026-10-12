// tests/catalogue.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCatalogue, SHELVES, EMPTY_SHELVES } from '../js/data/catalogue.js';

const P = (id, kind, extra = {}) => ({ id, name: id.toUpperCase(), kind, blurb: `${id} does things`, url: 'https://x.example/mcp', homepage: null, by: '@x', icon: null, needs: 'none', writes: ['message'], asks: [], tools: [], ...extra });
const plugins = [P('a', 'Data'), P('b', 'Data', { name: 'ZED' }), P('c', 'Data', { name: 'MID' }), P('d', 'Crypto', { tools: ['get_price'] })];
const pending = [{ ...P('p1', 'Data'), at: 10 }, { ...P('p2', 'Data'), at: 20 }];
const shelves = { ...EMPTY_SHELVES, featured: ['d', 'a', 'p1'], Data: ['b', 'a'] };

test('shelves: featured as listed (pending never featured), a kind pending-first newest-first then listed then the rest by name, empty kinds left out', () => {
  const cat = makeCatalogue({ plugins, pending, shelves, origin: 'http://h' });
  assert.deepEqual(cat.shelves().map(s => [s.id, s.ids]), [
    ['featured', ['d', 'a']],
    ['data', ['p2', 'p1', 'b', 'a', 'c']],
    ['crypto', ['d']],
  ]);
  assert.equal(SHELVES.length, 6);
  assert.deepEqual(cat.shelf('bots'), { id: 'bots', title: 'Bots', kind: 'Bots', ids: [] }, 'an empty kind still answers shelf(id), for its grid page');
  assert.equal(cat.shelf('zzz'), null);
});

test('entries carry pending and calls; byId finds both kinds; toJSON round-trips into the same catalogue', () => {
  const cat = makeCatalogue({ plugins, pending, shelves, calls: { a: 3 }, origin: 'http://h', now: 5 });
  assert.equal(cat.byId('a').calls, 3);
  assert.equal(cat.byId('d').calls, 0);
  assert.equal(cat.byId('a').pending, false);
  assert.equal(cat.byId('p1').pending, true);
  assert.equal(cat.byId('nope'), null);
  assert.equal(cat.all.length, 6);
  const again = makeCatalogue(JSON.parse(JSON.stringify(cat.toJSON())));
  assert.deepEqual(again.shelves(), cat.shelves());
  assert.equal(again.origin, 'http://h');
  assert.equal(again.now, 5);
});

test('search is live over name, blurb, kind, by and tool names, case-insensitive, capped at 200 characters, empty for a blank query', () => {
  const cat = makeCatalogue({ plugins, pending, shelves });
  assert.deepEqual(cat.search('zed').map(p => p.id), ['b']);
  assert.deepEqual(cat.search('CRYPTO').map(p => p.id), ['d']);
  assert.deepEqual(cat.search('get_price').map(p => p.id), ['d']);
  assert.deepEqual(cat.search('@x').map(p => p.id), ['p1', 'p2', 'a', 'b', 'c', 'd'], 'pending first, every plugin shares the handle');
  assert.deepEqual(cat.search('   '), []);
  assert.deepEqual(cat.search('a.*'), [], 'a regex is just text');
  assert.deepEqual(cat.search('x'.repeat(500)), []);
});
