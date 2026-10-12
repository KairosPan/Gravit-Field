# Gravity Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable Gravity Field demo: a site that lists real remote investment MCP servers as plugins, an MCP face at `/mcp` whose `plugin_call` forwards to them and keeps an anonymous ledger, and a submission queue the operator approves.

**Architecture:** One Node 22 process (`serve.js`) renders every page from pure `render*(state, cat) → html` functions ported from gravit-ui's Discover screen and serves those same modules to the browser, where `js/client.js` re-renders from a small store. `/mcp` is a stateless streamable-HTTP MCP server built per request from shared services (registry, submissions, ledger, gateway, rate limiters). The catalogue is `plugins/*.json` in the repository plus runtime-approved files under the data dir; there is no database.

**Tech Stack:** Node ≥ 22, ES modules, `node:test` + `node:assert/strict`; `@modelcontextprotocol/sdk` 1.32 (server and client, streamable HTTP with SSE fallback); `zod` 4; Linqi's `tokens.css`; no bundler, no framework, no build step.

**Spec:** `docs/superpowers/specs/2026-10-11-gravity-field-design.md`. Section numbers below (§3.1, §6…) cite that spec. The Discover screen this ports lives in Evolving-Alpha-US PR #7, branch `feat/gravit-ui` — local checkout `/Users/pan/Desktop/self-evolve/evolving-alpha-us`, worktree `.claude/worktrees/gravit-ui/gravit-ui/`; every ported line is reproduced in this plan, so the worktree is reference, not a dependency.

## Global Constraints

- Node `>=22`; `package.json` has `"type": "module"`; two dependencies only: `@modelcontextprotocol/sdk` and `zod` (spec §11). No build step: `js/` is served as it is and imported by Node as it is.
- Render modules (`js/render/*`), reducers, `js/data/catalogue.js`, `js/data/manifest.js`, `js/data/clients.js`, `js/routes.js`, `js/html.js`, `js/icons.js`, `js/time.js`, `js/store.js` import nothing from Node: they run in the browser too.
- Colours only by token name in `css/app.css` (`var(--surface)`, never a hex); the one sheet of tokens is Linqi's plus `--down-edge` and `--on-equity` (spec §5.1).
- Sizes from the spec: search pill 44 × 420, cards 300 (260 below 600 px), logo 44 (56 in the drawer), drawer 460, keys 36, radii 10/16/20/pill, main column max-width 1180, gutters 28 (16 below 600).
- Screens carry no explanatory small print (spec §10): labels and data only.
- The product speaks English. MCP tool names use underscores: `shop_search`, `shop_get`, `shop_publish`, `plugin_call`; `shop_install`, `shop_uninstall`, `shop_mine` are not registered (§6).
- A plugin URL is https (http only for `127.0.0.1`/`localhost` when `allowLoopback` is set); `needs` must be `none`; a manifest's `tools` must be a subset of what the server lists (§3.1, §8.1).
- The gateway forwards no request header, IP or token upstream and holds no credential (§7).
- Every string that reaches HTML passes through `esc`; the catalogue JSON embedded in a page has `<` escaped (§9).
- Tests are `node:test`, no DOM, no network: render functions are asserted as strings; upstreams are the in-process fake of `tests/helpers/fake-upstream.js`; `createApp` runs on port 0 with `probeOnBoot: false`.
- Commit messages: plain words, no backticks, no parentheses, no shell; one commit per task; `git add` only the task's files.

## Review Focus

1. **A manifest URL that points inside the network** — `http://169.254.169.254/`, `https://10.0.0.8/mcp`, `https://user:pw@host/mcp`: the probe must refuse it before connecting, and the submission must be refused with the rule. Pinned in Task 5 (`allowedUrl` refuses loopback, link-local, private ranges and credentials; `probe` returns `ok: false` without a connection).
2. **An upstream that answers slowly or endlessly, or with megabytes** — `plugin_call` must return `upstream unreachable` within `upstreamTimeoutMs`, never hang the request, and must cut a text result at 256 KB with a note. Pinned in Task 6 (the fake upstream's `slow` tool against a 300 ms timeout; a 300 KB `echo` is truncated).
3. **A submission id that collides or escapes** — the same id as a committed plugin, as a pending submission, a different-case `SecEdgar`, or `../etc`: refused by the validator or the door, and no file is ever written outside `submissions/`. Pinned in Task 3 (the id regex), Task 8 (`file()` throws on an invalid id) and Task 13 (the door refuses both collisions).
4. **A blurb or name containing `</script>` or `<img onerror>`** — it must render harmless on cards, in the drawer and inside the embedded catalogue JSON. Pinned in Task 10 (card and drawer escape) and Task 12 (`safeJson` turns `<` into `<`; the page test submits such a blurb through a fixture).
5. **A browser whose `localStorage` throws or holds a stale state** — a saved state from another version (`v` ≠ 1), or a storage that throws on read and write, must boot the fresh state with the page's route and keep working. Pinned in Task 2 (`createStore` falls back on a throwing storage and a refused state) and Task 17 (`boot` with `v: 0` saved and with a throwing storage).

---

## File structure

```
Gravity Field/
  package.json              type module, node >=22; scripts start / test / probe / export; deps sdk + zod
  serve.js                  createApp(options) → http.Server with .services and .ready; the CLI
  js/
    html.js                 esc, attrs, cls
    icons.js                ICONS paths (gravit-ui's set plus sun, moon), icon(name, size, sw)
    time.js                 MIN, HOUR, DAY, ago(ts, now)
    store.js                createStore({ initial, reducers, storage, key, accept, persist, hydrate })
    routes.js               parsePath(pathname) → route | null, toPath(route), SHELF_IDS
    data/manifest.js        KINDS, WRITES, NEEDS, RULES, validateManifest(input, { allowLoopback }) → { ok, manifest } | { ok: false, error: { field, rule } }
    data/catalogue.js       SHELVES, EMPTY_SHELVES, makeCatalogue({ plugins, pending, shelves, calls, origin, now }) — pure, isomorphic
    data/load.js            loadCommitted(root, opts) → { plugins, shelves }; loadRuntime(dir, opts) → manifests
    data/clients.js         CLIENTS, TOOL_NAMES, clientLines(origin)
    probe.js                allowedUrl(url, opts), connectUpstream(url, opts), probe(url, opts)
    gateway.js              createGateway({ timeoutMs, onDown }) → { call(entry, tool, args), close() }; MAX_TEXT
    ledger.js               createLedger({ file, rotateBytes }) → { record, counts, perPlugin, forPlugin }
    ratelimit.js            createLimiter({ limit, perMs }) → { take(key) }; clientIp(req, { trustProxy }); isLoopback(ip)
    submissions.js          createSubmissions({ dataDir }) → { list, get, has, add, approve, reject, approved, dirs }
    registry.js             createRegistry({ root, dataDir, probe }) → { reload, list, byId, has, shelves, setProbe, setStatus, probeAll }
    door.js                 submitManifest(services, input, via), approveSubmission(services, id), pendingEntry(rec), body readers
    pages.js                createPages(services) → route handler for /, /discover/<shelf>, /p/<id>, 404
    api.js                  createApi(services) → route handler for /api/*
    mcp.js                  makeServer(services, ctx), createMcpHandler(services), INSTRUCTIONS
    admin.js                adminAllowed(req, url, services), createAdmin(services) → route handler for /admin and /api/admin/*
    render/avatars.js       mark(spec, size, radius, name), logo(entry, size)
    render/discover.js      header, keyFor, card, pluginDrawer, renderCreate, renderToast, renderDiscover(state, cat)
    render/page.js          renderDocument({ title, body, data, theme }), renderNotFound(), safeJson(v)
    render/submit.js        renderSubmit({ values, result, cat })
    render/admin.js         renderAdmin({ pending, approved, counts, cat })
    reducers/discover.js    SEED_VERSION, initialState(seed), persist(s), accept(saved), reducers
    client.js               boot(win) → store; KEY, THEME_KEY, COPIED_MS, TOAST_MS
  css/tokens.css css/app.css
  plugins/                  coingecko.json secedgar.json ryufin.json cryptowisser.json stocklens.json pmpicks.json shelves.json
  scripts/probe.js scripts/export.js
  data/                     gitignored: submissions/ approved/ rejected/ ledger.jsonl
  tests/*.test.js tests/helpers/fake-upstream.js tests/helpers/fake-dom.js tests/fixtures/plugins/
  README.md
```

## Shared interfaces

Defined in the tasks named, repeated here so a task can be read alone.

```js
// a manifest (Task 3), as validateManifest returns it — normalised: by starts with '@', defaults filled
{ id, name, kind, blurb, url, homepage: string|null, by, icon: string|null, needs: 'none', writes: ['message'|'proposal'], asks: string[], tools: string[] }

// a probe result (Task 5)
{ ok: true, server: { name, version }, toolList: [{ name, description, inputSchema }], latencyMs, transport: 'http'|'sse' }
{ ok: false, error: string }

// an entry (Task 9 for approved, Task 13 for pending): a manifest plus derived fields
{ ...manifest, server: {name,version}|null, toolList: [], status: 'up'|'down'|'unknown', probedAt: ms|null, latencyMs: ms|null, calls: number, pending: boolean, at?: ms }

// the catalogue view (Task 4): built the same way on the server and in the browser
cat = makeCatalogue({ plugins, pending, shelves, calls, origin, now })
cat.all · cat.byId(id) · cat.shelves() → [{ id, title, kind?, ids }] (empty shelves left out) · cat.shelf(id) · cat.search(q) · cat.origin · cat.now · cat.toJSON()

// the browser state (Task 11)
{ v: 1, theme: 'system'|'cream'|'black', route: { shelf: string|null, plugin: string|null }, query: '', installedOnly: false,
  drawer: string|null, create: null | {}, toast: null | { text }, installed: string[], client: 'Claude Code'|'Cursor'|'Codex', copied: string|null, toolsExpanded: false }

// services (Task 9), what every route handler and the MCP face receive
{ options, log, registry, submissions, ledger, gateway, limiters: { requests, calls, submissions }, probe(url), origin(req) → 'http://host', catalogue(req) → cat }

// the gateway's answer (Task 6)
{ content, isError, ms } | { error: 'tool not offered'|'upstream unreachable', ms }

// a route handler (Tasks 12–16): returns true when it answered
async (ctx) => boolean, where ctx = { req, res, url, path, ip, services }
```

---

### Task 1: Scaffold — package, static server, tokens

**Files:**
- Create: `package.json`, `serve.js`, `css/tokens.css`
- Test: `tests/serve.test.js`

**Interfaces:**
- Produces: `createApp(options) → http.Server` (static `/css/*` and `/js/*`, `/healthz`, 404), `defaults(env)`, `contentType(path)`, `sendJson(res, status, body, headers)`, `sendHtml(res, status, html, headers)`, `notFound(res)`, `serveStatic(root, pathname, res)`, `HERE` from `serve.js`.

- [ ] **Step 1: Write package.json and install**

```json
{
  "name": "gravity-field",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Gravity Field: a registry of investment plugins — a site and an MCP face that forwards calls to real remote MCP servers",
  "scripts": {
    "start": "node serve.js",
    "test": "node --test tests/*.test.js",
    "probe": "node scripts/probe.js",
    "export": "node scripts/export.js"
  },
  "engines": { "node": ">=22" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.32.1",
    "zod": "^4.1.0"
  }
}
```

Run: `npm install`
Expected: `node_modules/` appears (gitignored); `package-lock.json` is created and is committed with this task.

- [ ] **Step 2: Write the failing test**

```js
// tests/serve.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, contentType } from '../serve.js';

function listen(app) {
  return new Promise(resolve => app.listen(0, '127.0.0.1', () => resolve(app.address().port)));
}

test('contentType maps the files the site serves', () => {
  assert.equal(contentType('x.html'), 'text/html; charset=utf-8');
  assert.equal(contentType('js/client.js'), 'text/javascript; charset=utf-8');
  assert.equal(contentType('css/app.css'), 'text/css; charset=utf-8');
  assert.equal(contentType('x.bin'), 'application/octet-stream');
});

test('static files under css/ and js/ are served with no cache; anything else under them is 404; the root is not reachable through them', async () => {
  const app = createApp({ probeOnBoot: false });
  const port = await listen(app);
  try {
    const css = await fetch(`http://127.0.0.1:${port}/css/tokens.css`);
    assert.equal(css.status, 200);
    assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8');
    assert.equal(css.headers.get('cache-control'), 'no-store');
    assert.match(await css.text(), /--surface: #ffffff/);
    assert.equal((await fetch(`http://127.0.0.1:${port}/js/nope.js`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/css/../package.json`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/css/%2e%2e/package.json`)).status, 404);
  } finally {
    app.close();
  }
});

test('healthz answers ok; a malformed escape is 400 and the server keeps serving; an unknown route is 404', async () => {
  const app = createApp({ probeOnBoot: false });
  const port = await listen(app);
  try {
    const h = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(h.status, 200);
    assert.equal((await h.json()).ok, true);
    assert.equal((await fetch(`http://127.0.0.1:${port}/%E0%A4%A`)).status, 400);
    assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${port}/nope`)).status, 404);
  } finally {
    app.close();
  }
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tests/serve.test.js`
Expected: FAIL — `Cannot find module '../serve.js'`.

- [ ] **Step 4: Write css/tokens.css**

Linqi's two themes as gravit-ui carries them (`gravit-ui/css/tokens.css`), verbatim:

```css
/* css/tokens.css — Linqi's tokens.css values (buyer-agent-demo @ 0ef5131), Cream and Black, plus --down-edge and --on-equity, as gravit-ui carries them */
:root,
:root[data-theme="cream"] {
  color-scheme: light;
  --bg: #f6f4ef; --surface: #ffffff; --surface-2: #ece8e0; --text: #121417; --dim: #5d5a53;
  --border: #e6e1d7; --card-border: #ece8e0; --rule: #121417; --primary: #121417; --on-primary: #ffffff;
  --warn: #d9741e; --warn-text: #94480c; --warn-fill: #fdf0e3; --warn-edge: #f3d2b4;
  --up: #0d7a52; --up-fill: #e4efe6; --down: #b4441c; --down-fill: #f6e6df;
  --down-edge: #e8c2b4;
  --on-equity: #ffffff;
  --hover: rgba(18, 20, 23, 0.05); --scrim: rgba(18, 20, 23, 0.32);
  --shadow-card: 0 1px 2px rgba(16, 24, 40, 0.06), 0 1px 3px rgba(16, 24, 40, 0.05);
  --shadow-lift: 0 8px 30px rgba(16, 24, 40, 0.1);
  --shadow: 0 16px 48px rgba(16, 24, 40, 0.16);
  --rail-bg: #ffffff;
  --alloc-cash: #c9c3b7; --alloc-stable: #5d5a53; --alloc-crypto: #121417; --alloc-equity: #3b5bdb;
  --alloc-rwa: #d9741e; --alloc-event: #0d7a52; --area: rgba(18, 20, 23, 0.05);
}
:root[data-theme="black"] {
  color-scheme: dark;
  --bg: #0e0f11; --surface: #17191c; --surface-2: #212429; --text: #f2f3f5; --dim: #a3a9b4;
  --border: #2b2e34; --card-border: #25282d; --rule: #f2f3f5; --primary: #f2f3f5; --on-primary: #0e0f11;
  --warn: #f0a040; --warn-text: #f5b866; --warn-fill: #2b2112; --warn-edge: #f0a040;
  --up: #4cc38a; --up-fill: #16301f; --down: #f08a6c; --down-fill: #35201a;
  --down-edge: #f08a6c;
  --on-equity: #ffffff;
  --hover: rgba(242, 243, 245, 0.06); --scrim: rgba(0, 0, 0, 0.6);
  --shadow-card: none; --shadow-lift: none; --shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
  --rail-bg: #12151b;
  --alloc-cash: #4a4e56; --alloc-stable: #a3a9b4; --alloc-crypto: #f2f3f5; --alloc-equity: #5c7cfa; --alloc-rwa: #f0a040; --alloc-event: #4cc38a; --area: rgba(242, 243, 245, 0.06);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
    color-scheme: dark;
    --bg: #0e0f11; --surface: #17191c; --surface-2: #212429; --text: #f2f3f5; --dim: #a3a9b4;
    --border: #2b2e34; --card-border: #25282d; --rule: #f2f3f5; --primary: #f2f3f5; --on-primary: #0e0f11;
    --warn: #f0a040; --warn-text: #f5b866; --warn-fill: #2b2112; --warn-edge: #f0a040;
    --up: #4cc38a; --up-fill: #16301f; --down: #f08a6c; --down-fill: #35201a;
    --down-edge: #f08a6c;
    --on-equity: #ffffff;
    --hover: rgba(242, 243, 245, 0.06); --scrim: rgba(0, 0, 0, 0.6);
    --shadow-card: none; --shadow-lift: none; --shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
    --rail-bg: #12151b;
    --alloc-cash: #4a4e56; --alloc-stable: #a3a9b4; --alloc-crypto: #f2f3f5; --alloc-equity: #5c7cfa; --alloc-rwa: #f0a040; --alloc-event: #4cc38a; --area: rgba(242, 243, 245, 0.06);
  }
}
:root {
  --font-sans: "Manrope", "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Segoe UI", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", "SF Mono", Menlo, Consolas, monospace;
  --radius-s: 10px; --radius-m: 16px; --radius-l: 20px; --radius-pill: 999px;
}
```

- [ ] **Step 5: Write serve.js**

```js
// serve.js — Gravity Field: one Node process that is the site, the API, the MCP face and the gateway (spec §4)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = fileURLToPath(new URL('.', import.meta.url));
export const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
};

export function contentType(path) {
  return TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

// every option defaults from the environment (spec §4)
export function defaults(env = process.env) {
  return {
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT || 4840),
    root: HERE,
    dataDir: env.GF_DATA_DIR || join(HERE, 'data'),
    publicOrigin: env.GF_PUBLIC_ORIGIN || null,
    adminToken: env.GF_ADMIN_TOKEN || null,
    upstreamTimeoutMs: Number(env.GF_UPSTREAM_TIMEOUT_MS || 20_000),
    trustProxy: env.GF_TRUST_PROXY === '1' || env.GF_TRUST_PROXY === 'true',
    probeOnBoot: true,
    probeEveryMs: 15 * 60_000,
    allowLoopback: false,
  };
}

export function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

export function sendHtml(res, status, html, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(html);
}

export function notFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found');
}

// css/ and js/ are served as they are, with no cache headers (the face/client/* lesson); a path that
// normalises out of those two folders is not a file of the site
export async function serveStatic(root, pathname, res) {
  const rel = normalize(decodeURIComponent(pathname));
  if (!/^\/(css|js)\/[^/]/.test(rel)) return notFound(res);
  try {
    const body = await readFile(join(root, rel));
    res.writeHead(200, { 'content-type': contentType(rel), 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    notFound(res);
  }
}

export function createApp(options = {}) {
  const o = { ...defaults(), ...options };
  const server = createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
    const path = url.pathname;
    if (req.method === 'GET' && /^\/(css|js)\//.test(path)) return serveStatic(o.root, path, res);
    if (path === '/healthz') return sendJson(res, 200, { ok: true });
    notFound(res);
  });
  server.options = o;
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = defaults();
  createApp().listen(o.port, o.host, () => console.log(`Gravity Field at http://${o.host}:${o.port}/`));
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test tests/serve.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json serve.js css/tokens.css tests/serve.test.js
git commit -m "feat: scaffold the package, the static server and the token sheet"
```

---

### Task 2: The shared helpers — html, icons, time, store

**Files:**
- Create: `js/html.js`, `js/icons.js`, `js/time.js`, `js/store.js`
- Test: `tests/html.test.js`, `tests/time.test.js`, `tests/store.test.js`

**Interfaces:**
- Produces: `esc(s)`, `attrs(obj)`, `cls(...names)`; `ICONS`, `icon(name, size = 22, sw = 2)`; `MIN`, `HOUR`, `DAY`, `ago(ts, now)`; `createStore({ initial, reducers, storage, key, accept, persist, hydrate }) → { get, dispatch(type, payload), subscribe(fn), reset(next) }`.

- [ ] **Step 1: Write the failing tests**

```js
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
```

```js
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
```

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/html.test.js tests/time.test.js tests/store.test.js`
Expected: FAIL — the three modules do not exist.

- [ ] **Step 3: Write js/html.js**

```js
// js/html.js — the three helpers every render module uses; render functions return strings
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
}

export function attrs(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== false && v != null)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`))
    .join('');
}

export function cls(...names) {
  return names.filter(Boolean).join(' ');
}
```

- [ ] **Step 4: Write js/icons.js**

gravit-ui's set, plus `sun` and `moon` for the theme key and `copy` for copy keys:

```js
// js/icons.js — 24-box line icons: gravit-ui's set, plus sun, moon and copy
export const ICONS = {
  chat: '<path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.5-4.5A8 8 0 1 1 21 12z"></path>',
  plus: '<path d="M12 5v14M5 12h14"></path>',
  chevDown: '<path d="M6 9l6 6 6-6"></path>',
  chevRight: '<path d="M9 6l6 6-6 6"></path>',
  chevLeft: '<path d="M15 6l-6 6 6 6"></path>',
  compass: '<circle cx="12" cy="12" r="9"></circle><path d="M15.5 8.5l-2 5-5 2 2-5z"></path>',
  markets: '<path d="M4 18l5-6 4 3 7-9"></path>',
  trade: '<path d="M7 7h10M7 12h10M7 17h6"></path>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"></path>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M3 7l9 6 9-6"></path>',
  wallet: '<path d="M3 7h15a3 3 0 0 1 3 3v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><path d="M3 7V6a2 2 0 0 1 2-2h11v3"></path><circle cx="17" cy="14" r="1.2"></circle>',
  search: '<circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path>',
  check: '<path d="M5 12l5 5 9-10"></path>',
  x: '<path d="M6 6l12 12M18 6L6 18"></path>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"></path>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"></path><path d="M9 12l2 2 4-4"></path>',
  bars: '<path d="M5 20V10M12 20V4M19 20v-7"></path>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"></path><path d="M4 19a2 2 0 0 1 2-2h13"></path>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"></path><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"></path>',
  plane: '<path d="M21 3L3 10l7 3 3 7z"></path><path d="M10 13l11-10"></path>',
  wave: '<path d="M3 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0"></path><path d="M3 17c2-3 4-3 6 0s4 3 6 0 4-3 6 0"></path>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M3 10h18M8 3v4M16 3v4"></path>',
  columns: '<path d="M3 21h18M5 21V10M9 21V10M15 21V10M19 21V10M3 10l9-6 9 6z"></path>',
  arrows: '<path d="M4 8h14l-3-3M20 16H6l3 3"></path>',
  flame: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-9z"></path>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5"></path>',
  fileCheck: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5M9 14l2 2 4-4"></path>',
  team: '<circle cx="8" cy="9" r="3"></circle><circle cx="16" cy="9" r="3"></circle><path d="M2 20a6 6 0 0 1 12 0M10 20a6 6 0 0 1 12 0"></path>',
  rewind: '<path d="M19 5l-9 7 9 7zM10 5l-9 7 9 7z"></path>',
  filter: '<path d="M3 5h18l-7 8v6l-4-2v-4z"></path>',
  pairs: '<path d="M4 9h16M4 15h16"></path><circle cx="8" cy="9" r="2" fill="currentColor"></circle><circle cx="16" cy="15" r="2" fill="currentColor"></circle>',
  upload: '<path d="M12 16V4M6 10l6-6 6 6"></path><path d="M4 20h16"></path>',
  pencil: '<path d="M4 20l4-1 11-11-3-3L5 16z"></path>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"></path><path d="M10 21h4"></path>',
  sigma: '<path d="M18 5H6l6 7-6 7h12"></path>',
  clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"></path>',
  star: '<path d="m12 4 2.4 5 5.6.8-4 3.9.9 5.5L12 16.6 7.1 19.2l.9-5.5-4-3.9 5.6-.8z"></path>',
  plug: '<path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0z"></path><path d="M12 16v5"></path>',
  agent: '<rect x="4" y="7" width="16" height="12" rx="3"></rect><path d="M12 3v4M9 12h.01M15 12h.01M9 16h6"></path>',
  coin: '<path d="M7 4v16M7 4 4 7M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3"></path>',
  stock: '<path d="M4 20h16"></path><path d="M6 17v-4M11 17V9M16 17v-6"></path><path d="m5 8 5-4 4 3 5-4"></path>',
  rwa: '<path d="M9 11V4.5A1.5 1.5 0 0 1 10.5 3H19a1.5 1.5 0 0 1 1.5 1.5v10A1.5 1.5 0 0 1 19 16h-5"></path><path d="M13 7h4M13 10h4"></path><circle cx="8" cy="16" r="5"></circle><path d="M8 13.5v5M6.5 15h3"></path>',
  prediction: '<circle cx="12" cy="12" r="9"></circle><path d="M12 12 16 8"></path><path d="M12 7v1M7 12h1M16.5 12h.5"></path>',
  sun: '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"></path>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path>',
};

export function icon(name, size = 22, sw = 2) {
  const path = ICONS[name];
  if (!path) throw new Error('unknown icon ' + name);
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}
```

- [ ] **Step 5: Write js/time.js**

```js
// js/time.js — the drawer's Checked line (spec §5.3): how long ago the probe ran
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export function ago(ts, now) {
  const d = Math.max(0, now - ts);
  if (d < MIN) return 'just now';
  if (d < HOUR) return `${Math.floor(d / MIN)} min ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)} h ago`;
  return `${Math.floor(d / DAY)} d ago`;
}
```

- [ ] **Step 6: Write js/store.js**

gravit-ui's store with one addition, `hydrate`: the page saves a subset of the state (theme, installed, client) and rebuilds a whole state from it at boot.

```js
// js/store.js — one state object, pure reducers, subscribers, optional persistence (gravit-ui's, plus hydrate)
// accept(saved) decides whether a saved state may be used; hydrate(saved) turns what was saved into a whole state;
// persist(state) is what gets written. A storage that throws or holds garbage boots `initial`.
export function createStore({ initial, reducers, storage = null, key = 'gravity-field.state', accept = () => true, persist = s => s, hydrate = s => s }) {
  let state = load() ?? initial;
  const subs = new Set();

  function load() {
    try {
      const raw = storage?.getItem(key);
      const saved = raw ? JSON.parse(raw) : null;
      return saved && accept(saved) ? hydrate(saved) : null;
    } catch {
      return null;
    }
  }
  function save() {
    try { storage?.setItem(key, JSON.stringify(persist(state))); } catch { /* storage may be unavailable: the page still runs */ }
  }
  function notify(type) {
    for (const fn of subs) fn(state, type);
  }

  return {
    get: () => state,
    dispatch(type, payload) {
      const reducer = reducers[type];
      if (!reducer) throw new Error('unknown action ' + type);
      const next = reducer(state, payload);
      if (next && next !== state) {
        state = next;
        save();
        notify(type);
      }
      return state;
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    reset(next) {
      state = next;
      save();
      notify('reset');
    },
  };
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test tests/html.test.js tests/time.test.js tests/store.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 8: Commit**

```bash
git add js/html.js js/icons.js js/time.js js/store.js tests/html.test.js tests/time.test.js tests/store.test.js
git commit -m "feat: the shared helpers html, icons, time and the store"
```

---

### Task 3: The manifest schema and its rules

**Files:**
- Create: `js/data/manifest.js`
- Test: `tests/manifest.test.js`

**Interfaces:**
- Consumes: `ICONS` from `js/icons.js`.
- Produces: `KINDS`, `WRITES`, `NEEDS`, `ID` (the id regex), `RULES` (field → rule in words), `urlOk(v, { allowLoopback })`, `validateManifest(input, { allowLoopback = false }) → { ok: true, manifest } | { ok: false, error: { field, rule } }`. The returned manifest is normalised: strings trimmed, `by` starts with `@`, `homepage`/`icon` null when empty, `needs: 'none'`, `writes` defaults to `['message']`, `asks` and `tools` default to `[]`.

- [ ] **Step 1: Write the failing test**

```js
// tests/manifest.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, urlOk, KINDS, RULES } from '../js/data/manifest.js';

const good = {
  id: 'secedgar', name: ' SEC EDGAR ', kind: 'Data', blurb: 'Filings and financials, by ticker or CIK',
  url: 'https://secedgar.caseyjhand.com/mcp', homepage: 'https://github.com/cyanheads/secedgar-mcp-server', by: 'cyanheads',
  icon: 'fileCheck', needs: 'none', writes: ['message'], asks: ['“What did NVIDIA file last quarter?”'], tools: ['secedgar_company_search'],
};
const bad = (patch, field) => {
  const r = validateManifest({ ...good, ...patch });
  assert.equal(r.ok, false, JSON.stringify(patch));
  assert.equal(r.error.field, field, JSON.stringify(patch));
  assert.equal(r.error.rule, RULES[field]);
};

test('a valid manifest comes back normalised: trimmed, by with @, defaults filled', () => {
  const r = validateManifest({ ...good, homepage: '', icon: '', writes: undefined, asks: undefined, tools: undefined, needs: undefined });
  assert.equal(r.ok, true);
  assert.deepEqual(r.manifest, {
    id: 'secedgar', name: 'SEC EDGAR', kind: 'Data', blurb: 'Filings and financials, by ticker or CIK',
    url: 'https://secedgar.caseyjhand.com/mcp', homepage: null, by: '@cyanheads', icon: null, needs: 'none', writes: ['message'], asks: [], tools: [],
  });
  assert.equal(validateManifest(good).manifest.by, '@cyanheads');
  assert.equal(validateManifest({ ...good, by: '@cyanheads' }).manifest.by, '@cyanheads');
  assert.deepEqual(KINDS, ['Data', 'Monitors', 'Bots', 'Crypto', 'Quant']);
});

test('each rule once, naming its field', () => {
  bad({ id: 'SecEdgar' }, 'id');
  bad({ id: 'a' }, 'id');
  bad({ id: '../etc' }, 'id');
  bad({ id: 'a'.repeat(42) }, 'id');
  bad({ name: 'x'.repeat(41) }, 'name');
  bad({ name: '' }, 'name');
  bad({ kind: 'Tools' }, 'kind');
  bad({ blurb: 'Ends with a period.' }, 'blurb');
  bad({ blurb: 'x'.repeat(91) }, 'blurb');
  bad({ blurb: '' }, 'blurb');
  bad({ url: 'http://secedgar.caseyjhand.com/mcp' }, 'url');
  bad({ url: 'https://user:pw@host.example/mcp' }, 'url');
  bad({ url: 'not a url' }, 'url');
  bad({ homepage: 'http://example.com' }, 'homepage');
  bad({ by: 'a b' }, 'by');
  bad({ icon: 'unicorn' }, 'icon');
  bad({ needs: 'exchange key' }, 'needs');
  bad({ writes: ['orders'] }, 'writes');
  bad({ asks: ['a', 'b', 'c', 'd', 'e'] }, 'asks');
  bad({ tools: ['a', 'a'] }, 'tools');
  bad({ tools: ['has space'] }, 'tools');
});

test('a loopback http URL passes only when allowLoopback is set; anything that is not an object is refused as a whole', () => {
  assert.equal(validateManifest({ ...good, url: 'http://127.0.0.1:4999/mcp' }).ok, false);
  assert.equal(validateManifest({ ...good, url: 'http://127.0.0.1:4999/mcp' }, { allowLoopback: true }).ok, true);
  assert.equal(validateManifest({ ...good, url: 'http://localhost:4999/mcp' }, { allowLoopback: true }).ok, true);
  assert.equal(validateManifest({ ...good, url: 'http://10.0.0.8/mcp' }, { allowLoopback: true }).ok, false, 'allowLoopback is loopback only');
  assert.deepEqual(validateManifest(null), { ok: false, error: { field: 'manifest', rule: 'an object' } });
  assert.deepEqual(validateManifest('x'), { ok: false, error: { field: 'manifest', rule: 'an object' } });
  assert.equal(urlOk('https://a.example/mcp'), true);
  assert.equal(urlOk('https://a.example/mcp?x=1'), true);
  assert.equal(urlOk('ftp://a.example/mcp'), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/manifest.test.js`
Expected: FAIL — `Cannot find module '../js/data/manifest.js'`.

- [ ] **Step 3: Write js/data/manifest.js**

```js
// js/data/manifest.js — the plugin manifest (spec §3.1): the schema, the rules in words, one validator for every door
import { z } from 'zod';
import { ICONS } from '../icons.js';

export const KINDS = ['Data', 'Monitors', 'Bots', 'Crypto', 'Quant'];
export const WRITES = ['message', 'proposal'];
export const NEEDS = ['none'];
export const ID = /^[a-z][a-z0-9-]{1,40}$/;
const BY = /^@?[A-Za-z0-9_.-]{1,40}$/;
const TOOL = /^[A-Za-z0-9_.-]{1,64}$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

// the rule each field answers to, in the words the form and shop_publish show back
export const RULES = {
  manifest: 'an object',
  id: 'lowercase letters, digits and hyphens, 2 to 41 characters, starting with a letter',
  name: '1 to 40 characters',
  kind: `one of ${KINDS.join(' · ')}`,
  blurb: '1 to 90 characters, no trailing period',
  url: 'an https URL with no credentials',
  homepage: 'an https URL, or empty',
  by: 'a handle: letters, digits, _ . -, up to 40 characters',
  icon: 'the name of an icon, or empty',
  needs: 'none — v1 lists plugins that need nothing from the user',
  writes: `a subset of ${WRITES.join(', ')}`,
  asks: 'up to four questions of up to 120 characters',
  tools: 'tool names of letters, digits, _ . -, up to 64 characters, no repeats, at most 64',
};

// https, no credentials; http only to loopback and only when the caller allows it (tests, a local upstream)
export function urlOk(v, { allowLoopback = false } = {}) {
  let u;
  try { u = new URL(v); } catch { return false; }
  if (u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  return allowLoopback && u.protocol === 'http:' && LOOPBACK.has(u.hostname);
}

const str = max => z.string().min(1).max(max);

function schema({ allowLoopback }) {
  return z.object({
    id: z.string().regex(ID),
    name: str(40),
    kind: z.enum(KINDS),
    blurb: str(90).refine(v => !/[.。]\s*$/.test(v)),
    url: z.string().refine(v => urlOk(v, { allowLoopback })),
    homepage: z.string().refine(v => urlOk(v)).nullable().optional(),
    by: z.string().regex(BY),
    icon: z.string().refine(v => v in ICONS).nullable().optional(),
    needs: z.enum(NEEDS).optional(),
    writes: z.array(z.enum(WRITES)).max(WRITES.length).optional(),
    asks: z.array(str(120)).max(4).optional(),
    tools: z.array(z.string().regex(TOOL)).max(64).refine(a => new Set(a).size === a.length).optional(),
  });
}

const TRIMMED = ['id', 'name', 'blurb', 'url', 'homepage', 'by', 'icon'];

export function validateManifest(input, { allowLoopback = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: { field: 'manifest', rule: RULES.manifest } };
  const raw = { ...input };
  for (const k of TRIMMED) if (typeof raw[k] === 'string') raw[k] = raw[k].trim();
  if (raw.homepage === '') raw.homepage = null;
  if (raw.icon === '') raw.icon = null;
  const parsed = schema({ allowLoopback }).safeParse(raw);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path?.[0] ?? 'manifest');
    return { ok: false, error: { field, rule: RULES[field] ?? RULES.manifest } };
  }
  const m = parsed.data;
  return {
    ok: true,
    manifest: {
      id: m.id, name: m.name, kind: m.kind, blurb: m.blurb, url: m.url, homepage: m.homepage ?? null,
      by: m.by.startsWith('@') ? m.by : '@' + m.by, icon: m.icon ?? null, needs: 'none',
      writes: m.writes ?? ['message'], asks: m.asks ?? [], tools: m.tools ?? [],
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/manifest.test.js`
Expected: PASS, 3 tests. If zod reports the `blurb` refine under a path other than `['blurb']`, read `parsed.error.issues` in the failing assertion's output and keep the first segment of the path; the field names must match the test.

- [ ] **Step 5: Commit**

```bash
git add js/data/manifest.js tests/manifest.test.js
git commit -m "feat: the manifest schema, its rules in words and the one validator"
```

---

### Task 4: The catalogue, the loader, the six seeds and the shelves

**Files:**
- Create: `js/data/catalogue.js`, `js/data/load.js`, `plugins/coingecko.json`, `plugins/secedgar.json`, `plugins/ryufin.json`, `plugins/cryptowisser.json`, `plugins/stocklens.json`, `plugins/pmpicks.json`, `plugins/shelves.json`, `tests/fixtures/plugins/alpha.json`, `tests/fixtures/plugins/beta.json`, `tests/fixtures/plugins/gamma.json`, `tests/fixtures/plugins/shelves.json`
- Test: `tests/catalogue.test.js`, `tests/load.test.js`

**Interfaces:**
- Consumes: `validateManifest` (Task 3).
- Produces: `SHELVES` (`[{ id, title, kind? }]`), `EMPTY_SHELVES`, `MAX_QUERY`, `makeCatalogue({ plugins, pending, shelves, calls, origin, now })` → `{ all, byId(id), search(q), shelves(), shelf(id), origin, now, toJSON() }`; `loadCommitted(root, { allowLoopback }) → { plugins, shelves }` (throws on an invalid committed file), `loadRuntime(dir, { allowLoopback, log }) → manifests` (skips and logs a corrupt file; reads `{ manifest }` wrappers and bare manifests).

- [ ] **Step 1: Write the fixtures**

```json
// tests/fixtures/plugins/alpha.json
{ "id": "alpha", "name": "Alpha Data", "kind": "Data", "blurb": "Daily bars and a screen, for tests", "url": "http://127.0.0.1:1/mcp", "homepage": "https://example.com/alpha", "by": "@tests", "icon": "bars", "needs": "none", "writes": ["message"], "asks": ["“Is alpha up?”"], "tools": ["echo"] }
```

```json
// tests/fixtures/plugins/beta.json
{ "id": "beta", "name": "Beta <b>Crypto</b>", "kind": "Crypto", "blurb": "Beta </script><img src=x onerror=alert(1)> prices", "url": "http://127.0.0.1:1/mcp", "by": "beta", "icon": null, "needs": "none" }
```

```json
// tests/fixtures/plugins/gamma.json
{ "id": "gamma", "name": "Gamma Monitor", "kind": "Monitors", "blurb": "Watches a thing", "url": "http://127.0.0.1:1/mcp", "by": "@gamma", "icon": "bell", "needs": "none", "writes": ["message", "proposal"], "tools": ["echo", "boom"] }
```

```json
// tests/fixtures/plugins/shelves.json
{ "featured": ["beta", "alpha"], "Data": ["alpha"], "Monitors": ["gamma"], "Bots": [], "Crypto": ["beta"], "Quant": [] }
```

- [ ] **Step 2: Write the failing tests**

```js
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
```

```js
// tests/load.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCommitted, loadRuntime } from '../js/data/load.js';

const ROOT = new URL('..', import.meta.url).pathname;
const FIX = new URL('./fixtures', import.meta.url).pathname;

test('the committed catalogue: six seeds, ids equal file names, every shelf id exists, four featured', () => {
  const { plugins, shelves } = loadCommitted(ROOT);
  assert.deepEqual(plugins.map(p => p.id), ['coingecko', 'cryptowisser', 'pmpicks', 'ryufin', 'secedgar', 'stocklens']);
  for (const p of plugins) assert.match(p.url, /^https:\/\//);
  const ids = new Set(plugins.map(p => p.id));
  for (const [shelf, list] of Object.entries(shelves)) for (const id of list) assert.ok(ids.has(id), `${shelf} names ${id}`);
  assert.equal(shelves.featured.length, 4);
  assert.deepEqual(shelves.Monitors, []);
});

test('the fixtures load with allowLoopback; without it the http URLs are refused as invalid committed files', () => {
  const { plugins, shelves } = loadCommitted(FIX, { allowLoopback: true });
  assert.deepEqual(plugins.map(p => p.id), ['alpha', 'beta', 'gamma']);
  assert.equal(plugins[1].by, '@beta');
  assert.deepEqual(shelves.featured, ['beta', 'alpha']);
  assert.throws(() => loadCommitted(FIX), /alpha\.json: url/);
});

test('a committed file whose id differs from its name, or that breaks a rule, throws with the file named', () => {
  const root = mkdtempSync(join(tmpdir(), 'gf-'));
  mkdirSync(join(root, 'plugins'));
  writeFileSync(join(root, 'plugins', 'one.json'), JSON.stringify({ id: 'two', name: 'x', kind: 'Data', blurb: 'y', url: 'https://a.example/mcp', by: '@a', needs: 'none' }));
  assert.throws(() => loadCommitted(root), /one\.json: id two does not match/);
  writeFileSync(join(root, 'plugins', 'one.json'), JSON.stringify({ id: 'one', name: 'x', kind: 'Nope', blurb: 'y', url: 'https://a.example/mcp', by: '@a', needs: 'none' }));
  assert.throws(() => loadCommitted(root), /one\.json: kind: one of/);
  const empty = mkdtempSync(join(tmpdir(), 'gf-'));
  mkdirSync(join(empty, 'plugins'));
  assert.deepEqual(loadCommitted(empty), { plugins: [], shelves: { featured: [], Data: [], Monitors: [], Bots: [], Crypto: [], Quant: [] } });
});

test('a runtime dir: wrappers and bare manifests load; a corrupt or invalid file is skipped and logged; a missing dir is created', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'gf-')), 'approved');
  const logged = [];
  assert.deepEqual(loadRuntime(dir, { log: m => logged.push(m) }), []);
  writeFileSync(join(dir, 'w.json'), JSON.stringify({ manifest: { id: 'w', name: 'W', kind: 'Quant', blurb: 'wrapped', url: 'https://a.example/mcp', by: '@a', needs: 'none' }, probe: { ok: true } }));
  writeFileSync(join(dir, 'b.json'), JSON.stringify({ id: 'b', name: 'B', kind: 'Bots', blurb: 'bare', url: 'https://a.example/mcp', by: '@b', needs: 'none' }));
  writeFileSync(join(dir, 'c.json'), '{not json');
  writeFileSync(join(dir, 'd.json'), JSON.stringify({ id: 'd', name: 'D', kind: 'Nope', blurb: 'bad kind', url: 'https://a.example/mcp', by: '@d', needs: 'none' }));
  const out = loadRuntime(dir, { log: m => logged.push(m) });
  assert.deepEqual(out.map(p => p.id), ['b', 'w']);
  assert.equal(logged.length, 2);
  assert.match(logged[0], /c\.json/);
  assert.match(logged[1], /d\.json: kind/);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/catalogue.test.js tests/load.test.js`
Expected: FAIL — the two modules do not exist.

- [ ] **Step 4: Write js/data/catalogue.js**

```js
// js/data/catalogue.js — the catalogue view the server and the browser build the same way (spec §3.3): shelves, search, lookups; pure
export const SHELVES = [
  { id: 'featured', title: 'Featured' },
  { id: 'data', title: 'Data', kind: 'Data' },
  { id: 'monitors', title: 'Monitors', kind: 'Monitors' },
  { id: 'bots', title: 'Bots', kind: 'Bots' },
  { id: 'crypto', title: 'Crypto', kind: 'Crypto' },
  { id: 'quant', title: 'Quant', kind: 'Quant' },
];
export const EMPTY_SHELVES = { featured: [], Data: [], Monitors: [], Bots: [], Crypto: [], Quant: [] };
export const MAX_QUERY = 200;

export function makeCatalogue({ plugins = [], pending = [], shelves = EMPTY_SHELVES, calls = {}, origin = '', now = 0 } = {}) {
  const sh = { ...EMPTY_SHELVES, ...shelves };
  const all = [...pending.map(p => ({ ...p, pending: true })), ...plugins.map(p => ({ ...p, pending: false }))]
    .map(p => ({ ...p, calls: calls[p.id] ?? 0 }));
  const byId = id => all.find(p => p.id === id) ?? null;
  const byName = (a, b) => a.name.localeCompare(b.name);

  // a kind's shelf: pending submissions first, newest first; then the listed ids in their order; then the rest by name
  function ofKind(kind) {
    const listed = (sh[kind] ?? []).map(byId).filter(p => p && !p.pending && p.kind === kind);
    const rest = all.filter(p => p.kind === kind && !p.pending && !listed.includes(p)).sort(byName);
    const pend = all.filter(p => p.kind === kind && p.pending).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    return [...pend, ...listed, ...rest];
  }
  const featured = () => (sh.featured ?? []).map(byId).filter(p => p && !p.pending);
  const withIds = s => ({ ...s, ids: (s.kind ? ofKind(s.kind) : featured()).map(p => p.id) });

  function search(q) {
    const s = String(q ?? '').trim().toLowerCase().slice(0, MAX_QUERY);
    if (!s) return [];
    return all.filter(p => [p.name, p.blurb, p.kind, p.by, ...(p.tools ?? []), ...(p.toolList ?? []).map(t => t.name)].join(' ').toLowerCase().includes(s));
  }

  return {
    all, byId, search, origin, now,
    shelves: () => SHELVES.map(withIds).filter(s => s.ids.length),
    shelf: id => { const s = SHELVES.find(x => x.id === id); return s ? withIds(s) : null; },
    toJSON: () => ({ plugins, pending, shelves: sh, calls, origin, now }),
  };
}
```

- [ ] **Step 5: Write js/data/load.js**

```js
// js/data/load.js — Node only: the committed catalogue under plugins/ and the files approved at runtime (spec §3.3, §8.2)
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateManifest } from './manifest.js';
import { EMPTY_SHELVES } from './catalogue.js';

// a committed file must be valid and named after its id: the test suite keeps it so, and a bad one stops the boot
export function loadCommitted(root, { allowLoopback = false } = {}) {
  const dir = join(root, 'plugins');
  const plugins = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'shelves.json').sort()) {
    const json = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const v = validateManifest(json, { allowLoopback });
    if (!v.ok) throw new Error(`plugins/${f}: ${v.error.field}: ${v.error.rule}`);
    if (v.manifest.id !== f.slice(0, -5)) throw new Error(`plugins/${f}: id ${v.manifest.id} does not match the file name`);
    plugins.push(v.manifest);
  }
  let shelves = { ...EMPTY_SHELVES };
  try { shelves = { ...EMPTY_SHELVES, ...JSON.parse(readFileSync(join(dir, 'shelves.json'), 'utf8')) }; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return { plugins, shelves };
}

// a runtime dir holds { manifest, probe, ... } records the admin page wrote, or bare manifests; a bad one is skipped, never fatal
export function loadRuntime(dir, { allowLoopback = false, log = () => {} } = {}) {
  mkdirSync(dir, { recursive: true });
  const out = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    const file = join(dir, f);
    try {
      const json = JSON.parse(readFileSync(file, 'utf8'));
      const v = validateManifest(json?.manifest ?? json, { allowLoopback });
      if (!v.ok) throw new Error(`${v.error.field}: ${v.error.rule}`);
      out.push(v.manifest);
    } catch (e) {
      log(`skipping ${file}: ${e.message}`);
    }
  }
  return out;
}
```

- [ ] **Step 6: Write the six seeds and the shelves**

The servers the 2026-10-11 probe found live (spec §3.5). `tools` names only tools that probe listed; CoinGecko's two tools are an `execute` meta-tool and a docs search, so its `tools` is empty (every listed tool).

```json
// plugins/coingecko.json
{
  "id": "coingecko",
  "name": "CoinGecko",
  "kind": "Crypto",
  "blurb": "Prices, market caps, volumes and history for every coin, from CoinGecko's public API",
  "url": "https://mcp.api.coingecko.com/mcp",
  "homepage": "https://docs.coingecko.com/docs/mcp-server",
  "by": "@coingecko",
  "icon": "coin",
  "needs": "none",
  "writes": ["message"],
  "asks": ["“What is BTC trading at right now?”", "“Which coins moved most this week?”"],
  "tools": []
}
```

```json
// plugins/secedgar.json
{
  "id": "secedgar",
  "name": "SEC EDGAR",
  "kind": "Data",
  "blurb": "Filings, XBRL financials, insider trades and material events, by ticker or CIK",
  "url": "https://secedgar.caseyjhand.com/mcp",
  "homepage": "https://github.com/cyanheads/secedgar-mcp-server",
  "by": "@cyanheads",
  "icon": "fileCheck",
  "needs": "none",
  "writes": ["message"],
  "asks": ["“What did NVIDIA file last quarter?”", "“Who sold shares at Tesla this month?”"],
  "tools": ["secedgar_company_search", "secedgar_search_filings", "secedgar_get_filing", "secedgar_get_financials", "secedgar_get_insider_transactions"]
}
```

```json
// plugins/ryufin.json
{
  "id": "ryufin",
  "name": "ryufin",
  "kind": "Data",
  "blurb": "Plain answers on about 2,400 US stocks, drawn from SEC filings",
  "url": "https://ryufin.com/mcp",
  "homepage": "https://ryufin.com",
  "by": "@ryufin",
  "icon": "book",
  "needs": "none",
  "writes": ["message"],
  "asks": ["“Is Apple still growing?”", "“What changed in Costco's last answers?”"],
  "tools": ["search_stocks", "get_stock_answers", "get_stock_overview", "get_financial_history", "get_company_news"]
}
```

```json
// plugins/cryptowisser.json
{
  "id": "cryptowisser",
  "name": "Cryptowisser News",
  "kind": "Crypto",
  "blurb": "Crypto news: the latest, by coin, trending stories, and a search",
  "url": "https://www.cryptowisser.com/mcp/server",
  "homepage": "https://www.cryptowisser.com",
  "by": "@cryptowisser",
  "icon": "file",
  "needs": "none",
  "writes": ["message"],
  "asks": ["“What is the news on Solana today?”"],
  "tools": ["latest-news", "news-about", "trending-stories", "search-news"]
}
```

```json
// plugins/stocklens.json
{
  "id": "stocklens",
  "name": "StockLens",
  "kind": "Data",
  "blurb": "Nightly AI ratings on US stocks, a market summary and a screen",
  "url": "https://mcp.stocklens.com/mcp",
  "homepage": null,
  "by": "@stocklens",
  "icon": "stock",
  "needs": "none",
  "writes": ["message"],
  "asks": ["“How does the market look this morning?”", "“Which stocks screen well today?”"],
  "tools": ["get_market_summary", "discover_stocks", "initiate_analysis", "fetch_analysis_result"]
}
```

```json
// plugins/pmpicks.json
{
  "id": "pmpicks",
  "name": "PredictionMarketsPicks",
  "kind": "Crypto",
  "blurb": "Kalshi crypto boards, perp liquidation math, expected value and Kelly sizing",
  "url": "https://predictionmarketspicks.com/api/mcp-crypto/mcp?via=registry",
  "homepage": "https://predictionmarketspicks.com",
  "by": "@predictionmarketspicks",
  "icon": "prediction",
  "needs": "none",
  "writes": ["message"],
  "asks": ["“What does the 15-minute BTC board say?”", "“Size this bet by Kelly”"],
  "tools": ["fifteen_min_board", "perps_board", "perp_liquidation", "calculate_ev", "kelly_size"]
}
```

```json
// plugins/shelves.json
{
  "featured": ["secedgar", "coingecko", "ryufin", "cryptowisser"],
  "Data": ["secedgar", "ryufin", "stocklens"],
  "Monitors": [],
  "Bots": [],
  "Crypto": ["coingecko", "cryptowisser", "pmpicks"],
  "Quant": []
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test tests/catalogue.test.js tests/load.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 8: Commit**

```bash
git add js/data/catalogue.js js/data/load.js plugins tests/fixtures tests/catalogue.test.js tests/load.test.js
git commit -m "feat: the catalogue view, the loader, the six seed plugins and the shelves"
```

---

### Task 5: The fake upstream and the probe

**Files:**
- Create: `tests/helpers/fake-upstream.js`, `js/probe.js`
- Test: `tests/probe.test.js`

**Interfaces:**
- Consumes: `urlOk` (Task 3).
- Produces: `startUpstream({ name, version }) → { url, port, calls, close() }` and `makeUpstream(opts)` for tests; `allowedUrl(url, { allowLoopback }) → { ok } | { ok: false, error }`, `withTimeout(promise, ms, what)`, `connectUpstream(url, { timeoutMs }) → { client, transport }`, `probe(url, { timeoutMs = 12000, allowLoopback = false, now }) → probe result` (see Shared interfaces).

- [ ] **Step 1: Write the fake upstream**

```js
// tests/helpers/fake-upstream.js — an in-process MCP server over streamable HTTP: echo, boom (fails), slow (waits); stateless, one server per request
import { createServer } from 'node:http';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export function makeUpstream({ name = 'fake-upstream', version = '0.1.0', calls = [] } = {}) {
  const s = new McpServer({ name, version }, { instructions: 'a fake upstream for tests' });
  s.registerTool('echo', { description: 'Echoes the text back\nSecond line is not shown', inputSchema: { text: z.string() } }, async ({ text }) => {
    calls.push(['echo', text]);
    return { content: [{ type: 'text', text: `echo:${text}` }] };
  });
  s.registerTool('boom', { description: 'Always fails', inputSchema: {} }, async () => ({ content: [{ type: 'text', text: 'it broke' }], isError: true }));
  s.registerTool('slow', { description: 'Answers after ms', inputSchema: { ms: z.number().optional() } }, async ({ ms = 2000 }) => {
    await new Promise(r => setTimeout(r, ms));
    return { content: [{ type: 'text', text: 'late' }] };
  });
  return s;
}

export async function startUpstream(opts = {}) {
  const calls = [];
  const http = createServer(async (req, res) => {
    if (new URL(req.url, 'http://x').pathname !== '/mcp') { res.writeHead(404); return res.end(); }
    const server = makeUpstream({ ...opts, calls });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch {
      if (!res.headersSent) { res.writeHead(500); res.end(); }
    }
  });
  const port = await new Promise(r => http.listen(0, '127.0.0.1', () => r(http.address().port)));
  return {
    url: `http://127.0.0.1:${port}/mcp`, port, calls,
    close: () => new Promise(r => { http.closeAllConnections(); http.close(() => r()); }),
  };
}

// a port that accepts a connection and never answers: the timeout case
export async function startSilent() {
  const http = createServer(() => {});
  const port = await new Promise(r => http.listen(0, '127.0.0.1', () => r(http.address().port)));
  return { url: `http://127.0.0.1:${port}/mcp`, close: () => new Promise(r => { http.closeAllConnections(); http.close(() => r()); }) };
}
```

- [ ] **Step 2: Write the failing test**

```js
// tests/probe.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedUrl, probe, withTimeout } from '../js/probe.js';
import { startUpstream, startSilent } from './helpers/fake-upstream.js';

test('allowedUrl: https public hosts pass; loopback only with allowLoopback; private, link-local, credentials and plain http never', () => {
  assert.deepEqual(allowedUrl('https://mcp.api.coingecko.com/mcp'), { ok: true });
  assert.deepEqual(allowedUrl('http://127.0.0.1:4999/mcp'), { ok: false, error: 'a loopback address' });
  assert.deepEqual(allowedUrl('http://127.0.0.1:4999/mcp', { allowLoopback: true }), { ok: true });
  assert.deepEqual(allowedUrl('http://localhost:4999/mcp', { allowLoopback: true }), { ok: true });
  assert.equal(allowedUrl('https://127.0.0.1/mcp').ok, false);
  for (const u of ['https://10.0.0.8/mcp', 'https://192.168.1.1/mcp', 'https://172.16.0.1/mcp', 'https://172.31.9.9/mcp', 'https://169.254.169.254/latest', 'https://[fd00::1]/mcp', 'https://[fe80::1]/mcp', 'https://db.internal/mcp', 'https://printer.local/mcp']) {
    assert.deepEqual(allowedUrl(u, { allowLoopback: true }), { ok: false, error: 'an address inside a network' }, u);
  }
  assert.equal(allowedUrl('https://172.32.0.1/mcp').ok, true, '172.32 is public');
  assert.deepEqual(allowedUrl('https://user:pw@host.example/mcp'), { ok: false, error: 'not an https URL' });
  assert.deepEqual(allowedUrl('http://host.example/mcp'), { ok: false, error: 'not an https URL' });
  assert.deepEqual(allowedUrl('garbage'), { ok: false, error: 'not an https URL' });
});

test('probe lists a live upstream: server, tools with one-line descriptions and schemas, latency, transport', async () => {
  const up = await startUpstream({ name: 'alpha-server', version: '2.0.0' });
  try {
    const r = await probe(up.url, { allowLoopback: true });
    assert.equal(r.ok, true);
    assert.deepEqual(r.server, { name: 'alpha-server', version: '2.0.0' });
    assert.deepEqual(r.toolList.map(t => t.name), ['echo', 'boom', 'slow']);
    assert.equal(r.toolList[0].description, 'Echoes the text back');
    assert.equal(r.toolList[0].inputSchema.type, 'object');
    assert.deepEqual(r.toolList[0].inputSchema.required, ['text']);
    assert.ok(Number.isInteger(r.latencyMs) && r.latencyMs >= 0);
    assert.equal(r.transport, 'http');
  } finally {
    await up.close();
  }
});

test('probe refuses a disallowed address without connecting, and reports a closed port as not ok', async () => {
  assert.deepEqual(await probe('http://127.0.0.1:1/mcp'), { ok: false, error: 'a loopback address' });
  const r = await probe('http://127.0.0.1:1/mcp', { allowLoopback: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /ECONNREFUSED|fetch failed|connect/i);
});

test('probe gives up on a silent server within the timeout', async () => {
  const silent = await startSilent();
  try {
    const t0 = Date.now();
    const r = await probe(silent.url, { allowLoopback: true, timeoutMs: 300 });
    assert.equal(r.ok, false);
    assert.match(r.error, /timed out/);
    assert.ok(Date.now() - t0 < 2500, 'two transports, 300 ms each, plus slack');
  } finally {
    await silent.close();
  }
  await assert.rejects(withTimeout(new Promise(() => {}), 20, 'x'), /x timed out after 20 ms/);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tests/probe.test.js`
Expected: FAIL — `Cannot find module '../js/probe.js'`.

- [ ] **Step 4: Write js/probe.js**

```js
// js/probe.js — connect to a plugin's server, list its tools, come back (spec §3.4); refuses addresses that point inside a network
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { urlOk } from './data/manifest.js';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const PRIVATE = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^127\./, /^\[f[cd][0-9a-f]{2}:/i, /^\[fe80:/i];

export function allowedUrl(url, { allowLoopback = false } = {}) {
  if (!urlOk(url, { allowLoopback })) return { ok: false, error: 'not an https URL' };
  const { hostname } = new URL(url);
  if (LOOPBACK.has(hostname)) return allowLoopback ? { ok: true } : { ok: false, error: 'a loopback address' };
  if (PRIVATE.some(re => re.test(hostname)) || hostname.endsWith('.local') || hostname.endsWith('.internal')) return { ok: false, error: 'an address inside a network' };
  return { ok: true };
}

export function withTimeout(promise, ms, what) {
  let t;
  const timeout = new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

// streamable HTTP first, SSE on failure; the connected client and which transport took
export async function connectUpstream(url, { timeoutMs = 12_000 } = {}) {
  let lastError;
  for (const [transport, T] of [['http', StreamableHTTPClientTransport], ['sse', SSEClientTransport]]) {
    const client = new Client({ name: 'gravity-field', version: '0.1.0' });
    try {
      await withTimeout(client.connect(new T(new URL(url))), timeoutMs, 'connect');
      return { client, transport };
    } catch (e) {
      lastError = e;
      await client.close().catch(() => {});
    }
  }
  throw lastError;
}

const firstLine = s => String(s ?? '').split('\n')[0].trim().slice(0, 200);

export async function probe(url, { timeoutMs = 12_000, allowLoopback = false, now = Date.now } = {}) {
  const allowed = allowedUrl(url, { allowLoopback });
  if (!allowed.ok) return { ok: false, error: allowed.error };
  const t0 = now();
  let client;
  try {
    const c = await connectUpstream(url, { timeoutMs });
    client = c.client;
    const { tools } = await withTimeout(client.listTools({}, { timeout: timeoutMs }), timeoutMs, 'tools/list');
    const info = client.getServerVersion() ?? {};
    return {
      ok: true,
      server: { name: info.name ?? '', version: info.version ?? '' },
      toolList: tools.map(t => ({ name: t.name, description: firstLine(t.description), inputSchema: t.inputSchema ?? { type: 'object' } })),
      latencyMs: Math.round(now() - t0),
      transport: c.transport,
    };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e).replace(/\s+/g, ' ').slice(0, 200) };
  } finally {
    await client?.close().catch(() => {});
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/probe.test.js`
Expected: PASS, 4 tests. The SDK prints nothing; Node may print an `ExperimentalWarning` for nothing here (none expected). If the closed-port error text differs on this machine, widen the regex in the test to what the SDK reports — the assertion is that `ok` is false and `error` is a non-empty string.

- [ ] **Step 6: Commit**

```bash
git add tests/helpers/fake-upstream.js js/probe.js tests/probe.test.js
git commit -m "feat: the probe that lists an upstream, with the in-process fake upstream for tests"
```

---

### Task 6: The gateway and the ledger

**Files:**
- Create: `js/gateway.js`, `js/ledger.js`
- Test: `tests/gateway.test.js`, `tests/ledger.test.js`

**Interfaces:**
- Consumes: `connectUpstream` (Task 5); `startUpstream`, `startSilent` from the fake upstream.
- Produces: `MAX_TEXT`, `trimContent(content)`, `allowedTools(entry)`, `createGateway({ timeoutMs, onDown(id, reason), now }) → { call(entry, tool, args) → { content, isError, ms } | { error, ms }, close(), size() }`; `ROTATE_BYTES`, `createLedger({ file, rotateBytes, now }) → { record({ plugin, tool, ok, ms }) → line, counts() → { total, lastHour, plugins: { id: { total, lastHour, tools } } }, perPlugin() → { id: total }, forPlugin(id), size() }`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/gateway.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGateway, trimContent, allowedTools, MAX_TEXT } from '../js/gateway.js';
import { startUpstream, startSilent } from './helpers/fake-upstream.js';

const entry = (url, extra = {}) => ({ id: 'alpha', name: 'Alpha', url, tools: ['echo', 'slow'], toolList: [], ...extra });

test('forwards a declared tool, passes the answer through, caches one client per plugin', async () => {
  const up = await startUpstream();
  const gw = createGateway({ timeoutMs: 5000 });
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
  const gw = createGateway();
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
  const gw = createGateway({ onDown: (id, why) => down.push([id, why]), timeoutMs: 1000 });
  const r = await gw.call(entry('http://127.0.0.1:1/mcp'), 'echo', { text: 'x' });
  assert.equal(r.error, 'upstream unreachable');
  assert.equal(down.length, 1);
  assert.equal(down[0][0], 'alpha');
  await gw.close();
});

test('a slow upstream times out as unreachable, the client is dropped, and the next call reconnects', async () => {
  const up = await startUpstream();
  const down = [];
  const gw = createGateway({ timeoutMs: 300, onDown: id => down.push(id) });
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
  const gw = createGateway({ onDown: id => down.push(id), timeoutMs: 5000 });
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
  const gw = createGateway({ timeoutMs: 300 });
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
```

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/gateway.test.js tests/ledger.test.js`
Expected: FAIL — the two modules do not exist.

- [ ] **Step 3: Write js/gateway.js**

```js
// js/gateway.js — plugin_call's forwarding half (spec §7): one cached client per plugin, a timeout, the answer passed through, a cut at 256 KB
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { connectUpstream } from './probe.js';

export const MAX_TEXT = 256 * 1024;
const TIMED_OUT = -32001;

// a text answer longer than MAX_TEXT is cut, with a note; images and the rest pass as they are
export function trimContent(content) {
  return (content ?? []).map(c => (c?.type === 'text' && typeof c.text === 'string' && c.text.length > MAX_TEXT
    ? { ...c, text: c.text.slice(0, MAX_TEXT) + `\n… [cut at ${MAX_TEXT} characters]` }
    : c));
}

// the tools a manifest admits: its own list, or every listed tool when the list is empty (spec §3.1)
export function allowedTools(entry) {
  return entry.tools?.length ? entry.tools : (entry.toolList ?? []).map(t => t.name);
}

export function createGateway({ timeoutMs = 20_000, onDown = () => {}, now = Date.now } = {}) {
  const clients = new Map(); // plugin id → { url, client }

  async function clientFor(entry) {
    const have = clients.get(entry.id);
    if (have && have.url === entry.url) return have.client;
    if (have) { clients.delete(entry.id); await have.client.close().catch(() => {}); }
    const { client } = await connectUpstream(entry.url, { timeoutMs });
    clients.set(entry.id, { url: entry.url, client });
    return client;
  }

  async function drop(entry, reason) {
    const have = clients.get(entry.id);
    clients.delete(entry.id);
    await have?.client.close().catch(() => {});
    onDown(entry.id, reason);
  }

  async function call(entry, tool, args = {}) {
    const t0 = now();
    if (!allowedTools(entry).includes(tool)) return { error: 'tool not offered', ms: 0 };
    let client;
    try {
      client = await clientFor(entry);
    } catch (e) {
      await drop(entry, e.message);
      return { error: 'upstream unreachable', ms: now() - t0 };
    }
    try {
      const r = await client.callTool({ name: tool, arguments: args && typeof args === 'object' ? args : {} }, undefined, { timeout: timeoutMs });
      return { content: trimContent(r.content), isError: !!r.isError, ms: now() - t0 };
    } catch (e) {
      // the server's own answer, an MCP error that is not a timeout, is the caller's tool error; anything else is the line going down
      if (e instanceof McpError && e.code !== TIMED_OUT) return { content: [{ type: 'text', text: e.message }], isError: true, ms: now() - t0 };
      await drop(entry, e.message);
      return { error: 'upstream unreachable', ms: now() - t0 };
    }
  }

  async function close() {
    for (const { client } of clients.values()) await client.close().catch(() => {});
    clients.clear();
  }

  return { call, close, size: () => clients.size };
}
```

- [ ] **Step 4: Write js/ledger.js**

```js
// js/ledger.js — one line per plugin_call and no caller (spec §7): an append-only JSONL file and the counts the pages read
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

export const ROTATE_BYTES = 10 * 1024 * 1024;
const HOUR = 3_600_000;

export function createLedger({ file = null, rotateBytes = ROTATE_BYTES, now = Date.now } = {}) {
  const lines = [];
  if (file) {
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file)) {
      for (const l of readFileSync(file, 'utf8').split('\n')) {
        if (!l.trim()) continue;
        try { lines.push(JSON.parse(l)); } catch { /* a torn last line after a crash: skipped */ }
      }
    }
  }

  function rotate(at) {
    const base = file.replace(/\.jsonl$/, '');
    const stamp = new Date(at).toISOString().slice(0, 10);
    const target = existsSync(`${base}.${stamp}.jsonl`) ? `${base}.${stamp}-${at}.jsonl` : `${base}.${stamp}.jsonl`;
    renameSync(file, target);
  }

  function record({ plugin, tool, ok, ms }) {
    const line = { at: now(), plugin, tool, ok: !!ok, ms: Math.max(0, Math.round(ms ?? 0)) };
    lines.push(line);
    if (file) {
      if (existsSync(file) && statSync(file).size >= rotateBytes) rotate(line.at);
      appendFileSync(file, JSON.stringify(line) + '\n');
    }
    return line;
  }

  function counts() {
    const since = now() - HOUR;
    const out = { total: lines.length, lastHour: 0, plugins: {} };
    for (const l of lines) {
      const p = (out.plugins[l.plugin] ??= { total: 0, lastHour: 0, tools: {} });
      p.total++;
      p.tools[l.tool] = (p.tools[l.tool] ?? 0) + 1;
      if (l.at >= since) { p.lastHour++; out.lastHour++; }
    }
    return out;
  }

  return {
    record, counts,
    perPlugin: () => Object.fromEntries(Object.entries(counts().plugins).map(([id, c]) => [id, c.total])),
    forPlugin: id => lines.reduce((n, l) => n + (l.plugin === id ? 1 : 0), 0),
    size: () => lines.length,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/gateway.test.js tests/ledger.test.js`
Expected: PASS, 9 tests, in well under 10 s (the slow and silent cases are bounded by their 300 ms timeouts).

- [ ] **Step 6: Commit**

```bash
git add js/gateway.js js/ledger.js tests/gateway.test.js tests/ledger.test.js
git commit -m "feat: the gateway that forwards plugin calls and the ledger that counts them"
```

---

### Task 7: The rate limiter and the client IP

**Files:**
- Create: `js/ratelimit.js`
- Test: `tests/ratelimit.test.js`

**Interfaces:**
- Produces: `createLimiter({ limit, perMs, now }) → { take(key) → { ok, retryAfterSec }, sweep(), size() }`, `clientIp(req, { trustProxy })`, `isLoopback(ip)`.

- [ ] **Step 1: Write the failing test**

```js
// tests/ratelimit.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, clientIp, isLoopback } from '../js/ratelimit.js';

test('a bucket admits limit calls, refuses with a retry-after of at least one second, and refills with time', () => {
  let t = 0;
  const l = createLimiter({ limit: 3, perMs: 1000, now: () => t });
  assert.deepEqual([l.take('a'), l.take('a'), l.take('a')].map(r => r.ok), [true, true, true]);
  assert.deepEqual(l.take('a'), { ok: false, retryAfterSec: 1 });
  assert.equal(l.take('b').ok, true, 'another key has its own bucket');
  t = 334;
  assert.equal(l.take('a').ok, true, 'a third of the window refilled one token');
  assert.equal(l.take('a').ok, false);
  t = 5000;
  assert.deepEqual([l.take('a'), l.take('a'), l.take('a'), l.take('a')].map(r => r.ok), [true, true, true, false], 'never more than limit, however long the wait');
  t = 10_000;
  l.sweep();
  assert.equal(l.size(), 0, 'idle buckets are swept');
});

test('clientIp is the socket, or the first forwarded hop only when the proxy is trusted; isLoopback knows the three spellings', () => {
  const req = { socket: { remoteAddress: '203.0.113.9' }, headers: { 'x-forwarded-for': '198.51.100.1, 10.0.0.1' } };
  assert.equal(clientIp(req), '203.0.113.9');
  assert.equal(clientIp(req, { trustProxy: true }), '198.51.100.1');
  assert.equal(clientIp({ socket: { remoteAddress: '::1' }, headers: {} }, { trustProxy: true }), '::1', 'no header, the socket');
  assert.equal(clientIp({ headers: {} }), '');
  for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(isLoopback(ip), true, ip);
  assert.equal(isLoopback('203.0.113.9'), false);
  assert.equal(isLoopback(''), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/ratelimit.test.js`
Expected: FAIL — `Cannot find module '../js/ratelimit.js'`.

- [ ] **Step 3: Write js/ratelimit.js**

```js
// js/ratelimit.js — a token bucket per client IP (spec §4), and who the client is behind a proxy
export function createLimiter({ limit, perMs, now = Date.now } = {}) {
  const buckets = new Map(); // key → { tokens, at }

  function take(key) {
    const t = now();
    const b = buckets.get(key) ?? { tokens: limit, at: t };
    b.tokens = Math.min(limit, b.tokens + ((t - b.at) / perMs) * limit);
    b.at = t;
    buckets.set(key, b);
    if (b.tokens >= 1) { b.tokens -= 1; return { ok: true, retryAfterSec: 0 }; }
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(((1 - b.tokens) * perMs) / limit / 1000)) };
  }

  function sweep() {
    const t = now();
    for (const [k, b] of buckets) if (t - b.at >= perMs) buckets.delete(k);
  }

  return { take, sweep, size: () => buckets.size };
}

// the first hop of X-Forwarded-For only when a proxy is trusted (spec §4); otherwise the socket, whatever the header says
export function clientIp(req, { trustProxy = false } = {}) {
  if (trustProxy) {
    const xff = req.headers?.['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  return req.socket?.remoteAddress ?? '';
}

export const isLoopback = ip => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/ratelimit.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add js/ratelimit.js tests/ratelimit.test.js
git commit -m "feat: the per address token bucket and the client address behind a proxy"
```

---

### Task 8: The submissions store

**Files:**
- Create: `js/submissions.js`
- Test: `tests/submissions.test.js`

**Interfaces:**
- Consumes: `ID` (Task 3).
- Produces: `createSubmissions({ dataDir, now, log }) → { list() (pending, newest first), get(id), has(id), add({ manifest, probe, via }) → record, approve(id, { probe }) → record | null, reject(id, reason) → record | null, approved() (records in approved/), dirs }`; `pendingEntry(record) → entry` (a pending submission as the catalogue shows it: `status` from its probe, `at` for ordering).

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/submissions.test.js`
Expected: FAIL — `Cannot find module '../js/submissions.js'`.

- [ ] **Step 3: Write js/submissions.js**

```js
// js/submissions.js — the review queue on disk (spec §8): submissions/, approved/, rejected/ under the data dir, one JSON record each
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ID } from './data/manifest.js';

// a pending submission as the catalogue shows it: its probe stands in for the registry's derived fields
export function pendingEntry(rec) {
  const p = rec.probe ?? {};
  return {
    ...rec.manifest,
    server: p.ok ? p.server : null,
    toolList: p.ok ? p.toolList : [],
    status: p.ok ? 'up' : 'down',
    probedAt: rec.at,
    latencyMs: p.ok ? p.latencyMs : null,
    at: rec.at,
  };
}

export function createSubmissions({ dataDir, now = Date.now, log = () => {} }) {
  const dirs = { pending: join(dataDir, 'submissions'), approved: join(dataDir, 'approved'), rejected: join(dataDir, 'rejected') };
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });

  // the id has passed the manifest rule before it is ever a file name; anything else is refused here too
  const file = (kind, id) => {
    if (!ID.test(id)) throw new Error('invalid id');
    return join(dirs[kind], id + '.json');
  };
  const read = kind => readdirSync(dirs[kind]).filter(f => f.endsWith('.json')).sort().map(f => {
    try { return JSON.parse(readFileSync(join(dirs[kind], f), 'utf8')); } catch (e) { log(`skipping ${join(dirs[kind], f)}: ${e.message}`); return null; }
  }).filter(Boolean);
  const write = (kind, id, rec) => writeFileSync(file(kind, id), JSON.stringify(rec, null, 2) + '\n');

  function get(id) {
    const f = file('pending', id);
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
  }

  return {
    dirs, get,
    list: () => read('pending').sort((a, b) => b.at - a.at),
    has: id => existsSync(file('pending', id)),
    add({ manifest, probe, via }) {
      const rec = { manifest, probe, via, at: now() };
      write('pending', manifest.id, rec);
      return rec;
    },
    approve(id, { probe }) {
      const rec = get(id);
      if (!rec) return null;
      const out = { ...rec, probe, approvedAt: now() };
      write('approved', id, out);
      unlinkSync(file('pending', id));
      return out;
    },
    reject(id, reason) {
      const rec = get(id);
      if (!rec) return null;
      const out = { ...rec, reason, rejectedAt: now() };
      write('rejected', id, out);
      unlinkSync(file('pending', id));
      return out;
    },
    approved: () => read('approved'),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/submissions.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add js/submissions.js tests/submissions.test.js
git commit -m "feat: the submissions queue on disk with approve and reject"
```

---

### Task 9: The registry, and the server that wires the services

**Files:**
- Create: `js/registry.js`, `tests/helpers/http.js`
- Modify: `serve.js` (replace the whole file with the version below)
- Test: `tests/registry.test.js`, `tests/serve.test.js` (add three tests)

**Interfaces:**
- Consumes: `loadCommitted`, `loadRuntime` (Task 4); `createSubmissions`, `pendingEntry` (Task 8); `createLedger`, `createGateway` (Task 6); `createLimiter`, `clientIp` (Task 7); `probe` (Task 5); `makeCatalogue` (Task 4).
- Produces: `createRegistry({ root, dataDir, probe, allowLoopback, now, log }) → { reload(), list(), byId(id), has(id), shelves(), setProbe(id, result), setStatus(id, status), probeAll() }`; `createApp(options)` now returns a server with `.services` (the services object of Shared interfaces), `.routes` (an array later tasks push handlers onto), `.ready` (a promise), and a `close()` that also stops the probe timer and closes upstream clients; `LIMITS`; `testApp(opts)`, `listen(app)`, `tmp()`, `FIXTURES` from the http helper.

- [ ] **Step 1: Write the failing tests**

```js
// tests/registry.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRegistry } from '../js/registry.js';

const FIX = new URL('./fixtures', import.meta.url).pathname;
const probeOk = (name = 'srv') => ({ ok: true, server: { name, version: '1' }, toolList: [{ name: 'echo', description: '', inputSchema: { type: 'object' } }], latencyMs: 3, transport: 'http' });

function dataDirWith(files) {
  const dataDir = mkdtempSync(join(tmpdir(), 'gf-'));
  mkdirSync(join(dataDir, 'approved'));
  for (const [name, json] of Object.entries(files)) writeFileSync(join(dataDir, 'approved', name), JSON.stringify(json));
  return dataDir;
}

test('reload: the committed catalogue plus runtime approvals, committed winning on an id clash; bare entries until a probe', () => {
  const dataDir = dataDirWith({
    'w.json': { manifest: { id: 'w', name: 'W', kind: 'Quant', blurb: 'wrapped', url: 'https://a.example/mcp', by: '@a', needs: 'none' }, probe: { ok: true } },
    'alpha.json': { manifest: { id: 'alpha', name: 'IMPOSTOR', kind: 'Data', blurb: 'x', url: 'https://a.example/mcp', by: '@a', needs: 'none' } },
  });
  const r = createRegistry({ root: FIX, dataDir, probe: async () => probeOk(), allowLoopback: true });
  r.reload();
  assert.deepEqual(r.list().map(p => p.id), ['alpha', 'beta', 'gamma', 'w']);
  assert.equal(r.byId('alpha').name, 'Alpha Data');
  assert.deepEqual(r.byId('w'), { id: 'w', name: 'W', kind: 'Quant', blurb: 'wrapped', url: 'https://a.example/mcp', homepage: null, by: '@a', icon: null, needs: 'none', writes: ['message'], asks: [], tools: [], server: null, toolList: [], status: 'unknown', probedAt: null, latencyMs: null });
  assert.equal(r.has('w'), true);
  assert.equal(r.has('zz'), false);
  assert.equal(r.byId('zz'), null);
  assert.deepEqual(r.shelves().featured, ['beta', 'alpha']);
});

test('setProbe records up and down; a down keeps the last tool list; setStatus flips status alone; probeAll runs the injected probe over every entry', async () => {
  const seen = [];
  let t = 50;
  const r = createRegistry({ root: FIX, dataDir: mkdtempSync(join(tmpdir(), 'gf-')), probe: async (url, opts) => { seen.push([url, opts.allowLoopback]); return probeOk(url); }, allowLoopback: true, now: () => t });
  r.reload();
  r.setProbe('alpha', probeOk('alpha-srv'));
  let a = r.byId('alpha');
  assert.equal(a.status, 'up');
  assert.equal(a.server.name, 'alpha-srv');
  assert.equal(a.probedAt, 50);
  assert.equal(a.latencyMs, 3);
  assert.equal(a.toolList.length, 1);
  t = 60;
  r.setProbe('alpha', { ok: false, error: 'boom' });
  a = r.byId('alpha');
  assert.equal(a.status, 'down');
  assert.equal(a.probedAt, 60);
  assert.equal(a.toolList.length, 1, 'the last known tools stay while the line is down');
  assert.equal(a.error, 'boom');
  r.setStatus('alpha', 'up');
  assert.equal(r.byId('alpha').status, 'up');
  await r.probeAll();
  assert.deepEqual(seen.map(s => s[1]), [true, true, true]);
  assert.deepEqual(r.list().map(p => p.status), ['up', 'up', 'up']);
  assert.equal(r.byId('beta').server.name, 'http://127.0.0.1:1/mcp');
});
```

Add to `tests/serve.test.js` (keep the three tests already there; add the import and these three):

```js
import { testApp } from './helpers/http.js';

test('createApp exposes its services and a ready promise; healthz counts the plugins by status', async () => {
  const { app, base, close } = await testApp();
  try {
    await app.ready;
    for (const k of ['registry', 'submissions', 'ledger', 'gateway', 'limiters', 'probe', 'origin', 'catalogue']) assert.ok(app.services[k], k);
    assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), { ok: true, plugins: 3, up: 0, down: 3 }, 'nothing probed yet: the fixtures are down until a probe passes');
    app.services.registry.setStatus('alpha', 'up');
    assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), { ok: true, plugins: 3, up: 1, down: 2 });
  } finally {
    await close();
  }
});

test('the request bucket answers 429 with retry-after once it is empty', async () => {
  const { base, close } = await testApp({ limits: { requests: [3, 60_000] } });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await fetch(`${base}/healthz`)).status, 200);
    const r = await fetch(`${base}/healthz`);
    assert.equal(r.status, 429);
    assert.equal(r.headers.get('retry-after'), '20');
  } finally {
    await close();
  }
});

test('the catalogue a request sees: fixtures, pending entries, calls, and the origin from the Host header or GF_PUBLIC_ORIGIN', async () => {
  const { app, close } = await testApp();
  try {
    const req = { headers: { host: '127.0.0.1:9' } };
    const cat = app.services.catalogue(req);
    assert.deepEqual(cat.all.map(p => p.id), ['alpha', 'beta', 'gamma']);
    assert.equal(cat.origin, 'http://127.0.0.1:9');
    assert.equal(app.services.origin({ headers: { host: 'h', 'x-forwarded-proto': 'https' } }), 'http://h', 'the forwarded proto counts only behind a trusted proxy');
    app.services.options.trustProxy = true;
    assert.equal(app.services.origin({ headers: { host: 'h', 'x-forwarded-proto': 'https' } }), 'https://h');
    app.services.options.publicOrigin = 'https://gravity.example';
    assert.equal(app.services.origin(req), 'https://gravity.example');
  } finally {
    await close();
  }
});
```

Note on `healthz`: a plugin that has never been probed has `status: 'unknown'`; `healthz` counts `up` and counts everything else as `down`, so an operator sees a boot that never probed as all-down rather than all-fine.

- [ ] **Step 2: Write tests/helpers/http.js**

```js
// tests/helpers/http.js — an app over the fixtures on a free port, with a fresh data dir and no probing
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../serve.js';

export const FIXTURES = new URL('../fixtures/', import.meta.url).pathname;

export function listen(app) {
  return new Promise(resolve => app.listen(0, '127.0.0.1', () => resolve(app.address().port)));
}

export function tmp() {
  return mkdtempSync(join(tmpdir(), 'gf-'));
}

export async function testApp(opts = {}) {
  const app = createApp({ root: FIXTURES, dataDir: tmp(), probeOnBoot: false, allowLoopback: true, log: () => {}, ...opts });
  const port = await listen(app);
  return { app, port, base: `http://127.0.0.1:${port}`, close: () => new Promise(r => app.close(() => r())) };
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/registry.test.js tests/serve.test.js`
Expected: FAIL — `js/registry.js` missing; `app.services` undefined.

- [ ] **Step 4: Write js/registry.js**

```js
// js/registry.js — the approved plugins and what the probe knows about them (spec §3.2, §8.2): committed files plus runtime approvals, committed winning
import { join } from 'node:path';
import { loadCommitted, loadRuntime } from './data/load.js';

const BARE = { server: null, toolList: [], status: 'unknown', probedAt: null, latencyMs: null };

export function createRegistry({ root, dataDir, probe, allowLoopback = false, now = Date.now, log = () => {} }) {
  let committed = { plugins: [], shelves: {} };
  let entries = [];
  const derived = new Map(); // id → what the probe found

  function reload() {
    committed = loadCommitted(root, { allowLoopback });
    const runtime = loadRuntime(join(dataDir, 'approved'), { allowLoopback, log });
    const ids = new Set(committed.plugins.map(p => p.id));
    entries = [...committed.plugins, ...runtime.filter(p => !ids.has(p.id))];
    return entries;
  }

  const withDerived = p => ({ ...p, ...BARE, ...(derived.get(p.id) ?? {}) });

  // a pass keeps the tools; a failure keeps the last known tools and marks the line down (spec §3.4)
  function setProbe(id, result) {
    const prev = derived.get(id) ?? {};
    derived.set(id, result.ok
      ? { server: result.server, toolList: result.toolList, status: 'up', probedAt: now(), latencyMs: result.latencyMs, transport: result.transport, error: null }
      : { ...prev, status: 'down', probedAt: now(), error: result.error });
  }

  const setStatus = (id, status) => derived.set(id, { ...(derived.get(id) ?? {}), status });

  async function probeAll() {
    for (const p of entries) setProbe(p.id, await probe(p.url, { allowLoopback }));
  }

  return {
    reload, setProbe, setStatus, probeAll,
    list: () => entries.map(withDerived),
    byId: id => { const p = entries.find(x => x.id === id); return p ? withDerived(p) : null; },
    has: id => entries.some(p => p.id === id),
    shelves: () => committed.shelves,
  };
}
```

- [ ] **Step 5: Replace serve.js**

```js
// serve.js — Gravity Field: one Node process that is the site, the API, the MCP face and the gateway (spec §4)
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegistry } from './js/registry.js';
import { createSubmissions, pendingEntry } from './js/submissions.js';
import { createLedger } from './js/ledger.js';
import { createGateway } from './js/gateway.js';
import { createLimiter, clientIp } from './js/ratelimit.js';
import { probe as realProbe } from './js/probe.js';
import { makeCatalogue } from './js/data/catalogue.js';

export const HERE = fileURLToPath(new URL('.', import.meta.url));
export const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
};
// requests a minute, plugin calls a minute, submissions an hour, per client address (spec §4)
export const LIMITS = { requests: [600, 60_000], calls: [60, 60_000], submissions: [10, 3_600_000] };

export function contentType(path) {
  return TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

// every option defaults from the environment (spec §4)
export function defaults(env = process.env) {
  return {
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT || 4840),
    root: HERE,
    dataDir: env.GF_DATA_DIR || join(HERE, 'data'),
    publicOrigin: env.GF_PUBLIC_ORIGIN || null,
    adminToken: env.GF_ADMIN_TOKEN || null,
    upstreamTimeoutMs: Number(env.GF_UPSTREAM_TIMEOUT_MS || 20_000),
    trustProxy: env.GF_TRUST_PROXY === '1' || env.GF_TRUST_PROXY === 'true',
    probeOnBoot: true,
    probeEveryMs: 15 * 60_000,
    allowLoopback: false,
  };
}

export function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

export function sendHtml(res, status, html, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(html);
}

export function notFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found');
}

// css/ and js/ are served as they are, with no cache headers (the face/client/* lesson); a path that
// normalises out of those two folders is not a file of the site
export async function serveStatic(root, pathname, res) {
  const rel = normalize(decodeURIComponent(pathname));
  if (!/^\/(css|js)\/[^/]/.test(rel)) return notFound(res);
  try {
    const body = await readFile(join(root, rel));
    res.writeHead(200, { 'content-type': contentType(rel), 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    notFound(res);
  }
}

export function createApp(options = {}) {
  const o = { ...defaults(), ...options };
  const log = o.log ?? (m => console.error(m));
  mkdirSync(o.dataDir, { recursive: true });

  const probeFn = o.probe ?? realProbe;
  const probe = (url, extra = {}) => probeFn(url, { allowLoopback: o.allowLoopback, timeoutMs: 12_000, ...extra });
  const registry = createRegistry({ root: o.root, dataDir: o.dataDir, probe, allowLoopback: o.allowLoopback, log });
  registry.reload();
  const submissions = createSubmissions({ dataDir: o.dataDir, log });
  const ledger = createLedger({ file: join(o.dataDir, 'ledger.jsonl') });
  const gateway = createGateway({ timeoutMs: o.upstreamTimeoutMs, onDown: id => registry.setStatus(id, 'down') });
  const limits = { ...LIMITS, ...(o.limits ?? {}) };
  const limiters = Object.fromEntries(Object.entries(limits).map(([k, [limit, perMs]]) => [k, createLimiter({ limit, perMs })]));

  const services = {
    options: o, log, registry, submissions, ledger, gateway, limiters, probe,
    // the origin the MCP address and the Use it lines show: GF_PUBLIC_ORIGIN, else what the request came to
    origin: req => o.publicOrigin ?? `${(o.trustProxy && req.headers['x-forwarded-proto']) || 'http'}://${req.headers.host ?? `${o.host}:${o.port}`}`,
    catalogue: req => makeCatalogue({
      plugins: registry.list(), pending: submissions.list().map(pendingEntry), shelves: registry.shelves(),
      calls: ledger.perPlugin(), origin: services.origin(req), now: Date.now(),
    }),
  };

  // route handlers answer true when they took the request; Tasks 12–16 push theirs here
  const routes = [];

  const ready = o.probeOnBoot ? registry.probeAll().catch(e => log(`probe: ${e.message}`)) : Promise.resolve();
  let timer = null;
  if (o.probeOnBoot && o.probeEveryMs > 0) {
    timer = setInterval(() => registry.probeAll().catch(e => log(`probe: ${e.message}`)), o.probeEveryMs);
    timer.unref();
  }

  const server = createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
    const ip = clientIp(req, o);
    const gate = limiters.requests.take(ip);
    if (!gate.ok) return sendJson(res, 429, { error: 'rate limited' }, { 'retry-after': String(gate.retryAfterSec) });
    const path = url.pathname;
    if (req.method === 'GET' && /^\/(css|js)\//.test(path)) return serveStatic(o.root, path, res);
    if (path === '/healthz') {
      const list = registry.list();
      return sendJson(res, 200, { ok: true, plugins: list.length, up: list.filter(p => p.status === 'up').length, down: list.filter(p => p.status !== 'up').length });
    }
    const ctx = { req, res, url, path, ip, services };
    try {
      for (const route of routes) if (await route(ctx)) return;
    } catch (e) {
      log(`${req.method} ${path}: ${e.stack ?? e.message}`);
      if (!res.headersSent) return sendJson(res, 500, { error: 'internal' });
      return res.end();
    }
    notFound(res);
  });

  server.services = services;
  server.routes = routes;
  server.ready = ready;
  const close = server.close.bind(server);
  server.close = cb => {
    if (timer) clearInterval(timer);
    gateway.close().catch(() => {});
    server.closeAllConnections();
    return close(cb);
  };
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = defaults();
  const app = createApp();
  app.listen(o.port, o.host, () => console.log(`Gravity Field at http://${o.host}:${o.port}/  ·  MCP at http://${o.host}:${o.port}/mcp`));
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/registry.test.js tests/serve.test.js`
Expected: PASS, 8 tests. Then `npm test` — every suite so far passes.

- [ ] **Step 7: Commit**

```bash
git add js/registry.js serve.js tests/helpers/http.js tests/registry.test.js tests/serve.test.js
git commit -m "feat: the registry of approved plugins and the server that wires the services"
```

---

### Task 10: The render modules — header, cards, shelves, the drawer, Create, toasts

**Files:**
- Create: `js/data/clients.js`, `js/render/avatars.js`, `js/render/discover.js`
- Test: `tests/discover.test.js`

**Interfaces:**
- Consumes: `esc`, `attrs`, `cls`, `icon`, `ago` (Task 2); a catalogue view `cat` (Task 4); the browser state shape (Shared interfaces; built by Task 11's `initialState`, constructed by hand in this task's tests).
- Produces: `CLIENTS`, `TOOL_NAMES`, `RESERVED_TOOLS`, `clientLines(origin) → { 'Claude Code': { file, code }, Cursor: {…}, Codex: {…} }`; `mark(spec, size, radius, name)`, `logo(entry, size = 44)`; `kv(rows)`, `sec(label, lines, html)`, `keyFor(p, state)`, `card(p, state, { view })`, `header(state)`, `exampleCall(p)`, `pluginDrawer(p, state, cat)`, `renderCreate(state, cat)`, `renderToast(t)`, `renderDiscover(state, cat) → '<main class="main disc …">…</main>'`, `TOOLS_SHOWN`.
- Every clickable carries `data-action` (`openPlugin`, `install`, `uninstall`, `closeDrawer`, `toggleInstalledOnly`, `openCreate`, `closeCreate`, `dismissToast`, `copy`, `setTheme`, `setClient`, `toggleTools`, `query`) and in-site links carry `data-nav`; Task 17's client reads exactly these.

- [ ] **Step 1: Write the failing test**

```js
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
  assert.doesNotMatch(h, /Free|by @|\$|price|Installed ·|shelf-sub/);
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
  assert.doesNotMatch(down, /<script|onerror=/);
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/discover.test.js`
Expected: FAIL — the three modules do not exist.

- [ ] **Step 3: Write js/data/clients.js**

```js
// js/data/clients.js — the line each client takes to add Gravity Field (spec §5.4), and the face's tool names (spec §6)
export const CLIENTS = ['Claude Code', 'Cursor', 'Codex'];
export const TOOL_NAMES = ['shop_search', 'shop_get', 'shop_publish', 'plugin_call'];
// they need an owner; registered when identity arrives (spec §12)
export const RESERVED_TOOLS = ['shop_install', 'shop_uninstall', 'shop_mine'];

export function clientLines(origin) {
  const url = `${origin}/mcp`;
  return {
    'Claude Code': { file: null, code: `claude mcp add --transport http gravity-field ${url}` },
    Cursor: { file: '~/.cursor/mcp.json', code: JSON.stringify({ mcpServers: { 'gravity-field': { url } } }, null, 2) },
    Codex: { file: '~/.codex/config.toml', code: `[mcp_servers.gravity-field]\nurl = "${url}"` },
  };
}
```

- [ ] **Step 4: Write js/render/avatars.js**

```js
// js/render/avatars.js — the rounded-square logos of the cards (44 px) and the drawer (56 px): a glyph, or the name's first letter
import { esc } from '../html.js';
import { icon } from '../icons.js';

export function mark(spec, size, radius, name) {
  const box = `width:${size}px;height:${size}px;border-radius:${radius}`;
  if (spec.type === 'glyph') return `<span class="av av-glyph" role="img" aria-label="${esc(name)}" style="${box}">${icon(spec.icon, Math.round(size / 2), 2)}</span>`;
  return `<span class="av av-letter tone-${spec.tone ?? 'grey'}" role="img" aria-label="${esc(name)}" style="${box};font-size:${Math.round(size * 0.42)}px">${esc(spec.text)}</span>`;
}

// the manifest validator has already vouched for the icon name, so icon() cannot throw here
export function logo(entry, size = 44) {
  const letter = String(entry.name ?? '').trim().slice(0, 1).toUpperCase() || '?';
  const spec = entry.icon ? { type: 'glyph', icon: entry.icon } : { type: 'letter', text: letter };
  return mark(spec, size, '10px', entry.name);
}
```

- [ ] **Step 5: Write js/render/discover.js**

```js
// js/render/discover.js — Discover's store as Gravity Field's one screen (spec §5): header, shelves, cards, the drawer, Create, toasts; pure
import { esc, attrs, cls } from '../html.js';
import { icon } from '../icons.js';
import { ago } from '../time.js';
import { logo } from './avatars.js';
import { CLIENTS, clientLines, TOOL_NAMES } from '../data/clients.js';

const WRITES_COPY = { message: 'Messages, into the conversation', proposal: 'Proposals: inside your limit it fills directly, beyond it a card' };
export const TOOLS_SHOWN = 12;

export const kv = rows => `<div class="kv-list">${rows.map(([k, v]) => `<div class="kv"><span class="kv-k">${esc(k)}</span><span class="kv-v">${v}</span></div>`).join('')}</div>`;
export const sec = (label, lines, html = false) => `<div class="dsec"><div class="dsec-label">${esc(label)}</div>${lines.map(l => `<div class="dsec-line">${html ? l : esc(l)}</div>`).join('')}</div>`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const host = url => { try { return new URL(url).host; } catch { return ''; } };

// the key: in review → a clock; installed → ✓ beside the trash key; else + (spec §5.2)
export function keyFor(p, state) {
  if (p.pending) return `<span class="pkey-wait" role="img" aria-label="In review">${icon('clock', 15, 2.1)}</span>`;
  if (!state.installed.includes(p.id)) return `<button type="button"${attrs({ class: 'pkey install', 'data-action': 'install', 'data-id': p.id, 'aria-label': `Install ${p.name}` })}>${icon('plus', 14, 2.4)}</button>`;
  return `<span class="pkeys"><span class="pkey-done" role="img" aria-label="Installed">${icon('check', 14, 2.4)}</span>` +
    `<button type="button"${attrs({ class: 'pkey uninstall', 'data-action': 'uninstall', 'data-id': p.id, 'aria-label': `Uninstall ${p.name}` })}>${icon('trash', 15, 2.1)}</button></span>`;
}

export function card(p, state, { view = 'shelf' } = {}) {
  return `<div${attrs({ class: cls('pcard', state.drawer === p.id && 'pressed', view === 'grid' && 'in-grid', p.status === 'down' && 'down'), 'data-action': 'openPlugin', 'data-id': p.id, role: 'button', tabindex: '0' })}>${logo(p, 44)}` +
    `<div class="pcard-body"><div class="pcard-name">${esc(p.name)}</div><div class="pcard-blurb">${esc(p.blurb)}</div></div>` +
    `<div class="pcard-side"><span class="pcard-kind">${esc(p.kind.toUpperCase())}</span>${keyFor(p, state)}</div></div>`;
}

function shelf(s, cat, state) {
  const cards = s.ids.map(id => cat.byId(id)).filter(Boolean).map(p => card(p, state)).join('');
  return `<section class="shelf"><div class="shelf-head"><div class="shelf-title">${esc(s.title)}</div><a class="link" data-nav href="/discover/${esc(s.id)}">See all ›</a></div><div class="shelf-row">${cards}</div></section>`;
}

function grid(title, plugins, state, back = false) {
  return `<section class="grid-sec">${back ? '<a class="back-link" data-nav href="/">‹ Gravity Field</a>' : ''}<div class="grid-title">${esc(title)}</div><div class="grid">${plugins.map(p => card(p, state, { view: 'grid' })).join('')}</div></section>`;
}

// Discover's header is the site header (spec §5.1): the name, the search pill, My plugins, Create, Submit, the theme key
export function header(state) {
  const on = state.installedOnly;
  const next = state.theme === 'black' ? 'cream' : 'black';
  return `<div class="disc-head"><h1 class="head-title">Gravity Field</h1>` +
    `<div class="search"><label for="dq" class="sr-only">Search plugins</label>${icon('search', 18, 2)}<input id="dq" type="search" autocomplete="off" placeholder="Search plugins" data-action="query"${attrs({ value: state.query })}></div><span class="spacer"></span>` +
    `<button type="button"${attrs({ class: cls('pill', on && 'pressed'), 'data-action': 'toggleInstalledOnly', 'aria-pressed': on ? 'true' : 'false' })}>My plugins</button>` +
    `<button type="button" class="pill" data-action="openCreate">${icon('plus', 14, 2.2)}Create</button>` +
    `<a class="pill" href="/submit">Submit</a>` +
    `<button type="button"${attrs({ class: 'theme-key', 'data-action': 'setTheme', 'data-value': next, 'aria-label': `Switch to ${next}` })}>${icon(state.theme === 'black' ? 'sun' : 'moon', 16, 2)}</button></div>`;
}

const copyKey = (key, text, state) => `<button type="button"${attrs({ class: 'btn-sm copy-key', 'data-action': 'copy', 'data-key': key, 'data-copy': text })}>${state.copied === key ? 'Copied' : 'Copy'}</button>`;
const snippet = (key, file, code, state) => `<div class="snippet">${file ? `<div class="snippet-file mono">${esc(file)}</div>` : ''}<pre class="snippet-code mono">${esc(code)}</pre>${copyKey(key, code, state)}</div>`;
const clientSeg = (name, state) => `<div class="radio-seg">${CLIENTS.map(n => `<label class="radio-item"><input type="radio"${attrs({ name, value: n, 'data-action': 'setClient', checked: n === state.client })}><span>${esc(n)}</span></label>`).join('')}</div>`;
const lineFor = (state, cat) => clientLines(cat.origin)[state.client] ?? clientLines(cat.origin)['Claude Code'];

// one example call: the first tool, and its schema's first required string argument as a placeholder (spec §5.3)
export function exampleCall(p) {
  const tool = p.tools?.[0] ?? p.toolList?.[0]?.name;
  if (!tool) return null;
  const schema = (p.toolList ?? []).find(t => t.name === tool)?.inputSchema;
  const arg = Array.isArray(schema?.required) ? schema.required.find(k => schema.properties?.[k]?.type === 'string') : null;
  return `plugin_call("${p.id}", "${tool}", ${arg ? `{ "${arg}": "<${arg}>" }` : '{}'})`;
}

function useIt(p, state, cat) {
  const line = lineFor(state, cat);
  const ex = exampleCall(p);
  return `<div class="dsec"><div class="dsec-label">Use it</div>${clientSeg('client-use', state)}${snippet('line', line.file, line.code, state)}${ex ? snippet('example', null, ex, state) : ''}</div>`;
}

export function pluginDrawer(p, state, cat) {
  const installed = state.installed.includes(p.id);
  const n = p.toolList?.length ?? 0;
  const meta = p.pending ? `${p.kind} · In review` : [p.kind, plural(n, 'tool'), p.calls ? plural(p.calls, 'call') : null].filter(Boolean).join(' · ');
  // the manifest's tools first, then the rest of what the server lists; beyond TOOLS_SHOWN a line that unfolds
  const lead = p.tools?.length ? p.tools : (p.toolList ?? []).map(t => t.name);
  const ordered = [...lead.map(name => (p.toolList ?? []).find(t => t.name === name) ?? { name, description: '' }), ...(p.toolList ?? []).filter(t => !lead.includes(t.name))];
  const shown = state.toolsExpanded ? ordered : ordered.slice(0, TOOLS_SHOWN);
  const toolLines = shown.map(t => `<span class="mono">${esc(t.name)}</span>${t.description ? ` <span class="dim">${esc(t.description)}</span>` : ''}`);
  if (ordered.length > shown.length) toolLines.push(`<button type="button" class="link" data-action="toggleTools">${ordered.length - shown.length} more</button>`);
  const status = p.status === 'up' ? '<span class="chip up">up</span>' : p.status === 'down' ? '<span class="chip down">down</span>' : '<span class="chip grey">unchecked</span>';
  const source = kv([
    ['Server', `<span class="mono">${esc(host(p.url))}</span>`],
    ...(p.server?.name ? [['Version', esc(`${p.server.name} ${p.server.version ?? ''}`.trim())]] : []),
    ['By', esc(p.by)],
    ...(p.homepage ? [['Homepage', `<a class="link" href="${esc(p.homepage)}" target="_blank" rel="noopener">${esc(host(p.homepage))}</a>`]] : []),
    ['Checked', `${p.probedAt ? esc(ago(p.probedAt, cat.now)) + ' ' : ''}${status}`],
  ]);
  const foot = p.pending ? '' : `<div class="drawer-foot"><button type="button" class="btn-primary"${attrs({ 'data-action': installed ? 'uninstall' : 'install', 'data-id': p.id })}>${installed ? 'Uninstall' : 'Install'}</button></div>`;
  return `<aside class="drawer"${attrs({ 'aria-label': p.name })}><div class="drawer-head"><h2>${esc(p.name)}</h2><button type="button" class="close-key" data-action="closeDrawer" aria-label="Close">×</button></div><div class="drawer-body">` +
    `<div class="plug-id">${logo(p, 56)}<div><div class="plug-name">${esc(p.name)}</div><div class="dim">${esc(meta)}</div></div></div><p class="plug-blurb">${esc(p.blurb)}.</p>` +
    (p.asks?.length ? sec('What you can ask it', p.asks) : '') +
    (toolLines.length ? sec('Tools', toolLines, true) : '') +
    (p.writes?.length ? sec('What it writes', p.writes.map(w => WRITES_COPY[w] ?? w)) : '') +
    sec('What it needs from you', ['Nothing.']) +
    `<div class="dsec"><div class="dsec-label">Source</div>${source}</div>` +
    useIt(p, state, cat) + foot + '</div></aside>';
}

// Create: the Gravity Field MCP face — its address, its four tools, the line a client takes (spec §5.4); nothing to type
export function renderCreate(state, cat) {
  if (!state.create) return '';
  const line = lineFor(state, cat);
  return `<div class="modal-scrim"><div class="modal wide" role="dialog" aria-label="Gravity Field MCP"><div class="modal-head"><h2 class="modal-title">Gravity Field MCP</h2><button type="button" class="close-key" data-action="closeCreate" aria-label="Close">×</button></div><div class="modal-body">` +
    `<div class="field"><span class="field-label">Address</span><span class="mono">${esc(cat.origin)}/mcp</span></div>` +
    `<div class="field"><span class="field-label">Tools</span><div class="tool-chips">${TOOL_NAMES.map(t => `<span class="chip grey mono">${esc(t)}</span>`).join('')}</div></div>` +
    `<div class="field"><span class="field-label">Client</span>${clientSeg('client-create', state)}</div>` +
    snippet('create', line.file, line.code, state) + '</div></div></div>';
}

export function renderToast(t) {
  return `<div class="toast" role="status">${esc(t.text)}<button type="button" class="toast-x" data-action="dismissToast" aria-label="Dismiss">×</button></div>`;
}

export function renderDiscover(state, cat) {
  let body;
  if (state.query.trim()) {
    const found = cat.search(state.query);
    body = grid(plural(found.length, 'result'), found, state);
  } else if (state.installedOnly) {
    body = grid('Installed', cat.all.filter(p => !p.pending && state.installed.includes(p.id)), state);
  } else if (state.route.shelf) {
    const s = cat.shelf(state.route.shelf);
    body = grid(s?.title ?? 'Gravity Field', (s?.ids ?? []).map(id => cat.byId(id)).filter(Boolean), state, true);
  } else {
    body = cat.shelves().map(s => shelf(s, cat, state)).join('') || '<div class="empty">No plugins</div>';
  }
  const p = state.drawer ? cat.byId(state.drawer) : null;
  return `<main class="${cls('main', 'disc', p && 'with-drawer')}">${header(state)}${body}${p ? pluginDrawer(p, state, cat) : ''}${state.toast ? renderToast(state.toast) : ''}${renderCreate(state, cat)}</main>`;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test tests/discover.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 7: Commit**

```bash
git add js/data/clients.js js/render/avatars.js js/render/discover.js tests/discover.test.js
git commit -m "feat: the render modules, Discover lifted into Gravity Field"
```

---

### Task 11: The browser state and its reducers

**Files:**
- Create: `js/reducers/discover.js`
- Test: `tests/reducers.test.js`

**Interfaces:**
- Produces: `SEED_VERSION`, `THEMES`, `initialState({ theme, installed, client, route })`, `persist(s)` (what is saved: `{ v, theme, installed, client }`), `accept(saved)`, `reducers` = `nav(route)`, `setQuery(q)`, `toggleInstalledOnly`, `openPlugin(id)`, `closeDrawer`, `install({ id, name })`, `uninstall(id)`, `dismissToast`, `openCreate`, `closeCreate`, `setClient(name)`, `setCopied(key|null)`, `setTheme(theme)`, `toggleTools`. A reducer returns the same object when nothing changes, so the store neither saves nor renders.

- [ ] **Step 1: Write the failing test**

```js
// tests/reducers.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reducers as R, initialState, persist, accept, SEED_VERSION } from '../js/reducers/discover.js';

test('initialState: defaults, the route carried in, the drawer open on the route\'s plugin, bad saved values sanitised', () => {
  const s = initialState();
  assert.deepEqual(s, { v: 1, theme: 'system', route: { shelf: null, plugin: null }, query: '', installedOnly: false, drawer: null, create: null, toast: null, installed: [], client: 'Claude Code', copied: null, toolsExpanded: false });
  const r = initialState({ theme: 'black', installed: ['a', 7, 'b'], client: 'Cursor', route: { shelf: 'data', plugin: 'a' } });
  assert.equal(r.theme, 'black');
  assert.deepEqual(r.installed, ['a', 'b']);
  assert.equal(r.client, 'Cursor');
  assert.deepEqual(r.route, { shelf: 'data', plugin: 'a' });
  assert.equal(r.drawer, 'a');
  assert.equal(initialState({ theme: 'neon', client: 'Vim', installed: 'x' }).theme, 'system');
  assert.equal(initialState({ theme: 'neon', client: 'Vim', installed: 'x' }).client, 'Claude Code');
  assert.deepEqual(initialState({ installed: 'x' }).installed, []);
  assert.deepEqual(persist({ ...s, theme: 'cream', installed: ['a'], client: 'Codex', query: 'secret', drawer: 'a' }), { v: 1, theme: 'cream', installed: ['a'], client: 'Codex' });
  assert.equal(accept({ v: SEED_VERSION }), true);
  assert.equal(accept({ v: 0 }), false);
  assert.equal(accept(null), false);
});

test('nav sets the route and the drawer and closes Create; openPlugin and closeDrawer keep the route in step', () => {
  const s = initialState();
  const d = R.nav({ ...s, create: {} }, { shelf: 'data', plugin: 'a' });
  assert.deepEqual([d.route, d.drawer, d.create], [{ shelf: 'data', plugin: 'a' }, 'a', null]);
  const o = R.openPlugin(s, 'b');
  assert.deepEqual([o.route, o.drawer], [{ shelf: null, plugin: 'b' }, 'b']);
  assert.equal(R.openPlugin(o, 'b'), o, 'the same drawer again changes nothing');
  const c = R.closeDrawer(o);
  assert.deepEqual([c.route, c.drawer], [{ shelf: null, plugin: null }, null]);
  assert.equal(R.closeDrawer(c), c);
  assert.equal(R.openPlugin({ ...o, toolsExpanded: true }, 'c').toolsExpanded, false, 'a new drawer starts folded');
});

test('install and uninstall keep the local list and raise a toast; a repeat is a no-op', () => {
  const s = initialState();
  const i = R.install(s, { id: 'a', name: 'Alpha' });
  assert.deepEqual(i.installed, ['a']);
  assert.deepEqual(i.toast, { text: 'Alpha installed' });
  assert.equal(R.install(i, { id: 'a', name: 'Alpha' }), i);
  const u = R.uninstall(i, 'a');
  assert.deepEqual(u.installed, []);
  assert.equal(u.toast, null);
  assert.equal(R.uninstall(u, 'a'), u);
  assert.equal(R.dismissToast(i).toast, null);
  assert.equal(R.dismissToast(u), u);
});

test('query, My plugins, Create, client, copied, theme and the tool fold', () => {
  const s = initialState();
  assert.equal(R.setQuery(s, 'btc').query, 'btc');
  assert.equal(R.setQuery(s, 'x'.repeat(300)).query.length, 200);
  assert.equal(R.setQuery(s, ''), s);
  assert.equal(R.setQuery(s, null), s);
  assert.equal(R.toggleInstalledOnly(s).installedOnly, true);
  const open = R.openCreate(R.openPlugin(s, 'a'));
  assert.deepEqual(open.create, {});
  assert.equal(open.drawer, null, 'one overlay at a time');
  assert.equal(open.route.plugin, null);
  assert.equal(R.closeCreate(open).create, null);
  assert.equal(R.closeCreate(s), s);
  assert.equal(R.setClient(s, 'Codex').client, 'Codex');
  assert.equal(R.setClient(s, 'Vim'), s);
  assert.equal(R.setClient(s, 'Claude Code'), s);
  assert.equal(R.setCopied(s, 'line').copied, 'line');
  assert.equal(R.setCopied(R.setCopied(s, 'line'), null).copied, null);
  assert.equal(R.setCopied(s, null), s);
  assert.equal(R.setTheme(s, 'black').theme, 'black');
  assert.equal(R.setTheme(s, 'neon'), s);
  assert.equal(R.setTheme(s, 'system'), s);
  assert.equal(R.toggleTools(s).toolsExpanded, true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/reducers.test.js`
Expected: FAIL — `Cannot find module '../js/reducers/discover.js'`.

- [ ] **Step 3: Write js/reducers/discover.js**

```js
// js/reducers/discover.js — the page's state and the pure reducers that move it (spec §5); the browser keeps theme, installed and client
import { CLIENTS } from '../data/clients.js';

export const SEED_VERSION = 1;
export const THEMES = ['system', 'cream', 'black'];
export const MAX_QUERY = 200;

export function initialState({ theme = 'system', installed = [], client = 'Claude Code', route = {} } = {}) {
  return {
    v: SEED_VERSION,
    theme: THEMES.includes(theme) ? theme : 'system',
    route: { shelf: route?.shelf ?? null, plugin: route?.plugin ?? null },
    query: '', installedOnly: false,
    drawer: route?.plugin ?? null, create: null, toast: null,
    installed: Array.isArray(installed) ? installed.filter(x => typeof x === 'string') : [],
    client: CLIENTS.includes(client) ? client : 'Claude Code',
    copied: null, toolsExpanded: false,
  };
}

// what the browser saves (spec §5.1): never a route, a query, a drawer or a toast
export const persist = s => ({ v: s.v, theme: s.theme, installed: s.installed, client: s.client });
export const accept = saved => !!saved && saved.v === SEED_VERSION;

export const reducers = {
  nav: (s, route = {}) => ({ ...s, route: { shelf: route.shelf ?? null, plugin: route.plugin ?? null }, drawer: route.plugin ?? null, create: null, toolsExpanded: false }),
  setQuery(s, q) {
    const query = String(q ?? '').slice(0, MAX_QUERY);
    return query === s.query ? s : { ...s, query };
  },
  toggleInstalledOnly: s => ({ ...s, installedOnly: !s.installedOnly }),
  openPlugin: (s, id) => (s.drawer === id ? s : { ...s, drawer: id, route: { ...s.route, plugin: id }, create: null, toolsExpanded: false }),
  closeDrawer: s => (s.drawer ? { ...s, drawer: null, route: { ...s.route, plugin: null } } : s),
  install: (s, { id, name }) => (s.installed.includes(id) ? s : { ...s, installed: [...s.installed, id], toast: { text: `${name} installed` } }),
  uninstall: (s, id) => (s.installed.includes(id) ? { ...s, installed: s.installed.filter(x => x !== id), toast: null } : s),
  dismissToast: s => (s.toast ? { ...s, toast: null } : s),
  // one overlay at a time: Create closes a drawer
  openCreate: s => ({ ...s, create: {}, drawer: null, route: { ...s.route, plugin: null } }),
  closeCreate: s => (s.create ? { ...s, create: null } : s),
  setClient: (s, c) => (CLIENTS.includes(c) && c !== s.client ? { ...s, client: c } : s),
  setCopied: (s, key) => ((key ?? null) === s.copied ? s : { ...s, copied: key ?? null }),
  setTheme: (s, t) => (THEMES.includes(t) && t !== s.theme ? { ...s, theme: t } : s),
  toggleTools: s => ({ ...s, toolsExpanded: !s.toolsExpanded }),
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/reducers.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add js/reducers/discover.js tests/reducers.test.js
git commit -m "feat: the browser state and its reducers"
```

---

### Task 12: Routes, the page shell, and the server-rendered pages

**Files:**
- Create: `js/routes.js`, `js/http.js`, `js/render/page.js`, `js/pages.js`
- Modify: `serve.js` (imports and the routes array; exact edits below)
- Test: `tests/routes.test.js`, `tests/pages.test.js`

**Interfaces:**
- Consumes: `renderDiscover` (Task 10), `initialState` (Task 11), `services.catalogue(req)` (Task 9).
- Produces: `SHELF_IDS`, `parsePath(pathname) → { page: 'shelves'|'submit'|'admin', shelf, plugin } | null`, `toPath(route)`; `sendJson`, `sendHtml`, `notFound`, `readBody(req, { limit })`, `parseCookies(header)` in `js/http.js` (re-exported by `serve.js`); `THEME_KEY`, `safeJson(v)`, `renderDocument({ title, body, data, script, lang })`, `renderNotFound()`; `createPages(services)` → a route handler.

- [ ] **Step 1: Write the failing tests**

```js
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
```

```js
// tests/pages.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testApp } from './helpers/http.js';
import { safeJson, renderDocument, renderNotFound } from '../js/render/page.js';

const probeOk = { ok: true, server: { name: 's', version: '1' }, toolList: [{ name: 'echo', description: '', inputSchema: { type: 'object' } }], latencyMs: 1, transport: 'http', missing: [] };

test('safeJson can sit inside a script tag; renderDocument carries fonts, tokens, the theme script, the data and the client; the 404 page loads no script', () => {
  assert.equal(safeJson({ a: '</script><b>' }), '{"a":"\\u003c/script>\\u003cb>"}');
  assert.equal(safeJson('x\u2028y'), '"x\\u2028y"');
  assert.equal(safeJson(undefined), 'null');
  const doc = renderDocument({ title: 'T <1>', body: '<main>x</main>', data: { k: '<' } });
  assert.match(doc, /^<!doctype html>\n<html lang="en">/);
  assert.match(doc, /<title>T &lt;1&gt;<\/title>/);
  assert.match(doc, /fonts\.googleapis\.com\/css2\?family=Manrope/);
  assert.match(doc, /<link rel="stylesheet" href="\/css\/tokens\.css">\n<link rel="stylesheet" href="\/css\/app\.css">/);
  assert.match(doc, /localStorage\.getItem\('gravity-field\.theme'\)/);
  assert.match(doc, /<div id="app" class="app"><main>x<\/main><\/div>/);
  assert.match(doc, /<script type="application\/json" id="catalogue">\{"k":"\\u003c"\}<\/script>/);
  assert.match(doc, /<script type="module" src="\/js\/client\.js"><\/script>/);
  const nf = renderDocument({ title: 'Not found', body: renderNotFound(), script: null });
  assert.doesNotMatch(nf, /type="module"|id="catalogue"/);
  assert.match(nf, /class="grid-title">Not found</);
});

test('the shelves page, a shelf grid and a plugin page are rendered on the server with the catalogue embedded, escaped', async () => {
  const { base, close } = await testApp();
  try {
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.equal(home.headers.get('content-type'), 'text/html; charset=utf-8');
    const h = await home.text();
    assert.match(h, /<title>Gravity Field<\/title>/);
    assert.match(h, /<h1 class="head-title">Gravity Field<\/h1>/);
    assert.match(h, /class="shelf-title">Featured</);
    const json = h.match(/<script type="application\/json" id="catalogue">([\s\S]*?)<\/script>/)[1];
    assert.doesNotMatch(json, /<\//, 'no closing tag can hide in the data');
    const data = JSON.parse(json);
    assert.deepEqual(data.plugins.map(p => p.id), ['alpha', 'beta', 'gamma']);
    assert.equal(data.plugins[1].blurb, 'Beta </script><img src=x onerror=alert(1)> prices', 'the data round-trips intact');
    assert.equal(data.origin, base);
    assert.ok(data.now > 0);
    assert.doesNotMatch(h.replace(json, ''), /<img src=x/, 'and the markup around it is escaped');
    const data2 = await (await fetch(`${base}/discover/data`)).text();
    assert.match(data2, /<title>Data · Gravity Field<\/title>/);
    assert.match(data2, /<a class="back-link" data-nav href="\/">‹ Gravity Field<\/a><div class="grid-title">Data<\/div>/);
    const one = await fetch(`${base}/p/alpha`);
    assert.equal(one.status, 200);
    const o = await one.text();
    assert.match(o, /<title>Alpha Data · Gravity Field<\/title>/);
    assert.match(o, /<main class="main disc with-drawer">/);
    assert.match(o, /<aside class="drawer" aria-label="Alpha Data">/);
    assert.match(o, /class="pcard pressed" data-action="openPlugin" data-id="alpha"/);
    assert.equal((await fetch(`${base}/`, { method: 'HEAD' })).status, 200);
  } finally {
    await close();
  }
});

test('an unknown plugin, an unknown shelf and a stray path are 404 pages without the client script; a pending submission has a page', async () => {
  const { app, base, close } = await testApp();
  try {
    for (const path of ['/p/nope', '/p/Bad', '/discover/zzz', '/x/y']) {
      const r = await fetch(`${base}${path}`);
      assert.equal(r.status, 404, path);
      const t = await r.text();
      assert.match(t, /class="grid-title">Not found</, path);
      assert.doesNotMatch(t, /type="module"/, path);
    }
    app.services.submissions.add({ manifest: { id: 'pend', name: 'Pending One', kind: 'Data', blurb: 'waits', url: 'https://p.example/mcp', homepage: null, by: '@p', icon: null, needs: 'none', writes: ['message'], asks: [], tools: [] }, probe: probeOk, via: 'form' });
    const r = await fetch(`${base}/p/pend`);
    assert.equal(r.status, 200);
    const t = await r.text();
    assert.match(t, /class="dim">Data · In review</);
    assert.match(t, /class="pkey-wait"/);
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/routes.test.js tests/pages.test.js`
Expected: FAIL — the modules do not exist; `/` is 404.

- [ ] **Step 3: Write js/routes.js**

```js
// js/routes.js — the paths the site answers (spec §4): /, /discover/<shelf>, /p/<id>, /submit, /admin; pure, shared with the browser
export const SHELF_IDS = ['featured', 'data', 'monitors', 'bots', 'crypto', 'quant'];
const ID = /^[a-z][a-z0-9-]{1,40}$/;

export function parsePath(pathname) {
  const parts = String(pathname ?? '').split('/').filter(Boolean);
  if (parts.length === 0) return { page: 'shelves', shelf: null, plugin: null };
  if (parts[0] === 'discover' && parts.length === 2 && SHELF_IDS.includes(parts[1])) return { page: 'shelves', shelf: parts[1], plugin: null };
  if (parts[0] === 'p' && parts.length === 2 && ID.test(parts[1])) return { page: 'shelves', shelf: null, plugin: parts[1] };
  if (parts.length === 1 && parts[0] === 'submit') return { page: 'submit', shelf: null, plugin: null };
  if (parts.length === 1 && parts[0] === 'admin') return { page: 'admin', shelf: null, plugin: null };
  return null;
}

export function toPath(route) {
  if (route.plugin) return `/p/${route.plugin}`;
  if (route.shelf) return `/discover/${route.shelf}`;
  return '/';
}
```

- [ ] **Step 4: Write js/http.js**

```js
// js/http.js — the answers every route writes, and the two readers: a bounded body and the cookie header
export function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

export function sendHtml(res, status, html, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(html);
}

export function notFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found');
}

// the whole body as a string, or a rejection carrying status 413 once it passes the limit
export function readBody(req, { limit = 64 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function parseCookies(header) {
  return Object.fromEntries(String(header ?? '').split(';').map(s => s.trim()).filter(Boolean).map(s => {
    const i = s.indexOf('=');
    try { return i < 0 ? [s, ''] : [s.slice(0, i), decodeURIComponent(s.slice(i + 1))]; } catch { return [s.slice(0, i), '']; }
  }));
}
```

- [ ] **Step 5: Write js/render/page.js**

```js
// js/render/page.js — the document around a screen (spec §4, §5.1): fonts, tokens, the theme before the first paint, the catalogue as JSON, the client script
import { esc } from '../html.js';

export const THEME_KEY = 'gravity-field.theme';
export const FONTS = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Noto+Sans+SC:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap';

// JSON that can sit inside <script>: no '<' (so no closing tag), and no raw line terminators
export function safeJson(v) {
  return JSON.stringify(v ?? null).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function renderDocument({ title = 'Gravity Field', body = '', data = null, script = '/js/client.js', lang = 'en' } = {}) {
  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="/css/tokens.css">
<link rel="stylesheet" href="/css/app.css">
<script>
  // the theme before the first paint: the saved choice, else the system's own
  try { const t = localStorage.getItem('${THEME_KEY}'); if (t === 'cream' || t === 'black') document.documentElement.dataset.theme = t; } catch {}
</script>
</head>
<body>
<div id="app" class="app">${body}</div>
${data ? `<script type="application/json" id="catalogue">${safeJson(data)}</script>` : ''}${script ? `\n<script type="module" src="${esc(script)}"></script>` : ''}
</body>
</html>
`;
}

export function renderNotFound() {
  return '<main class="main disc"><div class="disc-head"><h1 class="head-title">Gravity Field</h1></div><section class="grid-sec"><a class="back-link" href="/">‹ Gravity Field</a><div class="grid-title">Not found</div></section></main>';
}
```

- [ ] **Step 6: Write js/pages.js**

```js
// js/pages.js — the server-rendered pages (spec §4): the shelves, a shelf as a grid, a plugin with its drawer open, the 404
import { parsePath } from './routes.js';
import { renderDiscover } from './render/discover.js';
import { renderDocument, renderNotFound } from './render/page.js';
import { initialState } from './reducers/discover.js';
import { sendHtml } from './http.js';

const notFoundPage = res => sendHtml(res, 404, renderDocument({ title: 'Not found · Gravity Field', body: renderNotFound(), script: null }));

export function createPages(services) {
  return async function pages({ req, res, path }) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    const route = parsePath(path);
    if (!route) { notFoundPage(res); return true; }
    if (route.page !== 'shelves') return false;
    const cat = services.catalogue(req);
    const p = route.plugin ? cat.byId(route.plugin) : null;
    if (route.plugin && !p) { notFoundPage(res); return true; }
    const title = p ? `${p.name} · Gravity Field` : route.shelf ? `${cat.shelf(route.shelf)?.title ?? 'Gravity Field'} · Gravity Field` : 'Gravity Field';
    sendHtml(res, 200, renderDocument({ title, body: renderDiscover(initialState({ route }), cat), data: cat.toJSON() }));
    return true;
  };
}
```

- [ ] **Step 7: Edit serve.js**

Replace the three helper definitions (`sendJson`, `sendHtml`, `notFound`) with an import and a re-export, and add the pages route. The import block at the top becomes:

```js
import { createRegistry } from './js/registry.js';
import { createSubmissions, pendingEntry } from './js/submissions.js';
import { createLedger } from './js/ledger.js';
import { createGateway } from './js/gateway.js';
import { createLimiter, clientIp } from './js/ratelimit.js';
import { probe as realProbe } from './js/probe.js';
import { makeCatalogue } from './js/data/catalogue.js';
import { sendJson, sendHtml, notFound } from './js/http.js';
import { createPages } from './js/pages.js';

export { sendJson, sendHtml, notFound };
```

Delete the three `export function sendJson/sendHtml/notFound` blocks. Replace the line `const routes = [];` and its comment with:

```js
  // route handlers answer true when they took the request; tried in this order (Tasks 13–16 add theirs)
  const routes = [createPages(services)];
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --test tests/routes.test.js tests/pages.test.js tests/serve.test.js`
Expected: PASS. Then `npm test`: everything green.

- [ ] **Step 9: Commit**

```bash
git add js/routes.js js/http.js js/render/page.js js/pages.js serve.js tests/routes.test.js tests/pages.test.js
git commit -m "feat: the routes, the page shell and the server rendered pages"
```

---

### Task 13: The submission door and the JSON API

**Files:**
- Create: `js/door.js`, `js/api.js`
- Modify: `serve.js` (one import, one entry in the routes array), `tests/helpers/http.js` (add `rootWith`)
- Test: `tests/door.test.js`, `tests/api.test.js`

**Interfaces:**
- Consumes: `validateManifest` (Task 3), `services` (Task 9), `readBody`, `sendJson` (Task 12), the fake upstream (Task 5).
- Produces: `submitManifest(services, input, via) → { ok: true, id, status: 'review', probe, record } | { ok: false, error: { field, rule } }`, `approveSubmission(services, id) → { ok: true, record } | { ok: false, error }`, `rejectSubmission(services, id, reason)`, `manifestFromForm(fields)`; `publicEntry(p)`, `createApi(services)` → a route handler for `/api/*` except `/api/admin/*`; `rootWith(plugins, shelves) → root dir` for tests.

- [ ] **Step 1: Add rootWith to tests/helpers/http.js**

```js
import { mkdirSync, writeFileSync } from 'node:fs';

// a root whose plugins/ holds exactly these manifests and shelves
export function rootWith(plugins, shelves = {}) {
  const root = tmp();
  mkdirSync(join(root, 'plugins'));
  for (const p of plugins) writeFileSync(join(root, 'plugins', `${p.id}.json`), JSON.stringify(p));
  writeFileSync(join(root, 'plugins', 'shelves.json'), JSON.stringify(shelves));
  return root;
}

export const manifest = (id, url, extra = {}) => ({ id, name: id[0].toUpperCase() + id.slice(1), kind: 'Data', blurb: `${id} in one line`, url, homepage: null, by: `@${id}`, icon: null, needs: 'none', writes: ['message'], asks: [], tools: ['echo'], ...extra });
```

(Merge the `mkdirSync, writeFileSync` import with the existing `mkdtempSync` import from `node:fs`.)

- [ ] **Step 2: Write the failing tests**

```js
// tests/door.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submitManifest, approveSubmission, rejectSubmission, manifestFromForm } from '../js/door.js';
import { testApp, manifest } from './helpers/http.js';
import { startUpstream } from './helpers/fake-upstream.js';

test('submitManifest validates, refuses collisions, probes, and stores with the missing tools listed', async () => {
  const up = await startUpstream();
  const { app, close } = await testApp();
  try {
    const bad = await submitManifest(app.services, { ...manifest('zeta', up.url), kind: 'Nope' }, 'form');
    assert.deepEqual(bad.error.field, 'kind');
    assert.deepEqual((await submitManifest(app.services, manifest('alpha', up.url), 'form')).error, { field: 'id', rule: 'an approved plugin already has this id' });
    const r = await submitManifest(app.services, manifest('zeta', up.url, { tools: ['echo', 'nope'] }), 'mcp');
    assert.equal(r.ok, true);
    assert.equal(r.id, 'zeta');
    assert.equal(r.status, 'review');
    assert.deepEqual(r.probe.toolList.map(t => t.name), ['echo', 'boom', 'slow']);
    assert.deepEqual(r.probe.missing, ['nope']);
    assert.equal(r.record.via, 'mcp');
    assert.equal(app.services.submissions.has('zeta'), true);
    assert.deepEqual((await submitManifest(app.services, manifest('zeta', up.url), 'form')).error, { field: 'id', rule: 'a pending submission already has this id' });
    const dead = await submitManifest(app.services, manifest('eta', 'http://127.0.0.1:1/mcp'), 'form');
    assert.equal(dead.ok, true, 'a failed probe is stored, not refused');
    assert.equal(dead.probe.ok, false);
    assert.deepEqual(dead.probe.missing, []);
    const outside = await submitManifest(app.services, manifest('theta', 'https://10.0.0.8/mcp'), 'form');
    assert.equal(outside.ok, true);
    assert.equal(outside.probe.error, 'an address inside a network', 'the probe refused it without connecting; the operator sees why');
  } finally {
    await close();
    await up.close();
  }
});

test('approveSubmission probes again and needs every claimed tool; then the plugin is in the registry; reject moves the file', async () => {
  const up = await startUpstream();
  const { app, close } = await testApp();
  try {
    await submitManifest(app.services, manifest('zeta', up.url, { tools: ['echo', 'nope'] }), 'form');
    const no = await approveSubmission(app.services, 'zeta');
    assert.deepEqual(no, { ok: false, error: 'the server does not list: nope' });
    assert.equal(app.services.submissions.has('zeta'), true, 'still pending');
    await submitManifest(app.services, manifest('eta', up.url), 'form');
    const yes = await approveSubmission(app.services, 'eta');
    assert.equal(yes.ok, true);
    assert.equal(yes.record.approvedAt > 0, true);
    assert.equal(app.services.registry.has('eta'), true);
    assert.equal(app.services.registry.byId('eta').status, 'up');
    assert.deepEqual(app.services.registry.byId('eta').toolList.map(t => t.name), ['echo', 'boom', 'slow']);
    assert.equal(app.services.submissions.has('eta'), false);
    assert.deepEqual(await approveSubmission(app.services, 'eta'), { ok: false, error: 'no such submission' });
    await submitManifest(app.services, manifest('iota', 'http://127.0.0.1:1/mcp'), 'form');
    const down = await approveSubmission(app.services, 'iota');
    assert.equal(down.ok, false);
    assert.match(down.error, /^the probe failed: /);
    const rj = rejectSubmission(app.services, 'iota', 'no such server');
    assert.equal(rj.ok, true);
    assert.equal(rj.record.reason, 'no such server');
    assert.deepEqual(rejectSubmission(app.services, 'iota', 'x'), { ok: false, error: 'no such submission' });
  } finally {
    await close();
    await up.close();
  }
});

test('manifestFromForm: the id is the name\'s slug, asks split by line, tools empty, needs none', () => {
  const m = manifestFromForm(new URLSearchParams('name= Moat Score! &kind=Data&blurb=Moat scores, ask by ticker&url=https://moat.example/mcp&homepage=&by=you&icon=&asks=“Is KO wide?”%0A%0A“Compare KO and PEP”'));
  assert.deepEqual(m, { id: 'moat-score', name: 'Moat Score!', kind: 'Data', blurb: 'Moat scores, ask by ticker', url: 'https://moat.example/mcp', homepage: null, by: 'you', icon: null, needs: 'none', writes: ['message'], asks: ['“Is KO wide?”', '“Compare KO and PEP”'], tools: [] });
  assert.equal(manifestFromForm({ name: '123 Go' }).id, 'go', 'a slug starts with a letter');
  assert.equal(manifestFromForm({ name: '' }).id, '');
});
```

```js
// tests/api.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testApp, manifest } from './helpers/http.js';
import { startUpstream } from './helpers/fake-upstream.js';

const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('the catalogue as JSON: the list, one plugin, search by text and kind, the ledger counts, and 404s', async () => {
  const { base, close } = await testApp();
  try {
    const all = await (await fetch(`${base}/api/plugins`)).json();
    assert.deepEqual(all.plugins.map(p => p.id), ['alpha', 'beta', 'gamma']);
    assert.deepEqual(Object.keys(all.plugins[0]).sort(), ['asks', 'blurb', 'by', 'calls', 'homepage', 'icon', 'id', 'kind', 'latencyMs', 'name', 'needs', 'pending', 'probedAt', 'server', 'status', 'toolList', 'tools', 'url', 'writes']);
    const one = await fetch(`${base}/api/plugins/alpha`);
    assert.equal(one.status, 200);
    assert.equal((await one.json()).name, 'Alpha Data');
    assert.equal((await fetch(`${base}/api/plugins/nope`)).status, 404);
    assert.equal((await fetch(`${base}/api/plugins/Bad`)).status, 404);
    assert.deepEqual((await (await fetch(`${base}/api/search?q=beta`)).json()).plugins.map(p => p.id), ['beta']);
    assert.deepEqual((await (await fetch(`${base}/api/search?kind=Monitors`)).json()).plugins.map(p => p.id), ['gamma']);
    assert.deepEqual((await (await fetch(`${base}/api/search?q=&kind=Data`)).json()).plugins.map(p => p.id), ['alpha']);
    assert.deepEqual(await (await fetch(`${base}/api/ledger`)).json(), { total: 0, lastHour: 0, plugins: {} });
    const zz = await fetch(`${base}/api/zzz`);
    assert.equal(zz.status, 404);
    assert.deepEqual(await zz.json(), { error: 'not found' });
    assert.equal((await fetch(`${base}/api/admin/x/approve`, { method: 'POST' })).status, 404, 'admin paths are not the api\'s; without the admin handler they fall through');
  } finally {
    await close();
  }
});

test('POST /api/submissions: the door, its refusals, the body limit and its own bucket', async () => {
  const up = await startUpstream();
  const { base, close } = await testApp({ limits: { submissions: [2, 3_600_000] } });
  try {
    const r = await post(`${base}/api/submissions`, { manifest: manifest('zeta', up.url) });
    assert.equal(r.status, 202);
    const body = await r.json();
    assert.equal(body.id, 'zeta');
    assert.equal(body.status, 'review');
    assert.deepEqual(body.probe.toolList.map(t => t.name), ['echo', 'boom', 'slow']);
    const listed = (await (await fetch(`${base}/api/plugins`)).json()).plugins.find(p => p.id === 'zeta');
    assert.equal(listed.pending, true);
    assert.equal(listed.status, 'up');
    const dup = await post(`${base}/api/submissions`, manifest('zeta', up.url));
    assert.equal(dup.status, 400);
    assert.deepEqual(await dup.json(), { error: { field: 'id', rule: 'a pending submission already has this id' } });
    const third = await post(`${base}/api/submissions`, manifest('eta', up.url));
    assert.equal(third.status, 429, 'two submissions an hour from one address in this test');
    assert.ok(Number(third.headers.get('retry-after')) >= 1);
  } finally {
    await close();
    await up.close();
  }
});

test('POST /api/submissions with bad JSON is 400, over 64 KB is 413, an approved id is 400 with the rule', async () => {
  const { base, close } = await testApp();
  try {
    const bad = await post(`${base}/api/submissions`, '{not json');
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: 'invalid JSON' });
    const big = await post(`${base}/api/submissions`, JSON.stringify({ manifest: { blurb: 'x'.repeat(70 * 1024) } }));
    assert.equal(big.status, 413);
    const taken = await post(`${base}/api/submissions`, { manifest: manifest('alpha', 'https://a.example/mcp') });
    assert.equal(taken.status, 400);
    assert.deepEqual(await taken.json(), { error: { field: 'id', rule: 'an approved plugin already has this id' } });
  } finally {
    await close();
  }
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/door.test.js tests/api.test.js`
Expected: FAIL — the modules do not exist; `/api/plugins` is a 404 page.

- [ ] **Step 4: Write js/door.js**

```js
// js/door.js — the two doors share one validator and one probe (spec §8.1): submit a manifest, approve or reject a submission
import { validateManifest } from './data/manifest.js';

export async function submitManifest(services, input, via) {
  const { registry, submissions, probe, options } = services;
  const v = validateManifest(input, { allowLoopback: options.allowLoopback });
  if (!v.ok) return { ok: false, error: v.error };
  const m = v.manifest;
  if (registry.has(m.id)) return { ok: false, error: { field: 'id', rule: 'an approved plugin already has this id' } };
  if (submissions.has(m.id)) return { ok: false, error: { field: 'id', rule: 'a pending submission already has this id' } };
  // a failed probe is stored with its error: the operator may know the server; it cannot be approved until one passes
  const result = await probe(m.url);
  const missing = result.ok ? m.tools.filter(t => !result.toolList.some(x => x.name === t)) : [];
  const record = submissions.add({ manifest: m, probe: { ...result, missing }, via });
  return { ok: true, id: m.id, status: 'review', probe: record.probe, record };
}

// the acceptance check (spec §8.2): probe again, every claimed tool listed; then the file moves and the registry reloads
export async function approveSubmission(services, id) {
  const { registry, submissions, probe } = services;
  const rec = submissions.get(id);
  if (!rec) return { ok: false, error: 'no such submission' };
  const result = await probe(rec.manifest.url);
  if (!result.ok) return { ok: false, error: `the probe failed: ${result.error}` };
  const missing = rec.manifest.tools.filter(t => !result.toolList.some(x => x.name === t));
  if (missing.length) return { ok: false, error: `the server does not list: ${missing.join(', ')}` };
  const record = submissions.approve(id, { probe: { ...result, missing: [] } });
  registry.reload();
  registry.setProbe(id, result);
  return { ok: true, record };
}

export function rejectSubmission(services, id, reason = '') {
  const record = services.submissions.reject(id, String(reason).slice(0, 200));
  return record ? { ok: true, record } : { ok: false, error: 'no such submission' };
}

// the form's fields as a manifest (spec §5.5): the id is the name's slug; tools come from the probe, so none are claimed
export function manifestFromForm(fields) {
  const get = k => String((typeof fields.get === 'function' ? fields.get(k) : fields[k]) ?? '').trim();
  const name = get('name');
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '').slice(0, 41);
  const asks = get('asks').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 4);
  return { id, name, kind: get('kind'), blurb: get('blurb'), url: get('url'), homepage: get('homepage') || null, by: get('by'), icon: get('icon') || null, needs: 'none', writes: ['message'], asks, tools: [] };
}
```

- [ ] **Step 5: Write js/api.js**

```js
// js/api.js — the JSON routes (spec §4): the catalogue for the client script and anyone, the ledger counts, the submission door
import { sendJson, readBody } from './http.js';
import { submitManifest } from './door.js';

const ONE = /^\/api\/plugins\/([a-z][a-z0-9-]{1,40})$/;

// what a plugin looks like from outside: the manifest and the derived fields, nothing else
export function publicEntry(p) {
  const { id, name, kind, blurb, url, homepage, by, icon, needs, writes, asks, tools, server, toolList, status, probedAt, latencyMs, calls, pending } = p;
  return { id, name, kind, blurb, url, homepage, by, icon, needs, writes, asks, tools, server: server ?? null, toolList: toolList ?? [], status, probedAt: probedAt ?? null, latencyMs: latencyMs ?? null, calls: calls ?? 0, pending: !!pending };
}

export function createApi(services) {
  return async function api({ req, res, url, path, ip }) {
    if (!path.startsWith('/api/') || path.startsWith('/api/admin/')) return false;
    if (req.method === 'GET' && path === '/api/plugins') { sendJson(res, 200, { plugins: services.catalogue(req).all.map(publicEntry) }); return true; }
    const one = path.match(ONE);
    if (req.method === 'GET' && one) {
      const p = services.catalogue(req).byId(one[1]);
      if (p) sendJson(res, 200, publicEntry(p)); else sendJson(res, 404, { error: 'unknown plugin' });
      return true;
    }
    if (req.method === 'GET' && path === '/api/search') {
      const cat = services.catalogue(req);
      const q = url.searchParams.get('q') ?? '';
      const kind = url.searchParams.get('kind');
      let found = q.trim() ? cat.search(q) : cat.all;
      if (kind) found = found.filter(p => p.kind === kind);
      sendJson(res, 200, { plugins: found.map(publicEntry) });
      return true;
    }
    if (req.method === 'GET' && path === '/api/ledger') { sendJson(res, 200, services.ledger.counts()); return true; }
    if (req.method === 'POST' && path === '/api/submissions') {
      const gate = services.limiters.submissions.take(ip);
      if (!gate.ok) { sendJson(res, 429, { error: 'rate limited' }, { 'retry-after': String(gate.retryAfterSec) }); return true; }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch (e) { sendJson(res, e.status === 413 ? 413 : 400, { error: e.status === 413 ? 'body too large' : 'invalid JSON' }); return true; }
      const r = await submitManifest(services, body?.manifest ?? body, 'api');
      if (r.ok) sendJson(res, 202, { id: r.id, status: r.status, probe: r.probe }); else sendJson(res, 400, { error: r.error });
      return true;
    }
    sendJson(res, 404, { error: 'not found' });
    return true;
  };
}
```

- [ ] **Step 6: Edit serve.js**

Add the import after the `createPages` import:

```js
import { createApi } from './js/api.js';
```

and make the routes array:

```js
  const routes = [createApi(services), createPages(services)];
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test tests/door.test.js tests/api.test.js`
Expected: PASS, 6 tests. Then `npm test` green.

- [ ] **Step 8: Commit**

```bash
git add js/door.js js/api.js serve.js tests/helpers/http.js tests/door.test.js tests/api.test.js
git commit -m "feat: the submission door and the JSON api"
```

---

### Task 14: The MCP face

**Files:**
- Create: `js/mcp.js`
- Modify: `serve.js` (one import, one entry in the routes array)
- Test: `tests/mcp.test.js`

**Interfaces:**
- Consumes: `services`; `publicEntry` (Task 13); `submitManifest` (Task 13); `allowedTools` (Task 6); `KINDS` (Task 3); `TOOL_NAMES`, `RESERVED_TOOLS` (Task 10).
- Produces: `INSTRUCTIONS`, `makeServer(services, { req, ip }) → McpServer` with the four tools, `createMcpRoute(services)` → a route handler for `POST|GET|DELETE /mcp`.

- [ ] **Step 1: Write the failing test**

```js
// tests/mcp.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { testApp, rootWith, manifest } from './helpers/http.js';
import { startUpstream } from './helpers/fake-upstream.js';
import { TOOL_NAMES } from '../js/data/clients.js';

async function connect(base) {
  const client = new Client({ name: 'test-client', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  return client;
}
const textOf = r => JSON.parse(r.content[0].text);

test('the face: name, instructions naming the reserved tools, exactly the four tools', async () => {
  const { base, close } = await testApp();
  const client = await connect(base);
  try {
    assert.equal(client.getServerVersion().name, 'gravity-field');
    assert.match(client.getInstructions(), /shop_install, shop_uninstall, shop_mine are reserved/);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(), [...TOOL_NAMES].sort());
    for (const t of tools) assert.match(t.name, /^[A-Za-z0-9_-]{1,64}$/, 'a legal tool name');
  } finally {
    await client.close();
    await close();
  }
});

test('shop_search: everything in shelf order, by text, by kind; shop_get: one plugin or an error', async () => {
  const { base, close } = await testApp();
  const client = await connect(base);
  try {
    const all = textOf(await client.callTool({ name: 'shop_search', arguments: {} }));
    assert.deepEqual(all.plugins.map(p => p.id), ['beta', 'alpha', 'gamma'], 'featured first, then the kinds');
    assert.deepEqual(Object.keys(all.plugins[0]), ['id', 'name', 'kind', 'blurb', 'by', 'tools', 'status']);
    assert.deepEqual(textOf(await client.callTool({ name: 'shop_search', arguments: { q: 'gamma' } })).plugins.map(p => p.id), ['gamma']);
    assert.deepEqual(textOf(await client.callTool({ name: 'shop_search', arguments: { kind: 'Data' } })).plugins.map(p => p.id), ['alpha']);
    assert.deepEqual(textOf(await client.callTool({ name: 'shop_search', arguments: { q: 'zzz' } })).plugins, []);
    const one = textOf(await client.callTool({ name: 'shop_get', arguments: { id: 'alpha' } }));
    assert.equal(one.name, 'Alpha Data');
    assert.deepEqual(one.tools, ['echo']);
    assert.equal(one.pending, false);
    const none = await client.callTool({ name: 'shop_get', arguments: { id: 'nope' } });
    assert.equal(none.isError, true);
    assert.equal(none.content[0].text, 'unknown plugin');
  } finally {
    await client.close();
    await close();
  }
});

test('shop_publish lands in review and shows as such; its plugin cannot be called yet; a bad manifest names the rule', async () => {
  const up = await startUpstream();
  const { app, base, close } = await testApp();
  const client = await connect(base);
  try {
    const r = textOf(await client.callTool({ name: 'shop_publish', arguments: { manifest: manifest('zeta', up.url) } }));
    assert.equal(r.status, 'review');
    assert.deepEqual(r.probe.toolList.map(t => t.name), ['echo', 'boom', 'slow']);
    assert.equal(app.services.submissions.has('zeta'), true);
    const found = textOf(await client.callTool({ name: 'shop_search', arguments: { q: 'zeta' } })).plugins[0];
    assert.equal(found.status, 'review');
    const call = await client.callTool({ name: 'plugin_call', arguments: { id: 'zeta', tool: 'echo', args: { text: 'x' } } });
    assert.equal(call.isError, true);
    assert.equal(call.content[0].text, 'in review');
    const bad = await client.callTool({ name: 'shop_publish', arguments: { manifest: { ...manifest('eta', up.url), kind: 'Nope' } } });
    assert.equal(bad.isError, true);
    assert.equal(bad.content[0].text, 'kind: one of Data · Monitors · Bots · Crypto · Quant');
  } finally {
    await client.close();
    await close();
    await up.close();
  }
});

test('plugin_call forwards to a live plugin, writes a ledger line, refuses undeclared tools and unknown plugins, and is rate limited', async () => {
  const up = await startUpstream();
  const root = rootWith([manifest('live', up.url, { tools: ['echo'] })], { featured: ['live'], Data: ['live'] });
  const { base, close } = await testApp({ root, limits: { calls: [2, 60_000] } });
  const client = await connect(base);
  try {
    const r = await client.callTool({ name: 'plugin_call', arguments: { id: 'live', tool: 'echo', args: { text: 'hi' } } });
    assert.deepEqual(r.content, [{ type: 'text', text: 'echo:hi' }]);
    assert.equal(!!r.isError, false);
    assert.deepEqual(up.calls, [['echo', 'hi']]);
    const ledger = await (await fetch(`${base}/api/ledger`)).json();
    assert.equal(ledger.total, 1);
    assert.deepEqual(ledger.plugins.live.tools, { echo: 1 });
    const no = await client.callTool({ name: 'plugin_call', arguments: { id: 'live', tool: 'boom' } });
    assert.equal(no.isError, true);
    assert.equal(no.content[0].text, 'tool not offered');
    assert.equal((await (await fetch(`${base}/api/ledger`)).json()).total, 1, 'a refused tool is not a call');
    const unk = await client.callTool({ name: 'plugin_call', arguments: { id: 'nope', tool: 'echo' } });
    assert.equal(unk.content[0].text, 'unknown plugin');
    await client.callTool({ name: 'plugin_call', arguments: { id: 'live', tool: 'echo', args: { text: 'two' } } });
    const limited = await client.callTool({ name: 'plugin_call', arguments: { id: 'live', tool: 'echo', args: { text: 'three' } } });
    assert.equal(limited.isError, true);
    assert.equal(limited.content[0].text, 'rate limited');
    assert.equal((await (await fetch(`${base}/api/ledger`)).json()).total, 2);
    assert.equal((await (await fetch(`${base}/api/plugins/live`)).json()).calls, 2, 'the drawer\'s count follows');
  } finally {
    await client.close();
    await close();
    await up.close();
  }
});

test('a plain POST without a session works in stateless JSON mode, so curl can list the tools', async () => {
  const { base, close } = await testApp();
  try {
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.deepEqual(body.result.tools.map(t => t.name).sort(), [...TOOL_NAMES].sort());
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/mcp.test.js`
Expected: FAIL — `/mcp` is a 404 page, the client cannot connect.

- [ ] **Step 3: Write js/mcp.js**

```js
// js/mcp.js — the MCP face (spec §6): four tools over stateless streamable HTTP, one server per request, built from the shared services
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { KINDS } from './data/manifest.js';
import { RESERVED_TOOLS } from './data/clients.js';
import { allowedTools } from './gateway.js';
import { publicEntry } from './api.js';
import { submitManifest } from './door.js';

export const INSTRUCTIONS = `Gravity Field is a registry of investment plugins: remote MCP servers listed by kind (${KINDS.join(', ')}). shop_search lists plugins by text and kind; shop_get returns one plugin with the tools its server lists; shop_publish submits a manifest for the operator's review; plugin_call(id, tool, args) forwards one call to a listed plugin's own server and records a line in the ledger, with no caller identity. ${RESERVED_TOOLS.join(', ')} are reserved for a later version with accounts.`;

const text = v => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
const fail = msg => ({ content: [{ type: 'text', text: msg }], isError: true });
const brief = p => ({ id: p.id, name: p.name, kind: p.kind, blurb: p.blurb, by: p.by, tools: (p.toolList ?? []).length, status: p.pending ? 'review' : p.status });

export function makeServer(services, { req, ip }) {
  const server = new McpServer({ name: 'gravity-field', version: '0.1.0' }, { instructions: INSTRUCTIONS });
  const cat = () => services.catalogue(req);
  const pendingHas = id => { try { return services.submissions.has(id); } catch { return false; } };

  server.registerTool('shop_search', {
    description: 'List plugins. q matches name, blurb, kind, author and tool names; kind narrows to one kind. No arguments lists everything in shelf order; a plugin under review has status "review".',
    inputSchema: { q: z.string().max(200).optional(), kind: z.enum(KINDS).optional() },
  }, async ({ q, kind }) => {
    const c = cat();
    let found = q?.trim() ? c.search(q) : [...new Set(c.shelves().flatMap(s => s.ids))].map(id => c.byId(id)).filter(Boolean);
    if (kind) found = found.filter(p => p.kind === kind);
    return text({ plugins: found.map(brief) });
  });

  server.registerTool('shop_get', {
    description: 'One plugin: its manifest, the tools its server lists with their input schemas, its status and its call count.',
    inputSchema: { id: z.string().max(64) },
  }, async ({ id }) => {
    const p = cat().byId(id);
    return p ? text(publicEntry(p)) : fail('unknown plugin');
  });

  server.registerTool('shop_publish', {
    description: 'Submit a plugin for review. manifest: { id, name, kind, blurb, url, homepage?, by, icon?, needs: "none", writes?, asks?, tools? }. The server at url is probed at once; the operator approves or refuses.',
    inputSchema: { manifest: z.record(z.string(), z.unknown()) },
  }, async ({ manifest }) => {
    const gate = services.limiters.submissions.take(ip);
    if (!gate.ok) return fail('rate limited');
    const r = await submitManifest(services, manifest, 'mcp');
    return r.ok ? text({ id: r.id, status: r.status, probe: r.probe }) : fail(`${r.error.field}: ${r.error.rule}`);
  });

  server.registerTool('plugin_call', {
    description: 'Call one tool of a listed plugin through Gravity Field. The answer is the plugin\'s own; one ledger line is written.',
    inputSchema: { id: z.string().max(64), tool: z.string().max(64), args: z.record(z.string(), z.unknown()).optional() },
  }, async ({ id, tool, args }) => {
    // the order of spec §7: unknown plugin · tool not offered · rate limited · the call
    const p = services.registry.byId(id);
    if (!p) return fail(pendingHas(id) ? 'in review' : 'unknown plugin');
    if (!allowedTools(p).includes(tool)) return fail('tool not offered');
    const gate = services.limiters.calls.take(ip);
    if (!gate.ok) return fail('rate limited');
    const r = await services.gateway.call(p, tool, args ?? {});
    services.ledger.record({ plugin: id, tool, ok: !r.error && !r.isError, ms: r.ms });
    return r.error ? fail(r.error) : { content: r.content, isError: r.isError };
  });

  return server;
}

export function createMcpRoute(services) {
  return async function mcp({ req, res, path, ip }) {
    if (path !== '/mcp') return false;
    const server = makeServer(services, { req, ip });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      Promise.resolve(transport.close()).catch(() => {});
      Promise.resolve(server.close()).catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (e) {
      services.log(`mcp: ${e.message}`);
      if (!res.headersSent) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'internal' })); }
    }
    return true;
  };
}
```

- [ ] **Step 4: Edit serve.js**

Add the import:

```js
import { createMcpRoute } from './js/mcp.js';
```

and make the routes array:

```js
  const routes = [createApi(services), createMcpRoute(services), createPages(services)];
```

Also change the CLI's log line to name both doors (it already does: `Gravity Field at … · MCP at …/mcp`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/mcp.test.js`
Expected: PASS, 5 tests. If `getInstructions` is not a function on this SDK version, read `client.getInstructions?.()` and, if undefined, assert on `INSTRUCTIONS` imported from `js/mcp.js` instead; the contract is the text.

- [ ] **Step 6: Commit**

```bash
git add js/mcp.js serve.js tests/mcp.test.js
git commit -m "feat: the MCP face with its four tools over stateless streamable http"
```

---

### Task 15: The Submit page

**Files:**
- Create: `js/render/submit.js`, `js/submit.js`
- Modify: `serve.js` (one import, one entry in the routes array)
- Test: `tests/submit.test.js`

**Interfaces:**
- Consumes: `card` (Task 10), `KINDS` (Task 3), `ICONS` (Task 2), `submitManifest`, `manifestFromForm` (Task 13), `renderDocument` (Task 12), `readBody`, `sendHtml`, `sendJson` (Task 12).
- Produces: `renderSubmit({ values, result })`; `createSubmitRoute(services)` → a route handler for `GET|POST /submit`.

- [ ] **Step 1: Write the failing test**

```js
// tests/submit.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSubmit } from '../js/render/submit.js';
import { testApp } from './helpers/http.js';
import { startUpstream } from './helpers/fake-upstream.js';

const form = (base, fields, headers = {}) => fetch(`${base}/submit`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(fields).toString() });
const good = url => ({ name: 'Moat Score', blurb: 'Moat scores, ask by ticker', kind: 'Data', url, homepage: 'https://moat.example', by: 'you', icon: 'shield', asks: '“Is KO wide?”\n“Compare KO and PEP”' });

test('the form: eight labelled fields, the five kinds, the icon pick with the initial first, Submit; no helper sentences', () => {
  const h = renderSubmit({ values: { name: 'Moat' } });
  assert.match(h, /<h1 class="head-title">Submit a plugin<\/h1>/);
  const labels = [...h.matchAll(/class="field-label">([^<]+)</g)].map(m => m[1]);
  assert.deepEqual(labels, ['Name', 'One line', 'Kind', 'MCP address', 'Homepage', 'Your handle', 'Icon', 'What you can ask it']);
  assert.match(h, /<form class="submit-form" method="post" action="\/submit">/);
  assert.equal((h.match(/type="radio" name="kind"/g) ?? []).length, 5);
  assert.match(h, /type="radio" name="kind" value="Data" checked/);
  assert.match(h, /<select class="input" id="f-icon" name="icon"><option value="">M<\/option><option value="chat">chat<\/option>/);
  assert.match(h, /<input class="input" id="f-name" name="name" value="Moat" maxlength="40" required>/);
  assert.match(h, /<button type="submit" class="btn-primary">Submit<\/button>/);
  assert.doesNotMatch(h, /<p[ >]|placeholder="[^"]{9,}"/, 'labels and controls only');
  assert.doesNotMatch(h, /type="module"|field-error/);
});

test('GET shows the form; a good POST shows the card in review and the tools the probe found; the submission is stored', async () => {
  const up = await startUpstream();
  const { app, base, close } = await testApp();
  try {
    const g = await fetch(`${base}/submit`);
    assert.equal(g.status, 200);
    assert.match(await g.text(), /<title>Submit · Gravity Field<\/title>[\s\S]*submit-form/);
    const r = await form(base, good(up.url));
    assert.equal(r.status, 200);
    const t = await r.text();
    assert.match(t, /class="grid-title">In review</);
    assert.match(t, /class="pcard in-grid" data-action="openPlugin" data-id="moat-score"/);
    assert.match(t, /class="pkey-wait" role="img" aria-label="In review"/);
    assert.match(t, /class="pcard-name">Moat Score</);
    assert.match(t, /Tools found<\/div><div class="dsec-line"><span class="mono">echo<\/span> <span class="dim">Echoes the text back<\/span><\/div><div class="dsec-line"><span class="mono">boom<\/span>/);
    assert.doesNotMatch(t, /submit-form/, 'the form has done its job');
    const rec = app.services.submissions.get('moat-score');
    assert.equal(rec.via, 'form');
    assert.deepEqual(rec.manifest.asks, ['“Is KO wide?”', '“Compare KO and PEP”']);
    assert.equal(rec.manifest.by, '@you');
    assert.equal(rec.manifest.icon, 'shield');
    assert.deepEqual(rec.manifest.tools, []);
    assert.equal((await fetch(`${base}/p/moat-score`)).status, 200, 'and it has a page at once');
  } finally {
    await close();
    await up.close();
  }
});

test('a bad POST keeps the values and names the rule under its field; a probe that fails still stores and says so; the bucket holds', async () => {
  const { app, base, close } = await testApp({ limits: { submissions: [3, 3_600_000] } });
  try {
    const bad = await form(base, { ...good('https://m.example/mcp'), kind: 'Nope', name: 'Keep Me' });
    assert.equal(bad.status, 400);
    const t = await bad.text();
    assert.match(t, /name="name" value="Keep Me"/);
    assert.match(t, /Kind<\/span>[\s\S]*?<\/div><div class="field-error">one of Data · Monitors · Bots · Crypto · Quant<\/div>/);
    assert.equal(app.services.submissions.list().length, 0);
    const clash = await form(base, { ...good('https://m.example/mcp'), name: 'Alpha' });
    assert.equal(clash.status, 400);
    assert.match(await clash.text(), /class="field-error">an approved plugin already has this id</);
    const dead = await form(base, good('http://127.0.0.1:1/mcp'));
    assert.equal(dead.status, 200);
    const d = await dead.text();
    assert.match(d, /class="pcard in-grid down"/);
    assert.match(d, /Probe<\/div><div class="dsec-line"><span class="chip down">down<\/span> <span class="dim">/);
    assert.equal((await form(base, good('http://127.0.0.1:1/mcp'))).status, 429);
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/submit.test.js`
Expected: FAIL — the modules do not exist; `/submit` is a 404 page.

- [ ] **Step 3: Write js/render/submit.js**

```js
// js/render/submit.js — the submission form (spec §5.5): labels and controls only; after a submit, the card as it will look and what the probe found
import { esc, attrs } from '../html.js';
import { KINDS } from '../data/manifest.js';
import { ICONS } from '../icons.js';
import { card } from './discover.js';

const field = (label, body) => `<div class="field"><span class="field-label">${esc(label)}</span>${body}</div>`;
const input = (name, value, extra = {}) => `<input${attrs({ class: 'input', id: `f-${name}`, name, value: value ?? '', ...extra })}>`;
const kindSeg = kind => `<div class="radio-seg">${KINDS.map(k => `<label class="radio-item"><input type="radio"${attrs({ name: 'kind', value: k, checked: k === kind })}><span>${esc(k)}</span></label>`).join('')}</div>`;

function form(v, err) {
  const errLine = (...fields) => fields.map(f => (err?.field === f ? `<div class="field-error">${esc(err.rule)}</div>` : '')).join('');
  const initial = String(v.name ?? '').trim().slice(0, 1).toUpperCase() || 'Initial';
  return `<form class="submit-form" method="post" action="/submit">` +
    field('Name', input('name', v.name, { maxlength: 40, required: true })) + errLine('name', 'id') +
    field('One line', input('blurb', v.blurb, { maxlength: 90, required: true })) + errLine('blurb') +
    field('Kind', kindSeg(KINDS.includes(v.kind) ? v.kind : 'Data')) + errLine('kind') +
    field('MCP address', input('url', v.url, { type: 'url', placeholder: 'https://', required: true })) + errLine('url') +
    field('Homepage', input('homepage', v.homepage, { type: 'url', placeholder: 'https://' })) + errLine('homepage') +
    field('Your handle', input('by', v.by, { maxlength: 41, placeholder: '@' })) + errLine('by') +
    field('Icon', `<select class="input" id="f-icon" name="icon"><option value="">${esc(initial)}</option>${Object.keys(ICONS).map(k => `<option${attrs({ value: k, selected: k === v.icon })}>${esc(k)}</option>`).join('')}</select>`) + errLine('icon') +
    field('What you can ask it', `<textarea class="input" id="f-asks" name="asks" rows="4" maxlength="500">${esc(v.asks ?? '')}</textarea>`) + errLine('asks') +
    errLine('manifest', 'needs', 'writes', 'tools') +
    `<div class="btn-row"><button type="submit" class="btn-primary">Submit</button></div></form>`;
}

function after(result) {
  const probe = result.probe;
  const entry = { ...result.record.manifest, pending: true, status: probe.ok ? 'up' : 'down', toolList: probe.ok ? probe.toolList : [] };
  const found = probe.ok
    ? `<div class="dsec"><div class="dsec-label">Tools found</div>${probe.toolList.map(t => `<div class="dsec-line"><span class="mono">${esc(t.name)}</span>${t.description ? ` <span class="dim">${esc(t.description)}</span>` : ''}</div>`).join('')}</div>`
    : `<div class="dsec"><div class="dsec-label">Probe</div><div class="dsec-line"><span class="chip down">down</span> <span class="dim">${esc(probe.error ?? '')}</span></div></div>`;
  return `<section class="submitted"><div class="grid-title">In review</div><div class="grid">${card(entry, { installed: [], drawer: null }, { view: 'grid' })}</div>${found}</section>`;
}

export function renderSubmit({ values = {}, result = null } = {}) {
  const body = result?.ok ? after(result) : form(values, result && !result.ok ? result.error : null);
  return `<main class="main disc submit"><div class="disc-head"><a class="back-link" href="/">‹ Gravity Field</a><h1 class="head-title">Submit a plugin</h1></div>${body}</main>`;
}
```

- [ ] **Step 4: Write js/submit.js**

```js
// js/submit.js — the form door (spec §5.5, §8.1): GET shows the form; POST validates, probes, stores, and shows the card in review
import { renderSubmit } from './render/submit.js';
import { renderDocument } from './render/page.js';
import { sendHtml, sendJson, readBody } from './http.js';
import { submitManifest, manifestFromForm } from './door.js';

export function createSubmitRoute(services) {
  return async function submit({ req, res, path, ip }) {
    if (path !== '/submit') return false;
    const page = (status, props) => sendHtml(res, status, renderDocument({ title: 'Submit · Gravity Field', body: renderSubmit(props), script: null }));
    if (req.method === 'GET' || req.method === 'HEAD') { page(200, {}); return true; }
    if (req.method !== 'POST') return false;
    const gate = services.limiters.submissions.take(ip);
    if (!gate.ok) { sendJson(res, 429, { error: 'rate limited' }, { 'retry-after': String(gate.retryAfterSec) }); return true; }
    let fields;
    try { fields = new URLSearchParams(await readBody(req)); } catch (e) { sendJson(res, e.status === 413 ? 413 : 400, { error: e.status === 413 ? 'body too large' : 'bad form' }); return true; }
    const result = await submitManifest(services, manifestFromForm(fields), 'form');
    page(result.ok ? 200 : 400, { values: Object.fromEntries(fields), result });
    return true;
  };
}
```

- [ ] **Step 5: Edit serve.js**

Add the import:

```js
import { createSubmitRoute } from './js/submit.js';
```

and make the routes array:

```js
  const routes = [createApi(services), createMcpRoute(services), createSubmitRoute(services), createPages(services)];
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test tests/submit.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 7: Commit**

```bash
git add js/render/submit.js js/submit.js serve.js tests/submit.test.js
git commit -m "feat: the submit page, the form door into the review queue"
```

---

### Task 16: The admin page and its gate

**Files:**
- Create: `js/admin.js`, `js/render/admin.js`
- Modify: `serve.js` (one import, one entry at the head of the routes array)
- Test: `tests/admin.test.js`

**Interfaces:**
- Consumes: `approveSubmission`, `rejectSubmission` (Task 13), `pendingEntry` (Task 8), `isLoopback` (Task 7), `parseCookies`, `readBody`, `sendHtml`, `sendJson` (Task 12), `card`, `kv` (Task 10), `ago` (Task 2).
- Produces: `COOKIE`, `adminAllowed({ req, url, ip, services }) → { ok, setCookie? }`, `createAdmin(services)` → a route handler for `GET /admin` and `POST /api/admin/<id>/approve|reject`; `renderAdmin({ pending: [{ rec, entry }], approved, approvedDir, counts, now, error })`.

- [ ] **Step 1: Write the failing test**

```js
// tests/admin.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { testApp, manifest } from './helpers/http.js';
import { startUpstream } from './helpers/fake-upstream.js';
import { submitManifest } from '../js/door.js';

const far = { 'x-forwarded-for': '203.0.113.9' };

test('loopback sees the queue: empty, then a submission as a card with its table and keys; the ledger at the foot', async () => {
  const up = await startUpstream();
  const { app, base, close } = await testApp();
  try {
    const empty = await (await fetch(`${base}/admin`)).text();
    assert.match(empty, /<title>Admin · Gravity Field<\/title>/);
    assert.match(empty, /class="grid-title">In review<\/div><div class="empty">Nothing in review<\/div>/);
    assert.match(empty, /class="grid-title">Ledger<\/div><div class="kv-list"><div class="kv"><span class="kv-k">Calls<\/span><span class="kv-v">0<\/span>/);
    assert.doesNotMatch(empty, /type="module"/);
    await submitManifest(app.services, manifest('zeta', up.url, { tools: ['echo', 'nope'] }), 'mcp');
    const h = await (await fetch(`${base}/admin`)).text();
    assert.match(h, /class="pcard in-grid" data-action="openPlugin" data-id="zeta"/);
    assert.match(h, /<span class="kv-k">Via<\/span><span class="kv-v">mcp</);
    assert.match(h, /<span class="kv-k">Probe<\/span><span class="kv-v"><span class="chip up">up<\/span> fake-upstream 0\.1\.0 · \d+ ms</);
    assert.match(h, /<span class="kv-k">Tools found<\/span><span class="kv-v"><span class="mono">echo · boom · slow<\/span>/);
    assert.match(h, /<span class="kv-k">Claimed<\/span><span class="kv-v"><span class="mono">echo · <span class="down">nope<\/span><\/span>/);
    assert.match(h, /<form method="post" action="\/api\/admin\/zeta\/approve"><button type="submit" class="btn-primary small">Approve<\/button><\/form>/);
    assert.match(h, /<form method="post" action="\/api\/admin\/zeta\/reject" class="reject"><input class="input small" name="reason" aria-label="Reason" placeholder="Reason"><button type="submit" class="btn-danger">Reject<\/button><\/form>/);
    assert.match(await (await fetch(`${base}/admin?error=the+probe+failed`)).text(), /<div class="field-error">the probe failed<\/div>/);
  } finally {
    await close();
    await up.close();
  }
});

test('the gate: not loopback is 403 without a token; a token visit sets the cookie; the cookie then admits; a wrong token does not', async () => {
  const { base, close } = await testApp({ trustProxy: true });
  try {
    assert.equal((await fetch(`${base}/admin`, { headers: far })).status, 403);
    assert.equal((await fetch(`${base}/admin?token=abc`, { headers: far })).status, 403, 'no token is configured, so none can match');
  } finally {
    await close();
  }
  const withToken = await testApp({ trustProxy: true, adminToken: 's3cret' });
  try {
    const { base } = withToken;
    assert.equal((await fetch(`${base}/admin`, { headers: far })).status, 403);
    assert.equal((await fetch(`${base}/admin?token=wrong`, { headers: far })).status, 403);
    const ok = await fetch(`${base}/admin?token=s3cret`, { headers: far });
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get('set-cookie');
    assert.match(cookie, /^gf_admin=s3cret; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Lax$/);
    assert.equal((await fetch(`${base}/admin`, { headers: { ...far, cookie: 'gf_admin=s3cret' } })).status, 200);
    assert.equal((await fetch(`${base}/admin`, { headers: { ...far, cookie: 'gf_admin=nope' } })).status, 403);
    assert.equal((await fetch(`${base}/api/admin/zeta/approve`, { method: 'POST', headers: far })).status, 403);
    assert.equal((await fetch(`${base}/admin`)).status, 200, 'loopback needs no token');
  } finally {
    await withToken.close();
  }
});

test('approve and reject: JSON for a client, a redirect for a browser; the approved plugin joins the catalogue', async () => {
  const up = await startUpstream();
  const { app, base, close } = await testApp();
  try {
    await submitManifest(app.services, manifest('zeta', up.url, { tools: ['echo', 'nope'] }), 'mcp');
    await submitManifest(app.services, manifest('eta', up.url), 'form');
    await submitManifest(app.services, manifest('iota', up.url), 'form');
    const no = await fetch(`${base}/api/admin/zeta/approve`, { method: 'POST' });
    assert.equal(no.status, 409);
    assert.deepEqual(await no.json(), { ok: false, error: 'the server does not list: nope' });
    const yes = await fetch(`${base}/api/admin/eta/approve`, { method: 'POST' });
    assert.equal(yes.status, 200);
    assert.deepEqual(await yes.json(), { ok: true, id: 'eta' });
    const listed = (await (await fetch(`${base}/api/plugins`)).json()).plugins.find(p => p.id === 'eta');
    assert.equal(listed.pending, false);
    assert.equal(listed.status, 'up');
    assert.ok(existsSync(join(app.services.options.dataDir, 'approved', 'eta.json')));
    assert.match(await (await fetch(`${base}/admin`)).text(), /class="grid-title">Approved here<\/div><div class="kv-list"><div class="kv"><span class="kv-k">eta<\/span><span class="kv-v"><span class="mono">[^<]*approved\/eta\.json<\/span>/);
    const browser = await fetch(`${base}/api/admin/zeta/approve`, { method: 'POST', headers: { accept: 'text/html' }, redirect: 'manual' });
    assert.equal(browser.status, 303);
    assert.equal(browser.headers.get('location'), '/admin?error=the%20server%20does%20not%20list%3A%20nope');
    const rj = await fetch(`${base}/api/admin/iota/reject`, { method: 'POST', headers: { accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded' }, body: 'reason=no+such+server', redirect: 'manual' });
    assert.equal(rj.status, 303);
    assert.equal(rj.headers.get('location'), '/admin');
    assert.ok(existsSync(join(app.services.options.dataDir, 'rejected', 'iota.json')));
    assert.equal(app.services.submissions.has('iota'), false);
    assert.deepEqual(await (await fetch(`${base}/api/admin/nope/approve`, { method: 'POST' })).json(), { ok: false, error: 'no such submission' });
    assert.equal((await fetch(`${base}/api/admin/BAD/approve`, { method: 'POST' })).status, 404);
  } finally {
    await close();
    await up.close();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/admin.test.js`
Expected: FAIL — the modules do not exist; `/admin` is a 404 page.

- [ ] **Step 3: Write js/render/admin.js**

```js
// js/render/admin.js — the review queue (spec §5.6): each submission as a card and a table with Approve and Reject; the runtime approvals; the ledger
import { esc } from '../html.js';
import { ago } from '../time.js';
import { card, kv } from './discover.js';

const STATE = { installed: [], drawer: null };

function review({ rec, entry }, now) {
  const m = rec.manifest;
  const probe = rec.probe ?? {};
  const missing = probe.missing ?? [];
  const rows = [
    ['Id', `<span class="mono">${esc(m.id)}</span>`],
    ['Kind', esc(m.kind)],
    ['Server', `<span class="mono">${esc(m.url)}</span>`],
    ['By', esc(m.by)],
    ['Homepage', m.homepage ? `<a class="link" href="${esc(m.homepage)}" target="_blank" rel="noopener">${esc(m.homepage)}</a>` : '—'],
    ['Via', esc(rec.via)],
    ['Submitted', esc(ago(rec.at, now))],
    ['Probe', probe.ok ? `<span class="chip up">up</span> ${esc(`${probe.server?.name ?? ''} ${probe.server?.version ?? ''}`.trim())} · ${Number(probe.latencyMs) || 0} ms` : `<span class="chip down">down</span> <span class="dim">${esc(probe.error ?? '')}</span>`],
    ['Tools found', probe.ok ? `<span class="mono">${probe.toolList.map(t => esc(t.name)).join(' · ')}</span>` : '—'],
    ['Claimed', m.tools.length ? `<span class="mono">${m.tools.map(t => (missing.includes(t) ? `<span class="down">${esc(t)}</span>` : esc(t))).join(' · ')}</span>` : 'every listed tool'],
  ];
  return `<section class="review"><div class="grid">${card(entry, STATE, { view: 'grid' })}</div>${kv(rows)}` +
    `<div class="btn-row"><form method="post" action="/api/admin/${esc(m.id)}/approve"><button type="submit" class="btn-primary small">Approve</button></form>` +
    `<form method="post" action="/api/admin/${esc(m.id)}/reject" class="reject"><input class="input small" name="reason" aria-label="Reason" placeholder="Reason"><button type="submit" class="btn-danger">Reject</button></form></div></section>`;
}

export function renderAdmin({ pending = [], approved = [], approvedDir = 'approved', counts = { total: 0, lastHour: 0, plugins: {} }, now = Date.now(), error = null } = {}) {
  const list = pending.length ? pending.map(p => review(p, now)).join('') : '<div class="empty">Nothing in review</div>';
  const runtime = approved.length ? `<div class="grid-title">Approved here</div>${kv(approved.map(r => [r.manifest.id, `<span class="mono">${esc(`${approvedDir}/${r.manifest.id}.json`)}</span>`]))}` : '';
  const ledger = kv([['Calls', String(counts.total)], ['Last hour', String(counts.lastHour)], ...Object.entries(counts.plugins).map(([id, c]) => [id, String(c.total)])]);
  return `<main class="main disc admin"><div class="disc-head"><a class="back-link" href="/">‹ Gravity Field</a><h1 class="head-title">Admin</h1></div>` +
    (error ? `<div class="field-error">${esc(error)}</div>` : '') +
    `<div class="grid-title">In review</div>${list}${runtime}<div class="grid-title">Ledger</div>${ledger}</main>`;
}
```

- [ ] **Step 4: Write js/admin.js**

```js
// js/admin.js — the operator's door (spec §5.6, §8.3): loopback, or the cookie a token visit sets; approve and reject
import { renderAdmin } from './render/admin.js';
import { renderDocument } from './render/page.js';
import { sendHtml, sendJson, parseCookies, readBody } from './http.js';
import { isLoopback } from './ratelimit.js';
import { pendingEntry } from './submissions.js';
import { approveSubmission, rejectSubmission } from './door.js';

export const COOKIE = 'gf_admin';
const THIRTY_DAYS = 30 * 24 * 3600;
const ACTION = /^\/api\/admin\/([a-z][a-z0-9-]{1,40})\/(approve|reject)$/;

// loopback by the client address of §4; else the cookie; else ?token=, which sets the cookie; with no token configured, loopback only
export function adminAllowed({ req, url, ip, services }) {
  if (isLoopback(ip)) return { ok: true };
  const token = services.options.adminToken;
  if (!token) return { ok: false };
  if (parseCookies(req.headers.cookie)[COOKIE] === token) return { ok: true };
  if (url.searchParams.get('token') === token) return { ok: true, setCookie: `${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${THIRTY_DAYS}; HttpOnly; SameSite=Lax` };
  return { ok: false };
}

export function createAdmin(services) {
  return async function admin(ctx) {
    const { req, res, url, path } = ctx;
    const action = path.match(ACTION);
    if (path !== '/admin' && !action) return false;
    const gate = adminAllowed(ctx);
    if (!gate.ok) { sendJson(res, 403, { error: 'forbidden' }); return true; }
    const headers = gate.setCookie ? { 'set-cookie': gate.setCookie } : {};
    if (!action) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return false;
      const body = renderAdmin({
        pending: services.submissions.list().map(rec => ({ rec, entry: pendingEntry(rec) })),
        approved: services.submissions.approved(), approvedDir: services.submissions.dirs.approved,
        counts: services.ledger.counts(), now: Date.now(), error: url.searchParams.get('error'),
      });
      sendHtml(res, 200, renderDocument({ title: 'Admin · Gravity Field', body, script: null }), headers);
      return true;
    }
    if (req.method !== 'POST') return false;
    const [, id, verb] = action;
    let result;
    if (verb === 'approve') {
      result = await approveSubmission(services, id);
    } else {
      let reason = '';
      try { reason = new URLSearchParams(await readBody(req)).get('reason') ?? ''; } catch { reason = ''; }
      result = rejectSubmission(services, id, reason);
    }
    if ((req.headers.accept ?? '').includes('text/html')) {
      res.writeHead(303, { location: result.ok ? '/admin' : `/admin?error=${encodeURIComponent(result.error)}`, ...headers });
      res.end();
    } else {
      sendJson(res, result.ok ? 200 : 409, result.ok ? { ok: true, id } : { ok: false, error: result.error }, headers);
    }
    return true;
  };
}
```

- [ ] **Step 5: Edit serve.js**

Add the import:

```js
import { createAdmin } from './js/admin.js';
```

and make the routes array, admin first so `/api/admin/*` never reaches the api's 404:

```js
  const routes = [createAdmin(services), createApi(services), createMcpRoute(services), createSubmitRoute(services), createPages(services)];
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test tests/admin.test.js`
Expected: PASS, 3 tests. Then `npm test` green.

- [ ] **Step 7: Commit**

```bash
git add js/admin.js js/render/admin.js serve.js tests/admin.test.js
git commit -m "feat: the admin page behind its gate, approve and reject"
```

---

### Task 17: The browser client

**Files:**
- Create: `js/client.js`, `tests/helpers/fake-dom.js`
- Test: `tests/client.test.js`

**Interfaces:**
- Consumes: `createStore` (Task 2), `reducers`, `initialState`, `persist`, `accept` (Task 11), `makeCatalogue` (Task 4), `renderDiscover` (Task 10), `parsePath`, `toPath` (Task 12), `THEME_KEY` (Task 12).
- Produces: `KEY`, `COPIED_MS`, `TOAST_MS`, `boot(win, { copiedMs, toastMs }) → store` (with `store.timers.clear()`); the module boots itself in a browser when `#app` and `#catalogue` exist.

- [ ] **Step 1: Write the fake DOM**

```js
// tests/helpers/fake-dom.js — just enough of a window and document to run boot() under node:test: gravit-ui's, with paths instead of hashes.
// It does not parse HTML. Elements are registered by id or by selector; an innerHTML write behaves like the browser replacing
// the nodes: scroll positions go to 0, typed values go back to what the markup says, focus falls to <body>.
export function fakeWindow({ path = '/', storage = null, catalogue = null } = {}) {
  const byId = new Map();
  const bySelector = new Map();
  const listeners = { root: {}, doc: {}, win: {} };
  const clipboard = [];
  const pushed = [];
  const body = { tagName: 'BODY' };
  let html = '';
  let writes = 0;
  let pathname = path;

  const element = (props = {}) => ({
    id: '', tagName: 'DIV', value: '', rendered: '', dataset: {}, scrollTop: 0, scrollLeft: 0, selectionStart: 0, selectionEnd: 0,
    focus() { doc.activeElement = this; },
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
    ...props,
  });
  const present = el => !el.presentIf || el.presentIf.test(html);

  const root = {
    id: 'app',
    get innerHTML() { return html; },
    set innerHTML(v) {
      html = v;
      writes++;
      for (const el of [...byId.values(), ...[...bySelector.values()].flat()]) { el.scrollTop = 0; el.scrollLeft = 0; el.value = el.rendered; }
      doc.activeElement = body;
    },
    querySelectorAll(sel) { return (bySelector.get(sel) ?? []).filter(present); },
    querySelector(sel) { return (bySelector.get(sel) ?? []).find(present) ?? null; },
    addEventListener(type, fn) { (listeners.root[type] ??= []).push(fn); },
  };
  const catalogueEl = { textContent: catalogue ? JSON.stringify(catalogue) : '' };
  const doc = {
    activeElement: body,
    documentElement: { dataset: {} },
    getElementById(id) {
      if (id === 'app') return root;
      if (id === 'catalogue') return catalogue ? catalogueEl : null;
      const el = byId.get(id);
      return el && present(el) ? el : null;
    },
    addEventListener(type, fn) { (listeners.doc[type] ??= []).push(fn); },
  };
  const win = {
    document: doc,
    localStorage: storage,
    location: { get pathname() { return pathname; }, origin: 'http://127.0.0.1:4840' },
    history: { pushState(_s, _t, p) { pathname = p; pushed.push(p); } },
    navigator: { clipboard: { writeText(t) { clipboard.push(t); return Promise.resolve(); } } },
    addEventListener(type, fn) { (listeners.win[type] ??= []).push(fn); },
  };

  return {
    win, doc, root, body, clipboard, pushed,
    get writes() { return writes; },
    get pathname() { return pathname; },
    html: () => html,
    withId(id, props = {}) { const el = element({ id, ...props }); byId.set(id, el); return el; },
    withSelector(sel, props = {}) { const el = element(props); bySelector.set(sel, [...(bySelector.get(sel) ?? []), el]); return el; },
    fire(target, type, event = {}) { for (const fn of listeners[target][type] ?? []) fn({ preventDefault() {}, ...event }); },
    // a click the way delegation sees it: closest('a[data-nav]') is the element only when it is a nav link
    click(el) { this.fire('root', 'click', { target: { closest: sel => (sel.includes('data-nav') ? (el.nav ? el : null) : el) } }); },
    // the browser moving through history: the path changes, then popstate fires
    popTo(p) { pathname = p; this.fire('win', 'popstate'); },
  };
}

export function memoryStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), map: m };
}
```

- [ ] **Step 2: Write the failing test**

```js
// tests/client.test.js — boot() against a fake window: what the person sees after typing, clicking, pressing keys and coming back
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, KEY } from '../js/client.js';
import { fakeWindow, memoryStorage } from './helpers/fake-dom.js';
import { makeCatalogue } from '../js/data/catalogue.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const P = (id, kind, extra = {}) => ({ id, name: id[0].toUpperCase() + id.slice(1), kind, blurb: `${id} in one line`, url: `https://${id}.example/mcp`, homepage: null, by: `@${id}`, icon: null, needs: 'none', writes: ['message'], asks: [], tools: ['echo'], server: null, toolList: [{ name: 'echo', description: '', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }], status: 'up', probedAt: 1, latencyMs: 1, ...extra });
const catalogue = makeCatalogue({ plugins: [P('alpha', 'Data'), P('beta', 'Crypto')], shelves: { featured: ['alpha'], Data: ['alpha'], Crypto: ['beta'] }, origin: 'http://127.0.0.1:4840', now: 2 }).toJSON();

test('boot renders the shelves from the embedded catalogue; the route comes from the path', () => {
  const f = fakeWindow({ catalogue });
  const store = boot(f.win);
  assert.match(f.html(), /class="shelf-title">Featured</);
  assert.equal(f.writes, 1);
  assert.deepEqual(store.get().route, { shelf: null, plugin: null });
  const g = fakeWindow({ catalogue, path: '/p/beta' });
  boot(g.win);
  assert.match(g.html(), /<aside class="drawer" aria-label="Beta">/);
  store.timers.clear();
});

test('typing in the search re-renders a results grid and keeps the focus in the search box', () => {
  const f = fakeWindow({ catalogue });
  const dq = f.withId('dq', { tagName: 'INPUT', dataset: { action: 'query' } });
  const store = boot(f.win);
  dq.focus();
  dq.value = 'bet';
  f.fire('root', 'input', { target: dq });
  assert.equal(store.get().query, 'bet');
  assert.match(f.html(), /class="grid-title">1 result</);
  assert.equal(f.doc.activeElement, dq, 'the box keeps focus across the render');
  store.timers.clear();
});

test('a card opens its drawer and pushes /p/<id>; Escape closes it and pushes /; a nav link pushes its path; popstate follows the browser back', () => {
  const f = fakeWindow({ catalogue });
  const close = f.withSelector('.drawer .close-key', { tagName: 'BUTTON', presentIf: /<aside class="drawer"/ });
  const store = boot(f.win);
  f.click({ dataset: { action: 'openPlugin', id: 'alpha' } });
  assert.equal(store.get().drawer, 'alpha');
  assert.equal(f.doc.activeElement, close, 'the drawer that just opened takes focus on its close key');
  assert.deepEqual(f.pushed, ['/p/alpha']);
  assert.match(f.html(), /<aside class="drawer" aria-label="Alpha">/);
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.equal(store.get().drawer, null);
  assert.deepEqual(f.pushed, ['/p/alpha', '/']);
  assert.doesNotMatch(f.html(), /<aside/);
  f.click({ nav: true, href: '/discover/crypto' });
  assert.equal(f.pathname, '/discover/crypto');
  assert.match(f.html(), /class="grid-title">Crypto</);
  f.popTo('/');
  assert.equal(store.get().route.shelf, null);
  assert.match(f.html(), /class="shelf-title">Featured</);
  assert.deepEqual(f.pushed, ['/p/alpha', '/', '/discover/crypto'], 'coming back pushes nothing');
  store.timers.clear();
});

test('install is remembered across a reboot with the same storage and raises a toast that leaves; a stale or throwing storage boots fresh', async () => {
  const storage = memoryStorage();
  const f = fakeWindow({ catalogue, storage });
  const store = boot(f.win, { toastMs: 20 });
  f.click({ dataset: { action: 'install', id: 'alpha' } });
  assert.deepEqual(store.get().installed, ['alpha']);
  assert.match(f.html(), /class="toast" role="status">Alpha installed</);
  assert.deepEqual(JSON.parse(storage.getItem(KEY)), { v: 1, theme: 'system', installed: ['alpha'], client: 'Claude Code' });
  await sleep(40);
  assert.doesNotMatch(f.html(), /class="toast"/);
  const g = fakeWindow({ catalogue, storage });
  const again = boot(g.win);
  assert.deepEqual(again.get().installed, ['alpha']);
  assert.match(g.html(), /class="pkey-done"/);
  const stale = fakeWindow({ catalogue, storage: memoryStorage({ [KEY]: JSON.stringify({ v: 0, installed: ['alpha'] }) }) });
  assert.deepEqual(boot(stale.win).get().installed, []);
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  const t = fakeWindow({ catalogue, storage: throwing });
  const ts = boot(t.win);
  f.click({ dataset: { action: 'install', id: 'beta' } });
  assert.match(t.html(), /Featured/);
  store.timers.clear(); again.timers.clear(); ts.timers.clear();
});

test('the theme key sets the document attribute and remembers it; copy writes the clipboard and shows Copied for a moment; the client switch sticks', async () => {
  const storage = memoryStorage();
  const f = fakeWindow({ catalogue, storage });
  const store = boot(f.win, { copiedMs: 20 });
  f.click({ dataset: { action: 'setTheme', value: 'black' } });
  assert.equal(f.doc.documentElement.dataset.theme, 'black');
  assert.equal(storage.getItem('gravity-field.theme'), 'black');
  assert.match(f.html(), /data-value="cream"/);
  f.click({ dataset: { action: 'setTheme', value: 'system' } });
  assert.equal(f.doc.documentElement.dataset.theme, undefined);
  assert.equal(storage.getItem('gravity-field.theme'), null);
  f.click({ dataset: { action: 'openPlugin', id: 'alpha' } });
  f.click({ dataset: { action: 'copy', key: 'line', copy: 'claude mcp add --transport http gravity-field http://127.0.0.1:4840/mcp' } });
  assert.deepEqual(f.clipboard, ['claude mcp add --transport http gravity-field http://127.0.0.1:4840/mcp']);
  assert.match(f.html(), /data-key="line" data-copy="[^"]+">Copied</);
  await sleep(40);
  assert.match(f.html(), /data-key="line" data-copy="[^"]+">Copy</);
  f.fire('root', 'change', { target: { dataset: { action: 'setClient' }, value: 'Codex' } });
  assert.equal(store.get().client, 'Codex');
  assert.match(f.html(), /snippet-file mono">~\/\.codex\/config\.toml/);
  assert.equal(JSON.parse(storage.getItem(KEY)).client, 'Codex');
  store.timers.clear();
});

test('Create opens over the page and Escape closes it first; opening it from a drawer closes the drawer and pushes /', () => {
  const f = fakeWindow({ catalogue, path: '/p/alpha' });
  const close = f.withSelector('.modal .close-key', { tagName: 'BUTTON', presentIf: /modal-scrim/ });
  const store = boot(f.win);
  f.click({ dataset: { action: 'openCreate' } });
  assert.deepEqual(store.get().create, {});
  assert.equal(f.doc.activeElement, close, 'the dialog takes focus on its close key');
  assert.equal(store.get().drawer, null);
  assert.deepEqual(f.pushed, ['/']);
  assert.match(f.html(), /aria-label="Gravity Field MCP"/);
  f.fire('doc', 'keydown', { key: 'Escape' });
  assert.equal(store.get().create, null);
  assert.doesNotMatch(f.html(), /modal-scrim/);
  store.timers.clear();
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tests/client.test.js`
Expected: FAIL — `Cannot find module '../js/client.js'`.

- [ ] **Step 4: Write js/client.js**

```js
// js/client.js — the browser's boot: the catalogue from the page, the store, one render per change, delegation on data-action, paths in the history
import { createStore } from './store.js';
import { reducers, initialState, persist, accept } from './reducers/discover.js';
import { makeCatalogue } from './data/catalogue.js';
import { renderDiscover } from './render/discover.js';
import { parsePath, toPath } from './routes.js';
import { THEME_KEY } from './render/page.js';

export const KEY = 'gravity-field.state';
export const COPIED_MS = 1500;
export const TOAST_MS = 6000;

export function boot(win, { copiedMs = COPIED_MS, toastMs = TOAST_MS } = {}) {
  const doc = win.document;
  const root = doc.getElementById('app');
  let data = {};
  try { data = JSON.parse(doc.getElementById('catalogue')?.textContent || '{}'); } catch { data = {}; }
  const cat = makeCatalogue({ ...data, now: Date.now() });
  const route = parsePath(win.location.pathname) ?? { shelf: null, plugin: null };
  const store = createStore({
    initial: initialState({ route }), reducers, storage: win.localStorage, key: KEY,
    accept, persist, hydrate: saved => initialState({ ...saved, route }),
  });
  const timers = new Set();
  const after = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };

  function applyTheme(t) {
    if (t === 'cream' || t === 'black') doc.documentElement.dataset.theme = t; else delete doc.documentElement.dataset.theme;
    try { if (t === 'system') win.localStorage?.removeItem(THEME_KEY); else win.localStorage?.setItem(THEME_KEY, t); } catch { /* storage may be unavailable */ }
  }

  // a render replaces the nodes: the search keeps its focus and caret, shelves and the drawer keep their scroll
  let lastOverlay = null;
  function render() {
    const q = doc.getElementById('dq');
    const hadFocus = q && doc.activeElement === q;
    const caret = q?.selectionStart ?? 0;
    const shelves = [...root.querySelectorAll('.shelf-row')].map(e => e.scrollLeft);
    const drawerTop = root.querySelector('.drawer-body')?.scrollTop ?? 0;
    const s = store.get();
    const overlay = s.create ? 'modal' : s.drawer ? 'drawer' : null;
    root.innerHTML = renderDiscover(s, cat);
    // an overlay that just opened takes focus on its close key (spec §5.7); Escape closes it
    if (overlay && overlay !== lastOverlay) root.querySelector(overlay === 'modal' ? '.modal .close-key' : '.drawer .close-key')?.focus();
    lastOverlay = overlay;
    root.querySelectorAll('.shelf-row').forEach((e, i) => { e.scrollLeft = shelves[i] ?? 0; });
    const d = root.querySelector('.drawer-body');
    if (d) d.scrollTop = drawerTop;
    if (hadFocus) { const nq = doc.getElementById('dq'); nq?.focus(); try { nq?.setSelectionRange(caret, caret); } catch { /* not every input has a caret */ } }
  }
  store.subscribe(render);

  // the route moves the state and the address together; the same path is never pushed twice
  const go = route => {
    store.dispatch('nav', route);
    const path = toPath(route);
    if (win.location.pathname !== path) win.history.pushState(null, '', path);
  };

  const ACTIONS = {
    openPlugin: el => go({ shelf: store.get().route.shelf, plugin: el.dataset.id }),
    closeDrawer: () => go({ shelf: store.get().route.shelf, plugin: null }),
    install: el => {
      const p = cat.byId(el.dataset.id);
      if (!p || p.pending) return;
      store.dispatch('install', { id: p.id, name: p.name });
      after(toastMs, () => store.dispatch('dismissToast'));
    },
    uninstall: el => store.dispatch('uninstall', el.dataset.id),
    toggleInstalledOnly: () => store.dispatch('toggleInstalledOnly'),
    openCreate: () => { if (store.get().drawer) go({ shelf: store.get().route.shelf, plugin: null }); store.dispatch('openCreate'); },
    closeCreate: () => store.dispatch('closeCreate'),
    dismissToast: () => store.dispatch('dismissToast'),
    toggleTools: () => store.dispatch('toggleTools'),
    setTheme: el => { store.dispatch('setTheme', el.dataset.value); applyTheme(el.dataset.value); },
    copy: el => {
      try { win.navigator?.clipboard?.writeText(el.dataset.copy)?.catch?.(() => {}); } catch { /* no clipboard: the label still answers */ }
      store.dispatch('setCopied', el.dataset.key);
      after(copiedMs, () => { if (store.get().copied === el.dataset.key) store.dispatch('setCopied', null); });
    },
  };

  root.addEventListener('click', ev => {
    const nav = ev.target.closest('a[data-nav]');
    if (nav) {
      ev.preventDefault();
      const r = parsePath(new URL(nav.href, win.location.origin).pathname);
      if (r) go({ shelf: r.shelf, plugin: r.plugin });
      return;
    }
    const el = ev.target.closest('[data-action]');
    if (el && ACTIONS[el.dataset.action]) ACTIONS[el.dataset.action](el);
  });
  root.addEventListener('input', ev => { if (ev.target?.dataset?.action === 'query') store.dispatch('setQuery', ev.target.value); });
  root.addEventListener('change', ev => { if (ev.target?.dataset?.action === 'setClient') store.dispatch('setClient', ev.target.value); });
  doc.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape') return;
    const s = store.get();
    if (s.create) store.dispatch('closeCreate');
    else if (s.drawer) ACTIONS.closeDrawer();
  });
  win.addEventListener('popstate', () => {
    const r = parsePath(win.location.pathname);
    if (r) store.dispatch('nav', { shelf: r.shelf, plugin: r.plugin });
  });

  applyTheme(store.get().theme);
  render();
  store.timers = { clear: () => { for (const t of timers) clearTimeout(t); timers.clear(); } };
  return store;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && document.getElementById('app') && document.getElementById('catalogue')) boot(window);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/client.test.js`
Expected: PASS, 6 tests. (`applyTheme` writes `dataset.theme` on the fake's `documentElement`; the test's `undefined` check after `system` relies on `delete`.)

- [ ] **Step 6: Commit**

```bash
git add js/client.js tests/helpers/fake-dom.js tests/client.test.js
git commit -m "feat: the browser client, one store and one render per change"
```

---

### Task 18: The stylesheet

**Files:**
- Create: `css/app.css`
- Test: `tests/css.test.js`

**Interfaces:**
- Consumes: every class the render modules emit (Tasks 10, 12, 15, 16); the tokens of `css/tokens.css` (Task 1).
- Produces: `css/app.css`, one rule for every emitted class, colours only by token, the numbers of spec §3 and §5.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/css.test.js`
Expected: FAIL — `css/app.css` does not exist.

- [ ] **Step 3: Write css/app.css**

```css
/* css/app.css — every class the render modules emit (spec §5); numbers from the spec, colours only by token */
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.45 var(--font-sans); }
body { min-height: 100vh; -webkit-font-smoothing: antialiased; }
button, input, textarea, select { font: inherit; color: inherit; }
button { cursor: pointer; }
a { color: inherit; text-decoration: none; }
h1, h2 { margin: 0; font-weight: 700; letter-spacing: -0.01em; }
:focus-visible { outline: 2px solid var(--alloc-equity); outline-offset: 2px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.dim { color: var(--dim); font-size: 13px; }
.mono { font-family: var(--font-mono); font-size: 13px; }
.up { color: var(--up); font-weight: 700; }
.down { color: var(--down); font-weight: 700; }
.spacer { flex: 1 1 auto; }
.link { color: var(--alloc-equity); font-size: 13px; font-weight: 600; }
button.link { border: 0; background: none; padding: 0; min-height: 32px; cursor: pointer; }
.empty { color: var(--dim); font-size: 15px; padding: 24px 0; }

/* ---- the frame: one column, the page itself (spec §5.1) ---- */
.app { min-height: 100vh; }
.main { position: relative; display: flex; flex-direction: column; gap: 22px; width: 100%; max-width: 1180px; margin: 0 auto; padding: 24px 28px 48px; min-height: 100vh; }
.main.with-drawer { padding-right: 28px; }
.disc-head { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.head-title { font-size: 20px; flex: none; white-space: nowrap; }
.search { display: flex; align-items: center; gap: 10px; height: 44px; width: 420px; max-width: 100%; padding: 0 14px; border-radius: var(--radius-pill); border: 1px solid var(--border); background: var(--surface); color: var(--dim); }
.search input { flex: 1 1 auto; min-width: 0; width: 0; border: 0; background: transparent; font-size: 14px; outline: none; color: var(--text); }
.theme-key { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: 1px solid var(--border); border-radius: var(--radius-pill); background: var(--surface); color: var(--text); }

/* ---- controls (Linqi's) ---- */
.btn, .btn-sm, .btn-primary, .btn-danger, .pill { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 0; border-radius: var(--radius-pill); font-size: 13px; white-space: nowrap; }
.btn { min-height: 44px; padding: 0 18px; background: var(--surface-2); color: var(--text); font-size: 15px; }
.btn-sm, .pill { min-height: 36px; padding: 0 14px; background: var(--surface-2); color: var(--text); }
.btn-sm.pressed, .pill.pressed { background: var(--primary); color: var(--on-primary); }
.btn-primary { min-height: 44px; padding: 0 18px; background: var(--primary); color: var(--on-primary); font-size: 15px; font-weight: 600; }
.btn-primary:disabled { background: var(--surface-2); color: var(--dim); cursor: default; }
.btn-primary.small { min-height: 40px; padding: 0 16px; font-size: 14px; }
.btn-danger { min-height: 36px; padding: 0 14px; background: var(--down-fill); color: var(--down); font-weight: 600; }
.btn-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; border-radius: var(--radius-pill); padding: 2px 10px; white-space: nowrap; }
.chip.grey { background: var(--surface-2); color: var(--dim); }
.chip.up { background: var(--up-fill); color: var(--up); }
.chip.down { background: var(--down-fill); color: var(--down); }
.close-key { width: 36px; height: 36px; border: 0; border-radius: var(--radius-pill); background: var(--surface-2); font-size: 18px; }
.input { min-height: 44px; padding: 0 14px; border: 1px solid var(--border); border-radius: var(--radius-s); background: var(--surface); color: var(--text); font-size: 15px; width: 100%; }
.input.small { min-height: 36px; font-size: 13px; width: auto; }
textarea.input { padding: 10px 14px; line-height: 1.4; resize: vertical; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 12px; font-weight: 600; color: var(--dim); }
.field-error { font-size: 12px; color: var(--down); }
.radio-seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: var(--radius-pill); background: var(--surface-2); flex-wrap: wrap; align-self: flex-start; }
.radio-item { display: inline-flex; position: relative; }
.radio-item input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.radio-item span { display: inline-flex; align-items: center; min-height: 32px; padding: 0 12px; border-radius: var(--radius-pill); color: var(--dim); font-size: 13px; font-weight: 600; cursor: pointer; }
.radio-item input:checked + span { background: var(--surface); color: var(--text); font-weight: 700; box-shadow: var(--shadow-card); }
.radio-item input:focus-visible + span { outline: 2px solid var(--alloc-equity); outline-offset: 1px; }

/* ---- logos ---- */
.av { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; overflow: hidden; }
.av-letter.tone-grey { background: var(--surface-2); color: var(--text); }
.av-glyph { background: var(--surface-2); color: var(--text); }

/* ---- shelves, grids, cards (spec §5.2) ---- */
.shelf { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.shelf-head { display: flex; align-items: baseline; gap: 12px; }
.shelf-title { flex: 1 1 auto; font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }
.shelf-row { display: flex; gap: 12px; overflow-x: auto; margin: 0 -28px; padding: 2px 28px 6px; scrollbar-width: none; }
.shelf-row::-webkit-scrollbar { display: none; }
.pcard { flex: 0 0 300px; display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; column-gap: 12px; align-items: start; background: var(--surface); border: 1px solid var(--card-border); border-radius: var(--radius-m); padding: 16px; box-shadow: var(--shadow-card); cursor: pointer; }
.pcard.pressed { border-color: var(--rule); }
.pcard.in-grid { flex: none; }
.pcard.down .av, .pcard.down .pcard-body, .pcard.down .pcard-kind { opacity: 0.55; }
.pcard-body { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.pcard-name { font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pcard-blurb { font-size: 13px; line-height: 1.35; }
.pcard-side { display: flex; flex-direction: column; align-items: flex-end; justify-content: space-between; gap: 10px; align-self: stretch; }
.pcard-kind { font-size: 11px; font-weight: 700; color: var(--dim); letter-spacing: 0.04em; }
.pkey { display: inline-flex; align-items: center; justify-content: center; gap: 4px; border: 0; border-radius: var(--radius-pill); }
.pkey.install { width: 36px; height: 36px; background: var(--surface-2); color: var(--text); }
.pkeys { display: inline-flex; align-items: center; gap: 6px; }
.pkey-done { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 36px; color: var(--up); }
.pkey-wait { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; color: var(--dim); }
.pkey.uninstall { width: 36px; height: 36px; border: 1px solid var(--border); background: var(--surface); color: var(--down); }
.grid-sec { display: flex; flex-direction: column; gap: 10px; }
.grid-title { font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr)); gap: 12px; }
.back-link { color: var(--dim); font-size: 13px; font-weight: 600; }

/* ---- the drawer (spec §5.3) ---- */
.drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(460px, 100%); display: flex; flex-direction: column; background: var(--surface); border-left: 1px solid var(--card-border); border-radius: var(--radius-l) 0 0 var(--radius-l); box-shadow: var(--shadow); overflow: hidden; z-index: 30; }
.drawer-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 14px 14px 24px; border-bottom: 1px solid var(--border); }
.drawer-head h2 { font-size: 20px; }
.drawer-body { flex: 1 1 auto; display: flex; flex-direction: column; gap: 16px; padding: 20px 24px 24px; overflow-y: auto; }
.drawer-foot { margin-top: auto; display: flex; flex-direction: column; gap: 8px; }
.drawer-foot .btn-primary { width: 100%; }
.plug-id { display: flex; align-items: center; gap: 14px; }
.plug-name { font-size: 17px; font-weight: 700; }
.plug-blurb { margin: 0; font-size: 14px; color: var(--dim); }
.dsec { display: flex; flex-direction: column; gap: 8px; padding-top: 14px; border-top: 1px solid var(--border); }
.dsec-label { font-size: 12px; font-weight: 600; color: var(--dim); }
.dsec-line { font-size: 14px; line-height: 1.4; overflow-wrap: anywhere; }
.kv-list { display: flex; flex-direction: column; }
.kv { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 14px; }
.kv:last-child { border-bottom: 0; }
.kv-k { color: var(--dim); white-space: nowrap; }
.kv-v { text-align: right; overflow-wrap: anywhere; }
.snippet { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-s); background: var(--surface-2); }
.snippet-file { font-size: 12px; color: var(--dim); }
.snippet-code { margin: 0; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.copy-key { align-self: flex-end; background: var(--surface); border: 1px solid var(--border); }
.tool-chips { display: flex; flex-wrap: wrap; gap: 6px; }

/* ---- Create (spec §5.4) ---- */
.modal-scrim { position: fixed; inset: 0; display: flex; align-items: flex-start; justify-content: center; padding: max(16px, 8vh) 16px 16px; background: var(--scrim); z-index: 48; }
.modal { width: min(480px, 100%); max-height: calc(100vh - max(16px, 8vh) - 16px); display: flex; flex-direction: column; border-radius: var(--radius-l); background: var(--surface); border: 1px solid var(--card-border); box-shadow: var(--shadow); overflow: hidden; }
.modal.wide { width: min(560px, 100%); }
.modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 14px 14px 24px; border-bottom: 1px solid var(--border); }
.modal-title { font-size: 20px; }
.modal-body { display: flex; flex-direction: column; gap: 16px; padding: 20px 24px 24px; overflow-y: auto; }

/* ---- toasts ---- */
.toast { position: sticky; bottom: 28px; align-self: center; margin-top: auto; display: inline-flex; align-items: center; gap: 12px; padding: 8px 8px 8px 18px; border-radius: var(--radius-pill); background: var(--primary); color: var(--on-primary); font-size: 13px; white-space: nowrap; box-shadow: var(--shadow-lift); z-index: 25; }
.toast-x { width: 28px; height: 28px; border: 0; border-radius: var(--radius-pill); background: transparent; color: var(--on-primary); font-size: 14px; }

/* ---- Submit and Admin (spec §5.5, §5.6) ---- */
.submit-form { display: flex; flex-direction: column; gap: 16px; max-width: 560px; }
.submitted { display: flex; flex-direction: column; gap: 12px; max-width: 560px; }
.review { display: flex; flex-direction: column; gap: 12px; padding: 18px 20px; background: var(--surface); border: 1px solid var(--card-border); border-radius: var(--radius-m); box-shadow: var(--shadow-card); }
.review .grid { grid-template-columns: minmax(min(300px, 100%), 360px); }
.reject { display: inline-flex; gap: 8px; align-items: center; }

/* ---- narrow windows (spec §5.7) ---- */
@media (max-width: 860px) {
  .search { width: 100%; order: 10; }
  .disc-head { gap: 10px; }
  .drawer { width: 100%; border-radius: 0; }
}
@media (max-width: 600px) {
  .main { padding: 16px 16px 40px; }
  .shelf-row { margin: 0 -16px; padding: 2px 16px 6px; }
  .pcard { flex-basis: 260px; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/css.test.js`
Expected: PASS, 2 tests. If the first test lists a missing class, add its rule rather than removing the class from the markup: the markup is the spec's.

- [ ] **Step 5: Look at it**

Run: `npm start`, open `http://127.0.0.1:4840/` in a browser. The six seeds are probed at boot (a few seconds); the shelves Featured · Data · Crypto show; a card opens its drawer; Create shows the real address; `/submit` and `/admin` answer. Switch the theme; narrow the window below 860 px. Fix what looks wrong against spec §5 before committing; the string tests above pin the structure, this step pins the look.

- [ ] **Step 6: Commit**

```bash
git add css/app.css tests/css.test.js
git commit -m "feat: the stylesheet, every emitted class by token"
```

---

### Task 19: The scripts, the README, and the end-to-end flow

**Files:**
- Create: `scripts/probe.js`, `scripts/export.js`, `README.md`
- Test: `tests/e2e.test.js`

**Interfaces:**
- Consumes: everything above.
- Produces: `npm run probe` (probe every committed plugin, exit 1 if any is down), `npm run export` (print the runtime-approved manifests for moving into `plugins/`), the README.

- [ ] **Step 1: Write the failing end-to-end test**

```js
// tests/e2e.test.js — the whole story once: publish from a client, see it in review, approve as the operator, call it, see the count, export it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { testApp, manifest } from './helpers/http.js';
import { startUpstream } from './helpers/fake-upstream.js';

test('publish → in review → approve → call → counted → exported', async () => {
  const up = await startUpstream({ name: 'moat-server', version: '3.1' });
  const { app, base, close } = await testApp();
  const client = new Client({ name: 'claude-code-standin', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  try {
    // a developer publishes from their client
    const pub = JSON.parse((await client.callTool({ name: 'shop_publish', arguments: { manifest: manifest('moat', up.url, { name: 'Moat score', kind: 'Data', blurb: 'Moat scores, ask by ticker', tools: ['echo'] }) } })).content[0].text);
    assert.equal(pub.status, 'review');
    // the site shows it first on its shelf with the clock key, and the operator sees it in the queue
    const home = await (await fetch(`${base}/`)).text();
    assert.match(home, /shelf-title">Data<\/div>[\s\S]*?<div class="shelf-row"><div class="pcard" data-action="openPlugin" data-id="moat"[\s\S]*?class="pkey-wait"/);
    assert.match(await (await fetch(`${base}/admin`)).text(), /data-id="moat"[\s\S]*?Approve/);
    // calling it is refused while it waits
    assert.equal((await client.callTool({ name: 'plugin_call', arguments: { id: 'moat', tool: 'echo', args: { text: 'early' } } })).content[0].text, 'in review');
    // the operator approves from loopback
    const ok = await fetch(`${base}/api/admin/moat/approve`, { method: 'POST' });
    assert.deepEqual(await ok.json(), { ok: true, id: 'moat' });
    const got = JSON.parse((await client.callTool({ name: 'shop_get', arguments: { id: 'moat' } })).content[0].text);
    assert.equal(got.pending, false);
    assert.equal(got.status, 'up');
    assert.deepEqual(got.server, { name: 'moat-server', version: '3.1' });
    // the call goes through the gateway to the plugin's own server
    const r = await client.callTool({ name: 'plugin_call', arguments: { id: 'moat', tool: 'echo', args: { text: 'KO' } } });
    assert.deepEqual(r.content, [{ type: 'text', text: 'echo:KO' }]);
    assert.deepEqual(up.calls, [['echo', 'KO']]);
    // the count reaches the drawer and the ledger
    const page = await (await fetch(`${base}/p/moat`)).text();
    assert.match(page, /class="dim">Data · 3 tools · 1 call</);
    assert.deepEqual((await (await fetch(`${base}/api/ledger`)).json()).plugins.moat, { total: 1, lastHour: 1, tools: { echo: 1 } });
    // and the export prints the file to move into plugins/
    const out = execFileSync(process.execPath, [new URL('../scripts/export.js', import.meta.url).pathname], { env: { ...process.env, GF_DATA_DIR: app.services.options.dataDir }, encoding: 'utf8' });
    assert.match(out, /^# plugins\/moat\.json/m);
    assert.match(out, /"id": "moat"/);
    assert.match(out, /"url": "http:\/\/127\.0\.0\.1:\d+\/mcp"/);
    const none = execFileSync(process.execPath, [new URL('../scripts/export.js', import.meta.url).pathname], { env: { ...process.env, GF_DATA_DIR: `${app.services.options.dataDir}-empty` }, encoding: 'utf8' });
    assert.match(none, /nothing approved at runtime/);
  } finally {
    await client.close();
    await close();
    await up.close();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/e2e.test.js`
Expected: FAIL at the export step — `scripts/export.js` does not exist (everything before it passes).

- [ ] **Step 3: Write scripts/export.js**

```js
// scripts/export.js — print the plugins approved at runtime, to move into plugins/ with a commit (spec §8.2): npm run export
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dataDir = process.env.GF_DATA_DIR || new URL('../data', import.meta.url).pathname;
const dir = join(dataDir, 'approved');
let files = [];
try { files = readdirSync(dir).filter(f => f.endsWith('.json')).sort(); } catch { files = []; }
if (!files.length) {
  console.log(`nothing approved at runtime under ${dir}`);
} else {
  for (const f of files) {
    const rec = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    console.log(`# plugins/${f}  (from ${join(dir, f)})`);
    console.log(JSON.stringify(rec.manifest ?? rec, null, 2));
    console.log();
  }
}
```

- [ ] **Step 4: Write scripts/probe.js**

```js
// scripts/probe.js — probe every committed plugin and print what answers (spec §3.4): npm run probe; exit 1 when any is down
import { loadCommitted } from '../js/data/load.js';
import { probe } from '../js/probe.js';

const root = new URL('..', import.meta.url).pathname;
const { plugins } = loadCommitted(root);
let down = 0;
for (const p of plugins) {
  const r = await probe(p.url);
  if (r.ok) {
    const missing = p.tools.filter(t => !r.toolList.some(x => x.name === t));
    console.log(`OK    ${p.id.padEnd(14)} ${r.transport.padEnd(4)} ${String(r.latencyMs).padStart(5)} ms · ${r.server.name} ${r.server.version} · ${r.toolList.length} tools${missing.length ? ` · MISSING: ${missing.join(', ')}` : ''}`);
    if (missing.length) down++;
  } else {
    down++;
    console.log(`DOWN  ${p.id.padEnd(14)} ${r.error}`);
  }
}
process.exitCode = down ? 1 : 0;
```

- [ ] **Step 5: Write README.md**

```markdown
# Gravity Field

A registry of investment plugins: real remote MCP servers, listed by kind, behind one site and one MCP
endpoint. A client adds one server — Gravity Field — and reaches every listed plugin through
`plugin_call`; every call writes an anonymous ledger line. Design: `docs/superpowers/specs/2026-10-11-gravity-field-design.md`
(the Discover screen of Evolving-Alpha-US PR #7, lifted out of Gravit and made to exist).

## Run

```bash
npm install
npm start          # http://127.0.0.1:4840/  ·  MCP at http://127.0.0.1:4840/mcp
npm test           # node --test tests/*.test.js — no network, no DOM
npm run probe      # connect to every committed plugin and list its tools
npm run export     # print the plugins approved at runtime, to move into plugins/
```

Node ≥ 22. Two dependencies, both for the MCP face: `@modelcontextprotocol/sdk` and `zod`. No build step.

## Add it to a client

```bash
claude mcp add --transport http gravity-field http://127.0.0.1:4840/mcp
```

Cursor (`~/.cursor/mcp.json`): `{ "mcpServers": { "gravity-field": { "url": "http://127.0.0.1:4840/mcp" } } }` ·
Codex (`~/.codex/config.toml`): `[mcp_servers.gravity-field]` then `url = "http://127.0.0.1:4840/mcp"`.
The Create key on the site shows the same lines for the address it is served from.

Four tools: `shop_search(q?, kind?)` · `shop_get(id)` · `shop_publish(manifest)` · `plugin_call(id, tool, args)`.
`shop_install`, `shop_uninstall` and `shop_mine` are reserved for a version with accounts.

## What is real, what is not

Real: the six plugins on the shelves are live servers (CoinGecko, SEC EDGAR, ryufin, Cryptowisser News,
StockLens, PredictionMarketsPicks), probed at boot and every 15 minutes; `plugin_call` forwards to them;
the ledger counts; a submission from the form or from `shop_publish` lands in `/admin`, where approving
runs the probe again and lists the plugin.

Not in this version: accounts and signatures, per-user installs (Install on a card is the browser's own
memory), commissions, plugins that need the user's key, private plugins, a database.

## The catalogue

One file per plugin under `plugins/` — `id`, `name`, `kind` (Data · Monitors · Bots · Crypto · Quant),
`blurb` (one line), `url` (https, speaks MCP), `homepage`, `by`, `icon`, `needs` (`none`), `writes`, `asks`,
`tools` (a subset of what the server lists; empty means every tool). `plugins/shelves.json` orders the
shelves. Plugins approved at runtime live under the data dir (`approved/`) and merge with the committed
ones; `npm run export` prints them so a commit makes them permanent.

## Environment

| variable | default | what |
|---|---|---|
| `PORT`, `HOST` | `4840`, `127.0.0.1` | where to listen |
| `GF_DATA_DIR` | `./data` | submissions, approvals, rejections, the ledger |
| `GF_PUBLIC_ORIGIN` | the request's host | the origin shown in Create and Use it |
| `GF_ADMIN_TOKEN` | unset | `/admin` from off-loopback needs `?token=` once; unset means loopback only |
| `GF_TRUST_PROXY` | unset | `1` behind Railway or any proxy: the client address is `X-Forwarded-For`'s first hop |
| `GF_UPSTREAM_TIMEOUT_MS` | `20000` | the gateway's wait on an upstream |

## Layout

`serve.js` wires the services and the routes; `js/render/*` are pure `state → html` functions shared with
the browser; `js/client.js` boots the page; `js/mcp.js` is the face; `js/gateway.js` forwards; `js/probe.js`
lists an upstream; `js/registry.js`, `js/submissions.js`, `js/ledger.js` hold the state on disk;
`css/tokens.css` is Linqi's token sheet and `css/app.css` names colours only by token.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/e2e.test.js`, then `npm test`, then `npm run probe`.
Expected: the suite green; `npm run probe` prints six `OK` lines (a `DOWN` line means an upstream blinked or changed: check it by hand before touching its seed).

- [ ] **Step 7: Commit**

```bash
git add scripts/probe.js scripts/export.js README.md tests/e2e.test.js
git commit -m "feat: the probe and export scripts, the readme and the end to end flow"
```

---

## Spec coverage

| spec | task |
|---|---|
| §2 scope: real servers, no identity, no database | 4 (seeds), 9 (files on disk), 14 (no install tools) |
| §3.1 manifest, §3.2 derived fields, §3.3 shelves, §3.4 probe, §3.5 seeds | 3, 9, 4, 5, 4 |
| §4 server: options, routes, rate limit, embedded catalogue | 1, 9, 12, 13, 14, 15, 16 |
| §5.1 frame and header, §5.2 shelves and cards, §5.3 drawer, §5.4 Create, §5.5 Submit, §5.6 Admin, §5.7 narrow and focus | 10, 18 (CSS), 15, 16, 17 (Escape, focus) |
| §6 the four tools, underscores, reserved names | 10 (`clients.js`), 14 |
| §7 gateway order, pass-through, ledger | 6, 14 |
| §8.1 submit, §8.2 approve and reject and the union, §8.3 the gate | 13, 15, 16, 9 (union), 19 (export) |
| §9 errors and safety | 5 (addresses), 6 (timeouts, cut), 7 (buckets), 12 (`safeJson`), 8 (ids), 4 (corrupt files) |
| §10 testing | every task; 17 (fake DOM), 19 (end to end) |
| §11 repository and dependencies | 1, 19 |
| §12 seams | the module boundaries of Tasks 4, 8, 6, 9 |

Residuals, named rather than hidden: the drawer and the dialog receive focus when they open and close on
Escape, but Tab is not cycled inside them (spec §5.7 says "trap"); CoinGecko lists one `execute` meta-tool,
so its drawer's example call is `plugin_call("coingecko", "execute", …)` with no argument hint (spec §13.4);
the probe schedule is one timer per process, so two processes would probe twice; the Submit and Admin pages are plain
server-rendered HTML without the embedded catalogue or the client script (spec §4 says every page carries it; those two
need neither).
