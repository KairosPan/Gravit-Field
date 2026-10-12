// js/submit.js — the form door (spec §5.5, §8.1): GET shows the form; POST validates, probes, stores, and shows the card in review
import { renderSubmit } from './render/submit.js';
import { renderDocument } from './render/page.js';
import { sendHtml, sendJson, readBody } from './http.js';
import { submitManifest, manifestFromForm } from './door.js';

export function createSubmitRoute(services) {
  return async function submit({ req, res, path, ip }) {
    if (path !== '/submit') return false;
    const page = (status, props) => sendHtml(res, status, renderDocument({ title: 'Submit · Gravity Field', body: renderSubmit(props), script: null }));
    if (req.method === 'GET' || req.method === 'HEAD') { page(200, {}); return true; }
    if (req.method !== 'POST') return false;
    const gate = services.limiters.submissions.take(ip);
    if (!gate.ok) { sendJson(res, 429, { error: 'rate limited' }, { 'retry-after': String(gate.retryAfterSec) }); return true; }
    let fields;
    try { fields = new URLSearchParams(await readBody(req)); } catch (e) { sendJson(res, e.status === 413 ? 413 : 400, { error: e.status === 413 ? 'body too large' : 'bad form' }); return true; }
    const result = await submitManifest(services, manifestFromForm(fields), 'form', { from: services.sourceOf(ip) });
    page(result.ok ? 200 : 400, { values: Object.fromEntries(fields), result });
    return true;
  };
}
