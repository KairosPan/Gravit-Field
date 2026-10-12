// js/render/avatars.js — the rounded-square logos of the cards (44 px) and the drawer (56 px): a glyph, or the name's first letter
import { esc } from '../html.js';
import { icon } from '../icons.js';

export function mark(spec, size, radius, name) {
  const box = `width:${size}px;height:${size}px;border-radius:${radius}`;
  if (spec.type === 'glyph') return `<span class="av av-glyph" role="img" aria-label="${esc(name)}" style="${box}">${icon(spec.icon, Math.round(size / 2), 2)}</span>`;
  return `<span class="av av-letter tone-${spec.tone ?? 'grey'}" role="img" aria-label="${esc(name)}" style="${box};font-size:${Math.round(size * 0.42)}px">${esc(spec.text)}</span>`;
}

// the manifest validator has already vouched for the icon name, so icon() cannot throw here
export function logo(entry, size = 44) {
  const letter = String(entry.name ?? '').trim().slice(0, 1).toUpperCase() || '?';
  const spec = entry.icon ? { type: 'glyph', icon: entry.icon } : { type: 'letter', text: letter };
  return mark(spec, size, '10px', entry.name);
}
