// js/admin.js — the operator's door (spec §5.6, §8.3, §14.6): this machine, or a session opened by the token; approve and reject
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { renderAdmin } from './render/admin.js';
import { renderDocument } from './render/page.js';
import { sendHtml, sendJson, parseCookies, readBody } from './http.js';
import { isLocalRequest } from './ratelimit.js';
import { pendingEntry } from './submissions.js';
import { approveSubmission, rejectSubmission } from './door.js';

export const COOKIE = 'gf_admin';
const THIRTY_DAYS = 30 * 24 * 3600;
const MAX_SESSIONS = 1000;
const NO_REFERRER = { 'referrer-policy': 'no-referrer' };
const ACTION = /^\/api\/admin\/([a-z][a-z0-9-]{1,40})\/(approve|reject)$/;

// the token is compared by digest in constant time, so neither its bytes nor its length show through timing
function tokenMatches(given, token) {
  if (typeof given !== 'string' || !given) return false;
  return timingSafeEqual(createHash('sha256').update(given).digest(), createHash('sha256').update(token).digest());
}

// a session is a random id kept in memory with its expiry: the cookie never carries the token, and a restart signs everyone out
export function createSessions({ now = Date.now, max = MAX_SESSIONS } = {}) {
  const live = new Map(); // id → expires at
  return {
    open() {
      if (live.size >= max) live.delete(live.keys().next().value);
      const id = randomBytes(32).toString('base64url');
      live.set(id, now() + THIRTY_DAYS * 1000);
      return id;
    },
    valid(id) {
      const until = id ? live.get(id) : undefined;
      if (until === undefined) return false;
      if (until < now()) { live.delete(id); return false; }
      return true;
    },
  };
}

// this machine: a loopback socket nothing forwarded (isLocalRequest), never an address a header can claim. Else a session
// cookie; else Authorization: Bearer <token>, for scripts; else GET /admin?token=, which opens a session and is answered by
// a redirect to a clean /admin, so the token-bearing URL is left at once and never sent on as a Referer
export function adminAllowed({ req, url, path, services }, sessions) {
  if (isLocalRequest(req)) return { ok: true };
  const token = services.options.adminToken;
  if (!token) return { ok: false };
  if (sessions.valid(parseCookies(req.headers.cookie)[COOKIE])) return { ok: true };
  const bearer = String(req.headers.authorization ?? '').match(/^Bearer\s+(\S+)$/i)?.[1];
  if (bearer && tokenMatches(bearer, token)) return { ok: true };
  if (path === '/admin' && req.method === 'GET' && url.searchParams.has('token') && tokenMatches(url.searchParams.get('token'), token)) {
    const secure = services.origin(req).startsWith('https:') ? '; Secure' : '';
    return { ok: true, signIn: `${COOKIE}=${sessions.open()}; Path=/; Max-Age=${THIRTY_DAYS}; HttpOnly; SameSite=Lax${secure}` };
  }
  return { ok: false };
}

export function createAdmin(services) {
  const sessions = createSessions();
  return async function admin(ctx) {
    const { req, res, url, path } = ctx;
    const action = path.match(ACTION);
    if (path !== '/admin' && !action) return false;
    const gate = adminAllowed(ctx, sessions);
    if (!gate.ok) { sendJson(res, 403, { error: 'forbidden' }, NO_REFERRER); return true; }
    if (gate.signIn) {
      res.writeHead(303, { location: '/admin', 'set-cookie': gate.signIn, 'cache-control': 'no-store', ...NO_REFERRER });
      res.end();
      return true;
    }
    const headers = { ...NO_REFERRER };
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
