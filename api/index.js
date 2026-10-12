// api/index.js — the Vercel entry: one function serves the site, the API and the MCP face (spec §12, hosting).
// The data dir is the instance's /tmp, so submissions, approvals and the ledger last as long as the instance does.
import { createApp } from '../serve.js';

const app = createApp({ dataDir: process.env.GF_DATA_DIR || '/tmp/gravity-field', trustProxy: true, hosted: true });

// a cold instance answers its first request after the boot probes, at most 5 s, so statuses and tool lists are there
let warm = false;
async function warmUp() {
  let timer;
  await Promise.race([app.ready, new Promise(r => { timer = setTimeout(r, 5000); })]);
  clearTimeout(timer);
  warm = true;
}

export default async function handler(req, res) {
  if (!warm) await warmUp();
  return app.handle(req, res);
}
