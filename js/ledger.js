// js/ledger.js — one line per plugin_call and no caller (spec §7): an append-only JSONL file, and counts kept as calls arrive,
// so a page reads them without rescanning; memory holds the totals and only the last hour's lines
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

export const ROTATE_BYTES = 10 * 1024 * 1024;
const HOUR = 3_600_000;

export function createLedger({ file = null, rotateBytes = ROTATE_BYTES, now = Date.now } = {}) {
  let total = 0;
  const plugins = new Map(); // id → { total, tools: Map(tool → n) }
  const window = []; // { at, plugin } within the last hour, oldest first

  function count(line) {
    total++;
    const p = plugins.get(line.plugin) ?? { total: 0, tools: new Map() };
    p.total++;
    p.tools.set(line.tool, (p.tools.get(line.tool) ?? 0) + 1);
    plugins.set(line.plugin, p);
    window.push({ at: line.at, plugin: line.plugin });
  }
  function prune() {
    const since = now() - HOUR;
    let drop = 0;
    while (drop < window.length && window[drop].at < since) drop++;
    if (drop) window.splice(0, drop);
  }

  if (file) {
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file)) {
      for (const l of readFileSync(file, 'utf8').split('\n')) {
        if (!l.trim()) continue;
        try { count(JSON.parse(l)); } catch { /* a torn last line after a crash: skipped */ }
      }
      window.sort((a, b) => a.at - b.at);
      prune();
    }
  }

  function rotate(at) {
    const base = file.replace(/\.jsonl$/, '');
    const stamp = new Date(at).toISOString().slice(0, 10);
    const target = existsSync(`${base}.${stamp}.jsonl`) ? `${base}.${stamp}-${at}.jsonl` : `${base}.${stamp}.jsonl`;
    renameSync(file, target);
  }

  function record({ plugin, tool, ok, ms }) {
    const line = { at: now(), plugin, tool, ok: !!ok, ms: Math.max(0, Math.round(ms ?? 0)) };
    count(line);
    prune();
    if (file) {
      if (existsSync(file) && statSync(file).size >= rotateBytes) rotate(line.at);
      appendFileSync(file, JSON.stringify(line) + '\n');
    }
    return line;
  }

  function counts() {
    prune();
    const hour = new Map();
    for (const w of window) hour.set(w.plugin, (hour.get(w.plugin) ?? 0) + 1);
    const out = { total, lastHour: window.length, plugins: {} };
    for (const [id, p] of plugins) out.plugins[id] = { total: p.total, lastHour: hour.get(id) ?? 0, tools: Object.fromEntries(p.tools) };
    return out;
  }

  return {
    record, counts,
    perPlugin: () => Object.fromEntries([...plugins].map(([id, p]) => [id, p.total])),
    forPlugin: id => plugins.get(id)?.total ?? 0,
    size: () => total,
    windowSize: () => { prune(); return window.length; },
  };
}
