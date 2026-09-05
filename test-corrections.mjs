/* Banc des corrections post-audit.
   ------------------------------------------------------------------
   Chaque cas ici est né d'un défaut confirmé par l'audit du 4 septembre 2026.
   Ils ont tous été écrits AVANT la correction correspondante, et ont tous
   échoué avant elle. Les rejouer, c'est vérifier que le défaut n'est pas revenu.

   NODE_PATH=$(npm root -g) node test-corrections.mjs [--cas=<nom>] [--maintenant=<ISO>]
*/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const args = Object.fromEntries(process.argv.slice(2)
  .map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? '1']));
const RACINE = path.resolve(args.racine || process.cwd());
const playwright = createRequire(import.meta.url)('playwright');

const A = { lat: -20.88, lng: 55.45, label: 'Point A' };
const B = { lat: -20.94117, lng: 55.57849, label: 'Point B' };
const E = { lat: -21.057595, lng: 55.604842, label: 'Point E' };
const GEOM_AB = [[A.lat, A.lng], [B.lat, B.lng]];
const GEOM_BA = [[B.lat, B.lng], [-20.923476, 55.575151], [-20.969029, 55.470588], [A.lat, A.lng]];
/* Zones rapprochées : branches de 1,5 km dans l'axe du soleil levant séparées
   par 1 km hors axe. Une zone toutes les ~2,5 km, soit ~2,6 min à 16 m/s —
   sous les trois minutes du cooldown, donc de quoi l'éprouver vraiment. */
const F = { lat: -21.015475, lng: 55.498554, label: 'Point F — zones serrées' };
const GEOM_SERRE = [[-20.88,55.45],[-20.911118,55.430756],[-20.916383,55.444042],[-20.924163,55.43923],[-20.929428,55.452516],[-20.937208,55.447705],[-20.942473,55.460991],[-20.950252,55.45618],[-20.955517,55.469466],[-20.963297,55.464655],[-20.968562,55.477941],[-20.976341,55.47313],[-20.981606,55.486416],[-20.989386,55.481605],[-20.994651,55.494891],[-21.00243,55.490079],[-21.007695,55.503365],[-21.015475,55.498554]];
const GEOM_8 = [[-20.88,55.45],[-20.89053,55.476572],[-20.902199,55.469355],[-20.912729,55.495927],[-20.924399,55.48871],[-20.934929,55.515282],[-20.946598,55.508066],[-20.957128,55.534638],[-20.968797,55.527421],[-20.979327,55.553993],[-20.990997,55.546776],[-21.001527,55.573348],[-21.013196,55.566131],[-21.023726,55.592703],[-21.035395,55.585487],[-21.045925,55.612058],[-21.057595,55.604842]];

/* Avec --vraisApi, /api/* n'est plus simulé : la requête du navigateur est
   passée aux VRAIS handlers, seuls Google et Open-Meteo étant mockés. C'est la
   seule façon de prouver que le durcissement d'origine (J-006) ne casse pas
   l'application réelle. */
const VRAIS_API = args.vraisApi === '1';
let handlers = null;
if (VRAIS_API) {
  process.env.GOOGLE_MAPS_API_KEY = 'cle-de-test';
  handlers = {
    '/api/route': (await import(path.join(RACINE, 'api/route.js'))).default,
    '/api/elevation': (await import(path.join(RACINE, 'api/elevation.js'))).default,
    '/api/weather': (await import(path.join(RACINE, 'api/weather.js'))).default,
  };
}

/** Réponse amont factice, selon l'endpoint appelé par le handler. */
function reponseAmont(url, corps) {
  const j = (o) => new Response(JSON.stringify(o),
    { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.includes('routes.googleapis.com')) {
    const p2 = JSON.parse(corps);
    const o = { lat: p2.origin.location.latLng.latitude, lng: p2.origin.location.latLng.longitude };
    const d = { lat: p2.destination.location.latLng.latitude, lng: p2.destination.location.latLng.longitude };
    const pr = (x, y) => Math.abs(x.lat - y.lat) < 1e-6 && Math.abs(x.lng - y.lng) < 1e-6;
    const geom = pr(o, A) && pr(d, B) ? GEOM_AB : pr(o, B) && pr(d, A) ? GEOM_BA
      : pr(o, A) && pr(d, E) ? GEOM_8 : pr(o, A) && pr(d, F) ? GEOM_SERRE : null;
    if (!geom) return j({ routes: [] });
    const r = reponseRoute(geom);
    return j({ routes: [{
      distanceMeters: r.distanceMeters, duration: `${r.durationSeconds}s`,
      staticDuration: `${r.staticDurationSeconds}s`,
      polyline: { geoJsonLinestring: { type: 'LineString', coordinates: geom.map(([a, b]) => [b, a]) } },
      legs: [{ steps: r.steps.map((st) => ({ distanceMeters: st.distanceMeters,
        staticDuration: `${st.staticDurationSeconds}s`,
        polyline: { geoJsonLinestring: { type: 'LineString', coordinates: st.coordinates.map(([a, b]) => [b, a]) } } })) }],
    }] });
  }
  if (url.includes('maps/api/elevation')) {
    const n = (decodeURIComponent(url).match(/locations=([^&]*)/)[1].split('|')).length;
    return j({ status: 'OK', results: Array.from({ length: n }, () => ({ elevation: 0, resolution: 9.6 })) });
  }
  if (url.includes('open-meteo')) {
    const lats = new URL(url).searchParams.get('latitude').split(',');
    const bloc = () => ({
      hourly: { time: Array.from({ length: 72 }, (_, i) =>
          new Date(Date.UTC(2026, 11, 20) + i * 3600000).toISOString().slice(0, 16)),
        direct_normal_irradiance_instant: Array(72).fill(640), cloud_cover: Array(72).fill(12),
        visibility: Array(72).fill(24000), precipitation: Array(72).fill(0), weather_code: Array(72).fill(1) },
      hourly_units: { direct_normal_irradiance_instant: 'W/m²', cloud_cover: '%',
        visibility: 'm', precipitation: 'mm', weather_code: 'wmo code' },
    });
    return j(lats.length > 1 ? lats.map(bloc) : bloc());
  }
  return j({});
}

const journal = [];
const panne = { route: false, elevation: false, weather: false };
let delaiRouteMs = 0;
let meteoHorsFenetre = false;

function metres(g) {
  const Rt = 6371008.8, r = Math.PI / 180;
  let t = 0;
  for (let i = 1; i < g.length; i++) {
    const [la0, lo0] = g[i - 1], [la1, lo1] = g[i];
    t += Rt * Math.hypot((lo1 - lo0) * r * Math.cos((la0 + la1) / 2 * r), (la1 - la0) * r);
  }
  return t;
}
function reponseRoute(geom) {
  const m = metres(geom), st = m / 16, steps = [];
  for (let i = 1; i < geom.length; i++) {
    const seg = [geom[i - 1], geom[i]], sm = metres(seg);
    steps.push({ distanceMeters: sm, staticDurationSeconds: sm / 16, coordinates: seg });
  }
  return { provider: 'google-routes', routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
    trafficModel: 'BEST_GUESS', trafficBasis: 'REQUESTED_DEPARTURE',
    distanceMeters: m, durationSeconds: st * 1.1, staticDurationSeconds: st,
    trafficFactor: 1.1, geometry: geom, steps };
}
/** En-têtes de la requête HTTP entrante, tels que le navigateur les a posés. */
function req0Entetes(req) {
  const h = {};
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') h[k] = v;
  return h;
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
const serveur = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const envoyer = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.method === 'POST') {
    const brut = await new Promise((ok) => { let d = ''; req.on('data', (c) => { d += c; }); req.on('end', () => ok(d)); });
    let corps = null; try { corps = JSON.parse(brut); } catch {}
    journal.push({ chemin: url.pathname, corps });
    if (VRAIS_API && handlers[url.pathname]) {
      // On recopie les en-têtes du navigateur SANS toucher à host : c'est la
      // cohérence origin/host qui est testée, la réécrire viderait le test.
      const requeteHandler = new Request(base + url.pathname, {
        method: 'POST', headers: req0Entetes(req), body: brut,
      });
      const vrai = globalThis.fetch;
      globalThis.fetch = async (u, init) => reponseAmont(String(u), init && init.body);
      let rep2;
      try { rep2 = await handlers[url.pathname].fetch(requeteHandler); }
      finally { globalThis.fetch = vrai; }
      res.writeHead(rep2.status, { 'content-type': 'application/json' });
      return res.end(await rep2.text());
    }
    if (url.pathname === '/api/route') {
      if (delaiRouteMs) await new Promise((r) => setTimeout(r, delaiRouteMs));
      if (panne.route) return envoyer({ error: 'Panne simulée Routes.' }, 502);
      const o = corps?.origin, d = corps?.destination;
      const pr = (p, q) => p && Math.abs(p.lat - q.lat) < 1e-6 && Math.abs(p.lng - q.lng) < 1e-6;
      if (pr(o, A) && pr(d, B)) return envoyer(reponseRoute(GEOM_AB));
      if (pr(o, B) && pr(d, A)) return envoyer(reponseRoute(GEOM_BA));
      if (pr(o, A) && pr(d, E)) return envoyer(reponseRoute(GEOM_8));
      if (pr(o, A) && pr(d, F)) return envoyer(reponseRoute(GEOM_SERRE));
      if (pr(o, A) && pr(d, A)) return envoyer({ error: 'Aucun itinéraire routier trouvé par Google.', code: 'NO_ROUTE' }, 404);
      return envoyer({ error: 'Couple inconnu du banc.' }, 404);
    }
    if (url.pathname === '/api/elevation') {
      if (panne.elevation) return envoyer({ error: 'Panne simulée Elevation.' }, 502);
      return envoyer({ provider: 'google-elevation',
        elevations: (corps?.points || []).map(() => ({ elevationM: 0, resolutionM: 9.6 })) });
    }
    if (url.pathname === '/api/weather') {
      if (panne.weather) return envoyer({ error: 'Panne simulée Open-Meteo.' }, 502);
      const obs = corps?.observations || [];
      return envoyer({ provider: 'open-meteo', attribution: 'Weather data by Open-Meteo.com (CC BY 4.0)',
        resultats: obs.map((o) => meteoHorsFenetre
          ? { status: 'unknown', provider: 'open-meteo', deltaTimeMinutes: 4320,
              instantValidTime: null, fetchedAt: new Date().toISOString(),
              warnings: ['échéance trop éloignée du passage : 4320 min (limite 90 min)'] }
          : { status: 'ok', directNormalIrradiance: 640, cloudCover: 12, visibility: 24000,
              precipitation: 0, weatherCode: 1,
              instantValidTime: new Date(o.passageTimeMs).toISOString().slice(0, 16),
              passageTime: new Date(o.passageTimeMs).toISOString().slice(0, 19),
              deltaTimeMinutes: 0, provider: 'open-meteo',
              fetchedAt: new Date().toISOString(), warnings: [] }) });
    }
    return envoyer({ error: 'inconnu' }, 404);
  }
  const nom = url.pathname === '/' ? '/index.html' : url.pathname;
  const f = path.join(RACINE, nom);
  if (!f.startsWith(RACINE) || !fs.existsSync(f)) { res.writeHead(404); return res.end('non'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'text/plain' });
  res.end(fs.readFileSync(f));
});

let ok = 0, ko = 0; const echecs = [];
function chk(nom, valeur, detail = '') {
  if (valeur) { ok++; console.log(`  PASS  ${nom}${detail ? ' — ' + detail : ''}`); }
  else { ko++; echecs.push(nom); console.log(`  ÉCHEC ${nom}${detail ? ' — ' + detail : ''}`); }
}
const routes = () => journal.filter((j) => j.chemin === '/api/route');
const elevs = () => journal.filter((j) => j.chemin === '/api/elevation');
const meteos = () => journal.filter((j) => j.chemin === '/api/weather');

const port = await new Promise((r) => serveur.listen(0, () => r(serveur.address().port)));
const base = `http://127.0.0.1:${port}`;
const nav = await playwright.chromium.launch();
const MAINTENANT = new Date(args.maintenant || '2026-12-20T21:28:00+04:00').getTime();
const ctx = await nav.newContext({ timezoneId: args.tz || 'Indian/Reunion', locale: 'fr-FR',
  permissions: args.gps === 'non' ? [] : ['geolocation', 'notifications'],
  geolocation: { latitude: A.lat, longitude: A.lng } });
await ctx.addInitScript((m) => {
  const V = Date, dec = m - V.now();
  const D = function (...a) { return a.length ? new V(...a) : new V(V.now() + dec); };
  D.prototype = V.prototype; D.now = () => V.now() + dec; D.parse = V.parse; D.UTC = V.UTC;
  window.Date = D;
}, MAINTENANT);
const page = await ctx.newPage();
const erreursJS = [];
page.on('pageerror', (e) => erreursJS.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') erreursJS.push('console: ' + m.text()); });
const navigations = [];
await page.route('**://fonts.googleapis.com/**', (r) => r.abort());
await page.route('**://fonts.gstatic.com/**', (r) => r.abort());
await page.route('**/nominatim.openstreetmap.org/**', (r) => {
  const q = decodeURIComponent(new URL(r.request().url()).searchParams.get('q') || '');
  const p = /point a/i.test(q) ? A : /point e/i.test(q) ? E
    : /point f/i.test(q) ? F : B;
  navigations.push('NOMINATIM ' + q);
  r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify([{ display_name: p.label, lat: String(p.lat), lon: String(p.lng) }]) });
});
await page.route('**://www.google.com/**', (r) => { navigations.push(r.request().url()); r.fulfill({ status: 200, body: 'x' }); });
await page.route('**://waze.com/**', (r) => { navigations.push(r.request().url()); r.fulfill({ status: 200, body: 'x' }); });

async function choisir(champ, texte) {
  await page.fill(`#${champ}`, '');
  await page.type(`#${champ}`, texte, { delay: 8 });
  await page.waitForSelector(`#${champ === 'from' ? 'sugFrom' : 'sugTo'} li`, { timeout: 6000 });
  await page.click(`#${champ === 'from' ? 'sugFrom' : 'sugTo'} li`);
}
async function attendreFin() {
  await page.waitForFunction(() => {
    const t = document.getElementById('bilanGrand').textContent;
    const e = document.getElementById('err');
    return (t && t.length > 0) || !e.classList.contains('hide');
  }, null, { timeout: 20000 });
}
async function niveau1(sel = '#result') {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el || el.classList.contains('hide')) return '';
    const n = el.cloneNode(true);
    n.querySelectorAll('details, .hide').forEach((d) => d.remove());
    return n.textContent.replace(/\s+/g, ' ').trim();
  }, sel);
}
const journalTexte = () => page.evaluate(() => document.getElementById('log').textContent);


await page.goto(base + '/index.html');
const CAS = args.cas || 'tous';
const veut = (n) => CAS === 'tous' || CAS === n;

/* ══════════════════ LOT 1 — les trois P1 ══════════════════ */

/* R-002 — « Démarrer le suivi » ne doit jamais changer l'heure en silence.
   Avant correction : l'analyse de demain 06:15 devenait « maintenant » et le
   verdict passait de « Une période importante » à « Rien d'important ». */
if (veut('R-002')) {
  console.log('\n== R-002 — un trajet planifié survit au démarrage du suivi ==');
  await page.goto(base + '/index.html');
  await choisir('from', 'Point A'); await choisir('to', 'Point B');
  await page.fill('#date', '2026-12-21'); await page.fill('#time', '06:15');
  await page.click('#analyze'); await attendreFin();
  const avant = await page.evaluate(() => ({
    bilan: document.getElementById('bilanGrand').textContent,
    meta: document.getElementById('trajetMeta').textContent,
    zones: [...document.querySelectorAll('.zc')].map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
  }));
  const routesAvant = routes().length;

  await page.click('#start');
  await page.waitForTimeout(800);
  const suiviLance = await page.evaluate(() => !document.getElementById('tracking').classList.contains('hide'));
  chk('R-002 le suivi ne démarre pas seul sur un trajet planifié', !suiviLance);
  chk('R-002 une décision explicite est demandée',
    await page.isVisible('#recalPanneau'),
    await page.textContent('#recalTexte').catch(() => '(aucun panneau)'));

  await page.click('#recalAnnuler');
  const apres = await page.evaluate(() => ({
    bilan: document.getElementById('bilanGrand').textContent,
    meta: document.getElementById('trajetMeta').textContent,
    zones: [...document.querySelectorAll('.zc')].map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
  }));
  chk('R-002 annuler laisse l’analyse strictement intacte',
    JSON.stringify(avant) === JSON.stringify(apres),
    `${avant.bilan} → ${apres.bilan}`);
  chk('R-002 annuler n’émet aucune requête', routes().length === routesAvant);

  await page.click('#start'); await page.waitForSelector('#recalPanneau:not(.hide)');
  await page.click('#recalMaintenant');
  await attendreFin();
  chk('R-002 « recalculer pour maintenant » redemande une route à Google',
    routes().length === routesAvant + 1,
    routes().at(-1) ? new Date(routes().at(-1).corps.departureMs).toISOString() : '');
  chk('R-002 la nouvelle analyse part bien de maintenant',
    Math.abs(routes().at(-1).corps.departureMs - MAINTENANT) < 120000);
}

/* R-002 bis — un trajet déjà calculé pour maintenant démarre sans friction. */
if (veut('R-002b')) {
  console.log('\n== R-002 bis — trajet à l’heure actuelle : démarrage direct ==');
  await page.goto(base + '/index.html');
  await choisir('from', 'Point A'); await choisir('to', 'Point B');
  await page.click('#maintenant');
  await page.click('#analyze'); await attendreFin();
  await page.click('#start');
  await page.waitForSelector('#tracking:not(.hide)', { timeout: 10000 });
  chk('R-002b aucun panneau pour un trajet à l’heure actuelle',
    !(await page.isVisible('#recalPanneau')));
  chk('R-002b le suivi démarre', await page.isVisible('#tracking'));
  await page.click('#stopTrack');
}

/* R-003 — un seul mode de progression à la fois. */
if (veut('R-003')) {
  console.log('\n== R-003 — suivi réel et simulation mutuellement exclusifs ==');
  await page.goto(base + '/index.html');
  await choisir('from', 'Point A'); await choisir('to', 'Point E');
  await page.click('#maintenant');
  await page.fill('#time', '06:00'); await page.fill('#date', '2026-12-21');
  await page.click('#analyze'); await attendreFin();
  // Le cas du premier lancement : $('start') rend la main sur sa permission,
  // et #sim était cliquable dans cette fenêtre.
  await page.evaluate(() => {
    document.getElementById('start').click();
    document.getElementById('sim').click();
  });
  await page.waitForTimeout(2500);
  if (erreursJS.length) console.log('  >> erreurs JS : ' + erreursJS.join(' | ').slice(0, 400));
  const j = await journalTexte();
  const sim = /Simulation/.test(j), reel = /Suivi démarré/.test(j);
  chk('R-003 un seul mode a démarré', !(sim && reel),
    `simulation ${sim ? 'lancée' : 'non'} · suivi réel ${reel ? 'lancé' : 'non'}`);
  const etat = await page.evaluate(() => ({
    mode: document.getElementById('modeBanner').className,
    texte: document.getElementById('modeBanner').textContent.replace(/\s+/g, ' ').trim(),
  }));
  chk('R-003 le bandeau décrit le mode réellement actif',
    (reel && /reel/.test(etat.mode)) || (sim && /test/.test(etat.mode)),
    `« ${etat.texte.slice(0, 55)} »`);
  await page.click('#stopTrack').catch(() => {});
  // Enchaînements : test → réel, réel → test, sans survivant.
  await page.click('#sim'); await page.waitForSelector('#tracking:not(.hide)');
  await page.waitForTimeout(600);
  await page.click('#stopTrack');
  const restes = await page.evaluate(() => ({
    banniere: document.getElementById('modeBanner').classList.contains('hide'),
  }));
  chk('R-003 l’arrêt ne laisse aucun mode affiché', restes.banniere);
  // Le trajet est planifié : $('start') demande confirmation (R-002). On
  // recalcule pour maintenant, ce qui vérifie au passage l'enchaînement
  // simulation → recalcul → suivi réel.
  const simsAvant = ((await journalTexte()).match(/Simulation : le trajet défile/g) || []).length;
  await page.click('#start');
  await page.waitForSelector('#recalPanneau:not(.hide)', { timeout: 6000 });
  await page.click('#recalMaintenant');
  await attendreFin();
  await page.click('#start');
  await page.waitForSelector('#tracking:not(.hide)', { timeout: 10000 });
  await page.waitForTimeout(2500);
  const j2 = await journalTexte();
  const simsApres = (j2.match(/Simulation : le trajet défile/g) || []).length;
  const bandeau = await page.evaluate(() => document.getElementById('modeBanner').className);
  chk('R-003 aucune simulation ne redémarre pendant le suivi réel',
    simsApres === simsAvant, `${simsAvant} → ${simsApres}`);
  chk('R-003 le suivi réel est bien le mode affiché', /reel/.test(bandeau), bandeau);
  await page.click('#stopTrack');
}

/* R-004 — un départ passé est refusé avant tout appel Google. */
if (veut('R-004')) {
  console.log('\n== R-004 — départ dans le passé ==');
  const cas = [
    ['hier',              '2026-12-19', '06:15', false],
    ['aujourd’hui −2 h',  '2026-12-20', '19:28', false],
    ['maintenant',        '2026-12-20', '21:28', true],
    ['dans 5 min',        '2026-12-20', '21:33', true],
    ['demain',            '2026-12-21', '06:15', true],
  ];
  for (const [nom, d, h, accepte] of cas) {
    await page.goto(base + '/index.html');
    await choisir('from', 'Point A'); await choisir('to', 'Point B');
    await page.fill('#date', d); await page.fill('#time', h);
    const avant = routes().length;
    await page.click('#analyze'); await attendreFin();
    const err = await page.isVisible('#err') ? await page.textContent('#err') : '';
    const passe = /déjà passée/i.test(err);
    chk(`R-004 ${nom} — ${accepte ? 'accepté' : 'refusé'}`,
      accepte ? !passe : passe, err.slice(0, 70) || 'analyse acceptée');
    if (!accepte) {
      chk(`R-004 ${nom} — aucun appel /api/route`, routes().length === avant,
        `${routes().length - avant} requête(s)`);
    }
  }
}

/* ══════════════════ LOT 2 — P2 ══════════════════ */

/* R-005 — un GPS refusé, en panne ou muet doit mener à un état FINI.
   Avant correction : « En attente du premier point GPS… » indéfiniment, la
   branche « position figée » étant inatteignable sans premier point. */
if (veut('R-005')) {
  console.log('\n== R-005 — échec du GPS : état fini ==');
  const ctx2 = await nav.newContext({ timezoneId: 'Indian/Reunion', locale: 'fr-FR',
    permissions: [] });                       // géolocalisation refusée
  await ctx2.addInitScript((m) => {
    const V = Date, dec = m - V.now();
    const D = function (...a) { return a.length ? new V(...a) : new V(V.now() + dec); };
    D.prototype = V.prototype; D.now = () => V.now() + dec; D.parse = V.parse; D.UTC = V.UTC;
    window.Date = D;
  }, MAINTENANT);
  const p2 = await ctx2.newPage();
  await p2.route('**://fonts.g*/**', (r) => r.abort());
  await p2.route('**/nominatim.openstreetmap.org/**', (r) => {
    const q = decodeURIComponent(new URL(r.request().url()).searchParams.get('q') || '');
    const pt = /point a/i.test(q) ? A : B;
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([{ display_name: pt.label, lat: String(pt.lat), lon: String(pt.lng) }]) });
  });
  await p2.goto(base + '/index.html');
  for (const [champ, texte, liste] of [['from', 'Point A', 'sugFrom'], ['to', 'Point B', 'sugTo']]) {
    await p2.fill('#' + champ, ''); await p2.type('#' + champ, texte, { delay: 8 });
    await p2.waitForSelector('#' + liste + ' li'); await p2.click('#' + liste + ' li');
  }
  await p2.click('#maintenant');
  await p2.click('#analyze');
  await p2.waitForFunction(() => document.getElementById('bilanGrand').textContent.length > 0,
    null, { timeout: 20000 });
  await p2.click('#start');
  await p2.waitForSelector('#tracking:not(.hide)', { timeout: 10000 });
  await p2.waitForTimeout(3000);
  const etat = await p2.evaluate(() => ({
    titre: document.getElementById('suivTitre').textContent.trim(),
    age: document.getElementById('lAge').textContent.trim(),
    warn: document.getElementById('aliveWarn').classList.contains('hide')
      ? '' : document.getElementById('aliveWarn').textContent.trim(),
  }));
  chk('R-005 l’échec de la position est dit en clair',
    /Impossible d.{1,3}utiliser votre position/i.test(etat.titre + ' ' + etat.warn),
    `« ${etat.titre} » · « ${etat.warn.slice(0, 70)} »`);
  chk('R-005 l’écran ne reste pas sur « en attente »',
    !/En attente du GPS/i.test(etat.titre));
  chk('R-005 une issue est proposée',
    /réessay|Tester sans GPS|Arrêter/i.test(etat.titre + ' ' + etat.warn + ' '
      + (await p2.textContent('#stopTrack'))));
  await ctx2.close();
}

/* R-006 — hier, aujourd'hui et demain ne doivent jamais être indiscernables,
   et un trajet qui franchit minuit doit le dire. */
if (veut('R-006')) {
  console.log('\n== R-006 — la date est affichée ==');
  const vus = [];
  for (const [nom, d, h] of [['aujourd’hui', '2026-12-21', '17:56'],
                             ['demain', '2026-12-22', '06:15'],
                             ['dans trois jours', '2026-12-24', '06:15']]) {
    await page.goto(base + '/index.html');
    await choisir('from', 'Point A'); await choisir('to', 'Point B');
    await page.fill('#date', d); await page.fill('#time', h);
    await page.click('#analyze'); await attendreFin();
    const meta = (await page.textContent('#trajetMeta')).trim();
    vus.push(meta);
    chk(`R-006 ${nom} — la date figure sur l’écran de résultat`,
      /déc|janv|dim\.|lun\.|mar\.|mer\.|jeu\.|ven\.|sam\./i.test(meta), meta);
  }
  chk('R-006 les trois trajets sont discernables', new Set(vus).size === 3);

  await page.goto(base + '/index.html');
  await choisir('from', 'Point A'); await choisir('to', 'Point E');
  await page.fill('#date', '2026-12-21'); await page.fill('#time', '23:40');
  await page.click('#analyze'); await attendreFin();
  const minuit = (await page.textContent('#trajetMeta')).trim();
  chk('R-006 le franchissement de minuit est signalé',
    /\+1|lendemain|22/.test(minuit), minuit);
}

/* R-007 — le mode test doit exercer la MÊME règle de parole que la route :
   cooldown arbitré par l'horloge du trajet, jamais neutralisé. Depuis la V0.5,
   ces neuf zones serrées ne font plus qu'UN moment, et un moment ne parle
   qu'une fois — c'est aussi ce que ce cas vérifie. */
if (veut('R-007')) {
  console.log('\n== R-007 — cooldown vocal exercé en mode test ==');
  await page.goto(base + '/index.html');
  await choisir('from', 'Point A'); await choisir('to', 'Point F');
  await page.fill('#date', '2026-12-22'); await page.fill('#time', '06:00');
  await page.click('#analyze'); await attendreFin();
  // Cartes de PREMIER niveau : les moments. Les zones sources vivent dans
  // leurs replis et ne doivent pas être comptées ici.
  const nz = await page.evaluate(() => document.querySelectorAll('#zoneCartes > .zc').length);
  const nzones = await page.evaluate(() =>
    document.querySelectorAll('#techZones .techzone').length);
  await page.click('#sim');
  await page.waitForSelector('#tracking:not(.hide)');
  await page.waitForFunction(() => /Simulation terminée/.test(
    document.getElementById('log').textContent), null, { timeout: 60000 });
  const j = await journalTexte();
  // Le journal porte l'horloge des annonces — réelle en suivi, simulée en test.
  const total = (j.match(/Annonce \d\/4/g) || []).length;
  // Le journal est affiché du plus récent au plus ancien : on remet en ordre
  // chronologique avant de mesurer les écarts, sinon ils sortent négatifs et
  // une valeur absolue masquerait un vrai désordre.
  const heures = [...j.matchAll(/Annonce (\d)\/4 —.*?horloge (\d\d):(\d\d)/g)]
    .map((m) => ({ n: Number(m[1]), t: Number(m[2]) * 60 + Number(m[3]) }))
    .sort((a, b) => a.n - b.n).map((x) => x.t);
  const ecarts = heures.slice(1).map((h, i) => h - heures[i]);
  chk('R-007 le journal horodate les annonces sur l’horloge du trajet',
    heures.length === total && total > 0, `${heures.length}/${total} horodatée(s)`);
  chk('R-007 des annonces sont bien parties', total >= 1,
    `${total} annonce(s) · ${nzones} zones regroupées en ${nz} moment(s)`);
  chk('R-007/V0.5 un moment fait de plusieurs zones ne parle qu’une fois',
    total <= nz, `${total} annonce(s) pour ${nz} moment(s)`);
  // Avec un seul moment il n'y a pas d'écart à mesurer : le dire, plutôt que
  // de laisser deux contrôles passer sur un tableau vide.
  chk('R-007 les annonces se suivent dans l’ordre du trajet',
    ecarts.every((e) => e > 0),
    ecarts.length ? `écarts : ${ecarts.join(', ')} min` : 'une seule annonce, rien à ordonner');
  chk('R-007 jamais deux annonces à moins de trois minutes',
    ecarts.every((e) => e >= 3),
    ecarts.length ? `écarts : ${ecarts.join(', ')} min`
      : 'une seule annonce — l’espacement est couvert par test-episodes.mjs');
  chk('R-007 le plafond de quatre annonces tient', heures.length <= 4);
  chk('R-007 aucune zone faible n’est annoncée',
    !/Annonce.*faible/i.test(j));
  await page.click('#stopTrack');
}

/* R-010 — le cache du service worker doit porter une version, et ne jamais
   servir /api/*. Avant : un nom fixe, donc aucun ancien cache n'était jamais
   supprimé et un index.html périmé pouvait revenir avec d'anciens seuils T. */
if (veut('R-010')) {
  console.log('\n== R-010 — cache du service worker versionné ==');
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null
    || navigator.serviceWorker.ready, null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Le nettoyage se fait à l'activation : il faut donc désinscrire le worker,
  // planter le cache périmé, puis laisser le nouveau s'installer.
  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    const c = await caches.open('eblouissement-v1');
    await c.put('/index.html', new Response('<html>version périmée</html>',
      { headers: { 'content-type': 'text/html' } }));
  });
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(1200);
  const caches1 = await page.evaluate(() => caches.keys());
  chk('R-010 le nom du cache porte une version',
    caches1.some((n) => /v\d/.test(n)), caches1.join(', ') || '(aucun)');
  chk('R-010 aucun cache d’une version antérieure ne survit',
    !caches1.includes('eblouissement-v1'), caches1.join(', '));
  const apiEnCache = await page.evaluate(async () => {
    for (const n of await caches.keys()) {
      const c = await caches.open(n);
      for (const r of await c.keys()) if (r.url.includes('/api/')) return r.url;
    }
    return null;
  });
  chk('R-010 aucun endpoint /api/ n’est mis en cache', apiEnCache === null, apiEnCache || 'aucun');
  const servi = await page.evaluate(() => document.getElementById('analyze') !== null);
  chk('R-010 la page servie est bien la vraie application', servi);
}

/* R-013 — la voix doit pouvoir être coupée sans arrêter le suivi. */
if (veut('R-013')) {
  console.log('\n== R-013 — interrupteur de voix ==');
  await page.goto(base + '/index.html');
  await page.addInitScript(() => { window.__dits = []; });
  await page.goto(base + '/index.html');
  await page.evaluate(() => {
    window.__dits = [];
    const vrai = window.speechSynthesis.speak.bind(window.speechSynthesis);
    window.speechSynthesis.speak = (u) => { window.__dits.push(u.text); return vrai(u); };
  });
  await choisir('from', 'Point A'); await choisir('to', 'Point F');
  await page.fill('#date', '2026-12-22'); await page.fill('#time', '06:00');
  await page.click('#analyze'); await attendreFin();
  chk('R-013 un interrupteur de voix existe', await page.isVisible('#voix'),
    await page.textContent('#voix').catch(() => '(absent)'));
  await page.click('#voix');                    // couper
  await page.click('#sim');
  await page.waitForSelector('#tracking:not(.hide)');
  await page.waitForFunction(() => /Simulation terminée/.test(
    document.getElementById('log').textContent), null, { timeout: 60000 });
  const ditsCoupe = await page.evaluate(() => window.__dits.slice());
  const jCoupe = await journalTexte();
  chk('R-013 voix coupée : aucune synthèse ne part', ditsCoupe.length === 0,
    ditsCoupe.join(' | ') || 'aucune');
  chk('R-013 voix coupée : les annonces restent détectées et journalisées',
    /Annonce \d\/4/.test(jCoupe));
  await page.click('#stopTrack');
  await page.click('#voix');                    // rallumer
  await page.evaluate(() => { window.__dits = []; });
  await page.click('#sim');
  await page.waitForSelector('#tracking:not(.hide)');
  await page.waitForTimeout(4000);
  const ditsOn = await page.evaluate(() => window.__dits.slice());
  chk('R-013 voix rallumée : la synthèse repart', ditsOn.length > 0,
    ditsOn.slice(0, 2).join(' | ') || 'aucune');
  await page.click('#stopTrack');
}

/* R-014 — « Ma position » devenue arrivée ne doit pas se lire comme la
   position actuelle : c'est le point figé capturé au départ. */
if (veut('R-014')) {
  console.log('\n== R-014 — « Ma position » devenue arrivée ==');
  await page.goto(base + '/index.html');
  await page.evaluate(() => {
    navigator.geolocation.getCurrentPosition = (ok) => ok({
      coords: { latitude: -20.88, longitude: 55.45 }, timestamp: Date.now() });
  });
  await page.click('#useHere');
  await page.waitForFunction(() => document.getElementById('from').value === 'Ma position',
    null, { timeout: 6000 });
  await choisir('to', 'Point B');
  await page.fill('#date', '2026-12-22'); await page.fill('#time', '06:15');
  await page.click('#analyze'); await attendreFin();
  const titreAller = await page.textContent('#trajetTitre');
  await page.click('#retourResult');
  await page.waitForSelector('#retourPanneau:not(.hide)');
  const sens = await page.textContent('#retourSens');
  chk('R-014 le panneau ne présente pas le point figé comme la position actuelle',
    !/Ma position/.test(sens) && /enregistrée|figée|au départ/i.test(sens), sens);
  await page.fill('#retourTime', '17:56');
  await page.click('#retourCalculer'); await attendreFin();
  const titreRetour = await page.textContent('#trajetTitre');
  chk('R-014 l’écran de résultat du retour est explicite',
    !/→ Ma position/.test(titreRetour), `${titreAller}  →  ${titreRetour}`);
  const corps = routes().at(-1).corps;
  chk('R-014 les coordonnées ne bougent pas',
    corps.destination.lat === -20.88 && corps.destination.lng === 55.45,
    JSON.stringify(corps.destination));
}

/* J-006 de bout en bout : l'application réelle, devant les VRAIS handlers. */
if (veut('J-006')) {
  console.log('\n== J-006 — l’application passe le durcissement des endpoints ==');
  if (!VRAIS_API) {
    console.log('  (relancer avec --vraisApi=1 --cas=J-006)');
  } else {
    await page.goto(base + '/index.html');
    await choisir('from', 'Point A'); await choisir('to', 'Point B');
    await page.fill('#date', '2026-12-22'); await page.fill('#time', '06:15');
    await page.click('#analyze'); await attendreFin();
    const err = await page.isVisible('#err') ? await page.textContent('#err') : '';
    chk('J-006 l’analyse aboutit à travers les vrais endpoints', err === '', err.slice(0, 90));
    const zones = await page.evaluate(() => document.querySelectorAll('.zc').length);
    chk('J-006 les zones sont détectées comme avec le banc simulé', zones > 0, `${zones} zone(s)`);
    const j = await journalTexte();
    chk('J-006 relief et météo répondent aussi',
      /Relief — 1 requête/.test(j) && /Weather — 1 requête/.test(j));
    // Et un appel forgé depuis une autre page web est écarté.
    const forge = await page.evaluate(async (b) => {
      const r = await fetch(b + '/api/route', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-faux-origin': '1' },
        body: JSON.stringify({ origin: { lat: null, lng: 0 }, destination: { lat: 0, lng: 0 } }) });
      return { status: r.status, corps: await r.json() };
    }, base);
    chk('J-006 une coordonnée nulle est refusée sans appel facturé',
      forge.status === 400, `${forge.status} — ${forge.corps.error}`);
  }
}

/* J-001 — l'affirmation « aucune donnée de position n'est transmise ni
   conservée » était fausse : « Ma position » part vers Google Routes, les zones
   vers Elevation et Open-Meteo. Une information inexacte est pire qu'absente. */
if (veut('J-001')) {
  console.log('\n== J-001 — le texte de confidentialité dit vrai ==');
  await page.goto(base + '/index.html');
  const page1 = await page.evaluate(() => document.body.textContent.replace(/\s+/g, ' '));
  chk('J-001 l’affirmation fausse a disparu',
    !/Aucune donnée de position n.{1,3}est transmise/i.test(page1));
  const donnees = await page.evaluate(() => {
    const d = document.getElementById('donnees');
    return d ? d.textContent.replace(/\s+/g, ' ') : '';
  });
  chk('J-001 un emplacement « Données utilisées » existe', donnees.length > 0);
  for (const tiers of ['Google Routes', 'Google Elevation', 'Open-Meteo', 'Nominatim', 'Vercel']) {
    chk(`J-001 ${tiers} est nommé comme destinataire`, donnees.includes(tiers));
  }
  chk('J-001 ce qui reste sur l’appareil est dit sans promesse sur les tiers',
    /position pendant le suivi n.{1,3}est jamais envoyée/i.test(donnees)
    && /leurs propres conditions/i.test(donnees));
  chk('J-003 l’attribution OpenStreetMap est affichée là où l’adresse est saisie',
    await page.isVisible('#attribOsm'),
    await page.textContent('#attribOsm').catch(() => '(absente)'));
  chk('J-003 la licence ODbL est nommée',
    /ODbL/.test(await page.textContent('#attribOsm')));
  chk('W12 les prescriptions de conduite sont écrites',
    /Préparez Radius avant de prendre la route/i.test(
      await page.evaluate(() => document.getElementById('apropos').textContent)));
}

console.log(`\n${ok} contrôle(s) PASS, ${ko} ÉCHEC.`);
if (ko) console.log('Échecs : ' + echecs.join(' | '));
await nav.close(); serveur.close();
process.exit(ko ? 1 : 0);
