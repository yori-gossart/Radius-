/* Tests des trois fonctions serveur, avec `fetch` mocké.
   ------------------------------------------------------------------
   L'audit du 4 septembre 2026 a relevé que api/elevation.js et api/weather.js
   n'avaient AUCUN test, et api/route.js un seul cas nominal : toutes les
   branches d'erreur écrites avec soin — REQUEST_DENIED en HTTP 200, contrôle
   d'unités, tailles incohérentes — n'étaient jamais exécutées.

   Aucune API réelle n'est appelée : `fetch` global est remplacé pour chaque cas.

       node test-api.mjs
*/
process.env.GOOGLE_MAPS_API_KEY = 'cle-de-test';

let ok = 0, ko = 0; const echecs = [];
function chk(nom, condition, detail = '') {
  if (condition) { ok++; console.log(`  PASS  ${nom}${detail ? ' — ' + detail : ''}`); }
  else { ko++; echecs.push(nom); console.log(`  ÉCHEC ${nom}${detail ? ' — ' + detail : ''}`); }
}

/** Remplace fetch le temps d'un appel, et renvoie {status, corps, vuParFetch}. */
async function appeler(module, corpsRequete, reponseAmont, { methode = 'POST', entetes } = {}) {
  const vuParFetch = [];
  const vrai = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    vuParFetch.push({ url: String(url), init });
    if (reponseAmont instanceof Error) throw reponseAmont;
    return reponseAmont;
  };
  try {
    const req = new Request('https://radius.test' + module.chemin, {
      method: methode,
      // Exactement ce qu'un navigateur envoie pour un fetch same-origin :
      // si le durcissement d'origine cassait l'application, ce banc le verrait.
      headers: {
        'content-type': 'application/json',
        host: 'radius.test',
        origin: 'https://radius.test',
        ...(entetes || {}),
      },
      body: methode === 'POST' ? JSON.stringify(corpsRequete) : undefined,
    });
    const rep = await module.handler.fetch(req);
    let corps = null;
    try { corps = await rep.json(); } catch {}
    return { status: rep.status, corps, vuParFetch, entetes: rep.headers };
  } finally { globalThis.fetch = vrai; }
}

const rep = (obj, status = 200) => new Response(JSON.stringify(obj),
  { status, headers: { 'content-type': 'application/json' } });
const repTexte = (t, status = 200) => new Response(t, { status });

const route = { chemin: '/api/route', handler: (await import('./api/route.js')).default };
const elevation = { chemin: '/api/elevation', handler: (await import('./api/elevation.js')).default };
const weather = { chemin: '/api/weather', handler: (await import('./api/weather.js')).default };

const A = { lat: -20.88, lng: 55.45 }, B = { lat: -20.94, lng: 55.58 };
const demain = Date.now() + 86400000;

/* ══════════════ /api/route ══════════════ */
console.log('\n== api/route.js ==');
{
  const google = { routes: [{
    distanceMeters: 1000, duration: '120s', staticDuration: '100s',
    polyline: { geoJsonLinestring: { type: 'LineString', coordinates: [[55.45, -20.88], [55.46, -20.87]] } },
    legs: [{ steps: [{ distanceMeters: 1000, staticDuration: '100s',
      polyline: { geoJsonLinestring: { type: 'LineString', coordinates: [[55.45, -20.88], [55.46, -20.87]] } } }] }],
  }] };
  const r = await appeler(route, { origin: A, destination: B, departureMs: demain }, rep(google));
  chk('route nominal — 200', r.status === 200);
  chk('route nominal — provider google-routes', r.corps.provider === 'google-routes');
  chk('route nominal — trafficFactor 1,2', Math.abs(r.corps.trafficFactor - 1.2) < 1e-9);
  chk('route nominal — géométrie et étapes',
    r.corps.geometry.length === 2 && r.corps.steps.length === 1);
  chk('route nominal — départ futur transmis à Google',
    r.corps.trafficBasis === 'REQUESTED_DEPARTURE' && !!r.corps.googleDepartureTime);
  const envoye = JSON.parse(r.vuParFetch[0].init.body);
  chk('route nominal — paramètres de la mission inchangés',
    envoye.travelMode === 'DRIVE' && envoye.routingPreference === 'TRAFFIC_AWARE_OPTIMAL'
    && envoye.trafficModel === 'BEST_GUESS' && envoye.polylineQuality === 'HIGH_QUALITY'
    && envoye.polylineEncoding === 'GEO_JSON_LINESTRING');
  chk('route nominal — la clé passe par l’en-tête, jamais dans l’URL',
    r.vuParFetch[0].init.headers['X-Goog-Api-Key'] === 'cle-de-test'
    && !r.vuParFetch[0].url.includes('cle-de-test'));
  chk('route nominal — réponse non mise en cache',
    /no-store/.test(r.entetes.get('cache-control')));
}
{
  const r = await appeler(route, {}, null, { methode: 'GET' });
  chk('route GET — 405', r.status === 405);
  chk('route GET — aucun appel Google', r.vuParFetch.length === 0);
}
{
  const r = await appeler(route, { origin: { lat: 200, lng: 0 }, destination: B }, rep({}));
  chk('route latitude hors bornes — 400', r.status === 400);
  chk('route latitude hors bornes — aucun appel Google', r.vuParFetch.length === 0);
}
/* JSON.stringify transforme NaN en null, et Number(null) vaut 0 : une
   coordonnée absente devenait donc l'équateur au lieu d'être refusée. Même
   piège avec '' , false et []. */
for (const [nom, valeur] of [['null', null], ['chaîne vide', ''], ['false', false],
                             ['tableau vide', []], ['objet', {}]]) {
  const r = await appeler(route, { origin: { lat: valeur, lng: 0 }, destination: B }, rep({}));
  chk(`route latitude ${nom} — refusée, pas convertie en 0`,
    r.status === 400 && r.vuParFetch.length === 0,
    `${r.status}, ${r.vuParFetch.length} appel(s)`);
}
for (const [nom, valeur] of [['null', null], ['chaîne vide', '']]) {
  const r = await appeler(elevation, { points: [[valeur, 55.45]] }, rep({}));
  chk(`elevation latitude ${nom} — refusée`, r.status === 400 && r.vuParFetch.length === 0);
  const w = await appeler(weather, { observations: [{ lat: valeur, lng: 0, passageTimeMs: Date.now() }] }, rep({}));
  chk(`weather latitude ${nom} — refusée`, w.status === 400 && w.vuParFetch.length === 0);
}
{
  const r = await appeler(route, { origin: A, destination: B },
    rep({ error: { message: 'clé refusée', status: 'PERMISSION_DENIED' } }, 403));
  chk('route 4xx Google — statut relayé', r.status === 403, String(r.status));
  chk('route 4xx Google — message et code relayés',
    /clé refusée/.test(r.corps.error) && r.corps.code === 'PERMISSION_DENIED');
}
{
  const r = await appeler(route, { origin: A, destination: B }, rep({}, 503));
  chk('route 5xx Google — 503 relayé', r.status === 503);
}
{
  const r = await appeler(route, { origin: A, destination: B }, repTexte('pas du json'));
  chk('route réponse illisible — 502 GOOGLE_BAD_RESPONSE',
    r.status === 502 && r.corps.code === 'GOOGLE_BAD_RESPONSE');
}
{
  const r = await appeler(route, { origin: A, destination: B }, rep({ routes: [] }));
  chk('route zéro itinéraire — 404 NO_ROUTE',
    r.status === 404 && r.corps.code === 'NO_ROUTE', r.corps.error);
}
{
  const r = await appeler(route, { origin: A, destination: B },
    rep({ routes: [{ distanceMeters: 1000, duration: '120s', staticDuration: '100s' }] }));
  chk('route sans géométrie — 502 NO_GEOMETRY',
    r.status === 502 && r.corps.code === 'NO_GEOMETRY', r.corps.error);
}
{
  const r = await appeler(route, { origin: A, destination: B }, new Error('réseau coupé'));
  chk('route réseau injoignable — 502 GOOGLE_NETWORK_ERROR',
    r.status === 502 && r.corps.code === 'GOOGLE_NETWORK_ERROR');
}
{
  const google = { routes: [{ distanceMeters: 1000, duration: '120s',
    polyline: { geoJsonLinestring: { type: 'LineString', coordinates: [[55.45, -20.88], [55.46, -20.87]] } },
    legs: [] }] };
  const r = await appeler(route, { origin: A, destination: B }, rep(google));
  chk('route staticDuration absente — facteur ramené à 1, pas de division par zéro',
    r.status === 200 && r.corps.trafficFactor === 1, String(r.corps.trafficFactor));
}
{
  const google = { routes: [{ distanceMeters: 1000, duration: '120s', staticDuration: '100s',
    polyline: { geoJsonLinestring: { type: 'LineString', coordinates: [[55.45, -20.88], [999, 999], [55.46, -20.87]] } },
    legs: [] }] };
  const r = await appeler(route, { origin: A, destination: B }, rep(google));
  chk('route coordonnée aberrante — écartée de la géométrie',
    r.corps.geometry.length === 2, `${r.corps.geometry.length} point(s)`);
}
{
  const r = await appeler(route, { origin: A, destination: B, departureMs: Date.now() - 86400000 },
    rep({ routes: [{ distanceMeters: 1, duration: '1s', staticDuration: '1s',
      polyline: { geoJsonLinestring: { type: 'LineString', coordinates: [[55.45, -20.88], [55.46, -20.87]] } },
      legs: [] }] }));
  chk('route départ passé — bascule NOW et le DIT',
    r.corps.trafficBasis === 'NOW' && r.corps.googleDepartureTime === null,
    'le client refuse ce cas en amont depuis R-004, le serveur reste explicite');
}

/* ══════════════ /api/elevation ══════════════ */
console.log('\n== api/elevation.js ==');
{
  const r = await appeler(elevation, { points: [[-20.88, 55.45], [-20.87, 55.46]] },
    rep({ status: 'OK', results: [{ elevation: 120.5, resolution: 9.6 }, { elevation: 200, resolution: 9.6 }] }));
  chk('elevation nominal — 200 et provider', r.status === 200
    && r.corps.provider === 'google-elevation');
  chk('elevation nominal — altitude et résolution remontées',
    r.corps.elevations[0].elevationM === 120.5 && r.corps.elevations[0].resolutionM === 9.6);
  chk('elevation nominal — cinq décimales dans l’URL',
    /-20\.88000,55\.45000/.test(decodeURIComponent(r.vuParFetch[0].url)));
}
{
  const r = await appeler(elevation, { points: [] }, rep({}));
  chk('elevation liste vide — 400 sans appel', r.status === 400 && r.vuParFetch.length === 0);
}
{
  const r = await appeler(elevation, { points: Array.from({ length: 201 }, () => [0, 0]) }, rep({}));
  chk('elevation 201 points — 400 TROP_DE_POINTS',
    r.status === 400 && r.corps.code === 'TROP_DE_POINTS' && r.vuParFetch.length === 0);
}
{
  const r = await appeler(elevation, { points: [[-20.88, 55.45], [95, 0]] }, rep({}));
  chk('elevation coordonnée hors bornes — 400 sans appel',
    r.status === 400 && r.vuParFetch.length === 0);
}
{
  const r = await appeler(elevation, { points: [[-20.88, 55.45]] },
    rep({ status: 'REQUEST_DENIED', error_message: 'clé non autorisée' }));
  chk('elevation REQUEST_DENIED en HTTP 200 — traité comme une erreur',
    r.status === 403 && r.corps.code === 'REQUEST_DENIED', `${r.status} ${r.corps.code}`);
  chk('elevation REQUEST_DENIED — message de Google relayé',
    /clé non autorisée/.test(r.corps.error));
}
{
  const r = await appeler(elevation, { points: [[-20.88, 55.45], [-20.87, 55.46]] },
    rep({ status: 'OK', results: [{ elevation: 1, resolution: 1 }] }));
  chk('elevation compte incohérent — 502 TAILLE_INATTENDUE',
    r.status === 502 && r.corps.code === 'TAILLE_INATTENDUE', r.corps.error);
}
{
  const r = await appeler(elevation, { points: [[-20.88, 55.45]] }, repTexte('<html>'));
  chk('elevation réponse illisible — 502 GOOGLE_BAD_RESPONSE',
    r.status === 502 && r.corps.code === 'GOOGLE_BAD_RESPONSE');
}
{
  const r = await appeler(elevation, { points: [[-20.88, 55.45]] }, new Error('coupure'));
  chk('elevation réseau injoignable — 502 GOOGLE_NETWORK_ERROR',
    r.status === 502 && r.corps.code === 'GOOGLE_NETWORK_ERROR');
}
{
  const r = await appeler(elevation, { points: [[-20.88, 55.45]] }, null, { methode: 'GET' });
  chk('elevation GET — 405 sans appel', r.status === 405 && r.vuParFetch.length === 0);
}

/* ══════════════ /api/weather ══════════════ */
console.log('\n== api/weather.js ==');
const passage = Date.parse('2026-12-22T02:00:00Z');
const meteoOK = (unites = {}) => ({
  hourly: {
    time: ['2026-12-22T01:00', '2026-12-22T02:00', '2026-12-22T03:00'],
    direct_normal_irradiance_instant: [100, 640, 700],
    cloud_cover: [50, 12, 8], visibility: [10000, 24000, 30000],
    precipitation: [0, 0, 0.2], weather_code: [3, 1, 1],
  },
  hourly_units: {
    direct_normal_irradiance_instant: 'W/m²', cloud_cover: '%', visibility: 'm',
    precipitation: 'mm', weather_code: 'wmo code', ...unites,
  },
});
{
  const r = await appeler(weather, { observations: [{ lat: -20.88, lng: 55.45, passageTimeMs: passage }] },
    rep(meteoOK()));
  chk('weather nominal — 200 et attribution CC BY',
    r.status === 200 && /Open-Meteo/.test(r.corps.attribution));
  const z = r.corps.resultats[0];
  chk('weather nominal — échéance exacte retenue',
    z.status === 'ok' && z.instantValidTime === '2026-12-22T02:00' && z.deltaTimeMinutes === 0);
  chk('weather nominal — valeurs de la BONNE heure, pas d’une voisine',
    z.directNormalIrradiance === 640 && z.cloudCover === 12 && z.visibility === 24000);
  chk('weather nominal — heure de passage renvoyée pour rapprochement',
    z.passageTime === new Date(passage).toISOString());
  chk('weather nominal — unités reçues remontées telles quelles',
    z.unitesRecues.cloud_cover === '%');
}
{
  const r = await appeler(weather, { observations: [{ lat: -20.88, lng: 55.45, passageTimeMs: passage }] },
    rep(meteoOK({ visibility: 'km' })));
  const z = r.corps.resultats[0];
  chk('weather unité inattendue — variable annulée, pas convertie au hasard',
    z.visibility === null && z.status === 'partial', `status ${z.status}`);
  chk('weather unité inattendue — avertissement explicite',
    z.warnings.some((w) => /unité inattendue pour visibility/.test(w)), z.warnings[0]);
  chk('weather unité inattendue — les autres variables restent lues',
    z.cloudCover === 12 && z.directNormalIrradiance === 640);
}
{
  const brut = meteoOK(); delete brut.hourly_units.cloud_cover;
  const r = await appeler(weather, { observations: [{ lat: -20.88, lng: 55.45, passageTimeMs: passage }] }, rep(brut));
  chk('weather unité absente — variable annulée',
    r.corps.resultats[0].cloudCover === null
    && r.corps.resultats[0].warnings.some((w) => /unité absente pour cloud_cover/.test(w)));
}
{
  const brut = meteoOK(); brut.hourly.cloud_cover = [50, null, 8];
  const r = await appeler(weather, { observations: [{ lat: -20.88, lng: 55.45, passageTimeMs: passage }] }, rep(brut));
  chk('weather valeur nulle — annulée et signalée, jamais remplacée',
    r.corps.resultats[0].cloudCover === null
    && r.corps.resultats[0].warnings.some((w) => /valeur nulle pour cloud_cover/.test(w)));
}
{
  const brut = meteoOK(); brut.hourly.time = ['2026-12-25T02:00'];
  brut.hourly.direct_normal_irradiance_instant = [1]; brut.hourly.cloud_cover = [1];
  brut.hourly.visibility = [1]; brut.hourly.precipitation = [1]; brut.hourly.weather_code = [1];
  const r = await appeler(weather, { observations: [{ lat: -20.88, lng: 55.45, passageTimeMs: passage }] }, rep(brut));
  const z = r.corps.resultats[0];
  chk('weather échéance trop lointaine — statut inconnu, aucune valeur',
    z.status === 'unknown' && z.directNormalIrradiance === undefined,
    z.warnings[0]);
}
{
  const brut = meteoOK(); delete brut.hourly;
  const r = await appeler(weather, { observations: [{ lat: -20.88, lng: 55.45, passageTimeMs: passage }] }, rep(brut));
  chk('weather bloc horaire absent — statut inconnu',
    r.corps.resultats[0].status === 'unknown');
}
{
  const r = await appeler(weather,
    { observations: [{ lat: -20.88, lng: 55.45, passageTimeMs: passage },
                     { lat: -20.9, lng: 55.5, passageTimeMs: passage }] },
    rep(meteoOK()));                                   // un objet pour deux lieux
  chk('weather forme inattendue — refus explicite plutôt qu’alignement au hasard',
    r.status === 502 && r.corps.code === 'SHAPE_INATTENDUE', r.corps.error);
}
{
  const r = await appeler(weather,
    { observations: [{ lat: -20.88, lng: 55.45, passageTimeMs: passage },
                     { lat: -20.9, lng: 55.5, passageTimeMs: passage }] },
    rep([meteoOK(), meteoOK({ })]));
  chk('weather multi-lieux — un résultat par observation',
    r.status === 200 && r.corps.resultats.length === 2);
}
{
  const r = await appeler(weather,
    { observations: Array.from({ length: 7 }, () => ({ lat: 0, lng: 0, passageTimeMs: passage })) },
    rep([]));
  chk('weather sept zones — 400 TROP_DE_ZONES sans appel',
    r.status === 400 && r.corps.code === 'TROP_DE_ZONES' && r.vuParFetch.length === 0);
}
{
  const r = await appeler(weather, { observations: [{ lat: -20.88, lng: 55.45 }] }, rep({}));
  chk('weather heure de passage absente — 400 sans appel',
    r.status === 400 && r.vuParFetch.length === 0);
}
{
  const r = await appeler(weather, { observations: [{ lat: 95, lng: 0, passageTimeMs: passage }] }, rep({}));
  chk('weather coordonnée hors bornes — 400 sans appel',
    r.status === 400 && r.vuParFetch.length === 0);
}
{
  const r = await appeler(weather, { observations: [{ lat: 0, lng: 0, passageTimeMs: passage }] },
    new Error('coupure'));
  chk('weather réseau injoignable — 502 METEO_NETWORK_ERROR',
    r.status === 502 && r.corps.code === 'METEO_NETWORK_ERROR');
}
{
  const r = await appeler(weather, { observations: [{ lat: 0, lng: 0, passageTimeMs: passage }] },
    rep({ error: true, reason: 'paramètre inconnu' }, 400));
  chk('weather erreur Open-Meteo — motif relayé',
    r.status === 502 && /paramètre inconnu/.test(r.corps.error));
}
{
  const r = await appeler(weather, {}, null, { methode: 'GET' });
  chk('weather GET — 405 sans appel', r.status === 405 && r.vuParFetch.length === 0);
}

/* ══════════════ J-006 — friction sur l'appel des endpoints ══════════════
   Origin et Referer ne sont PAS une authentification : un client non navigateur
   les forge. Ces contrôles écartent l'appel depuis une autre page web ; la vraie
   protection reste le plafond de budget Google Cloud. */
console.log('\n== durcissement des entrées (J-006) ==');
const geomOK = { routes: [{ distanceMeters: 1000, duration: '120s', staticDuration: '100s',
  polyline: { geoJsonLinestring: { type: 'LineString', coordinates: [[55.45, -20.88], [55.46, -20.87]] } },
  legs: [] }] };
for (const mod of [['route', route, { origin: A, destination: B }],
                   ['elevation', elevation, { points: [[-20.88, 55.45]] }],
                   ['weather', weather, { observations: [{ lat: 0, lng: 0, passageTimeMs: passage }] }]]) {
  const [nom, m, corps] = mod;
  {
    const r = await appeler(m, corps, rep(geomOK), { entetes: { origin: 'https://ailleurs.example' } });
    chk(`${nom} — origine étrangère refusée`,
      r.status === 403 && r.corps.code === 'ORIGINE_ETRANGERE' && r.vuParFetch.length === 0,
      `${r.status}, ${r.vuParFetch.length} appel(s)`);
  }
  {
    const r = await appeler(m, corps, rep(geomOK), { entetes: { origin: '', referer: '' } });
    chk(`${nom} — appel sans origine ni referer refusé`,
      r.status === 403 && r.vuParFetch.length === 0, String(r.status));
  }
  {
    const r = await appeler(m, corps, rep(geomOK),
      { entetes: { origin: '', referer: 'https://radius.test/index.html' } });
    chk(`${nom} — un Referer same-origin suffit`, r.status !== 403, String(r.status));
  }
  {
    const r = await appeler(m, corps, rep(geomOK), { entetes: { 'content-type': 'text/plain' } });
    chk(`${nom} — Content-Type inattendu refusé`,
      r.status === 415 && r.vuParFetch.length === 0, String(r.status));
  }
  {
    const r = await appeler(m, corps, rep(geomOK), { entetes: { 'content-length': '99999999' } });
    chk(`${nom} — corps annoncé trop volumineux refusé`,
      r.status === 413 && r.vuParFetch.length === 0, String(r.status));
  }
}

console.log(`\n${ok} contrôle(s) PASS, ${ko} ÉCHEC.`);
if (ko) { console.log('Échecs : ' + echecs.join(' | ')); process.exit(1); }
