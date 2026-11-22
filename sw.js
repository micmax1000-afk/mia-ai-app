/* Mia AI — service worker della versione web (non usato nell'app Android).
 * Rete prima, cache come ripiego: se sei online vedi sempre la versione più recente;
 * se la rete manca, l'app si apre comunque (le chiamate ai modelli restano ovviamente online). */
'use strict';

const CACHE = 'mia-web-v1';
const CORE = [
  './', 'index.html', 'manifest.webmanifest', 'icons/icon.svg',
  'css/app.css', 'css/app-fix.css',
  'js/markdown.js', 'js/providers.js', 'js/files.js', 'js/mcp.js', 'js/tools.js', 'js/docs.js', 'js/sync.js',
  'js/github.js', 'js/github-ui.js', 'js/app.js', 'js/app-fix.js', 'js/pwa.js'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  // un file mancante non deve far fallire l'installazione
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(CORE.map((u) => c.add(u)))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // solo i file dell'app: mai le API
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});
