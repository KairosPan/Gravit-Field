// js/submissions.js — the review queue on disk (spec §8): submissions/, approved/, rejected/ under the data dir, one JSON record each
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ID } from './data/manifest.js';

// a pending submission as the catalogue shows it: its probe stands in for the registry's derived fields
export function pendingEntry(rec) {
  const p = rec.probe ?? {};
  return {
    ...rec.manifest,
    server: p.ok ? p.server : null,
    toolList: p.ok ? p.toolList : [],
    status: p.ok ? 'up' : 'down',
    probedAt: rec.at,
    latencyMs: p.ok ? p.latencyMs : null,
    at: rec.at,
  };
}

export function createSubmissions({ dataDir, now = Date.now, log = () => {} }) {
  const dirs = { pending: join(dataDir, 'submissions'), approved: join(dataDir, 'approved'), rejected: join(dataDir, 'rejected') };
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });

  // the id has passed the manifest rule before it is ever a file name; anything else is refused here too
  const file = (kind, id) => {
    if (!ID.test(id)) throw new Error('invalid id');
    return join(dirs[kind], id + '.json');
  };
  const read = kind => readdirSync(dirs[kind]).filter(f => f.endsWith('.json')).sort().map(f => {
    try { return JSON.parse(readFileSync(join(dirs[kind], f), 'utf8')); } catch (e) { log(`skipping ${join(dirs[kind], f)}: ${e.message}`); return null; }
  }).filter(Boolean);
  const write = (kind, id, rec) => writeFileSync(file(kind, id), JSON.stringify(rec, null, 2) + '\n');

  function get(id) {
    const f = file('pending', id);
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
  }

  return {
    dirs, get,
    list: () => read('pending').sort((a, b) => b.at - a.at),
    has: id => existsSync(file('pending', id)),
    add({ manifest, probe, via }) {
      const rec = { manifest, probe, via, at: now() };
      write('pending', manifest.id, rec);
      return rec;
    },
    approve(id, { probe }) {
      const rec = get(id);
      if (!rec) return null;
      const out = { ...rec, probe, approvedAt: now() };
      write('approved', id, out);
      unlinkSync(file('pending', id));
      return out;
    },
    reject(id, reason) {
      const rec = get(id);
      if (!rec) return null;
      const out = { ...rec, reason, rejectedAt: now() };
      write('rejected', id, out);
      unlinkSync(file('pending', id));
      return out;
    },
    approved: () => read('approved'),
  };
}
