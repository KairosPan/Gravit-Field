// js/sameorigin.js — a page in the visitor's own browser cannot drive this server (MCP: servers validate Origin).
// Host: on a loopback socket the Host must name this machine or GF_PUBLIC_ORIGIN, so a name rebound to 127.0.0.1 is refused.
// Writes: a POST, PUT, PATCH or DELETE that a browser marks as another site's is refused; no Origin at all is a client, not a browser.
import { isLoopback } from './ratelimit.js';

const LOCAL = new Set(['127.0.0.1', 'localhost', '[::1]']);
const publicHost = publicOrigin => { try { return publicOrigin ? new URL(publicOrigin).host.toLowerCase() : null; } catch { return null; } };

export function hostAllowed(req, { publicOrigin = null, hosted = false } = {}) {
  if (hosted) return true; // behind a platform the loopback socket is the platform's, and no visitor's machine is in reach
  if (!isLoopback(req.socket?.remoteAddress ?? '')) return true; // rebinding only reaches through the visitor's own machine
  const host = String(req.headers.host ?? '').toLowerCase();
  if (LOCAL.has(host.replace(/:\d+$/, ''))) return true;
  return host !== '' && host === publicHost(publicOrigin);
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function writeAllowed(req, { publicOrigin = null } = {}) {
  if (SAFE.has(req.method)) return true;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (origin == null) return true;
  let u;
  try { u = new URL(origin); } catch { return false; } // includes Origin: null
  const host = u.host.toLowerCase();
  return host === String(req.headers.host ?? '').toLowerCase() || host === publicHost(publicOrigin);
}
