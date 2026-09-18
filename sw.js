// Service worker minimal. Sur Android, Chrome n autorise les notifications
// QUE via un service worker — d ou ce fichier, qui ne fait rien d autre.
//
// Changer VERSION à chaque déploiement dont on veut être sûr qu'il chasse
// l'ancien cache. La page elle-même reste en « réseau d'abord » : un
// utilisateur en ligne reçoit toujours la dernière version.
// Le nom du cache porte une version, et `activate` supprime tout ce qui ne
// s'appelle pas exactement comme lui. Sans cela, aucun ancien cache n'était
// jamais supprimé : un index.html périmé pouvait revenir hors ligne avec
// d'anciens seuils T, et les relevés de terrain porteraient sur autre chose
// que ce qu'on croit avoir déployé.
const VERSION = 'v8';
const CACHE = `radius-${VERSION}`;
/* index.html ne se suffit plus à lui-même : son script est un module qui
   importe radius-core.mjs. Sans lui au cache, l'application ne démarre pas hors
   ligne — et pire, la requête du module retombait sur index.html, donc sur du
   HTML servi comme du JavaScript. */
const FICHIERS = ['./', 'index.html', 'radius-core.mjs', 'radius-garde.mjs',
                  'manifest.json', 'icon.svg', 'journey.html', 'journey-core.mjs'];

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
  // Nominatim et /api/route ne passent jamais par le cache : le premier est
  // d'une autre origine, le second est un POST.
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  // Les endpoints ne passent jamais par le cache, quelle que soit la méthode :
  // une altitude ou une météo servie depuis le cache serait un relevé faux.
  if (url.pathname.startsWith('/api/')) return;

  // La page elle-même : réseau d'abord. Les seuils de T changent d'une
  // sortie à l'autre ; servir une version en cache ferait relever le terrain
  // avec des seuils qu'on croit modifiés.
  // Les modules .mjs suivent la même règle que les pages. journey-core.mjs
  // porte la position solaire : servi depuis le cache sous une page fraîche,
  // il ferait relever le terrain avec un moteur qu'on croit remplacé — le
  // défaut même que la version du cache existe pour empêcher.
  const estPage = req.mode === 'navigate' || url.pathname.endsWith('.html')
    || url.pathname.endsWith('.mjs') || url.pathname.endsWith('/');
  if (estPage) {
    event.respondWith(fetch(req)
      .then((res) => {
        if (res.ok) { const copie = res.clone(); caches.open(CACHE).then((c) => c.put(req, copie)); }
        return res;
      })
      // Le repli sur index.html ne vaut que pour une NAVIGATION. Le servir pour
      // un .mjs absent rendrait du HTML là où le navigateur attend un module :
      // l'erreur porterait alors sur une syntaxe, pas sur le fichier manquant.
      .catch(() => caches.match(req).then((hit) => hit
        || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
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
