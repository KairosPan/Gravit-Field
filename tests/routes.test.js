// tests/routes.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePath, toPath, SHELF_IDS } from '../js/routes.js';

test('parsePath knows the five shapes and nothing else; toPath is its inverse for the shelves screen', () => {
  assert.deepEqual(parsePath('/'), { page: 'shelves', shelf: null, plugin: null });
  assert.deepEqual(parsePath(''), { page: 'shelves', shelf: null, plugin: null });
  assert.deepEqual(parsePath('/discover/data'), { page: 'shelves', shelf: 'data', plugin: null });
  assert.deepEqual(parsePath('/discover/featured/'), { page: 'shelves', shelf: 'featured', plugin: null });
  assert.deepEqual(parsePath('/p/secedgar'), { page: 'shelves', shelf: null, plugin: 'secedgar' });
  assert.deepEqual(parsePath('/submit'), { page: 'submit', shelf: null, plugin: null });
  assert.deepEqual(parsePath('/admin'), { page: 'admin', shelf: null, plugin: null });
  for (const bad of ['/discover', '/discover/zzz', '/discover/data/x', '/p', '/p/Bad', '/p/a', '/p/../x', '/submit/x', '/admin/x', '/x', '/api/plugins']) assert.equal(parsePath(bad), null, bad);
  assert.equal(SHELF_IDS.length, 6);
  assert.equal(toPath({ shelf: null, plugin: null }), '/');
  assert.equal(toPath({ shelf: 'data', plugin: null }), '/discover/data');
  assert.equal(toPath({ shelf: 'data', plugin: 'alpha' }), '/p/alpha', 'a drawer wins over a shelf');
});
