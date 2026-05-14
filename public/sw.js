/*
  Zion — Service Worker.
  Cloned from Splendor; cache name bumped to zion-v1.
  Bump the integer on every deploy so Tiff's mobile browser drops
  the old shell and pulls the new one.
*/

const CACHE_NAME = 'zion-v1';
const urlsToCache = [
  '/manifest.json',
  '/icons/zion-icon.svg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (!req.url.startsWith(self.location.origin)) return;

  const isNavigation =
    req.mode === 'navigate' ||
    (req.method === 'GET' && (req.headers.get('accept') || '').includes('text/html'));

  if (isNavigation) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('/manifest.json')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys()
        .then((cacheNames) => Promise.all(cacheNames.map((n) => caches.delete(n))))
        .then(() => {
          if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ success: true, message: 'Cache cleared' });
          }
        })
    );
  }
});
