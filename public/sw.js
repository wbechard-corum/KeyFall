// Network-first for the HTML shell so deploys reach users immediately.
// Cache-first for hashed /assets/* since their URLs change every build.
const CACHE = 'keyfall-v0.7';
// Samples live in their own cache so a shell upgrade doesn't throw away a
// 6.6 MB download the user already paid for.
const SAMPLE_CACHE = 'keyfall-samples-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys
        .filter((k) => k !== CACHE && k !== SAMPLE_CACHE)
        .map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  // Never touch the songs API or the mirror socket. Caching these meant the
  // library list, uploaded .mid blobs and MusicXML conversions all piled up
  // in the cache, and a stale list could be served after the network came
  // back — including "pending" notation that had long since finished.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/mirror/')) return;

  // Piano samples: cache-first and never evicted with the shell. They're a
  // ~6.6 MB one-time download, and the whole point is that the sampled piano
  // keeps working offline once you've fetched it.
  if (url.pathname.startsWith('/samples/')) {
    event.respondWith(
      caches.open(SAMPLE_CACHE).then((c) =>
        c.match(event.request).then((hit) =>
          hit || fetch(event.request).then((resp) => {
            if (resp.ok) c.put(event.request, resp.clone());
            return resp;
          })
        )
      )
    );
    return;
  }

  // Hashed build artifacts: cache-first (immutable URLs).
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cached) =>
        cached ||
        fetch(event.request).then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put(event.request, copy));
          }
          return resp;
        })
      )
    );
    return;
  }

  // Everything else (HTML, manifest): network-first, fall back to cache offline.
  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});
