// js/data/manifest.js — the plugin manifest (spec §3.1): the schema, the rules in words, one validator for every door
import { z } from 'zod';
import { ICONS } from '../icons.js';

export const KINDS = ['Data', 'Monitors', 'Bots', 'Crypto', 'Quant'];
export const WRITES = ['message', 'proposal'];
export const NEEDS = ['none'];
export const ID = /^[a-z][a-z0-9-]{1,40}$/;
const BY = /^@?[A-Za-z0-9_.-]{1,40}$/;
const TOOL = /^[A-Za-z0-9_.-]{1,64}$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

// the rule each field answers to, in the words the form and shop_publish show back
export const RULES = {
  manifest: 'an object',
  id: 'lowercase letters, digits and hyphens, 2 to 41 characters, starting with a letter',
  name: '1 to 40 characters',
  kind: `one of ${KINDS.join(' · ')}`,
  blurb: '1 to 90 characters, no trailing period',
  url: 'an https URL with no credentials',
  homepage: 'an https URL, or empty',
  by: 'a handle: letters, digits, _ . -, up to 40 characters',
  icon: 'the name of an icon, or empty',
  needs: 'none — v1 lists plugins that need nothing from the user',
  writes: `a subset of ${WRITES.join(', ')}`,
  asks: 'up to four questions of up to 120 characters',
  tools: 'tool names of letters, digits, _ . -, up to 64 characters, no repeats, at most 64',
};

// https, no credentials; http only to loopback and only when the caller allows it (tests, a local upstream)
export function urlOk(v, { allowLoopback = false } = {}) {
  let u;
  try { u = new URL(v); } catch { return false; }
  if (u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  return allowLoopback && u.protocol === 'http:' && LOOPBACK.has(u.hostname);
}

const str = max => z.string().min(1).max(max);

function schema({ allowLoopback }) {
  return z.object({
    id: z.string().regex(ID),
    name: str(40),
    kind: z.enum(KINDS),
    blurb: str(90).refine(v => !/[.。]\s*$/.test(v)),
    url: z.string().refine(v => urlOk(v, { allowLoopback })),
    homepage: z.string().refine(v => urlOk(v)).nullable().optional(),
    by: z.string().regex(BY),
    icon: z.string().refine(v => v in ICONS).nullable().optional(),
    needs: z.enum(NEEDS).optional(),
    writes: z.array(z.enum(WRITES)).max(WRITES.length).optional(),
    asks: z.array(str(120)).max(4).optional(),
    tools: z.array(z.string().regex(TOOL)).max(64).refine(a => new Set(a).size === a.length).optional(),
  });
}

const TRIMMED = ['id', 'name', 'blurb', 'url', 'homepage', 'by', 'icon'];

export function validateManifest(input, { allowLoopback = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: { field: 'manifest', rule: RULES.manifest } };
  const raw = { ...input };
  for (const k of TRIMMED) if (typeof raw[k] === 'string') raw[k] = raw[k].trim();
  if (raw.homepage === '') raw.homepage = null;
  if (raw.icon === '') raw.icon = null;
  const parsed = schema({ allowLoopback }).safeParse(raw);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path?.[0] ?? 'manifest');
    return { ok: false, error: { field, rule: RULES[field] ?? RULES.manifest } };
  }
  const m = parsed.data;
  return {
    ok: true,
    manifest: {
      id: m.id, name: m.name, kind: m.kind, blurb: m.blurb, url: m.url, homepage: m.homepage ?? null,
      by: m.by.startsWith('@') ? m.by : '@' + m.by, icon: m.icon ?? null, needs: 'none',
      writes: m.writes ?? ['message'], asks: m.asks ?? [], tools: m.tools ?? [],
    },
  };
}
