const VERSION = 'koszyki-v1';

const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/format.js',
  './js/calc.js',
  './js/db.js',
  './js/ui/util.js',
  './js/ui/toast.js',
  './js/ui/backup.js',
  './js/ui/occ.js',
  './js/ui/home.js',
  './js/ui/basket.js',
  './js/ui/sheet.js',
  './js/ui/history.js',
  './js/ui/month.js',
  './js/ui/settings.js',
  './js/ui/welcome.js',
  './js/ui/receipt.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // brak jednego pliku nie może przerwać instalacji
    await Promise.allSettled(ASSETS.map((url) => cache.add(url)));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      // no-cache: rewalidacja z serwerem, żeby poprawki nie czekały 10 min na cache GitHub Pages
      const response = await fetch(request, { cache: 'no-cache' });
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    } catch (err) {
      const cached = await cache.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return Response.error();
    }
  })());
});
