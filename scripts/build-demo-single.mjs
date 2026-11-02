// Builds ONE self-contained file: demo/AccrediHub-demo.html (all pages + sample backend inline).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const read = (p) => fs.readFileSync(p, 'utf8');

const rewrite = (t) => t
  .replace(/(['"])\/([a-z0-9-]+\.html)/g, '$1$2')
  .replace(/location\.href = /g, 'TR.href = ')
  .replace(/location\.search/g, 'TR.search')
  .replace(/history\.replaceState\(null, '', 'playlist-builder\.html\?id=' \+/g, "history.replaceState(null, '', '#/playlist-builder.html?id=' +")
  .replace(/const PIE_COLORS/g, 'var PIE_COLORS');

const pages = {};
for (const name of ['index', 'artists', 'artist', 'calendar', 'pr-agents', 'pr-agent', 'playlist', 'playlists', 'playlist-builder', 'profile']) {
  const html = read(path.join(pub, name + '.html'));
  const title = (html.match(/<title>(.*?)<\/title>/s) || [, 'AccrediHub'])[1];
  const style = (html.match(/<head>[\s\S]*?<style>([\s\S]*?)<\/style>/) || [, ''])[1];
  const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
  const scripts = [...body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  const markup = body.replace(/<script[\s\S]*?<\/script>/g, '');
  pages[name] = { title, style, markup: rewrite(markup), script: rewrite(scripts) };
}

const css = read(path.join(pub, 'theme.css'));
const logoUri = 'data:image/png;base64,' + fs.readFileSync(path.join(pub, 'logo.png')).toString('base64');
const appJs = rewrite(read(path.join(pub, 'app.js'))).replace(/\/logo\.png/g, logoUri);
const mock = read(path.join(root, 'scripts', 'mock-api.js'));
const safe = (s) => s.replace(/<\/(script)/gi, '<\\/$1');

const router = `
window.TR = {
  PAGES: ${safe(JSON.stringify(pages))},
  get search() { const h = location.hash.replace(/^#\\/?/, ''); const i = h.indexOf('?'); return i < 0 ? '' : h.slice(i); },
  set href(v) { TR.go(v); },
  go(h) { const t = '#/' + String(h).replace(/^\\//, ''); if (location.hash === t) TR.render(); else location.hash = t; },
  render() {
    const h = location.hash.replace(/^#\\/?/, '');
    let name = (h.split('?')[0] || 'index.html').replace(/\\.html$/, '');
    if (name === 'login' || name === 'tour-dates' && false) name = 'index';
    if (name === 'tour-dates') name = 'calendar';
    const p = TR.PAGES[name] || TR.PAGES.index;
    document.title = p.title;
    let st = document.getElementById('tr-page-style');
    if (!st) { st = document.createElement('style'); st.id = 'tr-page-style'; document.head.appendChild(st); }
    st.textContent = p.style;
    const s = document.createElement('script');
    s.textContent = p.script;
    document.head.appendChild(s); s.remove();
    document.getElementById('root').innerHTML = p.markup;
    window.scrollTo(0, 0);
  },
};
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a) return;
  const h = a.getAttribute('href');
  if (/^[a-z0-9-]+\\.html(\\?|$)/.test(h)) { e.preventDefault(); TR.go(h); }
});
window.addEventListener('hashchange', () => TR.render());
`;

const out = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AccrediHub (demo)</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Sora:wght@600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${css}</style>
<script src="https://cdn.tailwindcss.com"></script>
<script>${safe(mock)}</script>
<script>${safe(appJs)}</script>
<script>${safe(router)}</script>
<script src="https://unpkg.com/alpinejs@3.x.x/dist/cdn.min.js" defer></script>
</head>
<body>
<div id="root"></div>
<script>TR.render();</script>
</body>
</html>
`;
fs.mkdirSync(path.join(root, 'demo'), { recursive: true });
const dest = path.join(root, 'demo', 'AccrediHub-demo.html');
fs.writeFileSync(dest, out);
console.log('Wrote', dest, (out.length / 1024).toFixed(0) + ' KB');
