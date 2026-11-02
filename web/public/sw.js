// Minimal offline cache: app shell + TMDB posters. Bump VERSION to force refresh.
const VERSION = 'recco-v2'
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(['./', './manifest.webmanifest'])))
  self.skipWaiting()
})
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))))
  self.clients.claim()
})
self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.hostname === 'api.themoviedb.org') return // always live
  if (req.mode === 'navigate') {
    // share-target and ?add= hits must reach the page with their query string
    // always ask the network first so a new deploy shows up on the next open
    e.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(VERSION).then((c) => c.put('./', copy))
          }
          return res
        })
        .catch(() => caches.match('./')),
    )
    return
  }
  if (url.origin === location.origin || url.hostname === 'image.tmdb.org') {
    e.respondWith(
      caches.open(VERSION).then(async (c) => {
        const hit = await c.match(req)
        const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res }).catch(() => hit)
        return hit || net
      }),
    )
  }
})
