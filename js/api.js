// js/api.js — the JSON routes (spec §4): the catalogue for the client script and anyone, the ledger counts, the submission door
import { sendJson, readBody } from './http.js';
import { submitManifest } from './door.js';

const ONE = /^\/api\/plugins\/([a-z][a-z0-9-]{1,40})$/;

// what a plugin looks like from outside: the manifest and the derived fields, nothing else
export function publicEntry(p) {
  const { id, name, kind, blurb, url, homepage, by, icon, needs, writes, asks, tools, server, toolList, status, probedAt, latencyMs, calls, pending } = p;
  return { id, name, kind, blurb, url, homepage, by, icon, needs, writes, asks, tools, server: server ?? null, toolList: toolList ?? [], status, probedAt: probedAt ?? null, latencyMs: latencyMs ?? null, calls: calls ?? 0, pending: !!pending };
}

export function createApi(services) {
  return async function api({ req, res, url, path, ip }) {
    if (!path.startsWith('/api/') || path.startsWith('/api/admin/')) return false;
    if (req.method === 'GET' && path === '/api/plugins') { sendJson(res, 200, { plugins: services.catalogue(req).all.map(publicEntry) }); return true; }
    const one = path.match(ONE);
    if (req.method === 'GET' && one) {
      const p = services.catalogue(req).byId(one[1]);
      if (p) sendJson(res, 200, publicEntry(p)); else sendJson(res, 404, { error: 'unknown plugin' });
      return true;
    }
    if (req.method === 'GET' && path === '/api/search') {
      const cat = services.catalogue(req);
      const q = url.searchParams.get('q') ?? '';
      const kind = url.searchParams.get('kind');
      let found = q.trim() ? cat.search(q) : cat.all;
      if (kind) found = found.filter(p => p.kind === kind);
      sendJson(res, 200, { plugins: found.map(publicEntry) });
      return true;
    }
    if (req.method === 'GET' && path === '/api/ledger') { sendJson(res, 200, services.ledger.counts()); return true; }
    if (req.method === 'POST' && path === '/api/submissions') {
      const gate = services.limiters.submissions.take(ip);
      if (!gate.ok) { sendJson(res, 429, { error: 'rate limited' }, { 'retry-after': String(gate.retryAfterSec) }); return true; }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch (e) { sendJson(res, e.status === 413 ? 413 : 400, { error: e.status === 413 ? 'body too large' : 'invalid JSON' }); return true; }
      const r = await submitManifest(services, body?.manifest ?? body, 'api', { from: services.sourceOf(ip) });
      if (r.ok) sendJson(res, 202, { id: r.id, status: r.status, probe: r.probe }); else sendJson(res, 400, { error: r.error });
      return true;
    }
    sendJson(res, 404, { error: 'not found' });
    return true;
  };
}
