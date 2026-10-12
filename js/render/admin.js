// js/render/admin.js — the review queue (spec §5.6): each submission as a card and a table with Approve and Reject; the runtime approvals; the ledger
import { esc } from '../html.js';
import { ago } from '../time.js';
import { card, kv } from './discover.js';

const STATE = { installed: [], drawer: null };

function review({ rec, entry }, now) {
  const m = rec.manifest;
  const probe = rec.probe ?? {};
  const missing = probe.missing ?? [];
  const rows = [
    ['Id', `<span class="mono">${esc(m.id)}</span>`],
    ['Kind', esc(m.kind)],
    ['Server', `<span class="mono">${esc(m.url)}</span>`],
    ['By', esc(m.by)],
    ['Homepage', m.homepage ? `<a class="link" href="${esc(m.homepage)}" target="_blank" rel="noopener">${esc(m.homepage)}</a>` : '—'],
    ['Via', esc(rec.via)],
    ['Submitted', esc(ago(rec.at, now))],
    ['Probe', probe.ok ? `<span class="chip up">up</span> ${esc(`${probe.server?.name ?? ''} ${probe.server?.version ?? ''}`.trim())} · ${Number(probe.latencyMs) || 0} ms` : `<span class="chip down">down</span> <span class="dim">${esc(probe.error ?? '')}</span>`],
    ['Tools found', probe.ok ? `<span class="mono">${probe.toolList.map(t => esc(t.name)).join(' · ')}</span>` : '—'],
    ['Claimed', m.tools.length ? `<span class="mono">${m.tools.map(t => (missing.includes(t) ? `<span class="down">${esc(t)}</span>` : esc(t))).join(' · ')}</span>` : 'every listed tool'],
  ];
  return `<section class="review"><div class="grid">${card(entry, STATE, { view: 'grid' })}</div>${kv(rows)}` +
    `<div class="btn-row"><form method="post" action="/api/admin/${esc(m.id)}/approve"><button type="submit" class="btn-primary small">Approve</button></form>` +
    `<form method="post" action="/api/admin/${esc(m.id)}/reject" class="reject"><input class="input small" name="reason" aria-label="Reason" placeholder="Reason"><button type="submit" class="btn-danger">Reject</button></form></div></section>`;
}

export function renderAdmin({ pending = [], approved = [], approvedDir = 'approved', counts = { total: 0, lastHour: 0, plugins: {} }, now = Date.now(), error = null } = {}) {
  const list = pending.length ? pending.map(p => review(p, now)).join('') : '<div class="empty">Nothing in review</div>';
  const runtime = approved.length ? `<div class="grid-title">Approved here</div>${kv(approved.map(r => [r.manifest.id, `<span class="mono">${esc(`${approvedDir}/${r.manifest.id}.json`)}</span>`]))}` : '';
  const ledger = kv([['Calls', String(counts.total)], ['Last hour', String(counts.lastHour)], ...Object.entries(counts.plugins).map(([id, c]) => [id, String(c.total)])]);
  return `<main class="main disc admin"><div class="disc-head"><a class="back-link" href="/">‹ Gravity Field</a><h1 class="head-title">Admin</h1></div>` +
    (error ? `<div class="field-error">${esc(error)}</div>` : '') +
    `<div class="grid-title">In review</div>${list}${runtime}<div class="grid-title">Ledger</div>${ledger}</main>`;
}
