const CACHE = 'jee-pomodoro-flow-v23-auto-update';
const ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'firebase.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  // Deliberately no self.skipWaiting() here. The new worker installs and
  // waits — it does NOT swap the running app's code out from under an
  // open session. It only takes over once the page explicitly asks it to
  // (see the 'message' handler below), driven by the update prompt in
  // index.html. This is what makes a controlled, PWA-friendly update
  // possible instead of a silent/forced one.
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE ? caches.delete(k) : null))).then(() => self.clients.claim()));
});

// Lets the page force this waiting worker to activate immediately, right
// after the user taps the in-app "update available" prompt.
self.addEventListener('message', event => {
  const isSkip = event.data === 'SKIP_WAITING' || (event.data && event.data.type === 'SKIP_WAITING');
  if (isSkip) self.skipWaiting();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  // Page navigations: network-first. A fresh deploy must be visible on the
  // very next load, not masked by a stale cached index.html. Cache is only
  // used as an offline fallback.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(resp => {
          if (resp && resp.status === 200) {
            const copy = resp.clone();
            caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
          }
          return resp;
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match('index.html')))
    );
    return;
  }

  // Everything else (JS/CSS/icons): stale-while-revalidate. Serve the
  // cached copy instantly for speed, but always fetch a fresh copy in the
  // background and update the cache — so the *next* load already has the
  // new code.
  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request).then(resp => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const copy = resp.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});
