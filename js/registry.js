// js/registry.js — the approved plugins and what the probe knows about them (spec §3.2, §8.2): committed files plus runtime approvals, committed winning
import { join } from 'node:path';
import { loadCommitted, loadRuntime } from './data/load.js';

const BARE = { server: null, toolList: [], status: 'unknown', probedAt: null, latencyMs: null };

export function createRegistry({ root, dataDir, probe, allowLoopback = false, now = Date.now, log = () => {} }) {
  let committed = { plugins: [], shelves: {} };
  let entries = [];
  const derived = new Map(); // id → what the probe found

  function reload() {
    committed = loadCommitted(root, { allowLoopback });
    const runtime = loadRuntime(join(dataDir, 'approved'), { allowLoopback, log });
    const ids = new Set(committed.plugins.map(p => p.id));
    entries = [...committed.plugins, ...runtime.filter(p => !ids.has(p.id))];
    return entries;
  }

  const withDerived = p => ({ ...p, ...BARE, ...(derived.get(p.id) ?? {}) });

  // a pass keeps the tools; a failure keeps the last known tools and marks the line down (spec §3.4)
  function setProbe(id, result) {
    const prev = derived.get(id) ?? {};
    if (!result.ok) log(`probe ${id}: ${result.error}${result.detail ? ` · ${result.detail}` : ''}`);
    derived.set(id, result.ok
      ? { server: result.server, toolList: result.toolList, status: 'up', probedAt: now(), latencyMs: result.latencyMs, transport: result.transport, error: null }
      : { ...prev, status: 'down', probedAt: now(), error: result.error });
  }

  const setStatus = (id, status) => derived.set(id, { ...(derived.get(id) ?? {}), status });

  // every plugin at once: a cold start waits for the slowest probe, not the sum of them
  async function probeAll() {
    await Promise.all(entries.map(async p => setProbe(p.id, await probe(p.url, { allowLoopback }))));
  }

  // one plugin, now: for a call that finds its tools not known yet (mcp.js)
  async function probeOne(id) {
    const p = entries.find(x => x.id === id);
    if (!p) return null;
    const result = await probe(p.url, { allowLoopback });
    setProbe(id, result);
    return result;
  }

  return {
    reload, setProbe, setStatus, probeAll, probeOne,
    list: () => entries.map(withDerived),
    byId: id => { const p = entries.find(x => x.id === id); return p ? withDerived(p) : null; },
    has: id => entries.some(p => p.id === id),
    shelves: () => committed.shelves,
  };
}
