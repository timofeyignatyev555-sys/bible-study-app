// Packages the members' page for Cloudflare Pages (friday-bible-study.pages.dev), so the link carries no personal name.
// Usage: node tools/build-group.mjs && npx wrangler pages deploy dist-group --project-name friday-bible-study --branch main
import { mkdirSync, rmSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
const root = new URL('..', import.meta.url);
const out = new URL('dist-group/', root);
rmSync(out, { recursive: true, force: true });
for (const d of ['', 'css', 'js', 'icons']) mkdirSync(new URL(d, out), { recursive: true });
writeFileSync(new URL('index.html', out), readFileSync(new URL('group/index.html', root), 'utf8').replaceAll('../', './'));
for (const f of ['css/app.css', 'js/group.js', 'js/calgrid.js']) copyFileSync(new URL(f, root), new URL(f, out));
for (const f of readdirSync(new URL('icons/', root))) copyFileSync(new URL('icons/' + f, root), new URL('icons/' + f, out));
writeFileSync(new URL('_headers', out), '/*\n  X-Robots-Tag: noindex\n  Referrer-Policy: no-referrer\n  Cache-Control: no-cache\n');
console.log('built dist-group/');
