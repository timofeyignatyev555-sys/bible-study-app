// Packages the leader app for Cloudflare Pages (bible-admin.pages.dev). It has its own address so an iPhone fetches the
// "Bible Admin" name and gold icon fresh when the app is added to the Home Screen, and the URL carries no personal name.
// Usage: node tools/build-admin.mjs && npx wrangler pages deploy dist-admin --project-name bible-admin --branch main
// Redeploy after any change to index.html, manifest, sw.js, css or js (the github.io copy updates on git push by itself).
import { mkdirSync, rmSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
const root = new URL('..', import.meta.url);
const out = new URL('dist-admin/', root);
rmSync(out, { recursive: true, force: true });
for (const d of ['', 'css', 'js', 'icons']) mkdirSync(new URL(d, out), { recursive: true });
const files = ['index.html', 'manifest.webmanifest', 'sw.js', 'css/app.css', ...['app', 'rotation', 'store', 'sync', 'calgrid'].map(n => `js/${n}.js`)];
for (const f of files) copyFileSync(new URL(f, root), new URL(f, out));
for (const f of readdirSync(new URL('icons/', root)).filter(f => f.startsWith('admin-'))) copyFileSync(new URL('icons/' + f, root), new URL('icons/' + f, out));
writeFileSync(new URL('_headers', out), '/*\n  X-Robots-Tag: noindex\n  Referrer-Policy: no-referrer\n  Cache-Control: no-cache\n');
console.log('built dist-admin/ (' + (files.length + 1) + ' files + icons)');
