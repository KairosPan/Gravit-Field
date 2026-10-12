// js/render/submit.js — the submission form (spec §5.5): labels and controls only; after a submit, the card as it will look and what the probe found
import { esc, attrs } from '../html.js';
import { KINDS } from '../data/manifest.js';
import { ICONS } from '../icons.js';
import { card } from './discover.js';

const field = (label, body) => `<div class="field"><span class="field-label">${esc(label)}</span>${body}</div>`;
const input = (name, value, extra = {}) => `<input${attrs({ class: 'input', id: `f-${name}`, name, value: value ?? '', ...extra })}>`;
const kindSeg = kind => `<div class="radio-seg">${KINDS.map(k => `<label class="radio-item"><input type="radio"${attrs({ name: 'kind', value: k, checked: k === kind })}><span>${esc(k)}</span></label>`).join('')}</div>`;

function form(v, err) {
  const errLine = (...fields) => fields.map(f => (err?.field === f ? `<div class="field-error">${esc(err.rule)}</div>` : '')).join('');
  const initial = String(v.name ?? '').trim().slice(0, 1).toUpperCase() || 'Initial';
  return `<form class="submit-form" method="post" action="/submit">` +
    field('Name', input('name', v.name, { maxlength: 40, required: true })) + errLine('name', 'id') +
    field('One line', input('blurb', v.blurb, { maxlength: 90, required: true })) + errLine('blurb') +
    field('Kind', kindSeg(KINDS.includes(v.kind) ? v.kind : 'Data')) + errLine('kind') +
    field('MCP address', input('url', v.url, { type: 'url', placeholder: 'https://', required: true })) + errLine('url') +
    field('Homepage', input('homepage', v.homepage, { type: 'url', placeholder: 'https://' })) + errLine('homepage') +
    field('Your handle', input('by', v.by, { maxlength: 41, placeholder: '@' })) + errLine('by') +
    field('Icon', `<select class="input" id="f-icon" name="icon"><option value="">${esc(initial)}</option>${Object.keys(ICONS).map(k => `<option${attrs({ value: k, selected: k === v.icon })}>${esc(k)}</option>`).join('')}</select>`) + errLine('icon') +
    field('What you can ask it', `<textarea class="input" id="f-asks" name="asks" rows="4" maxlength="500">${esc(v.asks ?? '')}</textarea>`) + errLine('asks') +
    errLine('manifest', 'needs', 'writes', 'tools') +
    `<div class="btn-row"><button type="submit" class="btn-primary">Submit</button></div></form>`;
}

function after(result) {
  const probe = result.probe;
  const entry = { ...result.record.manifest, pending: true, status: probe.ok ? 'up' : 'down', toolList: probe.ok ? probe.toolList : [] };
  const found = probe.ok
    ? `<div class="dsec"><div class="dsec-label">Tools found</div>${probe.toolList.map(t => `<div class="dsec-line"><span class="mono">${esc(t.name)}</span>${t.description ? ` <span class="dim">${esc(t.description)}</span>` : ''}</div>`).join('')}</div>`
    : `<div class="dsec"><div class="dsec-label">Probe</div><div class="dsec-line"><span class="chip down">down</span> <span class="dim">${esc(probe.error ?? '')}</span></div></div>`;
  return `<section class="submitted"><div class="grid-title">In review</div><div class="grid">${card(entry, { installed: [], drawer: null }, { view: 'grid' })}</div>${found}</section>`;
}

export function renderSubmit({ values = {}, result = null } = {}) {
  const body = result?.ok ? after(result) : form(values, result && !result.ok ? result.error : null);
  return `<main class="main disc submit"><div class="disc-head"><a class="back-link" href="/">‹ Gravity Field</a><h1 class="head-title">Submit a plugin</h1></div>${body}</main>`;
}
