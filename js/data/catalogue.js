// js/data/catalogue.js — the catalogue view the server and the browser build the same way (spec §3.3): shelves, search, lookups; pure
export const SHELVES = [
  { id: 'featured', title: 'Featured' },
  { id: 'data', title: 'Data', kind: 'Data' },
  { id: 'monitors', title: 'Monitors', kind: 'Monitors' },
  { id: 'bots', title: 'Bots', kind: 'Bots' },
  { id: 'crypto', title: 'Crypto', kind: 'Crypto' },
  { id: 'quant', title: 'Quant', kind: 'Quant' },
];
export const EMPTY_SHELVES = { featured: [], Data: [], Monitors: [], Bots: [], Crypto: [], Quant: [] };
export const MAX_QUERY = 200;

export function makeCatalogue({ plugins = [], pending = [], shelves = EMPTY_SHELVES, calls = {}, origin = '', now = 0 } = {}) {
  const sh = { ...EMPTY_SHELVES, ...shelves };
  const all = [...pending.map(p => ({ ...p, pending: true })), ...plugins.map(p => ({ ...p, pending: false }))]
    .map(p => ({ ...p, calls: calls[p.id] ?? 0 }));
  const byId = id => all.find(p => p.id === id) ?? null;
  const byName = (a, b) => a.name.localeCompare(b.name);

  // a kind's shelf: pending submissions first, newest first; then the listed ids in their order; then the rest by name
  function ofKind(kind) {
    const listed = (sh[kind] ?? []).map(byId).filter(p => p && !p.pending && p.kind === kind);
    const rest = all.filter(p => p.kind === kind && !p.pending && !listed.includes(p)).sort(byName);
    const pend = all.filter(p => p.kind === kind && p.pending).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    return [...pend, ...listed, ...rest];
  }
  const featured = () => (sh.featured ?? []).map(byId).filter(p => p && !p.pending);
  const withIds = s => ({ ...s, ids: (s.kind ? ofKind(s.kind) : featured()).map(p => p.id) });

  function search(q) {
    const s = String(q ?? '').trim().toLowerCase().slice(0, MAX_QUERY);
    if (!s) return [];
    return all.filter(p => [p.name, p.blurb, p.kind, p.by, ...(p.tools ?? []), ...(p.toolList ?? []).map(t => t.name)].join(' ').toLowerCase().includes(s));
  }

  return {
    all, byId, search, origin, now,
    shelves: () => SHELVES.map(withIds).filter(s => s.ids.length),
    shelf: id => { const s = SHELVES.find(x => x.id === id); return s ? withIds(s) : null; },
    toJSON: () => ({ plugins, pending, shelves: sh, calls, origin, now }),
  };
}
