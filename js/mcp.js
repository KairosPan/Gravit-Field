// js/mcp.js — the MCP face (spec §6): four tools over stateless streamable HTTP, one server per request, built from the shared services
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { KINDS } from './data/manifest.js';
import { RESERVED_TOOLS } from './data/clients.js';
import { allowedTools } from './gateway.js';
import { publicEntry } from './api.js';
import { submitManifest } from './door.js';
import { readBody } from './http.js';

// the most of one request the face reads; the SDK is handed the parsed body, so it never buffers more
export const MAX_BODY = 1024 * 1024;

export const INSTRUCTIONS = `Gravity Field is a registry of investment plugins: remote MCP servers listed by kind (${KINDS.join(', ')}). shop_search lists plugins by text and kind; shop_get returns one plugin with the tools its server lists; shop_publish submits a manifest for the operator's review; plugin_call(id, tool, args) forwards one call to a listed plugin's own server and records a line in the ledger, with no caller identity. ${RESERVED_TOOLS.join(', ')} are reserved for a later version with accounts.`;

const text = v => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
const fail = msg => ({ content: [{ type: 'text', text: msg }], isError: true });
const brief = p => ({ id: p.id, name: p.name, kind: p.kind, blurb: p.blurb, by: p.by, tools: (p.toolList ?? []).length, status: p.pending ? 'review' : p.status });

export function makeServer(services, { req, ip }) {
  const server = new McpServer({ name: 'gravity-field', version: '0.1.0' }, { instructions: INSTRUCTIONS, maxToolInputElements: 10_000 });
  const from = services.sourceOf(ip);
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
    const r = await submitManifest(services, manifest, 'mcp', { from });
    return r.ok ? text({ id: r.id, status: r.status, probe: r.probe }) : fail(`${r.error.field}: ${r.error.rule}`);
  });

  server.registerTool('plugin_call', {
    description: 'Call one tool of a listed plugin through Gravity Field. The answer is the plugin\'s own; one ledger line is written.',
    inputSchema: { id: z.string().max(64), tool: z.string().max(64), args: z.record(z.string(), z.unknown()).optional() },
  }, async ({ id, tool, args }) => {
    // the order of spec §7: unknown plugin · tool not offered · rate limited · the call
    let p = services.registry.byId(id);
    if (!p) return fail(pendingHas(id) ? 'in review' : 'unknown plugin');
    // a plugin whose tools come from its probe, not yet up here (a cold instance, a failed boot probe): every attempt
    // costs the caller a call; the probe is shared by all who ask meanwhile, starts at most once a minute, and waits at
    // the doors' in-flight gate like any other
    if (!allowedTools(p).includes(tool) && !p.tools?.length && p.status !== 'up') {
      const gate = services.limiters.calls.take(ip);
      if (!gate.ok) return fail('rate limited');
      const probed = await services.registry.probeOnDemand(id, (url, o) => services.probe(url, { ...o, from }));
      if (probed?.busy) return fail('busy');
      p = services.registry.byId(id);
    }
    if (!allowedTools(p).includes(tool)) return fail('tool not offered');
    const gate = services.limiters.calls.take(ip);
    if (!gate.ok) return fail('rate limited');
    const r = await services.gateway.call(p, tool, args ?? {}, { from });
    services.ledger.record({ plugin: id, tool, ok: !r.error && !r.isError, ms: r.ms });
    return r.error ? fail(r.error) : { content: r.content, isError: r.isError };
  });

  return server;
}

export function createMcpRoute(services) {
  return async function mcp({ req, res, path, ip }) {
    if (path !== '/mcp') return false;
    // stateless: there is no session to stream to or end, so GET and DELETE hold nothing open
    if (req.method === 'GET' || req.method === 'DELETE') { res.writeHead(405, { allow: 'POST' }); res.end(); return true; }
    // a POST's body is read here, bounded, and handed over parsed
    let body;
    if (req.method === 'POST') {
      const rpcError = (status, code, message) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code, message } })); return true; };
      let text;
      try { text = await readBody(req, { limit: MAX_BODY }); } catch (e) { return rpcError(e.status === 413 ? 413 : 400, -32600, e.status === 413 ? 'request too large' : 'bad request'); }
      try { body = JSON.parse(text); } catch { return rpcError(400, -32700, 'Parse error'); }
    }
    const server = makeServer(services, { req, ip });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      Promise.resolve(transport.close()).catch(() => {});
      Promise.resolve(server.close()).catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      services.log(`mcp: ${e.message}`);
      if (!res.headersSent) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'internal' })); }
    }
    return true;
  };
}
