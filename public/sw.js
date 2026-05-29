/* Engelmann Voice Agent – Service Worker
 * Goal: make the installed PWA launch instantly and stay usable offline for the
 * app shell, WITHOUT ever caching realtime / API / auth traffic (LiveKit token,
 * dispatch, debug logs, reverse geocode, uploads). Realtime media runs over
 * WebSocket/WebRTC which the SW never intercepts.
 */
const VERSION = 'v1';
const SHELL_CACHE = `shell-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;

// Static app shell that is safe to precache.
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/js/boot.js',
  '/js/capabilities.js',
  '/js/permissions.js',
  '/js/ui.js',
  '/js/pwa.js',
  '/js/location.js',
  '/js/media.js',
];

// Never go through the cache for these – always hit the network.
const NETWORK_ONLY = [
  '/livekit-token',
  '/livekit-config',
  '/debug-log',
  '/debug-logs',
  '/healthz',
  '/api/',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Best-effort: a single missing file must not abort the whole install.
      Promise.allSettled(SHELL.map((url) => cache.add(url))),
    ).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

function isNetworkOnly(url) {
  return NETWORK_ONLY.some((p) => url.pathname === p || url.pathname.startsWith(p));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never cache POST/PUT etc.

  let url;
  try { url = new URL(request.url); } catch { return; }

  if (isNetworkOnly(url)) return; // let the network handle it

  // App navigations: network-first, fall back to cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('/', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/').then((r) => r || caches.match(request))),
    );
    return;
  }

  // Static assets (same-origin + CDN): stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
