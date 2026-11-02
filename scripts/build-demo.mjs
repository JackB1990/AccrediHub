// Builds the clickable browser-only demo into ./demo from the real pages in ./public.
// Usage: node scripts/build-demo.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'public');
const out = path.join(root, 'demo');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const f of fs.readdirSync(src)) {
  let text = fs.readFileSync(path.join(src, f), 'utf8');
  if (/\.(html|js|css)$/.test(f)) {
    // "/page.html" -> "page.html" so the demo works from any folder or straight from disk
    text = text.replace(/(['"])\/([a-z0-9-]+\.html)/g, '$1$2');
    text = text.replace('href="/theme.css"', 'href="theme.css"');
    if (f.endsWith('.html')) {
      text = text.replace('<script src="/app.js"></script>', '<script src="mock-api.js"></script>\n<script src="app.js"></script>');
      if (!text.includes('mock-api.js')) text = text.replace('</head>', '<script src="mock-api.js"></script>\n</head>');
    }
  }
  fs.writeFileSync(path.join(out, f), text);
}
fs.copyFileSync(path.join(root, 'scripts', 'mock-api.js'), path.join(out, 'mock-api.js'));
fs.writeFileSync(path.join(out, 'README.txt'),
  'AccrediHub demo\n================\nOpen index.html in a browser (needs internet for fonts/Tailwind/Alpine).\nAll data is sample data stored in your browser only. Use the "Reset" link bottom-right to start over.\n');
console.log('Demo built in', out);
