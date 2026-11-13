/* Ludo Supreme v2 — service worker offline-first.
   Caminhos relativos: funciona em raiz de domínio e em /repo-name/. */
const CACHE_NAME = 'ludo-v2.0.2-wood3d';

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/theme.css',
  './css/layout.css',
  './js/main.js',
  './js/game-engine.js',
  './js/scene3d/WorldManager.js',
  './js/scene3d/BoardBuilder.js',
  './js/scene3d/PawnManager.js',
  './js/scene3d/Dice3D.js',
  './js/scene3d/WoodTextures.js',
  './js/scene3d/GridMapper.js',
  './vendor/three.module.min.js',
  './vendor/tailwind.js',
  './vendor/confetti.min.js',
  './vendor/fontawesome/all.min.css',
  './vendor/fontawesome/webfonts/fa-solid-900.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin && !req.url.startsWith('blob:')) {
    // Recursos externos (PeerJS/QR já vendorados) passam direto.
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
    })
  );
});
