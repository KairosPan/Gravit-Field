// tests/discover.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDiscover, card, keyFor, pluginDrawer, renderCreate, renderToast, exampleCall, header, TOOLS_SHOWN } from '../js/render/discover.js';
import { logo } from '../js/render/avatars.js';
import { clientLines, TOOL_NAMES, CLIENTS } from '../js/data/clients.js';
import { makeCatalogue } from '../js/data/catalogue.js';

const NOW = 1_700_000_000_000;
const count = (h, re) => (h.match(re) ?? []).length;
const state = (over = {}) => ({ v: 1, theme: 'system', route: { shelf: null, plugin: null }, query: '', installedOnly: false, drawer: null, create: null, toast: null, installed: [], client: 'Claude Code', copied: null, toolsExpanded: false, ...over });
const T = (name, required = []) => ({ name, description: `${name} does a thing`, inputSchema: { type: 'object', properties: Object.fromEntries(required.map(k => [k, { type: 'string' }])), required } });
const P = (id, kind, extra = {}) => ({ id, name: id[0].toUpperCase() + id.slice(1), kind, blurb: `${id} in one line`, url: `https://${id}.example/mcp`, homepage: `https://${id}.example`, by: `@${id}`, icon: null, needs: 'none', writes: ['message'], asks: [], tools: [], server: { name: `${id}-srv`, version: '1.2' }, toolList: [], status: 'up', probedAt: NOW - 3 * 60_000, latencyMs: 40, ...extra });
const plugins = [
  P('alpha', 'Data', { icon: 'bars', asks: ['“Is alpha up?”'], tools: ['echo'], toolList: [T('boom'), T('echo', ['text'])], writes: ['message', 'proposal'] }),
  P('beta', 'Crypto', { name: 'Beta <b>Crypto</b>', blurb: 'Beta </script><img src=x onerror=alert(1)> prices', homepage: null, status: 'down' }),
  P('gamma', 'Monitors', { server: null, status: 'unknown', probedAt: null, toolList: Array.from({ length: 15 }, (_, i) => T(`tool_${i}`)) }),
];
const pending = [{ ...P('delta', 'Data', { server: null, toolList: [T('echo')] }), at: NOW }];
const shelves = { featured: ['alpha', 'beta'], Data: ['alpha'], Monitors: ['gamma'], Bots: [], Crypto: ['beta'], Quant: [] };
const cat = makeCatalogue({ plugins, pending, shelves, calls: { alpha: 3, beta: 1 }, origin: 'http://127.0.0.1:4840', now: NOW });

test('the page: the header with search, My plugins, Create, Submit and the theme key; the shelves that have plugins, each with See all; nothing about money or authors on cards', () => {
  const h = renderDiscover(state(), cat);
  assert.match(h, /^<main class="main disc">/);
  assert.match(h, /<h1 class="head-title">Gravity Field<\/h1>/);
  assert.match(h, /id="dq"[^>]*placeholder="Search plugins"[^>]*data-action="query"/);
  assert.match(h, /data-action="toggleInstalledOnly" aria-pressed="false">My plugins</);
  assert.match(h, /class="pill" data-action="openCreate">[\s\S]*?Create<\/button>/);
  assert.match(h, /<a class="pill" href="\/submit">Submit<\/a>/);
  assert.match(h, /class="theme-key" data-action="setTheme" data-value="black" aria-label="Switch to black"/);
  assert.deepEqual(h.match(/class="shelf-title">([^<]+)</g).map(m => m.slice(20, -1)), ['Featured', 'Data', 'Monitors', 'Crypto'], 'Bots and Quant are empty and hidden');
  assert.equal(count(h, /See all ›/g), 4);
  assert.match(h, /<a class="link" data-nav href="\/discover\/data">See all ›<\/a>/);
  const data = h.slice(h.indexOf('shelf-title">Data'), h.indexOf('shelf-title">Monitors'));
  assert.match(data, /^[\s\S]*?class="pcard" data-action="openPlugin" data-id="delta"[\s\S]*?data-id="alpha"/, 'the pending submission leads its shelf');
  assert.doesNotMatch(h, /Free ·|by @|\$\d|Installed ·|shelf-sub/, 'no price, author or count line on a card');
  assert.match(renderDiscover(state(), makeCatalogue({})), /<div class="empty">No plugins<\/div>/);
  assert.match(header(state({ theme: 'black' })), /data-value="cream" aria-label="Switch to cream"/);
});

test('a card: 44 px logo, name, one line, the kind label, one key; four key states; pressed and down and grid classes; everything escaped', () => {
  const s = state();
  const a = card(cat.byId('alpha'), s);
  assert.match(a, /^<div class="pcard" data-action="openPlugin" data-id="alpha" role="button" tabindex="0"><span class="av av-glyph" role="img" aria-label="Alpha" style="width:44px;height:44px;border-radius:10px">/);
  assert.match(a, /class="pcard-name">Alpha<\/div><div class="pcard-blurb">alpha in one line<\/div>/);
  assert.match(a, /class="pcard-kind">DATA</);
  assert.match(a, /<button type="button" class="pkey install" data-action="install" data-id="alpha" aria-label="Install Alpha">/);
  assert.match(keyFor(cat.byId('alpha'), state({ installed: ['alpha'] })), /^<span class="pkeys"><span class="pkey-done" role="img" aria-label="Installed">[\s\S]*?<button type="button" class="pkey uninstall" data-action="uninstall" data-id="alpha" aria-label="Uninstall Alpha">/);
  assert.match(keyFor(cat.byId('delta'), s), /^<span class="pkey-wait" role="img" aria-label="In review">/);
  assert.match(card(cat.byId('alpha'), state({ drawer: 'alpha' })), /class="pcard pressed"/);
  assert.match(card(cat.byId('alpha'), s, { view: 'grid' }), /class="pcard in-grid"/);
  const b = card(cat.byId('beta'), s);
  assert.match(b, /class="pcard down"/);
  assert.match(b, /class="pcard-name">Beta &lt;b&gt;Crypto&lt;\/b&gt;</);
  assert.match(b, /Beta &lt;\/script&gt;&lt;img src=x onerror=alert\(1\)&gt; prices/);
  assert.doesNotMatch(b, /<script|<img/);
  assert.match(logo(cat.byId('beta'), 56), /^<span class="av av-letter tone-grey" role="img" aria-label="Beta &lt;b&gt;Crypto&lt;\/b&gt;" style="width:56px;height:56px;border-radius:10px;font-size:24px">B<\/span>$/);
});

test('the drawer: meta line, the sections in order, the tool list led by the manifest, Source, Use it with the client line and an example, Install at the foot', () => {
  const s = state({ drawer: 'alpha' });
  const d = pluginDrawer(cat.byId('alpha'), s, cat);
  assert.match(d, /^<aside class="drawer" aria-label="Alpha"><div class="drawer-head"><h2>Alpha<\/h2><button type="button" class="close-key" data-action="closeDrawer" aria-label="Close">×<\/button><\/div>/);
  assert.match(d, /class="plug-name">Alpha<\/div><div class="dim">Data · 2 tools · 3 calls<\/div>/);
  assert.match(d, /<p class="plug-blurb">alpha in one line\.<\/p>/);
  const labels = [...d.matchAll(/class="dsec-label">([^<]+)</g)].map(m => m[1]);
  assert.deepEqual(labels, ['What you can ask it', 'Tools', 'What it writes', 'What it needs from you', 'Source', 'Use it']);
  assert.match(d, /Tools<\/div><div class="dsec-line"><span class="mono">echo<\/span> <span class="dim">echo does a thing<\/span><\/div><div class="dsec-line"><span class="mono">boom<\/span>/, 'the manifest\'s tool first, then the rest');
  assert.match(d, /Messages, into the conversation[\s\S]*Proposals: inside your limit/);
  assert.match(d, /What it needs from you<\/div><div class="dsec-line">Nothing\.<\/div>/);
  assert.match(d, /<span class="kv-k">Server<\/span><span class="kv-v"><span class="mono">alpha\.example<\/span>/);
  assert.match(d, /<span class="kv-k">Version<\/span><span class="kv-v">alpha-srv 1\.2</);
  assert.match(d, /<span class="kv-k">By<\/span><span class="kv-v">@alpha</);
  assert.match(d, /<span class="kv-k">Homepage<\/span><span class="kv-v"><a class="link" href="https:\/\/alpha\.example" target="_blank" rel="noopener">alpha\.example<\/a>/);
  assert.match(d, /<span class="kv-k">Checked<\/span><span class="kv-v">3 min ago <span class="chip up">up<\/span>/);
  assert.match(d, /type="radio" name="client-use" value="Claude Code" data-action="setClient" checked/);
  assert.match(d, /<pre class="snippet-code mono">claude mcp add --transport http gravity-field http:\/\/127\.0\.0\.1:4840\/mcp<\/pre><button type="button" class="btn-sm copy-key" data-action="copy" data-key="line" data-copy="claude mcp add --transport http gravity-field http:\/\/127\.0\.0\.1:4840\/mcp">Copy<\/button>/);
  assert.match(d, /<pre class="snippet-code mono">plugin_call\(&quot;alpha&quot;, &quot;echo&quot;, \{ &quot;text&quot;: &quot;&lt;text&gt;&quot; \}\)<\/pre>/);
  assert.match(d, /<div class="drawer-foot"><button type="button" class="btn-primary" data-action="install" data-id="alpha">Install<\/button><\/div><\/div><\/aside>$/);
  assert.doesNotMatch(d, /What you sign|How it is paid|Free|May not/);
  assert.match(pluginDrawer(cat.byId('alpha'), state({ installed: ['alpha'], copied: 'line' }), cat), /data-action="uninstall" data-id="alpha">Uninstall<[\s\S]*/);
  assert.match(pluginDrawer(cat.byId('alpha'), state({ copied: 'line' }), cat), /data-key="line" data-copy="[^"]+">Copied<\/button>/);
  assert.match(pluginDrawer(cat.byId('alpha'), state({ client: 'Codex' }), cat), /<div class="snippet-file mono">~\/\.codex\/config\.toml<\/div><pre class="snippet-code mono">\[mcp_servers\.gravity-field\]\nurl = &quot;http:\/\/127\.0\.0\.1:4840\/mcp&quot;<\/pre>/);
});

test('the drawer of a pending, a down and an unchecked plugin; the tool list folds beyond twelve and unfolds', () => {
  const pend = pluginDrawer(cat.byId('delta'), state(), cat);
  assert.match(pend, /class="dim">Data · In review</);
  assert.doesNotMatch(pend, /drawer-foot|data-action="install"/);
  const down = pluginDrawer(cat.byId('beta'), state(), cat);
  assert.match(down, /class="dim">Crypto · 0 tools · 1 call</);
  assert.match(down, /<span class="chip down">down<\/span>/);
  assert.doesNotMatch(down, /Homepage|What you can ask it|dsec-label">Tools</);
  assert.doesNotMatch(down, /<script|<img/, 'the blurb is text, never a tag');
  const unk = pluginDrawer(cat.byId('gamma'), state(), cat);
  assert.match(unk, /<span class="kv-k">Checked<\/span><span class="kv-v"><span class="chip grey">unchecked<\/span>/);
  assert.doesNotMatch(unk, /Version/);
  assert.equal(count(unk, /dsec-line"><span class="mono">tool_/g), TOOLS_SHOWN);
  assert.match(unk, /<button type="button" class="link" data-action="toggleTools">3 more<\/button>/);
  const open = pluginDrawer(cat.byId('gamma'), state({ toolsExpanded: true }), cat);
  assert.equal(count(open, /dsec-line"><span class="mono">tool_/g), 15);
  assert.doesNotMatch(open, /more<\/button>/);
  assert.equal(exampleCall(cat.byId('gamma')), 'plugin_call("gamma", "tool_0", {})');
  assert.equal(exampleCall({ id: 'x', tools: [], toolList: [] }), null);
});

test('Create: the address, the four tool chips, a client switch and its line with Copy; nothing to type; absent when closed', () => {
  assert.equal(renderCreate(state(), cat), '');
  const m = renderCreate(state({ create: {} }), cat);
  assert.match(m, /^<div class="modal-scrim"><div class="modal wide" role="dialog" aria-label="Gravity Field MCP"><div class="modal-head"><h2 class="modal-title">Gravity Field MCP<\/h2><button type="button" class="close-key" data-action="closeCreate" aria-label="Close">×<\/button>/);
  assert.match(m, /<span class="field-label">Address<\/span><span class="mono">http:\/\/127\.0\.0\.1:4840\/mcp<\/span>/);
  assert.equal(count(m, /class="chip grey mono"/g), 4);
  for (const t of TOOL_NAMES) assert.ok(m.includes(`class="chip grey mono">${t}<`), t);
  assert.doesNotMatch(m, /shop_install|shop_mine|shop\.search/);
  assert.equal(count(m, /type="radio" name="client-create"/g), 3);
  assert.match(m, /data-key="create" data-copy="claude mcp add --transport http gravity-field http:\/\/127\.0\.0\.1:4840\/mcp">Copy</);
  assert.match(renderCreate(state({ create: {}, client: 'Cursor' }), cat), /<div class="snippet-file mono">~\/\.cursor\/mcp\.json<\/div><pre class="snippet-code mono">\{[\s\S]*?&quot;mcpServers&quot;[\s\S]*?&quot;gravity-field&quot;/);
  assert.doesNotMatch(m, /type="(?:text|url|password)"|<textarea|<form/);
  assert.match(renderDiscover(state({ create: {} }), cat), /modal-scrim/);
  assert.deepEqual(Object.keys(clientLines('http://h')), CLIENTS);
});

test('search, My plugins and a shelf route each replace the shelves with a grid; a toast sits in the main column', () => {
  const found = renderDiscover(state({ query: 'alph' }), cat);
  assert.equal(count(found, /class="shelf"/g), 0);
  assert.match(found, /class="grid-title">1 result</);
  assert.match(renderDiscover(state({ query: 'zzz' }), cat), /class="grid-title">0 results</);
  const mine = renderDiscover(state({ installedOnly: true, installed: ['alpha', 'delta'] }), cat);
  assert.match(mine, /aria-pressed="true">My plugins</);
  assert.match(mine, /class="grid-title">Installed</);
  assert.equal(count(mine, /class="pcard in-grid"/g), 1, 'a pending submission is never installed');
  const data = renderDiscover(state({ route: { shelf: 'data', plugin: null } }), cat);
  assert.match(data, /<a class="back-link" data-nav href="\/">‹ Gravity Field<\/a><div class="grid-title">Data<\/div>/);
  assert.equal(count(data, /class="pcard in-grid"/g), 2);
  const bots = renderDiscover(state({ route: { shelf: 'bots', plugin: null } }), cat);
  assert.match(bots, /class="grid-title">Bots<\/div><div class="grid"><\/div>/);
  const open = renderDiscover(state({ drawer: 'alpha', toast: { text: 'Alpha installed' } }), cat);
  assert.match(open, /^<main class="main disc with-drawer">/);
  assert.match(open, /<aside class="drawer" aria-label="Alpha">/);
  assert.match(open, /<div class="toast" role="status">Alpha installed<button type="button" class="toast-x" data-action="dismissToast" aria-label="Dismiss">×<\/button><\/div>/);
  assert.equal(renderToast({ text: 'x' }), '<div class="toast" role="status">x<button type="button" class="toast-x" data-action="dismissToast" aria-label="Dismiss">×</button></div>');
  assert.doesNotMatch(renderDiscover(state({ drawer: 'nope' }), cat), /<aside/, 'a drawer for an id that is gone is simply absent');
});
