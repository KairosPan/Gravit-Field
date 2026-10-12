// js/gateway.js — plugin_call's forwarding half (spec §7): one cached client per plugin, a timeout, the answer passed through, a cut at 256 KB
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { connectUpstream, describeError } from './probe.js';

export const MAX_TEXT = 256 * 1024;
export const MAX_ITEMS = 64;
// what one call may read from an upstream before the answer is refused as too large
export const CALL_BYTES = 4 * 1024 * 1024;
const TIMED_OUT = -32001;

// what reaches the caller: at most MAX_ITEMS items; text over MAX_TEXT is cut with a note; image, audio and resource
// data over MAX_TEXT is replaced by a note, since half a picture is no picture
export function trimContent(content) {
  const list = Array.isArray(content) ? content : [];
  const omitted = (what, n) => ({ type: 'text', text: `[${what} omitted: ${n} characters of data, more than ${MAX_TEXT}]` });
  const cut = s => s.slice(0, MAX_TEXT) + `\n… [cut at ${MAX_TEXT} characters]`;
  const out = list.slice(0, MAX_ITEMS).map(c => {
    if (c?.type === 'text' && typeof c.text === 'string' && c.text.length > MAX_TEXT) return { ...c, text: cut(c.text) };
    if ((c?.type === 'image' || c?.type === 'audio') && typeof c.data === 'string' && c.data.length > MAX_TEXT) return omitted(c.type, c.data.length);
    if (c?.type === 'resource' && c.resource) {
      const r = c.resource;
      if (typeof r.blob === 'string' && r.blob.length > MAX_TEXT) return omitted(`resource ${r.uri ?? ''}`.trim(), r.blob.length);
      if (typeof r.text === 'string' && r.text.length > MAX_TEXT) return { ...c, resource: { ...r, text: cut(r.text) } };
    }
    return c;
  });
  if (list.length > MAX_ITEMS) out.push({ type: 'text', text: `[${list.length - MAX_ITEMS} more items omitted]` });
  return out;
}

// the tools a manifest admits: its own list, or every listed tool when the list is empty (spec §3.1)
export function allowedTools(entry) {
  return entry.tools?.length ? entry.tools : (entry.toolList ?? []).map(t => t.name);
}

// allowLoopback and resolve reach the guarded connection (spec §9): an approved plugin is checked again each time a connection opens
export function createGateway({ timeoutMs = 20_000, onDown = () => {}, now = Date.now, allowLoopback = false, resolve, maxBytes = CALL_BYTES } = {}) {
  const clients = new Map(); // plugin id → { url, client }

  async function clientFor(entry) {
    const have = clients.get(entry.id);
    if (have && have.url === entry.url) return have.client;
    if (have) { clients.delete(entry.id); await have.client.close().catch(() => {}); }
    const { client } = await connectUpstream(entry.url, { timeoutMs, allowLoopback, resolve, maxBytes });
    clients.set(entry.id, { url: entry.url, client });
    return client;
  }

  async function forget(entry) {
    const have = clients.get(entry.id);
    clients.delete(entry.id);
    await have?.client.close().catch(() => {});
  }

  async function drop(entry, reason) {
    await forget(entry);
    onDown(entry.id, reason);
  }

  const timedOut = e => (e instanceof McpError && e.code === TIMED_OUT) || /timed out after/.test(e?.message ?? '');

  async function call(entry, tool, args = {}) {
    const t0 = now();
    if (!allowedTools(entry).includes(tool)) return { error: 'tool not offered', ms: 0 };
    // a cached client that fails for any reason but a timeout gets one fresh connection: an upstream that forgot its
    // session after an idle spell or a restart is alive, and must not read as down (spec §7: reconnected on error)
    for (let attempt = 0; ; attempt++) {
      const cached = clients.get(entry.id)?.url === entry.url;
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
        // the server's own answer, an MCP error that is not a timeout, is the caller's tool error
        if (e instanceof McpError && e.code !== TIMED_OUT) return { content: [{ type: 'text', text: e.message }], isError: true, ms: now() - t0 };
        // an answer past the byte cap: the line is fine, this answer is not; the client is closed, the plugin stays up
        if (describeError(e) === 'answer too large') {
          await forget(entry);
          return { content: [{ type: 'text', text: `the answer was larger than ${maxBytes} bytes` }], isError: true, ms: now() - t0 };
        }
        if (cached && attempt === 0 && !timedOut(e)) { await forget(entry); continue; }
        await drop(entry, e.message);
        return { error: 'upstream unreachable', ms: now() - t0 };
      }
    }
  }

  async function close() {
    for (const { client } of clients.values()) await client.close().catch(() => {});
    clients.clear();
  }

  return { call, close, size: () => clients.size };
}
