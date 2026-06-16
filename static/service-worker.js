// ============================================================
// Tactical Cross - Service Worker (PWA cache strategy)
// ============================================================
// This is a minimal shell. Replace with a full Workbox strategy
// (e.g. via @vite-pwa/sveltekit) for production use.

const CACHE_NAME = 'tactical-cross-v1';

// Assets to pre-cache on install
const PRECACHE_ASSETS = [
  '/',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Install: pre-cache critical shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

// Activate: purge old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch: Network-first for navigation, cache-first for assets
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Handle dynamic caching for backend logic file (gameLogic.js)
  if (request.url.includes('/public/gameLogic.js')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        try {
          // Network-first approach for logic to ensure latest version
          const networkResponse = await fetch(request);
          if (networkResponse.ok) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch (err) {
          // Offline fallback
          const cachedResponse = await cache.match(request);
          if (cachedResponse) return cachedResponse;
          throw err;
        }
      })
    );
    return;
  }

  // Navigation requests → network first, fallback to cached '/'
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/'))
    );
    return;
  }

  // Static assets → cache first, network fallback
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
