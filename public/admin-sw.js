const CACHE_NAME = 'prague-ai-voice-admin-5.1.0';
const SHELL_URLS = [
  '/admin-app',
  '/admin.webmanifest',
  '/assets/favicon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request, { cache: 'no-store' })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('/admin-app'))),
  );
});
