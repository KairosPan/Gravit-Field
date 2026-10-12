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

// the whole body as a string, or a rejection carrying status 413 once it passes the limit
export function readBody(req, { limit = 64 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function parseCookies(header) {
  return Object.fromEntries(String(header ?? '').split(';').map(s => s.trim()).filter(Boolean).map(s => {
    const i = s.indexOf('=');
    try { return i < 0 ? [s, ''] : [s.slice(0, i), decodeURIComponent(s.slice(i + 1))]; } catch { return [s.slice(0, i), '']; }
  }));
}
