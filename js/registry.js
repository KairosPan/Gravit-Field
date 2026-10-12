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

  // a probe a call asked for (mcp.js): one per plugin at a time, shared by every caller that asks meanwhile, and at most
  // once a minute, counted from the moment it starts; through the probe it is given (the doors' gate), else the registry's own
  const ON_DEMAND_EVERY = 60_000;
  const running = new Map(); // id → the probe in flight
  const attempted = new Map(); // id → when the last on-demand probe started
  function probeOnDemand(id, probeFn = probe) {
    const p = entries.find(x => x.id === id);
    if (!p) return Promise.resolve(null);
    if (running.has(id)) return running.get(id);
    if (now() - (attempted.get(id) ?? -Infinity) < ON_DEMAND_EVERY) return Promise.resolve(null);
    attempted.set(id, now());
    const job = (async () => {
      try {
        const result = await probeFn(p.url, { allowLoopback });
        // a full gate is the site's state, not the plugin's: record nothing and leave the minute unspent
        if (result?.busy) attempted.delete(id);
        else setProbe(id, result);
        return result;
      } finally {
        running.delete(id);
      }
    })();
    running.set(id, job);
    return job;
  }

  // one plugin, now, with the registry's own probe
  async function probeOne(id) {
    const p = entries.find(x => x.id === id);
    if (!p) return null;
    const result = await probe(p.url, { allowLoopback });
    setProbe(id, result);
    return result;
  }

  return {
    reload, setProbe, setStatus, probeAll, probeOne, probeOnDemand,
    list: () => entries.map(withDerived),
    byId: id => { const p = entries.find(x => x.id === id); return p ? withDerived(p) : null; },
    has: id => entries.some(p => p.id === id),
    shelves: () => committed.shelves,
  };
}
