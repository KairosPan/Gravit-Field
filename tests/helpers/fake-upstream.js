// tests/helpers/fake-upstream.js — an in-process MCP server over streamable HTTP: echo, boom (fails), slow (waits); stateless, one server per request
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

// extraTools: [{ name, description, inputSchema (a zod shape), answer: args => content }] for the size and shape cases
export function makeUpstream({ name = 'fake-upstream', version = '0.1.0', calls = [], extraTools = [] } = {}) {
  const s = new McpServer({ name, version }, { instructions: 'a fake upstream for tests' });
  for (const t of extraTools) s.registerTool(t.name, { description: t.description ?? '', inputSchema: t.inputSchema ?? {} }, async args => ({ content: t.answer ? t.answer(args) : [{ type: 'text', text: 'ok' }] }));
  s.registerTool('echo', { description: 'Echoes the text back\nSecond line is not shown', inputSchema: { text: z.string() } }, async ({ text }) => {
    calls.push(['echo', text]);
    return { content: [{ type: 'text', text: `echo:${text}` }] };
  });
  s.registerTool('boom', { description: 'Always fails', inputSchema: {} }, async () => ({ content: [{ type: 'text', text: 'it broke' }], isError: true }));
  s.registerTool('slow', { description: 'Answers after ms', inputSchema: { ms: z.number().optional() } }, async ({ ms = 2000 }) => {
    calls.push(['slow', ms]);
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

// an upstream that keeps sessions, as the SDK's default server does; forget() drops them all, as an idle expiry or a restart would
// json: false answers every POST as an SSE stream and keeps a GET stream open, as most hosted servers do
export async function startStatefulUpstream({ json = true, ...opts } = {}) {
  const calls = [];
  const sessions = new Map();
  const http = createServer(async (req, res) => {
    if (new URL(req.url, 'http://x').pathname !== '/mcp') { res.writeHead(404); return res.end(); }
    const sid = req.headers['mcp-session-id'];
    let transport = sid ? sessions.get(sid) : null;
    if (sid && !transport) {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Session not found' } }));
    }
    if (!transport) {
      const t = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), enableJsonResponse: json, onsessioninitialized: id => sessions.set(id, t) });
      await makeUpstream({ ...opts, calls }).connect(t);
      transport = t;
    }
    try { await transport.handleRequest(req, res); } catch { if (!res.headersSent) { res.writeHead(500); res.end(); } }
  });
  const port = await new Promise(r => http.listen(0, '127.0.0.1', () => r(http.address().port)));
  return {
    url: `http://127.0.0.1:${port}/mcp`, port, calls,
    forget: () => sessions.clear(),
    close: () => new Promise(r => { http.closeAllConnections(); http.close(() => r()); }),
  };
}

// a port that accepts a connection and never answers: the timeout case
export async function startSilent() {
  const http = createServer(() => {});
  const port = await new Promise(r => http.listen(0, '127.0.0.1', () => r(http.address().port)));
  return { url: `http://127.0.0.1:${port}/mcp`, close: () => new Promise(r => { http.closeAllConnections(); http.close(() => r()); }) };
}
