// scripts/export.js — print the plugins approved at runtime, to move into plugins/ with a commit (spec §8.2): npm run export
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = process.env.GF_DATA_DIR || fileURLToPath(new URL('../data', import.meta.url));
const dir = join(dataDir, 'approved');
let files = [];
try { files = readdirSync(dir).filter(f => f.endsWith('.json')).sort(); } catch { files = []; }
if (!files.length) {
  console.log(`nothing approved at runtime under ${dir}`);
} else {
  for (const f of files) {
    const rec = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    console.log(`# plugins/${f}  (from ${join(dir, f)})`);
    console.log(JSON.stringify(rec.manifest ?? rec, null, 2));
    console.log();
  }
}
