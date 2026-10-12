// tests/helpers/http.js — an app over the fixtures on a free port, with a fresh data dir and no probing
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../serve.js';

export const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));

export function listen(app) {
  return new Promise(resolve => app.listen(0, '127.0.0.1', () => resolve(app.address().port)));
}

export function tmp() {
  return mkdtempSync(join(tmpdir(), 'gf-'));
}

export async function testApp(opts = {}) {
  const app = createApp({ root: FIXTURES, dataDir: tmp(), probeOnBoot: false, allowLoopback: true, log: () => {}, ...opts });
  const port = await listen(app);
  return { app, port, base: `http://127.0.0.1:${port}`, close: () => new Promise(r => app.close(() => r())) };
}
