// js/data/load.js — Node only: the committed catalogue under plugins/ and the files approved at runtime (spec §3.3, §8.2)
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateManifest } from './manifest.js';
import { EMPTY_SHELVES } from './catalogue.js';

// a committed file must be valid and named after its id: the test suite keeps it so, and a bad one stops the boot
export function loadCommitted(root, { allowLoopback = false } = {}) {
  const dir = join(root, 'plugins');
  const plugins = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'shelves.json').sort()) {
    const json = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const v = validateManifest(json, { allowLoopback });
    if (!v.ok) throw new Error(`plugins/${f}: ${v.error.field}: ${v.error.rule}`);
    if (v.manifest.id !== f.slice(0, -5)) throw new Error(`plugins/${f}: id ${v.manifest.id} does not match the file name`);
    plugins.push(v.manifest);
  }
  let shelves = { ...EMPTY_SHELVES };
  try { shelves = { ...EMPTY_SHELVES, ...JSON.parse(readFileSync(join(dir, 'shelves.json'), 'utf8')) }; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return { plugins, shelves };
}

// a runtime dir holds { manifest, probe, ... } records the admin page wrote, or bare manifests; a bad one is skipped, never fatal
export function loadRuntime(dir, { allowLoopback = false, log = () => {} } = {}) {
  mkdirSync(dir, { recursive: true });
  const out = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    const file = join(dir, f);
    try {
      const json = JSON.parse(readFileSync(file, 'utf8'));
      const v = validateManifest(json?.manifest ?? json, { allowLoopback });
      if (!v.ok) throw new Error(`${v.error.field}: ${v.error.rule}`);
      out.push(v.manifest);
    } catch (e) {
      log(`skipping ${file}: ${e.message}`);
    }
  }
  return out;
}
