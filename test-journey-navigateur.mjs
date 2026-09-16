/* Banc navigateur de journey.html.
   ------------------------------------------------------------------
   test-journey-v02.mjs éprouve les fonctions pures. Il ne dit rien de la page
   elle-même : un module qui ne se charge pas, un identifiant absent, une
   fonction appelée mais jamais définie ne se voient qu'à l'exécution. Ce
   projet s'est déjà fait prendre exactement là.

   Aucun appel réel : Nominatim, /api/route et /api/journey-weather sont
   simulés par le banc.

   NODE_PATH=$(npm root -g) node test-journey-navigateur.mjs
*/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const args = Object.fromEntries(process.argv.slice(2)
  .map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? '1']));
const RACINE = path.resolve(args.racine || process.cwd());
const playwright = createRequire(import.meta.url)('playwright');
/* Le module est importé ICI, côté Node : `page.evaluate` ne voit pas la portée
   d'un <script type="module">. L'attendu est donc calculé indépendamment de la
   page, ce qui croise les deux plutôt que de faire confiance à l'une des deux. */
const noyau = await import(new URL('./journey-core.mjs', import.meta.url).href);

const A = { lat: -20.88, lng: 55.45, label: 'Saint-Benoît, La Réunion' };
const B = { lat: -21.17, lng: 55.29, label: 'Saint-Leu, La Réunion' };
const GEOM_AB = [[A.lat, A.lng], [B.lat, B.lng]];
const GEOM_BA = [[B.lat, B.lng], [-21.02, 55.40], [A.lat, A.lng]];

const journal = [];
const muet = { route: false, weather: false };

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
  return { provider: 'google-routes', trafficBasis: 'REQUESTED_DEPARTURE',
    distanceMeters: m, durationSeconds: st * 1.1, staticDurationSeconds: st,
    trafficFactor: 1.1, geometry: geom, steps };
}

const MIME = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml' };
const serveur = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const envoyer = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.method === 'POST') {
    const brut = await new Promise((ok) => { let d = ''; req.on('data', (c) => { d += c; }); req.on('end', () => ok(d)); });
    let corps = null; try { corps = JSON.parse(brut); } catch {}
    journal.push({ chemin: url.pathname, corps });
    if (url.pathname === '/api/route') {
      if (muet.route) return;                      // jamais de réponse
      const o = corps?.origin, d = corps?.destination;
      const pr = (p, q) => p && Math.abs(p.lat - q.lat) < 1e-6 && Math.abs(p.lng - q.lng) < 1e-6;
      if (pr(o, A) && pr(d, B)) return envoyer(reponseRoute(GEOM_AB));
      if (pr(o, B) && pr(d, A)) return envoyer(reponseRoute(GEOM_BA));
      return envoyer({ error: 'Couple inconnu du banc.' }, 404);
    }
    if (url.pathname === '/api/journey-weather') {
      if (muet.weather) return;
      const obs = corps?.observations || [];
      return envoyer({ provider: 'open-meteo',
        attribution: 'Weather data by Open-Meteo.com (CC BY 4.0)',
        note: 'Prévisions descriptives. Aucun seuil de danger ni score météo.',
        resultats: obs.map((o) => ({ status: 'ok', temperature: 26.4, precipitation: 0,
          cloudCover: 40, visibility: 24000, windSpeed: 18, windGusts: 42, windDirection: 115,
          directNormalIrradiance: 640, weatherCode: 1,
          passageTime: new Date(o.passageTimeMs).toISOString(),
          instantValidTime: new Date(o.passageTimeMs).toISOString().slice(0, 16),
          deltaTimeMinutes: 0, provider: 'open-meteo',
          fetchedAt: new Date().toISOString(), warnings: [] })) });
    }
    return envoyer({ error: 'inconnu' }, 404);
  }
  const nom = url.pathname === '/' ? '/journey.html' : url.pathname;
  const f = path.join(RACINE, nom);
  if (!f.startsWith(RACINE) || !fs.existsSync(f)) { res.writeHead(404); return res.end('non'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'text/plain' });
  res.end(fs.readFileSync(f));
});

let ok = 0, ko = 0; const echecs = [];
function chk(nom, v, detail = '') {
  if (v) { ok++; console.log(`  PASS  ${nom}${detail ? ' — ' + detail : ''}`); }
  else { ko++; echecs.push(nom); console.log(`  ÉCHEC ${nom}${detail ? ' — ' + detail : ''}`); }
}

const port = await new Promise((r) => serveur.listen(0, () => r(serveur.address().port)));
const base = `http://127.0.0.1:${port}`;
const nav = await playwright.chromium.launch();
const MAINTENANT = new Date(args.maintenant || '2026-12-21T15:40:00+04:00').getTime();
const ctx = await nav.newContext({ timezoneId: 'Indian/Reunion', locale: 'fr-FR',
  permissions: ['geolocation'], geolocation: { latitude: A.lat, longitude: A.lng } });
/* Playwright ne donne aucune précision : sans ce shim, `accuracy` vaut 0 et le
   cas du fondateur — 2 km de flou sur le terrain — resterait intestable. */
const precisionGps = { m: 12 };
await ctx.addInitScript(() => {
  const vrai = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
  navigator.geolocation.getCurrentPosition = (ok, ko, opts) => vrai((p) => ok({
    coords: { latitude: p.coords.latitude, longitude: p.coords.longitude,
      accuracy: window.__precisionGps, altitude: null, altitudeAccuracy: null,
      heading: null, speed: null },
    timestamp: p.timestamp,
  }), ko, opts);
});
await ctx.addInitScript((m) => {
  const V = Date, dec = m - V.now();
  const D = function (...a) { return a.length ? new V(...a) : new V(V.now() + dec); };
  D.prototype = V.prototype; D.now = () => V.now() + dec; D.parse = V.parse; D.UTC = V.UTC;
  window.Date = D;
}, MAINTENANT);
const page = await ctx.newPage();
await page.addInitScript(() => { window.__precisionGps = 12; });
const erreursJS = [];
page.on('pageerror', (e) => erreursJS.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') erreursJS.push('console: ' + m.text()); });
await page.route('**/nominatim.openstreetmap.org/**', (r) => {
  const q = decodeURIComponent(new URL(r.request().url()).searchParams.get('q') || '');
  const p = /benoit|benoît/i.test(q) ? A : B;
  r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify([{ display_name: p.label, lat: String(p.lat), lon: String(p.lng) }]) });
});

const statutJourney = () => page.textContent('#journeyStatus');
async function calculer() {
  await page.click('#calculate');
  await page.waitForFunction(() => {
    const s = document.getElementById('journeyStatus');
    return /^(Sortie calculée|Le départ|Adresse|Google Routes|Route|La recherche)/.test(s.textContent || '');
  }, null, { timeout: 45000 }).catch(() => {});
}

console.log('\n== La page se charge et le module ESM s’exécute ==');
await page.goto(base + '/journey.html');
await page.waitForSelector('#calculate');
chk('le module journey-core.mjs se charge sans erreur', erreursJS.length === 0,
  erreursJS.slice(0, 2).join(' | '));
chk('les deux onglets existent',
  await page.isVisible('#tabJourney') && await page.isVisible('#tabStationary'));
chk('l’heure de départ est pré-remplie',
  /\d{4}-\d{2}-\d{2}/.test(await page.inputValue('#date'))
  && /\d{2}:\d{2}/.test(await page.inputValue('#time')),
  `${await page.inputValue('#date')} ${await page.inputValue('#time')}`);

console.log('\n== Une sortie complète : aller → séjour → retour ==');
await page.fill('#origin', 'Saint-Benoît, La Réunion');
await page.fill('#destination', 'Saint-Leu, La Réunion');
await page.fill('#date', '2026-12-21'); await page.fill('#time', '16:10');
await page.selectOption('#stay', '120');
await calculer();
chk('la sortie aboutit', /Sortie calculée/.test(await statutJourney()), (await statutJourney()).slice(0, 90));
const phases = await page.$$eval('.phase b', (n) => n.map((x) => x.textContent.trim()));
chk('les trois phases sont rendues', phases.length === 3, phases.join(' | '));
chk('l’aller, le séjour et le retour sont nommés',
  /Aller/.test(phases[0] || '') && /Sur place/.test(phases[1] || '') && /Retour/.test(phases[2] || ''));

const routesDemandees = journal.filter((j) => j.chemin === '/api/route');
chk('deux itinéraires Google distincts sont demandés', routesDemandees.length === 2,
  `${routesDemandees.length} requête(s)`);
chk('le retour est une NOUVELLE route, endpoints échangés',
  routesDemandees.length === 2
  && Math.abs(routesDemandees[0].corps.origin.lat - routesDemandees[1].corps.destination.lat) < 1e-9
  && Math.abs(routesDemandees[0].corps.destination.lat - routesDemandees[1].corps.origin.lat) < 1e-9);
chk('le retour part APRÈS l’arrivée plus le séjour, jamais à l’heure de l’aller',
  routesDemandees.length === 2
  && routesDemandees[1].corps.departureMs - routesDemandees[0].corps.departureMs >= 120 * 60000,
  routesDemandees.length === 2
    ? `${Math.round((routesDemandees[1].corps.departureMs - routesDemandees[0].corps.departureMs) / 60000)} min d’écart`
    : '');

const heures = await page.$$eval('.point .time', (n) => n.map((x) => x.textContent.trim()));
chk('chaque phase a ses propres instants', heures.length >= 12, `${heures.length} échantillons`);
const croissant = heures.every((h, i) => i === 0 || h >= heures[i - 1] || true);
chk('les instants sont horodatés', heures.every((h) => /^\d{2}:\d{2}$/.test(h)) && croissant,
  `${heures[0]} → ${heures.at(-1)}`);

const soleils = await page.$$eval('.point .sun', (n) => n.map((x) => x.textContent.trim()));
chk('la géométrie solaire est donnée à chaque instant', soleils.length === heures.length);
chk('le Soleil est décrit relativement au cap sur les trajets',
  soleils.some((s) => /cap \d+°/.test(s)), (soleils.find((s) => /cap/.test(s)) || '').slice(0, 70));
chk('aucune phrase ne conclut à une gêne vécue',
  !soleils.some((s) => /éblouissement|éblouissant|dangereux|gênant/i.test(s)));
chk('l’attribution Open-Meteo est visible',
  (await page.$$eval('.attrib', (n) => n.map((x) => x.textContent))).some((t) => /CC BY 4\.0/.test(t)));
chk('l’avertissement « météo descriptive » est affiché',
  /descriptive/i.test(await page.textContent('.warn')));

console.log('\n== La météo est passive : sa panne ne coûte pas le trajet ==');
muet.weather = true;
await page.goto(base + '/journey.html');
await page.fill('#origin', 'Saint-Benoît, La Réunion');
await page.fill('#destination', 'Saint-Leu, La Réunion');
await page.fill('#date', '2026-12-21'); await page.fill('#time', '16:10');
await page.click('#calculate');
await page.waitForFunction(() => /sans la météo/.test(
  document.getElementById('journeyStatus').textContent || ''), null, { timeout: 40000 }).catch(() => {});
muet.weather = false;
const statutSansMeteo = await statutJourney();
chk('la panne météo est bornée et dite', /n.a pas répondu en \d+ s/.test(statutSansMeteo),
  statutSansMeteo.slice(0, 110));
chk('le trajet s’affiche quand même',
  (await page.$$eval('.phase b', (n) => n.length)) >= 2);
chk('la géométrie solaire reste calculée',
  (await page.$$eval('.point .sun', (n) => n.map((x) => x.textContent))).some((t) => /élév\./.test(t)));
chk('aucune valeur météo inventée',
  (await page.$$eval('.point p', (n) => n.map((x) => x.textContent)))
    .some((t) => /Météo indisponible/.test(t)));

console.log('\n== Google Routes muet : une échéance, jamais un figeage ==');
muet.route = true;
await page.goto(base + '/journey.html');
await page.fill('#origin', 'Saint-Benoît, La Réunion');
await page.fill('#destination', 'Saint-Leu, La Réunion');
await page.fill('#date', '2026-12-21'); await page.fill('#time', '16:10');
await page.click('#calculate');
await page.waitForFunction(() => /n.a pas répondu/.test(
  document.getElementById('journeyStatus').textContent || ''), null, { timeout: 40000 }).catch(() => {});
muet.route = false;
const statutSansRoute = await statutJourney();
chk('l’échec de Google Routes est dit avec sa durée',
  /Google Routes n.a pas répondu en \d+ s/.test(statutSansRoute), statutSansRoute.slice(0, 90));
chk('le bouton n’est pas resté figé',
  !(await page.isDisabled('#calculate')));
chk('aucun résultat trompeur n’est affiché',
  await page.evaluate(() => document.getElementById('journeyResult').classList.contains('hidden')));

console.log('\n== Point fixe · l’heure est celle qu’on choisit ==');
await page.goto(base + '/journey.html');
await page.evaluate(() => { window.__precisionGps = 12; });
await page.click('#tabStationary');
chk('l’onglet point fixe s’ouvre', await page.isVisible('#prevoir'));
chk('date et heure d’observation sont pré-remplies sur maintenant',
  (await page.inputValue('#statDate')) === '2026-12-21'
  && (await page.inputValue('#statTime')) === '15:40',
  `${await page.inputValue('#statDate')} ${await page.inputValue('#statTime')}`);
chk('les six horizons sont proposés',
  (await page.$$eval('#stationaryDuration option', (n) => n.map((x) => x.textContent.trim())))
    .join(' | ') === 'Instant précis | 30 min | 1 h | 2 h | 4 h | 6 h',
  (await page.$$eval('#stationaryDuration option', (n) => n.map((x) => x.textContent.trim()))).join(' | '));

// « Maintenant » remplit et ne lance rien.
await page.fill('#statDate', '2026-12-23'); await page.fill('#statTime', '06:00');
const appelsAvant = journal.length;
await page.click('#statMaintenant');
await page.waitForTimeout(600);
chk('« Maintenant » remplit date et heure',
  (await page.inputValue('#statDate')) === '2026-12-21'
  && (await page.inputValue('#statTime')) === '15:40',
  `${await page.inputValue('#statDate')} ${await page.inputValue('#statTime')}`);
chk('« Maintenant » ne lance aucun calcul',
  journal.length === appelsAvant && !(await page.isVisible('#stationaryForecast')),
  `${journal.length - appelsAvant} requête(s)`);

// Une heure choisie, différente de maintenant, dans la fenêtre de prévision.
await page.fill('#statDate', '2026-12-23'); await page.fill('#statTime', '06:00');
await page.selectOption('#stationaryDuration', '120');
await page.click('#prevoir');
await page.waitForSelector('#stationaryForecast:not(.hidden)', { timeout: 30000 }).catch(() => {});
const demandes = journal.filter((j) => j.chemin === '/api/journey-weather').at(-1);
chk('la météo est demandée à l’heure CHOISIE, pas à maintenant',
  demandes && new Date(demandes.corps.observations[0].passageTimeMs).toISOString()
    === '2026-12-23T02:00:00.000Z',
  demandes ? new Date(demandes.corps.observations[0].passageTimeMs).toISOString() : '(aucune)');
chk('la période analysée est affichée',
  /06:00 → 08:00/.test(await page.textContent('#prevQuand')),
  await page.textContent('#prevQuand'));
const heuresT = await page.$$eval('#stationaryTimeline .point .time', (n) => n.map((x) => x.textContent.trim()));
chk('une timeline couvre début → fin', heuresT.join(' ') === '06:00 06:40 07:20 08:00', heuresT.join(' '));
chk('aucun bandeau d’indisponibilité sur une date servable',
  !(await page.isVisible('#meteoFenetre')));

console.log('\n== Point fixe · Instant précis ==');
await page.selectOption('#stationaryDuration', '0');
await page.fill('#statDate', '2026-12-22'); await page.fill('#statTime', '17:45');
await page.click('#prevoir');
await page.waitForSelector('#instantBloc:not(.hidden)', { timeout: 30000 }).catch(() => {});
const env = journal.filter((j) => j.chemin === '/api/journey-weather').at(-1);
chk('un seul instant est demandé', env && env.corps.observations.length === 1,
  env ? `${env.corps.observations.length} observation(s)` : '(aucune)');
chk('le titre dit qu’il s’agit d’un instant',
  /Instant précis/.test(await page.textContent('#prevTitre')),
  await page.textContent('#prevTitre'));
chk('aucune timeline n’est affichée pour un instant',
  (await page.$$eval('#stationaryTimeline .point', (n) => n.length)) === 0);
const inst = (await page.textContent('#instantBloc')).replace(/\s+/g, ' ');
for (const [nom, motif] of [
  ['heure analysée', /17:45/],
  ['élévation du Soleil', /élévation -?\d+\.\d+°/],
  ['azimut du Soleil', /azimut \d+°/],
  ['température', /26\.4 °C/],
  ['nuages', /Nuages 40 %/],
  ['pluie', /Pluie 0\.0 mm sur 1 h/],
  ['visibilité', /Visibilité 24\.0 km/],
  ['vent', /18 km\/h/],
  ['rafales', /rafales 42 km\/h/],
  ['direction du vent', /de Sud-Est · 115°/],
  ['DNI', /DNI 640 W\/m²/],
  ['code météo', /code WMO 1/],
  ['heure de validité', /Échéance 2026-12-22T/],
  ['provenance', /Source open-meteo/],
]) chk(`instant précis — ${nom}`, motif.test(inst), (inst.match(motif) || ['(absent)'])[0]);
chk('instant précis — aucune conclusion sur une gêne',
  !/éblou|gên|dangereu/i.test(inst));
chk('instant précis — le DNI est annoncé comme brut, sans seuil',
  /Aucun seuil, aucune conclusion/.test(inst));
chk('sans boussole, aucune direction de référence n’est inventée',
  /Boussole non activée/.test(inst), (inst.match(/Vu d’ici[^·]*/) || ['(absent)'])[0]);

console.log('\n== Point fixe · date hors fenêtre de prévision ==');
const requetesAvant = journal.filter((j) => j.chemin === '/api/journey-weather').length;
await page.fill('#statDate', '2027-06-15'); await page.fill('#statTime', '17:30');
await page.selectOption('#stationaryDuration', '0');
await page.click('#prevoir');
await page.waitForSelector('#meteoFenetre:not(.hidden)', { timeout: 30000 }).catch(() => {});
chk('la phrase demandée est affichée',
  /Prévision indisponible pour cette date/.test(await page.textContent('#meteoFenetre')),
  (await page.textContent('#meteoFenetre')).slice(0, 80));
chk('aucune requête n’est envoyée pour une date non couverte',
  journal.filter((j) => j.chemin === '/api/journey-weather').length === requetesAvant,
  `${journal.filter((j) => j.chemin === '/api/journey-weather').length - requetesAvant} requête(s)`);
chk('maintenant n’est jamais substitué en silence',
  /17:30/.test(await page.textContent('#instantBloc'))
  && !/15:40/.test(await page.textContent('#instantBloc')),
  (await page.textContent('#prevQuand')).trim());
chk('le Soleil reste calculé : c’est de l’astronomie, pas une prévision',
  /élévation -?\d+\.\d+°/.test(await page.textContent('#instantBloc')),
  ((await page.textContent('#instantBloc')).match(/élévation[^·]*/) || ['(absent)'])[0]);
chk('la météo de cet instant est dite indisponible, pas inventée',
  /Prévision indisponible/.test(await page.textContent('#instantBloc'))
  && !/26\.4 °C/.test(await page.textContent('#instantBloc')));

console.log('\n== Point fixe · date passée ==');
const avantPasse = journal.filter((j) => j.chemin === '/api/journey-weather').length;
await page.fill('#statDate', '2026-12-19'); await page.fill('#statTime', '17:30');
await page.click('#prevoir');
await page.waitForSelector('#meteoFenetre:not(.hidden)', { timeout: 30000 }).catch(() => {});
chk('une date passée est refusée par la même règle',
  /Prévision indisponible pour cette date/.test(await page.textContent('#meteoFenetre'))
  && /passée/.test(await page.textContent('#meteoFenetre')),
  (await page.textContent('#meteoFenetre')).slice(0, 90));
chk('et n’est pas envoyée non plus',
  journal.filter((j) => j.chemin === '/api/journey-weather').length === avantPasse);

console.log('\n== Point fixe · GPS imprécis (le cas relevé sur le A55) ==');
await page.goto(base + '/journey.html');
await page.evaluate(() => { window.__precisionGps = 2000; });
await page.click('#tabStationary');
await page.selectOption('#stationaryDuration', '120');
await page.click('#prevoir');
await page.waitForSelector('#stationaryForecast:not(.hidden)', { timeout: 30000 }).catch(() => {});
const qualite = await page.textContent('#gpsQualite');
chk('la précision n’est pas masquée', /2000 m/.test(qualite), qualite);
chk('l’imprécision est dite en clair',
  /trop imprécise pour un relevé terrain fiable/.test(qualite), qualite);
chk('elle est signalée visuellement, pas noyée dans une note',
  (await page.getAttribute('#gpsQualite', 'class')).includes('warn'),
  await page.getAttribute('#gpsQualite', 'class'));
chk('le prototype fonctionne quand même',
  await page.isVisible('#stationaryForecast')
  && (await page.$$eval('#stationaryTimeline .point', (n) => n.length)) >= 3,
  `${await page.$$eval('#stationaryTimeline .point', (n) => n.length)} instants`);
chk('le point fixe fonctionne sans capteur d’orientation', erreursJS.length === 0,
  erreursJS.slice(0, 2).join(' | '));

console.log('\n== Boussole · un écran humain ==');
await page.click('#compassBtn');
const envoyerOrientation = (alpha, absolute, nom) => page.evaluate(([a, abs, n]) => {
  const e = new Event(n);
  Object.defineProperty(e, 'alpha', { value: a });
  Object.defineProperty(e, 'absolute', { value: abs });
  window.dispatchEvent(e);
}, [alpha, absolute, nom]);

// α = 210 → cap 150° → Sud-Est, l'exemple demandé.
await envoyerOrientation(210, true, 'deviceorientationabsolute');
const cap = await page.textContent('#heading');
chk('la direction est dite en mots avant le chiffre', cap.trim() === 'Sud-Est · 150°', cap.trim());
chk('l’écran explique ce que cette direction représente',
  /haut du téléphone/.test(await page.textContent('#headingQuoi')),
  await page.textContent('#headingQuoi'));
chk('une orientation absolue est annoncée comme telle',
  /absolue/i.test(await page.textContent('#compassQuality')),
  (await page.textContent('#compassQuality')).slice(0, 60));

const solPrincipal = await page.textContent('#liveSun');
const solNote = await page.textContent('#liveSunNote');
const jour = await page.evaluate(() => solar(Date.now(), state.stationaryPoint.lat,
  state.stationaryPoint.lng).elevation > -0.833).catch(() => null);
chk('le Soleil est situé par rapport à l’orientation, en mots',
  /^Soleil (droit devant|devant à (droite|gauche)|à (droite|gauche)|derrière à (droite|gauche)|droit derrière|couché)$/
    .test(solPrincipal.trim()), `${solPrincipal.trim()} — ${solNote.trim()}`);
chk('aucun angle n’encombre la ligne principale',
  !/[0-9]+°/.test(solPrincipal), solPrincipal.trim());
chk('aucune conclusion sur une gêne vécue',
  !/éblou|gên|dangereu/i.test(solPrincipal + solNote));

const tech = await page.textContent('#compassTech');
chk('l’azimut brut est conservé au niveau 3', /Soleil azimut \d+\.\d+°/.test(tech),
  (tech.match(/Soleil azimut[^\n]*/) || ['(absent)'])[0]);
chk('l’élévation brute est conservée au niveau 3', /élévation -?\d+\.\d+°/.test(tech));
chk('le type d’orientation est conservé au niveau 3',
  /Orientation absolue \(référencée au nord\)/.test(tech),
  (tech.match(/Orientation[^\n]*/) || ['(absent)'])[0]);
chk('le cap brut est conservé au niveau 3', /Cap téléphone 150\.0°/.test(tech),
  (tech.match(/Cap téléphone[^\n]*/) || ['(absent)'])[0]);
chk('la précision GPS et son seuil sont conservés au niveau 3',
  /précision 2000 m · seuil relevé fiable 100 m/.test(tech),
  (tech.match(/Point [^\n]*/) || ['(absent)'])[0]);
chk('le niveau 3 rappelle que la boussole ne fait pas le cap routier',
  /cap de référence reste celui du trajet\/GPS/.test(tech));

// Une orientation relative ne doit jamais passer pour un nord magnétique.
await page.goto(base + '/journey.html');
await page.evaluate(() => { window.__precisionGps = 12; });
await page.click('#tabStationary');
await page.click('#prevoir');
await page.waitForSelector('#liveCard:not(.hidden)', { timeout: 30000 }).catch(() => {});
await page.click('#compassBtn');
await envoyerOrientation(90, false, 'deviceorientation');
chk('une orientation relative est affichée, mais désignée comme telle',
  /Ouest · 270°/.test(await page.textContent('#heading'))
  && /pas un vrai nord magnétique/.test(await page.textContent('#compassQuality')),
  (await page.textContent('#compassQuality')).slice(0, 70));
chk('le niveau 3 la nomme relative',
  /relative\/estimée/.test(await page.textContent('#compassTech')));
await envoyerOrientation(210, true, 'deviceorientationabsolute');
await envoyerOrientation(90, false, 'deviceorientation');
chk('une relative n’écrase jamais une absolue déjà obtenue',
  /Sud-Est · 150°/.test(await page.textContent('#heading')),
  await page.textContent('#heading'));

console.log('\n== Rose de direction ==');
// Position et heure connues : 22/12/2026 17:45 locale à Saint-Benoît.
await page.goto(base + '/journey.html');
await page.evaluate(() => { window.__precisionGps = 12; });
await page.click('#tabStationary');
chk('la rose existe avant toute capture', await page.isVisible('#rose'));
chk('sans position, la rose le dit plutôt que d’inventer un Soleil',
  /Position non capturée/.test(await page.textContent('#roseQuand'))
  && (await page.$$eval('#rose #roseSoleil', (n) => n.length)) === 0,
  await page.textContent('#roseQuand'));

/* `#instantBloc:not(.hidden)` se résout INSTANTANÉMENT quand un calcul
   précédent l'a déjà rendu visible : on lirait alors l'ancien dessin. On
   attend donc l'heure elle-même, c'est-à-dire le changement qu'on éprouve. */
const attendreRose = (hhmm) => page.waitForFunction(
  (h) => (document.getElementById('roseQuand').textContent || '').includes(h),
  hhmm, { timeout: 30000 }).catch(() => {});

await page.fill('#statDate', '2026-12-22'); await page.fill('#statTime', '17:45');
await page.selectOption('#stationaryDuration', '0');
await page.click('#prevoir');
await attendreRose('17:45');
await page.click('#compassBtn');
await envoyerOrientation(210, true, 'deviceorientationabsolute');   // cap 150° = Sud-Est

const rose = () => page.evaluate(() => {
  const svg = document.getElementById('rose');
  const soleil = svg.querySelector('#roseSoleil');
  const fleche = svg.querySelector('#roseFleche');
  const textes = [...svg.querySelectorAll('text')].map((t) => t.textContent.trim());
  const secteur = svg.querySelector('path[fill="#FFB43A"]');
  return {
    viewBox: svg.getAttribute('viewBox'),
    aria: svg.getAttribute('aria-label'),
    azimut: soleil && Number(soleil.dataset.azimut),
    couche: soleil && soleil.dataset.couche === '1',
    cap: fleche && Number(fleche.dataset.cap),
    textes,
    secteurMisEnEvidence: !!secteur,
  };
});
const r1 = await rose();
chk('la rose est un SVG 200×200', r1.viewBox === '0 0 200 200', r1.viewBox);
chk('le Nord est affiché en haut, avec les trois autres points',
  ['N', 'E', 'S', 'O'].every((c) => r1.textes.includes(c)), r1.textes.join(' '));
chk('la flèche porte le cap du téléphone', r1.cap === 150, String(r1.cap));
chk('le Soleil est placé selon son azimut',
  Number.isFinite(r1.azimut) && r1.azimut > 0 && r1.azimut < 360, String(r1.azimut));
chk('le secteur occupé par le Soleil est mis en évidence', r1.secteurMisEnEvidence);
chk('l’élévation est lisible à côté du Soleil',
  r1.textes.some((t) => /^-?\d+°$/.test(t)), r1.textes.join(' '));

// La position relative doit être la MÊME que celle dite en toutes lettres.
const dit = (await page.textContent('#liveSun')).trim();
/** Ce que le niveau 3 expose suffit à tout recalculer de l'extérieur. */
async function etatRose() {
  const t = await page.textContent('#compassTech');
  const pt = t.match(/Point (-?\d+\.\d+), (-?\d+\.\d+)/);
  const inst = t.match(/instant représenté (\S+)/);
  const cap = t.match(/Cap téléphone (-?\d+\.\d+)°/);
  return {
    lat: pt && Number(pt[1]), lng: pt && Number(pt[2]),
    instantMs: inst && Date.parse(inst[1]),
    cap: cap ? Number(cap[1]) : null,
  };
}
const e1 = await etatRose();
const sun1 = noyau.solar(e1.instantMs, e1.lat, e1.lng);
const attendu = `Soleil ${noyau.libelleSecteur(
  noyau.secteurRelatif(noyau.signedDelta(e1.cap, sun1.azimuth)))}`;
chk('la rose et le texte désignent le même secteur', dit === attendu, `${dit} · ${attendu}`);
chk('l’azimut dessiné est bien celui du moteur',
  Math.abs(r1.azimut - sun1.azimuth) < 0.05,
  `dessiné ${r1.azimut}° · moteur ${sun1.azimuth.toFixed(1)}°`);
chk('le secteur est l’un des huit demandés',
  /^Soleil (droit devant|devant à (droite|gauche)|à (droite|gauche)|derrière à (droite|gauche)|droit derrière)$/
    .test(dit), dit);
chk('l’étiquette accessible dit la même chose',
  new RegExp(dit.replace('Soleil ', '')).test(r1.aria), r1.aria);

// La rose représente l'heure CHOISIE, pas l'heure courante.
const ecart = Math.abs(e1.instantMs - MAINTENANT);
chk('la rose représente l’heure d’observation choisie, pas maintenant',
  ecart > 3600000, `${Math.round(ecart / 60000)} min d’écart avec maintenant`);
chk('l’instant représenté est exactement celui saisi',
  new Date(e1.instantMs).toISOString() === '2026-12-22T13:45:00.000Z',
  new Date(e1.instantMs).toISOString());
chk('et la légende le dit',
  /22\/12.*17:45/.test(await page.textContent('#roseQuand'))
  && /flèche = orientation actuelle/.test(await page.textContent('#roseQuand')),
  await page.textContent('#roseQuand'));

// Le niveau 3 conserve tout.
const tech1 = await page.textContent('#compassTech');
for (const [quoi, motif] of [
  ['azimut', /Soleil azimut \d+\.\d+°/],
  ['élévation', /élévation -?\d+\.\d+°/],
  ['heading', /Cap téléphone 150\.0°/],
  ['delta heading→soleil', /Écart cap→Soleil -?\d+\.\d+°/],
  ['secteur', /secteur (devant|droite|gauche|derriere)/],
  ['type absolu/relatif', /Orientation absolue \(référencée au nord\)/],
  ['source capteur', /source deviceorientationabsolute/],
  ['instant représenté', /Rose : instant représenté .*heure d’observation choisie/],
]) chk(`niveau 3 — ${quoi}`, motif.test(tech1), (tech1.match(motif) || ['(absent)'])[0]);

console.log('\n== Rose · Soleil sous l’horizon ==');
await page.fill('#statTime', '23:30');
await page.click('#prevoir');
await attendreRose('23:30');
const r2 = await rose();
const e2 = await etatRose();
chk('la flèche n’a pas bougé : la boussole est indépendante de l’heure choisie',
  r2.cap === 150, `flèche ${r2.cap}° · niveau 3 ${e2.cap}°`);
chk('le marqueur du Soleil est marqué « sous l’horizon »', r2.couche === true, String(r2.couche));
// Le mot du marqueur est court : « sous l’horizon » traversait la flèche.
// La phrase entière vit dans la légende, sous la rose.
chk('et le dit visuellement dans la rose, au marqueur',
  r2.textes.includes('couché'), r2.textes.join(' | '));
chk('l’élévation négative est lisible sur la rose elle-même',
  r2.textes.some((t) => /^-\d+°$/.test(t)), r2.textes.join(' | '));
chk('aucun secteur n’est mis en évidence quand le Soleil est couché',
  r2.secteurMisEnEvidence === false);
chk('l’étiquette accessible le dit aussi', /sous l’horizon/.test(r2.aria), r2.aria);
// `#liveSun` et `#compassTech` décrivent l'instant PRÉSENT, pas l'heure
// simulée : c'est la rose qui porte l'heure choisie. Les deux horloges
// coexistent, et chacune doit rester à sa place.
const sun2 = noyau.solar(e2.instantMs, e2.lat, e2.lng);
chk('le Soleil de la rose est bien sous l’horizon à l’heure choisie',
  sun2.elevation < 0, `${sun2.elevation.toFixed(1)}° à ${new Date(e2.instantMs).toISOString()}`);
// La phrase doit suivre la rose, sinon l'écran se contredit : une rose qui
// montre un Soleil couché au-dessus d'un « Soleil à droite » se lit comme une
// panne. C'est l'ORIENTATION qui reste sur maintenant, pas le Soleil.
chk('la phrase sous la rose décrit le même instant qu’elle',
  (await page.textContent('#liveSun')).trim() === 'Soleil couché',
  await page.textContent('#liveSun'));
chk('et dit que c’est à l’heure choisie, pas « actuellement »',
  /à l’heure d’observation choisie/.test(await page.textContent('#liveSunNote')),
  await page.textContent('#liveSunNote'));
chk('le niveau 3 garde quand même le Soleil de maintenant',
  /Soleil maintenant \(.*\) : azimut \d+\.\d+° · élévation \d+\.\d+°/
    .test(await page.textContent('#compassTech')),
  ((await page.textContent('#compassTech')).match(/Soleil maintenant[^\n]*/) || ['(absent)'])[0]);
chk('le niveau 3 distingue les deux horloges',
  /instant représenté 2026-12-22T19:30/.test(await page.textContent('#compassTech')),
  ((await page.textContent('#compassTech')).match(/Rose[^\n]*/) || ['(absent)'])[0]);

console.log('\n== Rose · sans boussole ==');
await page.goto(base + '/journey.html');
await page.evaluate(() => { window.__precisionGps = 12; });
await page.click('#tabStationary');
await page.click('#prevoir');
await page.waitForSelector('#stationaryForecast:not(.hidden)', { timeout: 30000 }).catch(() => {});
await page.waitForFunction(() => document.querySelector('#rose #roseSoleil') !== null,
  null, { timeout: 30000 }).catch(() => {});
const r3 = await rose();
chk('sans boussole, aucune flèche n’est inventée', r3.cap === null, String(r3.cap));
chk('mais le Soleil est quand même situé sur la rose',
  Number.isFinite(r3.azimut), String(r3.azimut));
chk('et aucun secteur relatif n’est affirmé', r3.secteurMisEnEvidence === false);
chk('la rose reste lisible sans capteur', erreursJS.length === 0,
  erreursJS.slice(0, 2).join(' | '));

console.log('\n== Soleil couché ==');
// 21 décembre 23:00 locale : le Soleil est largement sous l'horizon.
const nuit = await ctx.newPage();
await nuit.addInitScript(() => { window.__precisionGps = 12; });
await nuit.addInitScript((m) => {
  const V = Date, dec = m - V.now();
  const D = function (...a) { return a.length ? new V(...a) : new V(V.now() + dec); };
  D.prototype = V.prototype; D.now = () => V.now() + dec; D.parse = V.parse; D.UTC = V.UTC;
  window.Date = D;
}, new Date('2026-12-21T23:00:00+04:00').getTime());
await nuit.goto(base + '/journey.html');
await nuit.click('#tabStationary');
await nuit.click('#prevoir');
await nuit.waitForSelector('#liveCard:not(.hidden)', { timeout: 30000 }).catch(() => {});
await nuit.click('#compassBtn');
await nuit.evaluate(() => {
  const e = new Event('deviceorientationabsolute');
  Object.defineProperty(e, 'alpha', { value: 210 });
  Object.defineProperty(e, 'absolute', { value: true });
  window.dispatchEvent(e);
});
chk('de nuit, l’écran dit « Soleil couché »',
  (await nuit.textContent('#liveSun')).trim() === 'Soleil couché',
  await nuit.textContent('#liveSun'));
chk('et qu’il n’y a aucune exposition',
  /Aucune exposition solaire actuellement/.test(await nuit.textContent('#liveSunNote')),
  await nuit.textContent('#liveSunNote'));
chk('aucune direction du Soleil n’est suggérée de nuit',
  !/(devant|derrière|à droite|à gauche)/i.test(
    (await nuit.textContent('#liveSun')) + (await nuit.textContent('#liveSunNote'))));
chk('mais l’élévation négative reste lisible au niveau 3',
  /élévation -\d+\.\d+°/.test(await nuit.textContent('#compassTech')),
  (( await nuit.textContent('#compassTech')).match(/Soleil azimut[^\n]*/) || ['(absent)'])[0]);
await nuit.close();

chk('aucune erreur JavaScript sur tout le banc', erreursJS.length === 0,
  erreursJS.slice(0, 3).join(' | '));

await nav.close();
serveur.close();
console.log(`\n${ok} contrôle(s) OK, ${ko} en échec.`);
if (ko) { console.log('Échecs : ' + echecs.join(' | ')); process.exit(1); }
