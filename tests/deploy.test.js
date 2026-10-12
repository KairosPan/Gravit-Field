// tests/deploy.test.js — what the deployment uploads: .vercelignore must never drop a file the function or the browser loads
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });

test('.vercelignore keeps every runtime file: api, serve.js, js, css, plugins and the package files', () => {
  const runtime = git('ls-files', 'api', 'serve.js', 'js', 'css', 'plugins', 'package.json', 'package-lock.json', 'vercel.json').split('\n').filter(Boolean);
  assert.ok(runtime.includes('js/data/load.js') && runtime.includes('js/data/catalogue.js'), 'the nested data modules are in the list');
  let ignored = '';
  try {
    ignored = git('-c', 'core.excludesFile=.vercelignore', 'check-ignore', '--no-index', ...runtime);
  } catch (e) {
    ignored = e.stdout ?? ''; // check-ignore exits 1 when nothing is ignored
  }
  assert.deepEqual(ignored.split('\n').filter(Boolean), [], 'runtime files the upload would leave out');
});

test('.vercelignore still leaves out what the function does not need', () => {
  const out = git('-c', 'core.excludesFile=.vercelignore', 'check-ignore', '--no-index', 'tests/serve.test.js', 'docs/superpowers/plans/2026-10-11-gravity-field.md', 'data/ledger.jsonl', 'scripts/probe.js');
  assert.deepEqual(out.split('\n').filter(Boolean).sort(), ['data/ledger.jsonl', 'docs/superpowers/plans/2026-10-11-gravity-field.md', 'scripts/probe.js', 'tests/serve.test.js']);
});
