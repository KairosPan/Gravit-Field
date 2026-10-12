// js/probe.js — connect to a plugin's server, list its tools, come back (spec §3.4); refuses addresses that point inside a network
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { urlOk } from './data/manifest.js';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const PRIVATE = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^127\./, /^\[f[cd][0-9a-f]{2}:/i, /^\[fe80:/i];

// loopback is named as such before the https rule, so the operator reads why; http passes only to loopback, only when allowed
export function allowedUrl(url, { allowLoopback = false } = {}) {
  let hostname;
  try { ({ hostname } = new URL(url)); } catch { return { ok: false, error: 'not an https URL' }; }
  if (LOOPBACK.has(hostname)) {
    if (!allowLoopback) return { ok: false, error: 'a loopback address' };
    return urlOk(url, { allowLoopback }) ? { ok: true } : { ok: false, error: 'not an https URL' };
  }
  if (!urlOk(url)) return { ok: false, error: 'not an https URL' };
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
