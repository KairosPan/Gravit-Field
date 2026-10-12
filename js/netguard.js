// js/netguard.js — where an upstream may live (spec §9): blocked ranges by address, not by name; a lookup that refuses
// them at connect time, so a name cannot be re-pointed inside after it was checked; a fetch that uses it and never follows a redirect
import { BlockList, isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';

const loop = new BlockList();
loop.addSubnet('127.0.0.0', 8, 'ipv4');
loop.addAddress('::1', 'ipv6');

const inside = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]]) inside.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32]]) inside.addSubnet(net, bits, 'ipv6');

// ::ffff:a.b.c.d and its hex spelling ::ffff:7f00:1 are IPv4 addresses and are judged as such
function unmap(ip) {
  const s = String(ip ?? '').replace(/^\[|\]$/g, '').toLowerCase();
  const dotted = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const hex = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return s;
}

// why an address may not be reached, or null when it may
export function blockedReason(ip, { allowLoopback = false } = {}) {
  const a = unmap(ip);
  const v = isIP(a);
  if (!v) return 'not an address';
  const type = v === 6 ? 'ipv6' : 'ipv4';
  if (loop.check(a, type)) return allowLoopback ? null : 'a loopback address';
  if (inside.check(a, type)) return 'an address inside a network';
  return null;
}

const blocked = why => Object.assign(new Error(why), { code: 'EBLOCKED' });

// a lookup for net and tls connect: resolve, refuse if any answer is blocked, reply in the shape the socket asked for
export function guardedLookup({ allowLoopback = false, resolve = dnsLookup } = {}) {
  return function lookup(hostname, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    resolve(hostname, { ...options, all: true }, (err, answers) => {
      if (err) return callback(err);
      const list = Array.isArray(answers) ? answers : [{ address: answers, family: isIP(answers) }];
      if (!list.length) return callback(Object.assign(new Error(`no address for ${hostname}`), { code: 'ENOTFOUND' }));
      for (const a of list) {
        const why = blockedReason(a.address, { allowLoopback });
        if (why) return callback(blocked(why));
      }
      if (options.all) return callback(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };
}

// before any connection: every address of the name may be reached (an IP literal is judged as it is)
export function checkHost(hostname, { allowLoopback = false, resolve = dnsLookup } = {}) {
  const host = String(hostname ?? '').replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    const why = blockedReason(host, { allowLoopback });
    return Promise.resolve(why ? { ok: false, error: why } : { ok: true });
  }
  return new Promise(done => {
    guardedLookup({ allowLoopback, resolve })(host, { all: true }, err => {
      if (!err) return done({ ok: true });
      done({ ok: false, error: err.code === 'EBLOCKED' ? err.message : 'host not found' });
    });
  });
}

const NULL_BODY = new Set([101, 103, 204, 205, 304]);

// the registry names itself to the servers it probes and calls: some hosts refuse a request that carries no User-Agent
export const USER_AGENT = 'GravityField/0.1 (+https://github.com/KairosPan/Gravit-Field)';

// the answer as a web stream built by hand: nothing is enqueued once it is closed, errored or cancelled (Node's
// toWeb adapter flushes bytes already buffered into a body the reader cancelled, and throws where nothing catches it);
// past maxBytes it errors with EBIG and the socket is closed, so nothing larger is ever buffered
function webBody(res, maxBytes) {
  let open = true;
  let seen = 0;
  const finish = fn => { if (open) { open = false; fn(); } };
  return new ReadableStream({
    start(controller) {
      res.on('data', chunk => {
        if (!open) return;
        seen += chunk.length;
        if (maxBytes && seen > maxBytes) {
          finish(() => controller.error(Object.assign(new Error(`answer larger than ${maxBytes} bytes`), { code: 'EBIG' })));
          res.destroy();
          return;
        }
        controller.enqueue(new Uint8Array(chunk));
        if (controller.desiredSize <= 0) res.pause();
      });
      res.on('end', () => finish(() => controller.close()));
      res.on('error', e => finish(() => controller.error(e)));
      res.on('close', () => finish(() => controller.error(Object.assign(new Error('the connection closed before the answer ended'), { code: 'ECONNRESET' }))));
    },
    pull() { res.resume(); },
    cancel() { open = false; res.destroy(); },
  }, { highWaterMark: 64 * 1024, size: chunk => chunk.byteLength });
}

// a fetch for the MCP client transports: node:http(s) through the guarded lookup; a redirect comes back as it is.
// Each fetch owns its connection pool: a socket opened under one policy is never reused under another; destroy() closes the pool
export function guardedFetch({ allowLoopback = false, resolve = dnsLookup, maxBytes = 0 } = {}) {
  const lookup = guardedLookup({ allowLoopback, resolve });
  const agents = { 'http:': new http.Agent({ keepAlive: true }), 'https:': new https.Agent({ keepAlive: true }) };
  function fetch(input, init = {}) {
    return new Promise((done, fail) => {
      const failWith = cause => fail(new TypeError('fetch failed', { cause }));
      let url;
      try { url = new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url); } catch (e) { return failWith(e); }
      const host = url.hostname.replace(/^\[|\]$/g, '');
      if (isIP(host)) {
        const why = blockedReason(host, { allowLoopback });
        if (why) return failWith(blocked(why));
      }
      const mod = url.protocol === 'https:' ? https : url.protocol === 'http:' ? http : null;
      if (!mod) return failWith(new Error(`unsupported protocol ${url.protocol}`));
      const method = (init.method ?? 'GET').toUpperCase();
      const headers = Object.fromEntries(new Headers(init.headers ?? {}));
      if (!headers['user-agent']) headers['user-agent'] = USER_AGENT;
      const body = init.body == null ? null : typeof init.body === 'string' || init.body instanceof Uint8Array ? init.body : String(init.body);
      if (body != null && headers['content-length'] == null) headers['content-length'] = String(Buffer.byteLength(body));
      const req = mod.request({ hostname: host, port: url.port || undefined, path: url.pathname + url.search, method, headers, lookup, agent: agents[url.protocol], signal: init.signal ?? undefined }, res => {
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) for (const x of [].concat(v ?? [])) h.append(k, String(x));
        const empty = NULL_BODY.has(res.statusCode) || method === 'HEAD';
        if (empty) res.resume();
        done(new Response(empty ? null : webBody(res, maxBytes), { status: res.statusCode, statusText: res.statusMessage, headers: h }));
      });
      req.on('error', failWith);
      req.end(body ?? undefined);
    });
  }
  fetch.destroy = () => { agents['http:'].destroy(); agents['https:'].destroy(); };
  return fetch;
}
