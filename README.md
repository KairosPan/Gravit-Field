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
| `GF_PUBLIC_ORIGIN` | the request's host | the origin shown in Create and Use it; required behind a proxy on the same machine, since a loopback request must name this machine or this origin |
| `GF_ADMIN_TOKEN` | unset | `/admin` from anywhere but this machine needs `?token=` once; unset means local only. A request a proxy forwarded is never local |
| `GF_TRUST_PROXY` | unset | `1` behind Railway or any proxy: the client address is the last `X-Forwarded-For` hop, the one the proxy appended |
| `GF_UPSTREAM_TIMEOUT_MS` | `20000` | the gateway's wait on an upstream |

## Limits and safety

- An upstream is reached only at a public address: the name is resolved, every address is checked, and the
  connection opens to the checked address. Loopback, private, link-local and CGNAT ranges are refused, and
  redirects are never followed.
- Per client, an IPv6 client counted by its /64: 600 requests and 60 plugin calls a minute, 10 submissions an
  hour. At once, for everyone: 8 submission probes and 64 upstream calls, at most 2 and 8 of them from one
  source. A full gate answers `busy` and frees as soon as work ends.
- The review queue holds 200 submissions, at most 3 from one source. A source is a salted digest made each run,
  never the address.
- A loopback request must carry a Host that names this machine or `GF_PUBLIC_ORIGIN`. A write that a browser
  marks as another site's is refused. A probe failure reads as a kind, such as `connection refused` or
  `timed out`, never as text from the network.

## Layout

`serve.js` wires the services and the routes; `js/render/*` are pure `state → html` functions shared with
the browser; `js/client.js` boots the page; `js/mcp.js` is the face; `js/gateway.js` forwards; `js/probe.js`
lists an upstream; `js/registry.js`, `js/submissions.js`, `js/ledger.js` hold the state on disk;
`css/tokens.css` is Linqi's token sheet and `css/app.css` names colours only by token.
