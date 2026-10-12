// js/ratelimit.js — a token bucket per client IP (spec §4), and who the client is behind a proxy
// at most maxKeys buckets: past that the idle ones are swept, then the oldest dropped, so many addresses cannot grow memory without end
export function createLimiter({ limit, perMs, now = Date.now, maxKeys = 50_000 } = {}) {
  const buckets = new Map(); // key → { tokens, at }

  function take(key) {
    const t = now();
    if (!buckets.has(key) && buckets.size >= maxKeys) {
      sweep();
      if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value);
    }
    const b = buckets.get(key) ?? { tokens: limit, at: t };
    b.tokens = Math.min(limit, b.tokens + ((t - b.at) / perMs) * limit);
    b.at = t;
    buckets.set(key, b);
    if (b.tokens >= 1) { b.tokens -= 1; return { ok: true, retryAfterSec: 0 }; }
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(((1 - b.tokens) * perMs) / limit / 1000)) };
  }

  function sweep() {
    const t = now();
    for (const [k, b] of buckets) if (t - b.at >= perMs) buckets.delete(k);
  }

  return { take, sweep, size: () => buckets.size };
}

// behind a trusted proxy, the last hop of X-Forwarded-For: the one the proxy appended; every earlier hop is whatever the client
// wrote. Without a trusted proxy, the socket, whatever the header says
export function clientIp(req, { trustProxy = false } = {}) {
  if (trustProxy) {
    const hops = String(req.headers?.['x-forwarded-for'] ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return req.socket?.remoteAddress ?? '';
}

export const isLoopback = ip => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

// local for the admin gate: the socket is loopback and no proxy forwarded the request, so a proxy on the same machine
// does not make the whole world local, and no header a client writes can either
export function isLocalRequest(req) {
  const h = req.headers ?? {};
  return isLoopback(req.socket?.remoteAddress ?? '') && !h['x-forwarded-for'] && !h.forwarded && !h['x-real-ip'];
}
