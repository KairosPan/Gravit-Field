# Gravity Field — Design

**Status (2026-10-11):** draft for the operator's review, written at the end of the brainstorming of
2026-10-11; approved in conversation section by section, not yet approved as a written spec, and no
implementation plan exists yet.
**Owner:** the operator.
**Reference:** Evolving-Alpha-US PR #7 (`feat/gravit-ui` @ `a8aa791`), the Discover screen —
`gravit-ui/js/render/discover.js`, `gravit-ui/js/reducers/discover.js`, `gravit-ui/js/data/plugins.js`,
`gravit-ui/css/{tokens,app}.css` — and its spec,
`docs/superpowers/specs/2026-10-09-demo-v2-gravit-frontend-design.md` §3, §7, §9.4, §10, §13–14. Where
this document is silent on look or copy, that spec's Discover sections are the authority.
**Language:** the product speaks English (that spec's decision 10). Copy quoted here is what goes on
screen.

---

## 1. Context and decisions

The operator's request, 2026-10-11: *"我现在想做一个投资 Plugin 的收录中心，叫 Gravity Field，具体可以参考
Evolving-Alpha-US 最新 PR 里的 Discover 模块。"*

Discover, inside Gravit, is an App Store of free plugins with an MCP face. Its spec §9.4 says of the
back end: none exists. Gravity Field is that store taken out of Gravit and made to exist: a site people
browse and an MCP endpoint agents connect to, where the plugins on the shelves are real servers that
answer.

Decisions taken in the brainstorming, in order; each was the operator's answer to one question:

1. **A real registry** — not a directory of links, not a front-end prototype. The shelves list real
   servers, the MCP face is real, a submission goes somewhere and comes back approved.
2. **Gateway, not phone book.** A client connects to one MCP, Gravity Field; `plugin_call` is forwarded
   to the plugin's own server and every call writes a ledger line. This keeps spec §7.7's `plugin.call`
   and is the ground for the commission line that spec §7.6 names.
3. **No identity in v1.** Browsing and calling need no login; install is the browser's local memory;
   publishing is a submission the operator approves by hand; the ledger counts without names.
4. **A demo now, a community plugin library later.** v1 runs from one command and needs no database and
   no account anywhere. What a community will need — submissions as pull requests or a database,
   identity, per-user accounting — arrives through the seams named in §12, not through a rewrite.

Two facts found while brainstorming shaped the scope:

- The official MCP Registry lists dozens of remote (streamable HTTP) finance servers. A probe on
  2026-10-11 (connect, `initialize`, `tools/list`) found **six that answer without a key**: CoinGecko
  (official), SEC EDGAR by cyanheads, ryufin, Cryptowisser News, StockLens, PredictionMarketsPicks.
  Six others wanted a key (401), did not resolve, or timed out. So the demo's shelves can be real, and
  they lean to Data and Crypto.
- Claude's tool names allow only `[A-Za-z0-9_-]`; the spec's `shop.search` cannot be registered as
  written. The real face uses underscores (§6).

## 2. What Gravity Field is, and is not (v1)

**Is:** one site rendered by a Node process; one MCP endpoint at `/mcp` with four tools; a catalogue of
plugin files in the repository; a gateway that forwards `plugin_call` to the plugin's server; a
submission queue on disk and an admin page where the operator approves; an anonymous ledger of calls.

**Is not, in v1:** accounts, signatures, per-user installs or accounting, commissions, hosting of
anyone's code, plugins that need the user's own key or session, private plugins (private needs an
owner), a scripted driver (everything on the site is real), a database.

A plugin, as in spec §7.7, is **one MCP server plus one manifest**. In v1 the server is remote — an
https URL speaking streamable HTTP; the SDK's SSE fallback is accepted — and asks nothing of the user.

## 3. The catalogue

### 3.1 The manifest

One file per plugin, `plugins/<id>.json`:

```json
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
  "tools": ["secedgar_company_search", "secedgar_search_filings", "secedgar_get_filing", "secedgar_get_financials"]
}
```

| field | rule | on screen |
|---|---|---|
| `id` | `^[a-z][a-z0-9-]{1,40}$`, unique across approved and pending | the card's `data-id`, `/p/<id>`, the first argument of `plugin_call` |
| `name` | 1–40 characters | card and drawer title |
| `kind` | one of `Data` · `Monitors` · `Bots` · `Crypto` · `Quant` | the type label, the shelf |
| `blurb` | 1–90 characters, no trailing period | the card's one line; the drawer adds the period |
| `url` | https; speaks MCP over streamable HTTP, or SSE | never on a card; the drawer's Source shows its host |
| `homepage` | https, optional | Source |
| `by` | `^@?[A-Za-z0-9_.-]{1,40}$` | Source only; never on a card (spec §14.2) |
| `icon` | a name in `icons.js`, or `null` → the name's first letter | the 44 px logo |
| `needs` | `none` — the only value v1 accepts; anything else is refused with the reason | What it needs from you |
| `writes` | subset of `message`, `proposal`; default `["message"]` | What it writes |
| `asks` | 0–4 quoted questions, editorial | What you can ask it |
| `tools` | raw tool names the manifest claims; must be a subset of what the server lists; empty means every listed tool | Tools, with the server's own one-line descriptions |

Not in the manifest, because a registry cannot promise it: Discover's `never` line ("Never: move money,
pay anyone, change limits") is Gravit's gate speaking, not the plugin's; Gravity Field has no gate and
does not print it. `visibility` is always public in v1 and is not written. Shelf placement is not a
manifest field; it lives in `plugins/shelves.json` (§3.3).

### 3.2 Derived fields

Filled by the probe (§3.4), kept beside the manifest in memory, never edited by hand: `server` (the
upstream's `name` and `version` from `initialize`), `toolList` (every tool the server lists: `name`,
the first line of its `description`, its `inputSchema`), `status` (`up` / `down`), `probedAt`,
`latencyMs`. The manifest's `tools` selects which of `toolList` the drawer leads with and which
`plugin_call` admits.

### 3.3 Shelves

`plugins/shelves.json`:

```json
{ "featured": ["secedgar", "coingecko", "ryufin", "cryptowisser"],
  "Data": ["secedgar", "ryufin", "stocklens"], "Monitors": [], "Bots": [],
  "Crypto": ["coingecko", "cryptowisser", "pmpicks"], "Quant": [] }
```

Featured replaces Discover's Like shelf (Like reads Memory; Gravity Field has none). A plugin missing
from its kind's list is appended after the listed ones, by name. A kind with no plugins has no shelf.
Ordering is editorial and lives in this one file.

### 3.4 The probe

`probe(url)`: connect with the SDK client — streamable HTTP first, SSE on failure — 12 s per step,
`initialize` then `tools/list`, close; return `{ ok, server, toolList, latencyMs }` or
`{ ok: false, error }`. It runs:

- at boot for every plugin unless `probeOnBoot: false` (tests), then every 15 minutes;
- on every submission (§8.1), at once; its result is stored with the submission;
- on approval (§8.2), again, as the acceptance check.

A plugin whose probe fails stays listed with `status: down` — its card dims, its drawer says so — and
is not removed, since upstreams blink.

### 3.5 The seeds

The six servers the 2026-10-11 probe found live, as files the plan writes; `kind` and `blurb` are
editorial:

| id | kind | name | url | tools the server lists |
|---|---|---|---|---|
| `coingecko` | Crypto | CoinGecko | `https://mcp.api.coingecko.com/mcp` | 2 (`execute`, `search_docs`) |
| `secedgar` | Data | SEC EDGAR | `https://secedgar.caseyjhand.com/mcp` | 16 |
| `ryufin` | Data | ryufin | `https://ryufin.com/mcp` | 6 |
| `cryptowisser` | Crypto | Cryptowisser News | `https://www.cryptowisser.com/mcp/server` | 5 |
| `stocklens` | Data | StockLens | `https://mcp.stocklens.com/mcp` | 8 |
| `pmpicks` | Crypto | PredictionMarketsPicks | `https://predictionmarketspicks.com/api/mcp-crypto/mcp?via=registry` | 7 |

Monitors, Bots and Quant start empty and hidden.

## 4. The server

One Node 22 process. `serve.js` exports `createApp(options) → http.Server` and, run directly, listens
on `127.0.0.1:4840`. Options, each defaulting from the environment:

| option | env | default | what |
|---|---|---|---|
| `host`, `port` | `HOST`, `PORT` | `127.0.0.1`, `4840` | where to listen |
| `root` | — | the repository | where `plugins/`, `css/`, `js/` are read |
| `dataDir` | `GF_DATA_DIR` | `./data` | submissions, approvals, rejections, the ledger |
| `publicOrigin` | `GF_PUBLIC_ORIGIN` | the request's own `Host` | the origin shown in Create and in Use it |
| `adminToken` | `GF_ADMIN_TOKEN` | unset | the admin gate (§8.3); unset = loopback only |
| `upstreamTimeoutMs` | `GF_UPSTREAM_TIMEOUT_MS` | `20000` | the gateway's wait on an upstream |
| `probeOnBoot`, `probeEveryMs` | — | `true`, 15 min | the probe schedule |
| `allowLoopback` | — | `false` | accept `http://127.0.0.1` plugin URLs (tests) |
| `trustProxy` | `GF_TRUST_PROXY` | `false` | the client IP is the first hop of `X-Forwarded-For`; set behind Railway or any proxy |

Routes:

| route | what |
|---|---|
| `GET /` | the shelves, server-rendered |
| `GET /discover/<shelf>` | one shelf as a grid: `featured`, `data`, `monitors`, `bots`, `crypto`, `quant` |
| `GET /p/<id>` | the shelves with that plugin's drawer open; a 404 page for an unknown id |
| `GET /submit` | the submission form |
| `GET /admin` | the review queue; gated |
| `POST /api/submissions` | the form's submission; the same validator as `shop_publish` |
| `POST /api/admin/<id>/approve`, `POST /api/admin/<id>/reject` | gated |
| `GET /api/plugins`, `GET /api/plugins/<id>`, `GET /api/search?q=&kind=` | JSON, public |
| `GET /api/ledger` | the counts: per plugin and per tool, last hour and total |
| `POST /mcp` (and `GET`, `DELETE`, as the transport requires) | the MCP face (§6) |
| `GET /css/*`, `GET /js/*` | static; no cache headers (the `face/client/*` lesson) |
| `GET /healthz` | `{ ok, plugins, up, down }` |

Every page carries the catalogue as JSON in `<script type="application/json" id="catalogue">`, so the
client script boots without a request; the same render modules run on both sides (§5).

Rate limit: a token bucket per client IP (the socket's address, or the first hop of `X-Forwarded-For`
when `trustProxy` is set): 60 `plugin_call` a minute, 600 requests a minute overall, 10 submissions an hour. Over the
limit answers 429 with `Retry-After`. In memory; resets on restart.

## 5. The web UI

### 5.1 Frame

One screen. Discover's header is the site header: the h1 reads **Gravity Field**, then the 44 × 420
search pill ("Search plugins"), a spacer, the **My plugins** pill (pressed = ink), **+ Create**, a
**Submit** pill linking `/submit`, and a 32 px round theme key (sun / moon glyph). No rail: the main
column is the page, max-width 1180 px, centred, 28 px gutters (16 px below 600 px). Linqi's tokens,
Cream and Black, with `html[data-theme]` saved in `localStorage` before the first paint as gravit-ui
does. Fonts: Manrope, Noto Sans SC, IBM Plex Mono from Google Fonts, system fallbacks offline.

### 5.2 Shelves, grids, cards

As spec §7.2–7.3 and §14: shelves with "See all ›" (a link to `/discover/<shelf>`), 300 px cards, three
in view and the fourth cut, the row bleeding into the gutter. A card: 44 px logo · name 15/700 · blurb
13 · the kind label 11/700 dim top-right · one key bottom-right. The key: **+** (install, a
`--surface-2` round) · **✓ beside a trash key** (installed) · **clock** (in review; submissions only,
§8.1). No author line, no price, no install count on a card. A `down` plugin's card wears `.pcard.down`:
logo and text at 55 % opacity, the key unchanged. The clicked card wears the ink border while its drawer
is open.

Search is live over name, blurb, kind, `by` and tool names; results are a grid titled "n results". My
plugins shows the installed grid, titled "Installed"; there is no "Yours" group in v1 (no identity).
gravit-ui's hash routes become paths: the client uses `history.pushState` for `/discover/<shelf>` and
`/p/<id>`, and the server renders the same state for a cold load.

### 5.3 The drawer

Linqi's 460 px drawer; one open at a time; Esc closes. Head: 56 px logo, name 17/700, the meta line
**`<kind> · <n> tools · <calls> calls`** (calls from the ledger, total; the last part omitted while
zero), then the blurb with its period. Sections, each a `.dsec`, empty ones left out:

1. **What you can ask it** — `asks`.
2. **Tools** — the manifest's `tools` first, then the rest of `toolList`; each a `mono` name with the
   server's one-line description in `dim`; beyond 12, an "n more" line that expands.
3. **What it writes** — `writes` in Discover's words ("Messages, into the conversation" / "Proposals:
   inside your limit it fills directly, beyond it a card").
4. **What it needs from you** — "Nothing."
5. **Source** — a kv table: Server `<host>` · Version `<server.name> <server.version>` · By `@handle` ·
   Homepage (a link) · Checked `<n> min ago` with a status chip, `up` in `--up`, `down` in `--down`.
6. **Use it** — the client segment (Claude Code · Cursor · Codex), the one line that adds Gravity Field
   to that client, and under it one example call in `mono` —
   `plugin_call("secedgar", "secedgar_company_search", { "query": "NVIDIA" })` — built from the first
   tool and its schema's first required string argument, else `{}`. A Copy key on each.

Foot: a full-width **Install** or **Uninstall** (local memory; toast "SEC EDGAR installed", no action
key). No What you sign (§2), no How it is paid (spec §14.2).

### 5.4 Create: the Gravity Field MCP

The dialog of spec §14.3 with the scripted client removed. Title **Gravity Field MCP**; Address
`<publicOrigin>/mcp` in mono; Tools as four grey mono chips (`shop_search` · `shop_get` · `shop_publish`
· `plugin_call`); Client (Claude Code · Cursor · Codex) with that client's line and a Copy key:

- Claude Code: `claude mcp add --transport http gravity-field <origin>/mcp`
- Cursor, `~/.cursor/mcp.json`: `{ "mcpServers": { "gravity-field": { "url": "<origin>/mcp" } } }`
- Codex, `~/.codex/config.toml`: `[mcp_servers.gravity-field]` then `url = "<origin>/mcp"`

Nothing in it can be typed. No status line: v1 has no sessions to count. What a connected client does
next is real: a `shop_publish` from Claude Code lands in `/admin` (§8).

### 5.5 Submit

`/submit`: one column of `.field`s, labels only, no helper sentences (spec §10): Name · One line · Kind
(a radio segment) · MCP address · Homepage · Your handle · Icon (a letter, or a glyph name; the name's
initial by default) · What you can ask it (up to four lines) · **Submit**. On submit the server
validates (§3.1), probes (§3.4), stores (§8.1) and answers; the page shows the card as it will look,
with the clock key, and the probe's result — the tools found, or the error. No visibility choice: public
only.

### 5.6 Admin

`/admin`: the pending submissions, newest first, each a card plus a table — the manifest's fields, the
probe (server, latency, tools found, and in `--down` the tools the manifest claims that the server
lacks) — and **Approve** (`.btn-primary`) / **Reject** (`.btn-danger`). Approving a submission whose
acceptance probe fails leaves it pending and shows the error. Below, **Approved here** lists the
runtime-approved plugins (§8.2) with their file paths, so the operator can move them into the
repository. The ledger's totals at the foot.

### 5.7 States and responsiveness

Below 860 px the header wraps (the search full width), shelves still scroll, the drawer and the dialog
are full width; below 600 px gutters are 16 px and cards 260 px. Reduced motion: no transitions. Every
key has an `aria-label`; focus is visible; the drawer and the dialog trap focus while open.

## 6. The MCP face

`POST /mcp` through the SDK's `StreamableHTTPServerTransport` in stateless mode (a transport per
request, no session id), an `McpServer` named `gravity-field`. Four tools:

| tool | input | output |
|---|---|---|
| `shop_search` | `{ q?: string, kind?: Kind }` | `{ plugins: [{ id, name, kind, blurb, by, tools: number, status }] }`; no `q` and no `kind` returns everything in shelf order; pending submissions appear with `status: "review"` |
| `shop_get` | `{ id }` | the manifest, `toolList` with descriptions and input schemas, `status`, `probedAt`, `calls`; an unknown id is a tool error |
| `shop_publish` | `{ manifest }` | `{ id, status: "review", probe }`, or a tool error naming the field and the rule |
| `plugin_call` | `{ id, tool, args }` | the upstream result's `content` and `isError`, passed through unchanged |

Reserved and not registered in v1: `shop_install`, `shop_uninstall`, `shop_mine` — they need an owner
and arrive with identity (§12). The server's `instructions`, one paragraph, say what the four tools are
and that `plugin_call` reaches any listed plugin's declared tools.

Naming: spec §7.7 writes `shop.search`; dots are not legal in Claude's tool names
(`^[a-zA-Z0-9_-]{1,64}$`), so the face registers underscores and the site shows underscores. The
seven-name contract maps one to one.

## 7. The gateway and the ledger

`plugin_call(id, tool, args)`, in order:

1. `id` names an approved plugin, else the tool error `unknown plugin`.
2. `tool` is in the manifest's `tools`, or the manifest's `tools` is empty and `tool` is in `toolList`;
   else `tool not offered`.
3. The rate limit admits the caller (§4), else `rate limited`.
4. The upstream client for that plugin — one cached SDK `Client` per plugin, reconnected on error, over
   the transport the probe found — calls the tool with `args`, within `upstreamTimeoutMs`.
5. The result's `content` and `isError` return unchanged. A transport failure returns the tool error
   `upstream unreachable` and marks the plugin `down` until the next probe passes.
6. One ledger line is appended whatever happened.

Nothing travels upstream but the MCP call: no request header from the caller, no IP, no token. Gravity
Field holds no credential for any upstream.

The ledger: `$GF_DATA_DIR/ledger.jsonl`, one line per call, `{ at, plugin, tool, ok, ms }`; no caller
identity (decision 3). In memory: counts per plugin and per tool, total and last hour, rebuilt from the
file at boot; at 10 MB the file rotates to `ledger.<date>.jsonl` and the counts carry on.
`GET /api/ledger`, the drawer's meta line and the admin foot read the counts.

## 8. Submission and review

### 8.1 Submit

Two doors, one validator: `POST /api/submissions` (the form) and `shop_publish` (a client). Validation
(§3.1), then the probe. A submission is **refused outright**, with the first failing rule, when the
manifest is invalid; `needs` is not `none`; the URL is not https (`http://127.0.0.1` passes only with
`allowLoopback`); an approved plugin or a pending submission already has the id. A submission whose
probe fails is **accepted and stored** with the error — the operator may know the server — but cannot
be approved until a probe passes.

Stored as `$GF_DATA_DIR/submissions/<id>.json`: `{ manifest, probe, at, via: "form" | "mcp" }`. The
site shows it at once: first on its kind's shelf with the clock key; its drawer's meta reads
`<kind> · In review` and has no Install; `shop_search` lists it with `status: "review"`;
`plugin_call` refuses it with `in review`; `/p/<id>` opens its drawer like any other.

### 8.2 Approve, reject

**Approve:** the acceptance probe runs again; it must pass and every tool the manifest claims must be
listed; the file moves to `$GF_DATA_DIR/approved/<id>.json`, the catalogue reloads, the card's clock
becomes +. **Reject:** the file moves to `$GF_DATA_DIR/rejected/<id>.json` with the reason; the card
leaves. The admin page shows the result either way.

The catalogue is the union of `plugins/*.json` (committed) and `$GF_DATA_DIR/approved/*.json`
(approved at runtime), the committed file winning on an id clash. `npm run export` prints the
runtime-approved files' paths and contents so the operator can move them into `plugins/` with a commit.
That commit is how a demo-time approval becomes permanent, and (§12) how a community's approvals become
pull requests.

### 8.3 The admin gate

`/admin` and `/api/admin/*` answer only to a request whose client IP (§4) is loopback, or one carrying the cookie set by
visiting `/admin?token=<GF_ADMIN_TOKEN>` (the face's tokenized URL: 30 days, exact host). With no
`GF_ADMIN_TOKEN`, loopback only. Everything else about the site is public.

## 9. Errors and safety

- **Upstream down:** the probe marks it; the card dims; Source says `down`; `plugin_call` returns
  `upstream unreachable` within the timeout and never hangs the request.
- **Bad manifest:** refused with the field and the rule; nothing stored.
- **A tool not on the server:** the submission can be stored but not approved; `plugin_call` refuses
  tools outside the manifest.
- **Abuse:** the rate limit; `plugin_call` reaches only approved plugins and only their declared tools,
  so Gravity Field is not an open proxy; `args` go upstream as given and the upstream validates its own
  schema.
- **Secrets:** none held, none forwarded; `needs: none` is enforced, so no submission can ask the site
  to carry a key.
- **Rendering:** every string through `esc`; the catalogue JSON in the page has `<` escaped; colours
  only by token; no explanatory small print on screens (spec §10).
- **Data on disk:** `$GF_DATA_DIR` is created at boot; a corrupt file in it is skipped and logged, never
  a crash.

## 10. Testing

`node --test tests/`, no DOM, no network:

- **render** — pure functions asserted as strings, as gravit-ui's tests do: shelves, the card's four
  states (install / installed / review / down), drawer sections present and absent, Create's line per
  client, Submit, Admin, the 404.
- **catalogue** — fixture files under `tests/fixtures/plugins/`; each validation rule of §3.1 once;
  shelf order and the append rule; the union with a runtime `approved/` dir and the clash rule.
- **probe and gateway** — `tests/helpers/fake-upstream.js` starts an in-process MCP server (the SDK's
  `McpServer` + `StreamableHTTPServerTransport`) on a random loopback port with two tools and one that
  throws: the probe lists them; `plugin_call` forwards, passes `isError` through, refuses an undeclared
  tool, and reports an unreachable port within the timeout.
- **http** — `createApp({ root: fixtures, dataDir: tmp, probeOnBoot: false, allowLoopback: true })` on
  port 0: pages 200 with the catalogue script; `/p/<unknown>` 404; `/api/search`; a submission from the
  form and one from `shop_publish` (the SDK client against `/mcp`); the admin gate refusing a non-loopback
  request (`trustProxy: true` and an `X-Forwarded-For` header); approve and reject; the ledger line after a call; 429 once
  the bucket empties.
- **client** — `tests/helpers/fake-dom.js` as in gravit-ui, booting `client.js` against a fake window:
  search, drawer open and close, install memory, theme, `pushState`.

Target: the density of gravit-ui's suite (220 tests over a comparable surface).

## 11. Repository

```
Gravity Field/
  package.json             type module, node >=22; scripts start / test / probe / export
  serve.js                 createApp and the CLI
  js/
    html.js icons.js time.js ids.js store.js        ported from gravit-ui
    data/manifest.js       the schema (zod) and the rules of §3.1
    data/catalogue.js      pure, isomorphic: union, shelves, search, byId over arrays
    data/load.js           Node only: reads plugins/ and the data dir
    data/clients.js        the three client lines for an origin
    probe.js gateway.js ledger.js ratelimit.js submissions.js
    mcp.js                 the four tools and the stateless transport handler
    api.js                 the /api routes
    render/avatars.js render/discover.js render/page.js render/submit.js render/admin.js
    reducers/discover.js   setQuery, toggleInstalledOnly, openPlugin, closeDrawer, install, uninstall,
                           dismissToast, openCreate, closeCreate, setClient, setCopied, setTheme
    client.js              browser boot: state from #catalogue and localStorage, store, delegation, pushState
  css/tokens.css css/app.css
  plugins/*.json plugins/shelves.json
  data/                    gitignored: submissions/ approved/ rejected/ ledger.jsonl
  tests/*.test.js tests/helpers/ tests/fixtures/
  docs/superpowers/specs/ docs/superpowers/plans/
  README.md
```

Two dependencies, both for the MCP face: `@modelcontextprotocol/sdk` and `zod` (the SDK's own schema
library, used for the manifest too). No build step, no bundler: `js/` is served as it is and imported by
Node as it is; the render modules and reducers import nothing from Node.

Commit messages: plain words, no backticks, no parentheses, no shell; one commit per task.

## 12. Growth seams

What changes when the demo becomes the community's library, and where it lands:

| later | where it lands | what stays |
|---|---|---|
| Submissions become pull requests | `submissions.js` gains a backend that opens a PR from a submission; `plugins/` is the registry of record | the manifest, the validator, the probe, the pages |
| A database | `load.js`, `submissions.js`, `ledger.js` behind the same functions | everything above them |
| Identity — GitHub login, API keys, or a wallet signature | a session layer in `serve.js`; `shop_install / shop_uninstall / shop_mine` registered; the drawer regains What you sign; the ledger gains a caller | the four tools, the gateway |
| Plugins that need the user's key | a credential reference the owner's client passes to `plugin_call`, never stored; or a direct connection line in Source | `needs` as the declaration |
| Gravit's Discover screen | points its `shop.*` calls at this face; install state stays Linqi's | the contract of spec §7.7 |
| Hosting | Railway with a volume for `$GF_DATA_DIR`, so submissions and the ledger persist; or Vercel with an ephemeral data dir | `createApp` |

## 13. Open

1. The name on screen and in the client lines — `Gravity Field`, `gravity-field` — is assumed; no
   domain is chosen.
2. Kinds for the seeds (StockLens as Data or Bots; PredictionMarketsPicks as Crypto or Quant) are
   editorial and move in `shelves.json`.
3. Whether Create should show the last hour's call count as a sign of life.
4. CoinGecko's public endpoint wraps its API in one `execute` tool; list it as is, or wait for a face
   with named tools.
5. Deployment target and timing: after the demo runs locally.
