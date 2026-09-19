/* Service worker — cache de la coquille de l'app.
   Les données (relevés, photos) vivent dans IndexedDB, jamais ici. */

const CACHE = 'epure-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './vendor/jsqr.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Network-first sur la navigation pour récupérer les mises à jour dès qu'il y
   a du réseau, cache-first sur le reste pour démarrer instantanément. */
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  /* Stale-while-revalidate : on sert le cache tout de suite (démarrage
     instantané, et ça marche hors ligne), et on rafraîchit en arrière-plan.
     Surtout pas du cache-first pur — app.js et styles.css y resteraient figés
     pour toujours, et aucune correction ne parviendrait aux téléphones. */
  e.respondWith(
    caches.match(request).then((hit) => {
      const reseau = fetch(request).then((res) => {
        if (res.ok && new URL(request.url).origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || reseau;
    })
  );
});
