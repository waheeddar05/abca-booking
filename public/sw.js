const CACHE_NAME = 'playorbit-v5';

// Only precache truly static/public assets (no auth-protected pages)
const PRECACHE_ASSETS = [
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/images/playorbit-logo.jpeg',
  '/manifest.json',
];

// Install: cache static assets only
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch: network-first for API & pages, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip auth-related requests
  if (url.pathname.startsWith('/api/auth')) return;

  // API calls: network-first with cache fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Static assets (icons, images, fonts, JS/CSS): cache-first
  if (url.pathname.startsWith('/icons/') ||
      url.pathname.startsWith('/images/') ||
      url.pathname.startsWith('/_next/static/') ||
      url.pathname === '/manifest.json') {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Pages: network-first (don't cache redirects or auth pages)
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Only cache successful, non-redirect responses
        if (response.ok && !response.redirected) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
