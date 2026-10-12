// js/ledger.js — one line per plugin_call and no caller (spec §7): an append-only JSONL file and the counts the pages read
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

export const ROTATE_BYTES = 10 * 1024 * 1024;
const HOUR = 3_600_000;

export function createLedger({ file = null, rotateBytes = ROTATE_BYTES, now = Date.now } = {}) {
  const lines = [];
  if (file) {
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file)) {
      for (const l of readFileSync(file, 'utf8').split('\n')) {
        if (!l.trim()) continue;
        try { lines.push(JSON.parse(l)); } catch { /* a torn last line after a crash: skipped */ }
      }
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
    lines.push(line);
    if (file) {
      if (existsSync(file) && statSync(file).size >= rotateBytes) rotate(line.at);
      appendFileSync(file, JSON.stringify(line) + '\n');
    }
    return line;
  }

  function counts() {
    const since = now() - HOUR;
    const out = { total: lines.length, lastHour: 0, plugins: {} };
    for (const l of lines) {
      const p = (out.plugins[l.plugin] ??= { total: 0, lastHour: 0, tools: {} });
      p.total++;
      p.tools[l.tool] = (p.tools[l.tool] ?? 0) + 1;
      if (l.at >= since) { p.lastHour++; out.lastHour++; }
    }
    return out;
  }

  return {
    record, counts,
    perPlugin: () => Object.fromEntries(Object.entries(counts().plugins).map(([id, c]) => [id, c.total])),
    forPlugin: id => lines.reduce((n, l) => n + (l.plugin === id ? 1 : 0), 0),
    size: () => lines.length,
  };
}
