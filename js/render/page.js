// js/render/page.js — the document around a screen (spec §4, §5.1): fonts, tokens, the theme before the first paint, the catalogue as JSON, the client script
import { esc } from '../html.js';

export const THEME_KEY = 'gravity-field.theme';
export const FONTS = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Noto+Sans+SC:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap';

// JSON that can sit inside <script>: no '<' (so no closing tag), and no raw line terminators
export function safeJson(v) {
  return JSON.stringify(v ?? null).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function renderDocument({ title = 'Gravity Field', body = '', data = null, script = '/js/client.js', lang = 'en' } = {}) {
  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="/css/tokens.css">
<link rel="stylesheet" href="/css/app.css">
<script>
  // the theme before the first paint: the saved choice, else the system's own
  try { const t = localStorage.getItem('${THEME_KEY}'); if (t === 'cream' || t === 'black') document.documentElement.dataset.theme = t; } catch {}
</script>
</head>
<body>
<div id="app" class="app">${body}</div>
${data ? `<script type="application/json" id="catalogue">${safeJson(data)}</script>` : ''}${script ? `\n<script type="module" src="${esc(script)}"></script>` : ''}
</body>
</html>
`;
}

export function renderNotFound() {
  return '<main class="main disc"><div class="disc-head"><h1 class="head-title">Gravity Field</h1></div><section class="grid-sec"><a class="back-link" href="/">‹ Gravity Field</a><div class="grid-title">Not found</div></section></main>';
}
