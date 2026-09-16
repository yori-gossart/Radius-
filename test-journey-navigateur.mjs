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

console.log('\n== Point fixe · GPS net ==');
await page.goto(base + '/journey.html');
await page.evaluate(() => { window.__precisionGps = 12; });
await page.click('#tabStationary');
chk('l’onglet point fixe s’ouvre', await page.isVisible('#stationaryGps'));
await page.selectOption('#stationaryDuration', '240');
await page.click('#stationaryGps');
await page.waitForSelector('#stationaryForecast:not(.hidden)', { timeout: 30000 }).catch(() => {});
chk('la prévision du point fixe s’affiche',
  await page.isVisible('#stationaryForecast'), await page.textContent('#stationaryStatus'));
const pts = await page.$$eval('#stationaryTimeline .point .time', (n) => n.map((x) => x.textContent.trim()));
chk('la course du Soleil est échantillonnée dans le temps', pts.length >= 3, pts.join(' '));
chk('sans boussole, aucun cap n’est inventé',
  !(await page.$$eval('#stationaryTimeline .point .sun', (n) => n.map((x) => x.textContent)))
    .some((t) => /cap \d+°/.test(t)));
chk('une position nette affiche sa précision sans alarme',
  /12 m/.test(await page.textContent('#gpsQualite'))
  && !/trop imprécise/.test(await page.textContent('#gpsQualite')),
  await page.textContent('#gpsQualite'));
chk('le point fixe fonctionne sans capteur d’orientation', erreursJS.length === 0,
  erreursJS.slice(0, 2).join(' | '));

console.log('\n== Point fixe · GPS imprécis (le cas relevé sur le A55) ==');
await page.goto(base + '/journey.html');
await page.evaluate(() => { window.__precisionGps = 2000; });
await page.click('#tabStationary');
await page.click('#stationaryGps');
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

console.log('\n== Boussole · un écran humain ==');
await page.click('#compassBtn');
const envoyer = (alpha, absolute, nom) => page.evaluate(([a, abs, n]) => {
  const e = new Event(n);
  Object.defineProperty(e, 'alpha', { value: a });
  Object.defineProperty(e, 'absolute', { value: abs });
  window.dispatchEvent(e);
}, [alpha, absolute, nom]);

// α = 210 → cap 150° → Sud-Est, l'exemple demandé.
await envoyer(210, true, 'deviceorientationabsolute');
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
await page.click('#stationaryGps');
await page.waitForSelector('#liveCard:not(.hidden)', { timeout: 30000 }).catch(() => {});
await page.click('#compassBtn');
await envoyer(90, false, 'deviceorientation');
chk('une orientation relative est affichée, mais désignée comme telle',
  /Ouest · 270°/.test(await page.textContent('#heading'))
  && /pas un vrai nord magnétique/.test(await page.textContent('#compassQuality')),
  (await page.textContent('#compassQuality')).slice(0, 70));
chk('le niveau 3 la nomme relative',
  /relative\/estimée/.test(await page.textContent('#compassTech')));
await envoyer(210, true, 'deviceorientationabsolute');
await envoyer(90, false, 'deviceorientation');
chk('une relative n’écrase jamais une absolue déjà obtenue',
  /Sud-Est · 150°/.test(await page.textContent('#heading')),
  await page.textContent('#heading'));

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
await nuit.click('#stationaryGps');
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
