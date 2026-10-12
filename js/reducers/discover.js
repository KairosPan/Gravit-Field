// js/reducers/discover.js — the page's state and the pure reducers that move it (spec §5); the browser keeps theme, installed and client
import { CLIENTS } from '../data/clients.js';

export const SEED_VERSION = 1;
export const THEMES = ['system', 'cream', 'black'];
export const MAX_QUERY = 200;

export function initialState({ theme = 'system', installed = [], client = 'Claude Code', route = {} } = {}) {
  return {
    v: SEED_VERSION,
    theme: THEMES.includes(theme) ? theme : 'system',
    route: { shelf: route?.shelf ?? null, plugin: route?.plugin ?? null },
    query: '', installedOnly: false,
    drawer: route?.plugin ?? null, create: null, toast: null,
    installed: Array.isArray(installed) ? installed.filter(x => typeof x === 'string') : [],
    client: CLIENTS.includes(client) ? client : 'Claude Code',
    copied: null, toolsExpanded: false,
  };
}

// what the browser saves (spec §5.1): never a route, a query, a drawer or a toast
export const persist = s => ({ v: s.v, theme: s.theme, installed: s.installed, client: s.client });
export const accept = saved => !!saved && saved.v === SEED_VERSION;

export const reducers = {
  nav: (s, route = {}) => ({ ...s, route: { shelf: route.shelf ?? null, plugin: route.plugin ?? null }, drawer: route.plugin ?? null, create: null, toolsExpanded: false }),
  setQuery(s, q) {
    const query = String(q ?? '').slice(0, MAX_QUERY);
    return query === s.query ? s : { ...s, query };
  },
  toggleInstalledOnly: s => ({ ...s, installedOnly: !s.installedOnly }),
  openPlugin: (s, id) => (s.drawer === id ? s : { ...s, drawer: id, route: { ...s.route, plugin: id }, create: null, toolsExpanded: false }),
  closeDrawer: s => (s.drawer ? { ...s, drawer: null, route: { ...s.route, plugin: null } } : s),
  install: (s, { id, name }) => (s.installed.includes(id) ? s : { ...s, installed: [...s.installed, id], toast: { text: `${name} installed` } }),
  uninstall: (s, id) => (s.installed.includes(id) ? { ...s, installed: s.installed.filter(x => x !== id), toast: null } : s),
  dismissToast: s => (s.toast ? { ...s, toast: null } : s),
  // one overlay at a time: Create closes a drawer
  openCreate: s => ({ ...s, create: {}, drawer: null, route: { ...s.route, plugin: null } }),
  closeCreate: s => (s.create ? { ...s, create: null } : s),
  setClient: (s, c) => (CLIENTS.includes(c) && c !== s.client ? { ...s, client: c } : s),
  setCopied: (s, key) => ((key ?? null) === s.copied ? s : { ...s, copied: key ?? null }),
  setTheme: (s, t) => (THEMES.includes(t) && t !== s.theme ? { ...s, theme: t } : s),
  toggleTools: s => ({ ...s, toolsExpanded: !s.toolsExpanded }),
};
