// Service worker minimal. Sur Android, Chrome n autorise les notifications
// QUE via un service worker — d ou ce fichier, qui ne fait rien d autre.
const CACHE = 'eblouissement-v1';
const FICHIERS = ['./', 'index.html', 'manifest.json', 'icon.svg'];

// Tout le calcul est local une fois l'itinéraire chargé, mais sans cache
// l'appli refusait de s'ouvrir hors réseau. Chaque fichier est mis en cache
// séparément : un fichier absent ne doit pas faire échouer les autres.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.all(FICHIERS.map((f) => c.add(f).catch(() => {}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((noms) => Promise.all(noms.filter((x) => x !== CACHE).map((x) => caches.delete(x))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Nominatim et OSRM ne passent jamais par le cache.
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;

  // La page elle-même : réseau d'abord. Les seuils de T changent d'une
  // sortie à l'autre ; servir une version en cache ferait relever le terrain
  // avec des seuils qu'on croit modifiés.
  const estPage = req.mode === 'navigate' || url.pathname.endsWith('.html')
    || url.pathname.endsWith('/');
  if (estPage) {
    event.respondWith(fetch(req)
      .then((res) => {
        if (res.ok) { const copie = res.clone(); caches.open(CACHE).then((c) => c.put(req, copie)); }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html'))));
    return;
  }

  // Le reste — manifest, icône : cache d'abord.
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copie = res.clone(); caches.open(CACHE).then((c) => c.put(req, copie)); }
    return res;
  })));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => {
    for (const c of list) if ('focus' in c) return c.focus();
    if (self.clients.openWindow) return self.clients.openWindow('./');
  }));
});
