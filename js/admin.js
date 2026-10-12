// js/admin.js — the operator's door (spec §5.6, §8.3): loopback, or the cookie a token visit sets; approve and reject
import { renderAdmin } from './render/admin.js';
import { renderDocument } from './render/page.js';
import { sendHtml, sendJson, parseCookies, readBody } from './http.js';
import { isLocalRequest } from './ratelimit.js';
import { pendingEntry } from './submissions.js';
import { approveSubmission, rejectSubmission } from './door.js';

export const COOKIE = 'gf_admin';
const THIRTY_DAYS = 30 * 24 * 3600;
const ACTION = /^\/api\/admin\/([a-z][a-z0-9-]{1,40})\/(approve|reject)$/;

// local: a loopback socket that nothing forwarded (isLocalRequest), never a client address a header can claim; else the
// cookie; else ?token=, which sets the cookie; with no token configured, local only
export function adminAllowed({ req, url, services }) {
  if (isLocalRequest(req)) return { ok: true };
  const token = services.options.adminToken;
  if (!token) return { ok: false };
  if (parseCookies(req.headers.cookie)[COOKIE] === token) return { ok: true };
  if (url.searchParams.get('token') === token) return { ok: true, setCookie: `${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${THIRTY_DAYS}; HttpOnly; SameSite=Lax` };
  return { ok: false };
}

export function createAdmin(services) {
  return async function admin(ctx) {
    const { req, res, url, path } = ctx;
    const action = path.match(ACTION);
    if (path !== '/admin' && !action) return false;
    const gate = adminAllowed(ctx);
    if (!gate.ok) { sendJson(res, 403, { error: 'forbidden' }); return true; }
    const headers = gate.setCookie ? { 'set-cookie': gate.setCookie } : {};
    if (!action) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return false;
      const body = renderAdmin({
        pending: services.submissions.list().map(rec => ({ rec, entry: pendingEntry(rec) })),
        approved: services.submissions.approved(), approvedDir: services.submissions.dirs.approved,
        counts: services.ledger.counts(), now: Date.now(), error: url.searchParams.get('error'),
      });
      sendHtml(res, 200, renderDocument({ title: 'Admin · Gravity Field', body, script: null }), headers);
      return true;
    }
    if (req.method !== 'POST') return false;
    const [, id, verb] = action;
    let result;
    if (verb === 'approve') {
      result = await approveSubmission(services, id);
    } else {
      let reason = '';
      try { reason = new URLSearchParams(await readBody(req)).get('reason') ?? ''; } catch { reason = ''; }
      result = rejectSubmission(services, id, reason);
    }
    if ((req.headers.accept ?? '').includes('text/html')) {
      res.writeHead(303, { location: result.ok ? '/admin' : `/admin?error=${encodeURIComponent(result.error)}`, ...headers });
      res.end();
    } else {
      sendJson(res, result.ok ? 200 : 409, result.ok ? { ok: true, id } : { ok: false, error: result.error }, headers);
    }
    return true;
  };
}
