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

// the queue holds at most maxPending submissions, so the review page and every catalogue stay small, and at most
// maxPerSource from one source (a salted digest of the client, serve.js), so one crowd cannot fill it alone
export const MAX_PENDING = 200;
export const MAX_PER_SOURCE = 3;

export function createSubmissions({ dataDir, now = Date.now, log = () => {}, maxPending = MAX_PENDING, maxPerSource = MAX_PER_SOURCE }) {
  const dirs = { pending: join(dataDir, 'submissions'), approved: join(dataDir, 'approved'), rejected: join(dataDir, 'rejected') };
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  // pending records by file name: each file is parsed once; a listing reads the directory and parses only what is new
  const seen = new Map();
  function pending() {
    const names = new Set(readdirSync(dirs.pending).filter(f => f.endsWith('.json')));
    for (const name of seen.keys()) if (!names.has(name)) seen.delete(name);
    for (const name of names) {
      if (seen.has(name)) continue;
      try { seen.set(name, JSON.parse(readFileSync(join(dirs.pending, name), 'utf8'))); } catch (e) { log(`skipping ${join(dirs.pending, name)}: ${e.message}`); seen.set(name, null); }
    }
    return [...seen.values()].filter(Boolean);
  }

  // the id has passed the manifest rule before it is ever a file name; anything else is refused here too
  const file = (kind, id) => {
    if (!ID.test(id)) throw new Error('invalid id');
    return join(dirs[kind], id + '.json');
  };
  const read = kind => readdirSync(dirs[kind]).filter(f => f.endsWith('.json')).sort().map(f => {
    try { return JSON.parse(readFileSync(join(dirs[kind], f), 'utf8')); } catch (e) { log(`skipping ${join(dirs[kind], f)}: ${e.message}`); return null; }
  }).filter(Boolean);
  // a pending file is created only if absent ('wx'), so a later submission can never overwrite an earlier one
  const write = (kind, id, rec, flag = 'w') => writeFileSync(file(kind, id), JSON.stringify(rec, null, 2) + '\n', { flag });
  // ids whose probe is running: held from the door's first check until the file exists or the door gives up
  const reserved = new Set();

  function get(id) {
    const f = file('pending', id);
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
  }

  return {
    dirs, get,
    list: () => pending().sort((a, b) => b.at - a.at),
    has: id => existsSync(file('pending', id)),
    reserve(id) {
      if (reserved.has(id) || existsSync(file('pending', id))) return false;
      reserved.add(id);
      return true;
    },
    release: id => { reserved.delete(id); },
    add({ manifest, probe, via, from = null }) {
      const queue = pending();
      if (from && queue.filter(r => r.from === from).length >= maxPerSource) throw Object.assign(new Error(`${maxPerSource} of your submissions are already in review`), { code: 'ESOURCE' });
      if (queue.length >= maxPending) throw Object.assign(new Error('the review queue is full'), { code: 'EFULL' });
      const rec = { manifest, probe, via, at: now(), ...(from ? { from } : {}) };
      write('pending', manifest.id, rec, 'wx');
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
