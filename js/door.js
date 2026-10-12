// js/door.js — the two doors share one validator and one probe (spec §8.1): submit a manifest, approve or reject a submission
import { validateManifest } from './data/manifest.js';

// from is the source's digest (serve.js sourceOf): the probe runs under its share and the queue holds its count
export async function submitManifest(services, input, via, { from = null } = {}) {
  const { registry, submissions, probe, options } = services;
  const v = validateManifest(input, { allowLoopback: options.allowLoopback });
  if (!v.ok) return { ok: false, error: v.error };
  const m = v.manifest;
  const approved = { ok: false, error: { field: 'id', rule: 'an approved plugin already has this id' } };
  const taken = { ok: false, error: { field: 'id', rule: 'a pending submission already has this id' } };
  if (registry.has(m.id)) return approved;
  // the id is held while the probe runs, so a second submission of it is refused instead of racing the first
  if (!submissions.reserve(m.id)) return taken;
  try {
    // a failed probe is stored with its error: the operator may know the server; it cannot be approved until one passes
    // the raw detail of a failure stays out of what the submitter reads and what is stored
    const { detail, ...result } = await probe(m.url, { from });
    if (registry.has(m.id)) return approved; // approved while this probe ran
    const missing = result.ok ? m.tools.filter(t => !result.toolList.some(x => x.name === t)) : [];
    let record;
    try {
      record = submissions.add({ manifest: m, probe: { ...result, missing }, via, from });
    } catch (e) {
      if (e.code === 'EFULL' || e.code === 'ESOURCE') return { ok: false, error: { field: 'manifest', rule: e.message } };
      if (e.code === 'EEXIST') return taken;
      throw e;
    }
    return { ok: true, id: m.id, status: 'review', probe: record.probe, record };
  } finally {
    submissions.release(m.id);
  }
}

// the acceptance check (spec §8.2): probe again, every claimed tool listed; then the file moves and the registry reloads
export async function approveSubmission(services, id) {
  const { registry, submissions, probe } = services;
  const rec = submissions.get(id);
  if (!rec) return { ok: false, error: 'no such submission' };
  const { detail, ...result } = await probe(rec.manifest.url);
  if (!result.ok) return { ok: false, error: `the probe failed: ${result.error}` };
  const missing = rec.manifest.tools.filter(t => !result.toolList.some(x => x.name === t));
  if (missing.length) return { ok: false, error: `the server does not list: ${missing.join(', ')}` };
  // rejected while this probe ran: nothing to approve
  const record = submissions.approve(id, { probe: { ...result, missing: [] } });
  if (!record) return { ok: false, error: 'no such submission' };
  registry.reload();
  registry.setProbe(id, result);
  return { ok: true, record };
}

export function rejectSubmission(services, id, reason = '') {
  const record = services.submissions.reject(id, String(reason).slice(0, 200));
  return record ? { ok: true, record } : { ok: false, error: 'no such submission' };
}

// the form's fields as a manifest (spec §5.5): the id is the name's slug; tools come from the probe, so none are claimed
export function manifestFromForm(fields) {
  const get = k => String((typeof fields.get === 'function' ? fields.get(k) : fields[k]) ?? '').trim();
  const name = get('name');
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '').slice(0, 41);
  const asks = get('asks').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 4);
  return { id, name, kind: get('kind'), blurb: get('blurb'), url: get('url'), homepage: get('homepage') || null, by: get('by'), icon: get('icon') || null, needs: 'none', writes: ['message'], asks, tools: [] };
}
