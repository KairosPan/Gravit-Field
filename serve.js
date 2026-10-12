// serve.js — Gravity Field: one Node process that is the site, the API, the MCP face and the gateway (spec §4)
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegistry } from './js/registry.js';
import { createSubmissions, pendingEntry } from './js/submissions.js';
import { createLedger } from './js/ledger.js';
import { createGateway } from './js/gateway.js';
import { createLimiter, createGate, clientIp, bucketKey } from './js/ratelimit.js';
import { probe as realProbe } from './js/probe.js';
import { makeCatalogue } from './js/data/catalogue.js';
import { sendJson, sendHtml, notFound } from './js/http.js';
import { createPages } from './js/pages.js';
import { createApi } from './js/api.js';

export { sendJson, sendHtml, notFound };

export const HERE = fileURLToPath(new URL('.', import.meta.url));
export const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
};
// requests a minute, plugin calls a minute, submissions an hour, per client (spec §4; an IPv6 client is its /64)
export const LIMITS = { requests: [600, 60_000], calls: [60, 60_000], submissions: [10, 3_600_000] };
// outbound work at once: for everyone together, and a share for each source; a full gate answers busy and frees the
// moment work ends, so a crowd can slow the site down but never lock it for a window, and one client cannot take every place.
// Together with the per-client buckets this bounds sockets, memory and throughput: places × the upstream timeout
export const INFLIGHT = { probes: 8, calls: 64, probesPerSource: 2, callsPerSource: 8 };

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
  const inflight = { ...INFLIGHT, ...(o.inflight ?? {}) };
  const probeGate = createGate(inflight.probes, { perKey: inflight.probesPerSource });
  const callGate = createGate(inflight.calls, { perKey: inflight.callsPerSource });
  const ownProbe = (url, extra = {}) => probeFn(url, { allowLoopback: o.allowLoopback, timeoutMs: 12_000, ...extra });
  // the doors' probes wait at the gate; the registry's own schedule never does, so a crowd cannot mark plugins down
  const probe = async (url, { from, ...extra } = {}) => {
    if (!probeGate.enter(from)) return { ok: false, error: 'busy' };
    try { return await ownProbe(url, extra); } finally { probeGate.leave(from); }
  };
  const registry = createRegistry({ root: o.root, dataDir: o.dataDir, probe: ownProbe, allowLoopback: o.allowLoopback, log });
  registry.reload();
  const submissions = createSubmissions({ dataDir: o.dataDir, log });
  const ledger = createLedger({ file: join(o.dataDir, 'ledger.jsonl') });
  const upstream = createGateway({ timeoutMs: o.upstreamTimeoutMs, onDown: id => registry.setStatus(id, 'down'), allowLoopback: o.allowLoopback });
  const gateway = {
    ...upstream,
    async call(entry, tool, args, { from } = {}) {
      if (!callGate.enter(from)) return { error: 'busy', ms: 0 };
      try { return await upstream.call(entry, tool, args); } finally { callGate.leave(from); }
    },
  };
  const limits = { ...LIMITS, ...(o.limits ?? {}) };
  const limiters = Object.fromEntries(Object.entries(limits).map(([k, [limit, perMs]]) => [k, createLimiter({ limit, perMs })]));
  // idle buckets are swept each minute
  const sweeper = setInterval(() => { for (const l of Object.values(limiters)) l.sweep(); }, 60_000);
  sweeper.unref();

  // who submitted, for the per-source queue limit only: a digest of the client key under a salt this run made and keeps in memory
  const salt = randomBytes(16);
  const sourceOf = ip => createHash('sha256').update(salt).update(bucketKey(ip)).digest('hex').slice(0, 16);

  const services = {
    options: o, log, registry, submissions, ledger, gateway, limiters, probe, sourceOf,
    // the origin the MCP address and the Use it lines show: GF_PUBLIC_ORIGIN, else what the request came to
    origin: req => o.publicOrigin ?? `${(o.trustProxy && req.headers['x-forwarded-proto']) || 'http'}://${req.headers.host ?? `${o.host}:${o.port}`}`,
    catalogue: req => makeCatalogue({
      plugins: registry.list(), pending: submissions.list().map(pendingEntry), shelves: registry.shelves(),
      calls: ledger.perPlugin(), origin: services.origin(req), now: Date.now(),
    }),
  };

  // route handlers answer true when they took the request; tried in this order (Tasks 13–16 add theirs)
  const routes = [createApi(services), createPages(services)];

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
    clearInterval(sweeper);
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
