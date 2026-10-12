// js/render/discover.js — Discover's store as Gravity Field's one screen (spec §5): header, shelves, cards, the drawer, Create, toasts; pure
import { esc, attrs, cls } from '../html.js';
import { icon } from '../icons.js';
import { ago } from '../time.js';
import { logo } from './avatars.js';
import { CLIENTS, clientLines, TOOL_NAMES } from '../data/clients.js';

const WRITES_COPY = { message: 'Messages, into the conversation', proposal: 'Proposals: inside your limit it fills directly, beyond it a card' };
export const TOOLS_SHOWN = 12;

export const kv = rows => `<div class="kv-list">${rows.map(([k, v]) => `<div class="kv"><span class="kv-k">${esc(k)}</span><span class="kv-v">${v}</span></div>`).join('')}</div>`;
export const sec = (label, lines, html = false) => `<div class="dsec"><div class="dsec-label">${esc(label)}</div>${lines.map(l => `<div class="dsec-line">${html ? l : esc(l)}</div>`).join('')}</div>`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const host = url => { try { return new URL(url).host; } catch { return ''; } };

// the key: in review → a clock; installed → ✓ beside the trash key; else + (spec §5.2)
export function keyFor(p, state) {
  if (p.pending) return `<span class="pkey-wait" role="img" aria-label="In review">${icon('clock', 15, 2.1)}</span>`;
  if (!state.installed.includes(p.id)) return `<button type="button"${attrs({ class: 'pkey install', 'data-action': 'install', 'data-id': p.id, 'aria-label': `Install ${p.name}` })}>${icon('plus', 14, 2.4)}</button>`;
  return `<span class="pkeys"><span class="pkey-done" role="img" aria-label="Installed">${icon('check', 14, 2.4)}</span>` +
    `<button type="button"${attrs({ class: 'pkey uninstall', 'data-action': 'uninstall', 'data-id': p.id, 'aria-label': `Uninstall ${p.name}` })}>${icon('trash', 15, 2.1)}</button></span>`;
}

export function card(p, state, { view = 'shelf' } = {}) {
  return `<div${attrs({ class: cls('pcard', state.drawer === p.id && 'pressed', view === 'grid' && 'in-grid', p.status === 'down' && 'down'), 'data-action': 'openPlugin', 'data-id': p.id, role: 'button', tabindex: '0' })}>${logo(p, 44)}` +
    `<div class="pcard-body"><div class="pcard-name">${esc(p.name)}</div><div class="pcard-blurb">${esc(p.blurb)}</div></div>` +
    `<div class="pcard-side"><span class="pcard-kind">${esc(p.kind.toUpperCase())}</span>${keyFor(p, state)}</div></div>`;
}

function shelf(s, cat, state) {
  const cards = s.ids.map(id => cat.byId(id)).filter(Boolean).map(p => card(p, state)).join('');
  return `<section class="shelf"><div class="shelf-head"><div class="shelf-title">${esc(s.title)}</div><a class="link" data-nav href="/discover/${esc(s.id)}">See all ›</a></div><div class="shelf-row">${cards}</div></section>`;
}

function grid(title, plugins, state, back = false) {
  return `<section class="grid-sec">${back ? '<a class="back-link" data-nav href="/">‹ Gravity Field</a>' : ''}<div class="grid-title">${esc(title)}</div><div class="grid">${plugins.map(p => card(p, state, { view: 'grid' })).join('')}</div></section>`;
}

// Discover's header is the site header (spec §5.1): the name, the search pill, My plugins, Create, Submit, the theme key
export function header(state) {
  const on = state.installedOnly;
  const next = state.theme === 'black' ? 'cream' : 'black';
  return `<div class="disc-head"><h1 class="head-title">Gravity Field</h1>` +
    `<div class="search"><label for="dq" class="sr-only">Search plugins</label>${icon('search', 18, 2)}<input id="dq" type="search" autocomplete="off" placeholder="Search plugins" data-action="query"${attrs({ value: state.query })}></div><span class="spacer"></span>` +
    `<button type="button"${attrs({ class: cls('pill', on && 'pressed'), 'data-action': 'toggleInstalledOnly', 'aria-pressed': on ? 'true' : 'false' })}>My plugins</button>` +
    `<button type="button" class="pill" data-action="openCreate">${icon('plus', 14, 2.2)}Create</button>` +
    `<a class="pill" href="/submit">Submit</a>` +
    `<button type="button"${attrs({ class: 'theme-key', 'data-action': 'setTheme', 'data-value': next, 'aria-label': `Switch to ${next}` })}>${icon(state.theme === 'black' ? 'sun' : 'moon', 16, 2)}</button></div>`;
}

const copyKey = (key, text, state) => `<button type="button"${attrs({ class: 'btn-sm copy-key', 'data-action': 'copy', 'data-key': key, 'data-copy': text })}>${state.copied === key ? 'Copied' : 'Copy'}</button>`;
const snippet = (key, file, code, state) => `<div class="snippet">${file ? `<div class="snippet-file mono">${esc(file)}</div>` : ''}<pre class="snippet-code mono">${esc(code)}</pre>${copyKey(key, code, state)}</div>`;
const clientSeg = (name, state) => `<div class="radio-seg">${CLIENTS.map(n => `<label class="radio-item"><input type="radio"${attrs({ name, value: n, 'data-action': 'setClient', checked: n === state.client })}><span>${esc(n)}</span></label>`).join('')}</div>`;
const lineFor = (state, cat) => clientLines(cat.origin)[state.client] ?? clientLines(cat.origin)['Claude Code'];

// a tool's first required string argument: what an example call fills in (pages carry it as hint, the server has the schema)
export function hintOf(schema) {
  return Array.isArray(schema?.required) ? schema.required.find(k => schema.properties?.[k]?.type === 'string') ?? null : null;
}

// one example call: the first tool, and its first required string argument as a placeholder (spec §5.3)
export function exampleCall(p) {
  const tool = p.tools?.[0] ?? p.toolList?.[0]?.name;
  if (!tool) return null;
  const t = (p.toolList ?? []).find(x => x.name === tool);
  const arg = t?.hint ?? hintOf(t?.inputSchema);
  return `plugin_call("${p.id}", "${tool}", ${arg ? `{ "${arg}": "<${arg}>" }` : '{}'})`;
}

function useIt(p, state, cat) {
  const line = lineFor(state, cat);
  const ex = exampleCall(p);
  return `<div class="dsec"><div class="dsec-label">Use it</div>${clientSeg('client-use', state)}${snippet('line', line.file, line.code, state)}${ex ? snippet('example', null, ex, state) : ''}</div>`;
}

export function pluginDrawer(p, state, cat) {
  const installed = state.installed.includes(p.id);
  const n = p.toolList?.length ?? 0;
  const meta = p.pending ? `${p.kind} · In review` : [p.kind, plural(n, 'tool'), p.calls ? plural(p.calls, 'call') : null].filter(Boolean).join(' · ');
  // the manifest's tools first, then the rest of what the server lists; beyond TOOLS_SHOWN a line that unfolds
  const lead = p.tools?.length ? p.tools : (p.toolList ?? []).map(t => t.name);
  const ordered = [...lead.map(name => (p.toolList ?? []).find(t => t.name === name) ?? { name, description: '' }), ...(p.toolList ?? []).filter(t => !lead.includes(t.name))];
  const shown = state.toolsExpanded ? ordered : ordered.slice(0, TOOLS_SHOWN);
  const toolLines = shown.map(t => `<span class="mono">${esc(t.name)}</span>${t.description ? ` <span class="dim">${esc(t.description)}</span>` : ''}`);
  if (ordered.length > shown.length) toolLines.push(`<button type="button" class="link" data-action="toggleTools">${ordered.length - shown.length} more</button>`);
  const status = p.status === 'up' ? '<span class="chip up">up</span>' : p.status === 'down' ? '<span class="chip down">down</span>' : '<span class="chip grey">unchecked</span>';
  const source = kv([
    ['Server', `<span class="mono">${esc(host(p.url))}</span>`],
    ...(p.server?.name ? [['Version', esc(`${p.server.name} ${p.server.version ?? ''}`.trim())]] : []),
    ['By', esc(p.by)],
    ...(p.homepage ? [['Homepage', `<a class="link" href="${esc(p.homepage)}" target="_blank" rel="noopener">${esc(host(p.homepage))}</a>`]] : []),
    ['Checked', `${p.probedAt ? esc(ago(p.probedAt, cat.now)) + ' ' : ''}${status}`],
  ]);
  const foot = p.pending ? '' : `<div class="drawer-foot"><button type="button" class="btn-primary"${attrs({ 'data-action': installed ? 'uninstall' : 'install', 'data-id': p.id })}>${installed ? 'Uninstall' : 'Install'}</button></div>`;
  return `<aside class="drawer"${attrs({ 'aria-label': p.name })}><div class="drawer-head"><h2>${esc(p.name)}</h2><button type="button" class="close-key" data-action="closeDrawer" aria-label="Close">×</button></div><div class="drawer-body">` +
    `<div class="plug-id">${logo(p, 56)}<div><div class="plug-name">${esc(p.name)}</div><div class="dim">${esc(meta)}</div></div></div><p class="plug-blurb">${esc(p.blurb)}.</p>` +
    (p.asks?.length ? sec('What you can ask it', p.asks) : '') +
    (toolLines.length ? sec('Tools', toolLines, true) : '') +
    (p.writes?.length ? sec('What it writes', p.writes.map(w => WRITES_COPY[w] ?? w)) : '') +
    sec('What it needs from you', ['Nothing.']) +
    `<div class="dsec"><div class="dsec-label">Source</div>${source}</div>` +
    useIt(p, state, cat) + foot + '</div></aside>';
}

// Create: the Gravity Field MCP face — its address, its four tools, the line a client takes (spec §5.4); nothing to type
export function renderCreate(state, cat) {
  if (!state.create) return '';
  const line = lineFor(state, cat);
  return `<div class="modal-scrim"><div class="modal wide" role="dialog" aria-label="Gravity Field MCP"><div class="modal-head"><h2 class="modal-title">Gravity Field MCP</h2><button type="button" class="close-key" data-action="closeCreate" aria-label="Close">×</button></div><div class="modal-body">` +
    `<div class="field"><span class="field-label">Address</span><span class="mono">${esc(cat.origin)}/mcp</span></div>` +
    `<div class="field"><span class="field-label">Tools</span><div class="tool-chips">${TOOL_NAMES.map(t => `<span class="chip grey mono">${esc(t)}</span>`).join('')}</div></div>` +
    `<div class="field"><span class="field-label">Client</span>${clientSeg('client-create', state)}</div>` +
    snippet('create', line.file, line.code, state) + '</div></div></div>';
}

export function renderToast(t) {
  return `<div class="toast" role="status">${esc(t.text)}<button type="button" class="toast-x" data-action="dismissToast" aria-label="Dismiss">×</button></div>`;
}

export function renderDiscover(state, cat) {
  let body;
  if (state.query.trim()) {
    const found = cat.search(state.query);
    body = grid(plural(found.length, 'result'), found, state);
  } else if (state.installedOnly) {
    body = grid('Installed', cat.all.filter(p => !p.pending && state.installed.includes(p.id)), state);
  } else if (state.route.shelf) {
    const s = cat.shelf(state.route.shelf);
    body = grid(s?.title ?? 'Gravity Field', (s?.ids ?? []).map(id => cat.byId(id)).filter(Boolean), state, true);
  } else {
    body = cat.shelves().map(s => shelf(s, cat, state)).join('') || '<div class="empty">No plugins</div>';
  }
  const p = state.drawer ? cat.byId(state.drawer) : null;
  return `<main class="${cls('main', 'disc', p && 'with-drawer')}">${header(state)}${body}${p ? pluginDrawer(p, state, cat) : ''}${state.toast ? renderToast(state.toast) : ''}${renderCreate(state, cat)}</main>`;
}
