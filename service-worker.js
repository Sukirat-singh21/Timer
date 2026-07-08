const CACHE = 'jee-pomodoro-flow-v21-menu-colors';
const ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'firebase.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE ? caches.delete(k) : null))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(resp => {
        if (!resp || resp.status !== 200 || resp.type !== 'basic') return resp;
        const copy = resp.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
        return resp;
      }).catch(() => {
        if (event.request.mode === 'navigate') return caches.match('index.html');
        return caches.match(event.request);
      });
    })
  );
});
