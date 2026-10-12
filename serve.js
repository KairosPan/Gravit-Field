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
