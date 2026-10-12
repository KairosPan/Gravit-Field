// tests/css.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderDiscover } from '../js/render/discover.js';
import { renderSubmit } from '../js/render/submit.js';
import { renderAdmin } from '../js/render/admin.js';
import { renderNotFound } from '../js/render/page.js';
import { makeCatalogue } from '../js/data/catalogue.js';
import { initialState } from '../js/reducers/discover.js';

const NOW = 1_700_000_000_000;
const T = (name, required = []) => ({ name, description: `${name} does a thing`, inputSchema: { type: 'object', properties: Object.fromEntries(required.map(k => [k, { type: 'string' }])), required } });
const P = (id, kind, extra = {}) => ({ id, name: id, kind, blurb: `${id} in one line`, url: `https://${id}.example/mcp`, homepage: `https://${id}.example`, by: `@${id}`, icon: null, needs: 'none', writes: ['message'], asks: ['“x?”'], tools: [], server: { name: 's', version: '1' }, toolList: [T('echo', ['text'])], status: 'up', probedAt: NOW - 60_000, latencyMs: 4, ...extra });
const manifest = { id: 'pend', name: 'Pend', kind: 'Data', blurb: 'pending', url: 'https://p.example/mcp', homepage: null, by: '@p', icon: null, needs: 'none', writes: ['message'], asks: [], tools: ['echo', 'nope'] };
const probeOk = { ok: true, server: { name: 's', version: '1' }, toolList: [T('echo')], latencyMs: 4, transport: 'http', missing: ['nope'] };
const cat = makeCatalogue({
  plugins: [P('alpha', 'Data', { icon: 'bars' }), P('beta', 'Crypto', { status: 'down' }), P('gamma', 'Monitors', { status: 'unknown', probedAt: null, server: null, toolList: Array.from({ length: 14 }, (_, i) => T(`t${i}`)) })],
  pending: [{ ...P('pend', 'Data'), at: NOW }],
  shelves: { featured: ['alpha'], Data: ['alpha'], Monitors: ['gamma'], Crypto: ['beta'] }, calls: { alpha: 2 }, origin: 'http://h', now: NOW,
});
const S = over => ({ ...initialState(), ...over });
const everyState = () => [
  S(), S({ drawer: 'alpha' }), S({ drawer: 'alpha', installed: ['alpha'], copied: 'line' }), S({ drawer: 'beta' }), S({ drawer: 'gamma' }), S({ drawer: 'gamma', toolsExpanded: true }), S({ drawer: 'pend' }),
  S({ create: {} }), S({ create: {}, client: 'Cursor' }), S({ create: {}, client: 'Codex', copied: 'create' }), S({ query: 'a' }), S({ query: 'zzz' }),
  S({ installedOnly: true, installed: ['alpha'] }), S({ route: { shelf: 'data', plugin: null } }), S({ route: { shelf: 'bots', plugin: null } }), S({ toast: { text: 'x' } }), S({ theme: 'black' }),
];
const everyPage = () => everyState().map(s => renderDiscover(s, cat)).join('')
  + renderSubmit({ values: { name: 'M', kind: 'Quant', icon: 'coin' } })
  + renderSubmit({ values: { name: 'Keep' }, result: { ok: false, error: { field: 'kind', rule: 'x' } } })
  + renderSubmit({ result: { ok: true, record: { manifest }, probe: probeOk } })
  + renderSubmit({ result: { ok: true, record: { manifest }, probe: { ok: false, error: 'down' } } })
  + renderAdmin({ pending: [{ rec: { manifest, probe: probeOk, via: 'form', at: NOW }, entry: { ...manifest, pending: true, status: 'up', toolList: probeOk.toolList } }, { rec: { manifest: { ...manifest, id: 'dead' }, probe: { ok: false, error: 'x' }, via: 'mcp', at: NOW }, entry: { ...manifest, id: 'dead', pending: true, status: 'down', toolList: [] } }], approved: [{ manifest }], approvedDir: '/d/approved', counts: { total: 3, lastHour: 1, plugins: { alpha: { total: 3, lastHour: 1, tools: {} } } }, now: NOW, error: 'oops' })
  + renderAdmin({})
  + renderNotFound();

test('every class the screens emit has a rule in app.css, and app.css names no colour by hex', async () => {
  const css = await readFile(new URL('../css/app.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,6}\b/, 'colours come from tokens.css');
  const classes = new Set(everyPage().match(/class="([^"]+)"/g).flatMap(m => m.slice(7, -1).split(/\s+/)));
  const missing = [...classes].filter(c => c && !new RegExp(`\\.${c.replace(/-/g, '\\-')}(?![\\w-])`).test(css));
  assert.deepEqual(missing, [], 'classes without a rule');
});

test('the numbers of the spec: the 420 search, 300 cards and 260 narrow, the 460 drawer, the 1180 column, 28 and 16 gutters; a down card dims; the toast sits under the drawer; braces balance', async () => {
  const css = await readFile(new URL('../css/app.css', import.meta.url), 'utf8');
  const rule = sel => css.match(new RegExp(`^${sel.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`, 'm'))?.[1] ?? '';
  assert.match(rule('.search'), /height: 44px; width: 420px/);
  assert.match(rule('.pcard'), /flex: 0 0 300px/);
  assert.match(rule('.pcard'), /grid-template-columns: 44px minmax\(0, 1fr\) auto/);
  assert.match(rule('.drawer'), /width: min\(460px, 100%\)/);
  assert.match(rule('.drawer'), /position: fixed/);
  assert.match(rule('.main'), /max-width: 1180px/);
  assert.match(rule('.main'), /padding: 24px 28px/);
  assert.match(rule('.shelf-row'), /margin: 0 -28px/, 'the row bleeds into the gutter');
  assert.match(css, /^\.pcard\.down \.av, \.pcard\.down \.pcard-body, \.pcard\.down \.pcard-kind \{ opacity: 0\.55; \}/m);
  assert.match(css, /^\.pcard\.down \{ color: var\(--text\); font-weight: 400; \}/m, 'the red, bold utility .down never colours a down card: it only dims');
  const narrow = css.match(/@media \(max-width: 600px\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(narrow, /\.main \{ padding: 16px 16px/);
  assert.match(narrow, /\.pcard \{ flex-basis: 260px; \}/);
  assert.match(narrow, /\.shelf-row \{ margin: 0 -16px/);
  const wide = css.match(/@media \(max-width: 860px\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(wide, /\.search \{ width: 100%/);
  assert.match(wide, /\.drawer \{ width: 100%/);
  const z = sel => Number(css.match(new RegExp(`^\\${sel} \\{[^}]*z-index: (\\d+)`, 'm'))?.[1]);
  assert.ok(z('.toast') < z('.drawer') && z('.drawer') < z('.modal-scrim'), 'toast under drawer under dialog');
  assert.match(css, /^\.radio-item input \{ position: absolute; opacity: 0/m, 'the radio itself is hidden, its label is the key');
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /^:focus-visible \{ outline: 2px solid var\(--alloc-equity\)/m);
  let depth = 0;
  css.split('\n').forEach((line, i) => { for (const ch of line) { if (ch === '{') depth++; else if (ch === '}') { depth--; assert.ok(depth >= 0, `a stray } on line ${i + 1}`); } } });
  assert.equal(depth, 0);
});
