// js/http.js — the answers every route writes, and the two readers: a bounded body and the cookie header
export function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

export function sendHtml(res, status, html, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(html);
}

export function notFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found');
}

// the whole body as a string, or a rejection carrying status 413 once it passes the limit. Past the limit the rest is
// read and discarded, never kept, so the 413 reaches a client that is still sending instead of a reset socket
export function readBody(req, { limit = 64 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', c => {
      if (over) return;
      size += c.length;
      if (size > limit) { over = true; chunks.length = 0; return; }
      chunks.push(c);
    });
    req.on('end', () => (over ? reject(Object.assign(new Error('body too large'), { status: 413 })) : resolve(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

export function parseCookies(header) {
  return Object.fromEntries(String(header ?? '').split(';').map(s => s.trim()).filter(Boolean).map(s => {
    const i = s.indexOf('=');
    try { return i < 0 ? [s, ''] : [s.slice(0, i), decodeURIComponent(s.slice(i + 1))]; } catch { return [s.slice(0, i), '']; }
  }));
}
