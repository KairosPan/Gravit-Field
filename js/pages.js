// js/pages.js — the server-rendered pages (spec §4): the shelves, a shelf as a grid, a plugin with its drawer open, the 404
import { parsePath } from './routes.js';
import { renderDiscover } from './render/discover.js';
import { renderDocument, renderNotFound } from './render/page.js';
import { initialState } from './reducers/discover.js';
import { sendHtml } from './http.js';

const notFoundPage = res => sendHtml(res, 404, renderDocument({ title: 'Not found · Gravity Field', body: renderNotFound(), script: null }));

export function createPages(services) {
  return async function pages({ req, res, path }) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    const route = parsePath(path);
    if (!route) { notFoundPage(res); return true; }
    if (route.page !== 'shelves') return false;
    const cat = services.catalogue(req);
    const p = route.plugin ? cat.byId(route.plugin) : null;
    if (route.plugin && !p) { notFoundPage(res); return true; }
    const title = p ? `${p.name} · Gravity Field` : route.shelf ? `${cat.shelf(route.shelf)?.title ?? 'Gravity Field'} · Gravity Field` : 'Gravity Field';
    sendHtml(res, 200, renderDocument({ title, body: renderDiscover(initialState({ route }), cat), data: cat.toJSON() }));
    return true;
  };
}
