// Bible Study service worker: offline app shell for the leader app and the group page. Bump VERSION on every deploy.
const VERSION = 'v1.2.0';
const CACHE = 'biblestudy-' + VERSION;
const SHELL = ['./', './index.html', './group/', './group/index.html', './css/app.css', './manifest.webmanifest', './js/app.js', './js/rotation.js', './js/store.js', './js/sync.js', './js/group.js', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname.endsWith('workers.dev')) return; // sync API is never cached
  if (url.origin !== location.origin) {
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(cc => cc.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
    return;
  }
  // the group page carries its key in ?k=, so match pages without the query string
  const shell = url.pathname.includes('/group/') ? './group/index.html' : './index.html';
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(cc => cc.put(url.origin + url.pathname, c)); } return r; })
    .catch(() => caches.match(url.origin + url.pathname).then(m => m || (e.request.mode === 'navigate' ? caches.match(shell) : undefined))));
});