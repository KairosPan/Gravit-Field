// js/routes.js — the paths the site answers (spec §4): /, /discover/<shelf>, /p/<id>, /submit, /admin; pure, shared with the browser
export const SHELF_IDS = ['featured', 'data', 'monitors', 'bots', 'crypto', 'quant'];
const ID = /^[a-z][a-z0-9-]{1,40}$/;

export function parsePath(pathname) {
  const parts = String(pathname ?? '').split('/').filter(Boolean);
  if (parts.length === 0) return { page: 'shelves', shelf: null, plugin: null };
  if (parts[0] === 'discover' && parts.length === 2 && SHELF_IDS.includes(parts[1])) return { page: 'shelves', shelf: parts[1], plugin: null };
  if (parts[0] === 'p' && parts.length === 2 && ID.test(parts[1])) return { page: 'shelves', shelf: null, plugin: parts[1] };
  if (parts.length === 1 && parts[0] === 'submit') return { page: 'submit', shelf: null, plugin: null };
  if (parts.length === 1 && parts[0] === 'admin') return { page: 'admin', shelf: null, plugin: null };
  return null;
}

export function toPath(route) {
  if (route.plugin) return `/p/${route.plugin}`;
  if (route.shelf) return `/discover/${route.shelf}`;
  return '/';
}
