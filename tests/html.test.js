// tests/html.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, attrs, cls } from '../js/html.js';

test('esc escapes the five characters and tolerates null', () => {
  assert.equal(esc(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(12), '12');
});

test('attrs drops false and null, writes true bare, escapes values', () => {
  assert.equal(attrs({ class: 'a', hidden: true, title: null, disabled: false, 'data-x': '"q"' }), ' class="a" hidden data-x="&quot;q&quot;"');
});

test('cls joins the truthy names', () => {
  assert.equal(cls('a', false, null, 'b', '', 'c'), 'a b c');
});
