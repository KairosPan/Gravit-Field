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

// allowLoopback and resolve reach the guarded connection (spec §9): an approved plugin is checked again each time a connection opens
export function createGateway({ timeoutMs = 20_000, onDown = () => {}, now = Date.now, allowLoopback = false, resolve } = {}) {
  const clients = new Map(); // plugin id → { url, client }

  async function clientFor(entry) {
    const have = clients.get(entry.id);
    if (have && have.url === entry.url) return have.client;
    if (have) { clients.delete(entry.id); await have.client.close().catch(() => {}); }
    const { client } = await connectUpstream(entry.url, { timeoutMs, allowLoopback, resolve });
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
