// scripts/probe.js — probe every committed plugin and print what answers (spec §3.4): npm run probe; exit 1 when any is down
import { fileURLToPath } from 'node:url';
import { loadCommitted } from '../js/data/load.js';
import { probe } from '../js/probe.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const { plugins } = loadCommitted(root);
let down = 0;
for (const p of plugins) {
  const r = await probe(p.url);
  if (r.ok) {
    const missing = p.tools.filter(t => !r.toolList.some(x => x.name === t));
    console.log(`OK    ${p.id.padEnd(14)} ${r.transport.padEnd(4)} ${String(r.latencyMs).padStart(5)} ms · ${r.server.name} ${r.server.version} · ${r.toolList.length} tools${missing.length ? ` · MISSING: ${missing.join(', ')}` : ''}`);
    if (missing.length) down++;
  } else {
    down++;
    console.log(`DOWN  ${p.id.padEnd(14)} ${r.error}`);
  }
}
process.exitCode = down ? 1 : 0;
