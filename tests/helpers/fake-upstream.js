// tests/helpers/fake-upstream.js — an in-process MCP server over streamable HTTP: echo, boom (fails), slow (waits); stateless, one server per request
import { createServer } from 'node:http';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export function makeUpstream({ name = 'fake-upstream', version = '0.1.0', calls = [] } = {}) {
  const s = new McpServer({ name, version }, { instructions: 'a fake upstream for tests' });
  s.registerTool('echo', { description: 'Echoes the text back\nSecond line is not shown', inputSchema: { text: z.string() } }, async ({ text }) => {
    calls.push(['echo', text]);
    return { content: [{ type: 'text', text: `echo:${text}` }] };
  });
  s.registerTool('boom', { description: 'Always fails', inputSchema: {} }, async () => ({ content: [{ type: 'text', text: 'it broke' }], isError: true }));
  s.registerTool('slow', { description: 'Answers after ms', inputSchema: { ms: z.number().optional() } }, async ({ ms = 2000 }) => {
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

// a port that accepts a connection and never answers: the timeout case
export async function startSilent() {
  const http = createServer(() => {});
  const port = await new Promise(r => http.listen(0, '127.0.0.1', () => r(http.address().port)));
  return { url: `http://127.0.0.1:${port}/mcp`, close: () => new Promise(r => { http.closeAllConnections(); http.close(() => r()); }) };
}
