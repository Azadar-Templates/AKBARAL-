const CACHE = 'private-mission-shell-v2';
// Shell and API URLs are relative to THIS script's location, never
// origin-rooted: the dashboard is served at origin root over direct loopback
// (/service-worker.js) but under the owner-only proxy prefix in production
// (/mission-gateway/service-worker.js). Root-absolute entries would precache
// from the public app root through the proxy (and fail the atomic install),
// and a hardcoded '/api/' bypass would let authenticated mission API
// responses be cached under the prefix. Relative resolution keeps both
// serving modes correct with no code fork.
const SHELL = ['./', './styles.css', './app.js', './manifest.webmanifest'];
const API_ROOT = new URL('./api/', self.location.href).pathname;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key.startsWith('private-mission-shell-')).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Never cache authenticated or potentially private API responses. POST,
  // PUT, PATCH and DELETE are never intercepted either.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith(API_ROOT)) return;
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});
