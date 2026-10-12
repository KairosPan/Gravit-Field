// js/ratelimit.js — a token bucket per client IP (spec §4), and who the client is behind a proxy
export function createLimiter({ limit, perMs, now = Date.now } = {}) {
  const buckets = new Map(); // key → { tokens, at }

  function take(key) {
    const t = now();
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

// the first hop of X-Forwarded-For only when a proxy is trusted (spec §4); otherwise the socket, whatever the header says
export function clientIp(req, { trustProxy = false } = {}) {
  if (trustProxy) {
    const xff = req.headers?.['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  return req.socket?.remoteAddress ?? '';
}

export const isLoopback = ip => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
