// js/probe.js — connect to a plugin's server, list its tools, come back (spec §3.4); refuses addresses that point inside a network
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { isIP } from 'node:net';
import { urlOk } from './data/manifest.js';
import { blockedReason, checkHost, guardedFetch } from './netguard.js';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
// what one probe may read and keep: the answer's bytes, the tools, each schema serialized, the server's name and version
export const PROBE_BYTES = 2 * 1024 * 1024;
export const MAX_TOOLS = 64;
export const MAX_SCHEMA = 16 * 1024;
const MAX_LABEL = 80;

// loopback is named as such before the https rule, so the operator reads why; http passes only to loopback, only when allowed
export function allowedUrl(url, { allowLoopback = false } = {}) {
  let hostname;
  try { ({ hostname } = new URL(url)); } catch { return { ok: false, error: 'not an https URL' }; }
  if (LOOPBACK.has(hostname)) {
    if (!allowLoopback) return { ok: false, error: 'a loopback address' };
    return urlOk(url, { allowLoopback }) ? { ok: true } : { ok: false, error: 'not an https URL' };
  }
  if (!urlOk(url)) return { ok: false, error: 'not an https URL' };
  const literal = hostname.replace(/^\[|\]$/g, '');
  if (isIP(literal)) {
    const why = blockedReason(literal, { allowLoopback });
    return why ? { ok: false, error: why } : { ok: true };
  }
  if (hostname.endsWith('.local') || hostname.endsWith('.internal')) return { ok: false, error: 'an address inside a network' };
  return { ok: true };
}

// an error and its causes as one line
const flatten = e => (!e ? '' : [e.code, e.message, e.cause ? flatten(e.cause) : ''].filter(Boolean).join(' '));

export function withTimeout(promise, ms, what) {
  let t;
  const timeout = new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

// streamable HTTP first, SSE on failure; both through the guarded fetch, so every connection is to an address checked as it opens
export async function connectUpstream(url, { timeoutMs = 12_000, allowLoopback = false, resolve, maxBytes = 0 } = {}) {
  const fetch = guardedFetch({ allowLoopback, maxBytes, ...(resolve ? { resolve } : {}) });
  const failures = [];
  for (const [transport, T] of [['http', StreamableHTTPClientTransport], ['sse', SSEClientTransport]]) {
    const client = new Client({ name: 'gravity-field', version: '0.1.0' });
    try {
      await withTimeout(client.connect(new T(new URL(url), { fetch })), timeoutMs, 'connect');
      // closing the client also closes the pool its fetch opened
      const close = client.close.bind(client);
      client.close = async () => { try { await close(); } finally { fetch.destroy(); } };
      return { client, transport };
    } catch (e) {
      failures.push([transport, e]);
      await client.close().catch(() => {});
    }
  }
  fetch.destroy();
  // both attempts, in order: why streamable HTTP failed is usually the reason; the SSE fallback's answer follows it
  throw Object.assign(new Error(failures.map(([t, e]) => `${t}: ${flatten(e)}`).join(' · ')), { cause: failures.at(-1)[1] });
}

// a tool's description as the drawer shows it: the first line, then its first sentence, at most 140 characters
export function oneLine(s) {
  const line = String(s ?? '').split('\n')[0].trim();
  const sentence = line.match(/^(.+?[.!?])\s+(?=[A-Z])/);
  const out = sentence ? sentence[1] : line;
  return out.length > 140 ? out.slice(0, 139).trimEnd() + '…' : out;
}

// what a submitter may read about a failure: its kind, never addresses or text from inside the network it was tried from
export function describeError(e) {
  const text = flatten(e);
  if (/EBIG|answer larger than/.test(text)) return 'answer too large';
  if (/EBLOCKED|inside a network/.test(text)) return 'an address inside a network';
  if (/a loopback address/.test(text)) return 'a loopback address';
  if (/timed out|ETIMEDOUT|-32001/i.test(text)) return 'timed out';
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/.test(text)) return 'host not found';
  if (/ECONNREFUSED/.test(text)) return 'connection refused';
  if (/ECONNRESET|socket hang up|EPIPE/.test(text)) return 'connection reset';
  if (/certificate|CERT_|SSL|TLS|self[- ]signed/i.test(text)) return 'TLS error';
  const status = text.match(/\bHTTP (\d{3})\b|status code \((\d{3})\)/);
  if (status) return `the server answered HTTP ${status[1] ?? status[2]}`;
  return 'not an MCP server';
}

// a schema is kept as it came when it serializes within MAX_SCHEMA, else as an object of unknown shape
function boundedSchema(schema) {
  const s = schema && typeof schema === 'object' ? schema : { type: 'object' };
  return JSON.stringify(s).length <= MAX_SCHEMA ? s : { type: 'object' };
}

export async function probe(url, { timeoutMs = 12_000, allowLoopback = false, resolve, now = Date.now } = {}) {
  const allowed = allowedUrl(url, { allowLoopback });
  if (!allowed.ok) return { ok: false, error: allowed.error };
  const host = await checkHost(new URL(url).hostname, { allowLoopback, ...(resolve ? { resolve } : {}) });
  if (!host.ok) return { ok: false, error: host.error };
  const t0 = now();
  let client;
  try {
    const c = await connectUpstream(url, { timeoutMs, allowLoopback, resolve, maxBytes: PROBE_BYTES });
    client = c.client;
    const { tools } = await withTimeout(client.listTools({}, { timeout: timeoutMs }), timeoutMs, 'tools/list');
    const info = client.getServerVersion() ?? {};
    return {
      ok: true,
      server: { name: String(info.name ?? '').slice(0, MAX_LABEL), version: String(info.version ?? '').slice(0, MAX_LABEL) },
      toolList: tools.filter(t => typeof t.name === 'string' && t.name.length > 0 && t.name.length <= 64).slice(0, MAX_TOOLS)
        .map(t => ({ name: t.name, description: oneLine(t.description), inputSchema: boundedSchema(t.inputSchema) })),
      latencyMs: Math.round(now() - t0),
      transport: c.transport,
    };
  } catch (e) {
    // the kind is what a submitter may read; the raw detail is for the operator's log only (registry.js, door.js)
    return { ok: false, error: describeError(e), detail: flatten(e).replace(/\s+/g, ' ').slice(0, 300) };
  } finally {
    await client?.close().catch(() => {});
  }
}
