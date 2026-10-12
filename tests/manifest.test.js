// tests/manifest.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, urlOk, KINDS, RULES } from '../js/data/manifest.js';

const good = {
  id: 'secedgar', name: ' SEC EDGAR ', kind: 'Data', blurb: 'Filings and financials, by ticker or CIK',
  url: 'https://secedgar.caseyjhand.com/mcp', homepage: 'https://github.com/cyanheads/secedgar-mcp-server', by: 'cyanheads',
  icon: 'fileCheck', needs: 'none', writes: ['message'], asks: ['“What did NVIDIA file last quarter?”'], tools: ['secedgar_company_search'],
};
const bad = (patch, field) => {
  const r = validateManifest({ ...good, ...patch });
  assert.equal(r.ok, false, JSON.stringify(patch));
  assert.equal(r.error.field, field, JSON.stringify(patch));
  assert.equal(r.error.rule, RULES[field]);
};

test('a valid manifest comes back normalised: trimmed, by with @, defaults filled', () => {
  const r = validateManifest({ ...good, homepage: '', icon: '', writes: undefined, asks: undefined, tools: undefined, needs: undefined });
  assert.equal(r.ok, true);
  assert.deepEqual(r.manifest, {
    id: 'secedgar', name: 'SEC EDGAR', kind: 'Data', blurb: 'Filings and financials, by ticker or CIK',
    url: 'https://secedgar.caseyjhand.com/mcp', homepage: null, by: '@cyanheads', icon: null, needs: 'none', writes: ['message'], asks: [], tools: [],
  });
  assert.equal(validateManifest(good).manifest.by, '@cyanheads');
  assert.equal(validateManifest({ ...good, by: '@cyanheads' }).manifest.by, '@cyanheads');
  assert.deepEqual(KINDS, ['Data', 'Monitors', 'Bots', 'Crypto', 'Quant']);
});

test('each rule once, naming its field', () => {
  bad({ id: 'SecEdgar' }, 'id');
  bad({ id: 'a' }, 'id');
  bad({ id: '../etc' }, 'id');
  bad({ id: 'a'.repeat(42) }, 'id');
  bad({ name: 'x'.repeat(41) }, 'name');
  bad({ name: '' }, 'name');
  bad({ kind: 'Tools' }, 'kind');
  bad({ blurb: 'Ends with a period.' }, 'blurb');
  bad({ blurb: 'x'.repeat(91) }, 'blurb');
  bad({ blurb: '' }, 'blurb');
  bad({ url: 'http://secedgar.caseyjhand.com/mcp' }, 'url');
  bad({ url: 'https://user:pw@host.example/mcp' }, 'url');
  bad({ url: 'not a url' }, 'url');
  bad({ homepage: 'http://example.com' }, 'homepage');
  bad({ by: 'a b' }, 'by');
  bad({ icon: 'unicorn' }, 'icon');
  bad({ needs: 'exchange key' }, 'needs');
  bad({ writes: ['orders'] }, 'writes');
  bad({ asks: ['a', 'b', 'c', 'd', 'e'] }, 'asks');
  bad({ tools: ['a', 'a'] }, 'tools');
  bad({ tools: ['has space'] }, 'tools');
});

test('a loopback http URL passes only when allowLoopback is set; anything that is not an object is refused as a whole', () => {
  assert.equal(validateManifest({ ...good, url: 'http://127.0.0.1:4999/mcp' }).ok, false);
  assert.equal(validateManifest({ ...good, url: 'http://127.0.0.1:4999/mcp' }, { allowLoopback: true }).ok, true);
  assert.equal(validateManifest({ ...good, url: 'http://localhost:4999/mcp' }, { allowLoopback: true }).ok, true);
  assert.equal(validateManifest({ ...good, url: 'http://10.0.0.8/mcp' }, { allowLoopback: true }).ok, false, 'allowLoopback is loopback only');
  assert.deepEqual(validateManifest(null), { ok: false, error: { field: 'manifest', rule: 'an object' } });
  assert.deepEqual(validateManifest('x'), { ok: false, error: { field: 'manifest', rule: 'an object' } });
  assert.equal(urlOk('https://a.example/mcp'), true);
  assert.equal(urlOk('https://a.example/mcp?x=1'), true);
  assert.equal(urlOk('ftp://a.example/mcp'), false);
});
