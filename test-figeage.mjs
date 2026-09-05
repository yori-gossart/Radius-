/* Banc du figeage — « Le calcul reste figé ».
   ------------------------------------------------------------------
   Relevé du 5 septembre 2026, 17:26 à La Réunion : le bouton est resté
   « Calcul en cours… », grisé, sans erreur, sur l'écran de saisie. Les
   journaux Vercel montrent pourtant les trois appels sortis et répondus —
   /api/route 200 à 13:26:48 UTC, /api/elevation 200 à 13:26:49,
   /api/weather 200 à 13:26:50, une minute après un 502 sur ce même
   /api/weather. Le serveur avait fini ; la page, non.

   Tout ce qui suit `await` dans analyserTrajet est synchrone, et une
   exception y serait rattrapée puis dite. Un bouton figé sans message ne
   peut donc venir que d'une attente qui ne se termine jamais : un corps de
   réponse qui n'arrive pas au bout, et `await r.json()` qui n'a pas de fin.

   Ces cas ont été écrits AVANT la correction et échouaient tous avant elle.

   NODE_PATH=$(npm root -g) node test-figeage.mjs [--cas=<nom>]
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
const GEOM_AB = [[A.lat, A.lng], [B.lat, B.lng]];

/* Les échéances sont lues dans index.html, jamais recopiées : un banc qui
   porte sa propre copie d'une constante finit par tester l'autre valeur. */
const SRC = fs.readFileSync(path.join(RACINE, 'index.html'), 'utf8');
function constante(nom, avantCorrection) {
  const m = SRC.match(new RegExp(`const\\s+${nom}\\s*=\\s*(\\d+)`));
  if (m) return Number(m[1]);
  // Avant la correction, l'échéance n'existe pas : le banc attend quand même,
  // et c'est justement l'attente sans fin qu'il doit montrer.
  console.log(`  (${nom} absent d'index.html — attente de secours ${avantCorrection} ms)`);
  return avantCorrection;
}

/* Le mode « muet » n'envoie jamais de réponse et ne ferme jamais la socket :
   c'est exactement ce qu'a vu le téléphone, et ce qu'aucune erreur `fetch`
   ne vient interrompre côté navigateur. */
const muet = { route: false, elevation: false, weather: false };
const journal = [];
const sockets = new Set();

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

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
const serveur = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const envoyer = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.method === 'POST') {
    const brut = await new Promise((ok) => { let d = ''; req.on('data', (c) => { d += c; }); req.on('end', () => ok(d)); });
    let corps = null; try { corps = JSON.parse(brut); } catch {}
    journal.push({ chemin: url.pathname, corps });
    const cle = url.pathname.replace('/api/', '');
    if (muet[cle]) { sockets.add(res); return; }  // jamais de réponse, jamais de fin
    if (url.pathname === '/api/route') {
      const o = corps?.origin, d = corps?.destination;
      const pr = (p, q) => p && Math.abs(p.lat - q.lat) < 1e-6 && Math.abs(p.lng - q.lng) < 1e-6;
      if (pr(o, A) && pr(d, B)) return envoyer(reponseRoute(GEOM_AB));
      return envoyer({ error: 'Couple inconnu du banc.' }, 404);
    }
    if (url.pathname === '/api/elevation') {
      return envoyer({ provider: 'google-elevation',
        elevations: (corps?.points || []).map(() => ({ elevationM: 0, resolutionM: 9.6 })) });
    }
    if (url.pathname === '/api/weather') {
      const obs = corps?.observations || [];
      return envoyer({ provider: 'open-meteo', attribution: 'Weather data by Open-Meteo.com (CC BY 4.0)',
        resultats: obs.map((o) => ({ status: 'ok', directNormalIrradiance: 640, cloudCover: 12,
          visibility: 24000, precipitation: 0, weatherCode: 1,
          instantValidTime: new Date(o.passageTimeMs).toISOString().slice(0, 16),
          passageTime: new Date(o.passageTimeMs).toISOString().slice(0, 19),
          deltaTimeMinutes: 0, provider: 'open-meteo',
          fetchedAt: new Date().toISOString(), warnings: [] })) });
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

const port = await new Promise((r) => serveur.listen(0, () => r(serveur.address().port)));
const base = `http://127.0.0.1:${port}`;
const nav = await playwright.chromium.launch();
const MAINTENANT = new Date(args.maintenant || '2026-12-20T21:28:00+04:00').getTime();
const ctx = await nav.newContext({ timezoneId: 'Indian/Reunion', locale: 'fr-FR',
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
await page.route('**://fonts.googleapis.com/**', (r) => r.abort());
await page.route('**://fonts.gstatic.com/**', (r) => r.abort());
await page.route('**/nominatim.openstreetmap.org/**', (r) => {
  const q = decodeURIComponent(new URL(r.request().url()).searchParams.get('q') || '');
  const p = /point a/i.test(q) ? A : B;
  r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify([{ display_name: p.label, lat: String(p.lat), lon: String(p.lng) }]) });
});

async function choisir(champ, texte) {
  await page.fill(`#${champ}`, '');
  await page.type(`#${champ}`, texte, { delay: 8 });
  await page.waitForSelector(`#${champ === 'from' ? 'sugFrom' : 'sugTo'} li`, { timeout: 6000 });
  await page.click(`#${champ === 'from' ? 'sugFrom' : 'sugTo'} li`);
}
async function preparer() {
  await page.goto(base + '/index.html');
  await choisir('from', 'Point A'); await choisir('to', 'Point B');
  await page.fill('#date', '2026-12-21'); await page.fill('#time', '06:15');
}
/** Ce que le fondateur voit : l'état exact du bouton principal. */
const bouton = () => page.evaluate(() => ({
  texte: document.getElementById('analyze').textContent.trim(),
  grise: document.getElementById('analyze').disabled,
  verrou: typeof state === 'object' ? state.analyseEnCours : null,
}));
const FIGE = (b) => b.grise || /Calcul en cours/.test(b.texte) || b.verrou === true;
/** Fin d'analyse : un bilan, ou une erreur. Jamais un simple délai d'attente. */
async function attendreFin(ms) {
  try {
    await page.waitForFunction(() => {
      const t = document.getElementById('bilanGrand').textContent;
      const e = document.getElementById('err');
      return (t && t.length > 0) || !e.classList.contains('hide');
    }, null, { timeout: ms });
    return true;
  } catch { return false; }   // figé : les contrôles suivants doivent le dire
}

const CAS = args.cas || 'tous';
const veut = (n) => CAS === 'tous' || CAS === n;
const D_ROUTE = constante('DELAI_ROUTE_MS', 20000);
const D_RELIEF = constante('DELAI_RELIEF_MS', 12000);
const D_METEO = constante('DELAI_METEO_MS', 12000);
console.log(`Échéances lues dans index.html — route ${D_ROUTE} ms · relief ${D_RELIEF} ms · météo ${D_METEO} ms`);

/* ── F-001 — /api/route muet : une échéance, une erreur, un bouton rendu ── */
if (veut('F-001')) {
  console.log('\n== F-001 — Google Routes ne répond jamais ==');
  muet.route = true;
  await preparer();
  await page.click('#analyze');
  await page.waitForTimeout(1500);
  const pendant = await bouton();
  chk('F-001 le bouton dit que ça calcule pendant l’attente', FIGE(pendant), pendant.texte);
  await attendreFin(D_ROUTE + 8000);
  const apres = await bouton();
  muet.route = false;
  chk('F-001 le calcul se termine, il ne reste pas figé', !FIGE(apres),
    `${apres.texte} · grisé ${apres.grise}`);
  chk('F-001 le bouton retrouve son libellé', apres.texte === 'Analyser le trajet', apres.texte);
  const err = await page.textContent('#err');
  chk('F-001 l’échec est dit, avec sa durée', /n.a pas répondu en \d+ s/.test(err), err.trim());
  chk('F-001 aucun repli silencieux sur un ancien résultat',
    await page.evaluate(() => document.getElementById('result').classList.contains('hide')));
}

/* ── F-002 — /api/weather muet : la météo est passive, elle ne bloque rien ── */
if (veut('F-002')) {
  console.log('\n== F-002 — Open-Meteo ne répond jamais ==');
  muet.weather = true;
  await preparer();
  await page.click('#analyze');
  await attendreFin(D_METEO + 12000);
  const apres = await bouton();
  muet.weather = false;
  chk('F-002 le trajet s’affiche malgré la météo muette',
    await page.evaluate(() => !document.getElementById('result').classList.contains('hide')));
  chk('F-002 le bilan est bien celui du trajet',
    (await page.textContent('#bilanGrand')).trim().length > 0,
    (await page.textContent('#bilanGrand')).trim());
  chk('F-002 le bouton n’est pas resté figé', !FIGE(apres), `${apres.texte} · grisé ${apres.grise}`);
  const tech = await page.textContent('#techGlobal');
  chk('F-002 la panne météo est nommée au niveau 3', /Météo erreur.*n.a pas répondu en \d+ s/s.test(tech),
    (tech.match(/Météo erreur[^\n]*/) || ['(rien)'])[0]);
  const inconnu = await page.evaluate(() =>
    state.result.zones.every((z) => z.weatherContext && z.weatherContext.status === 'unknown'));
  chk('F-002 aucune valeur météo inventée : statut inconnu partout', inconnu);
}

/* ── F-003 — /api/elevation muet : le relief non plus ne bloque rien ── */
if (veut('F-003')) {
  console.log('\n== F-003 — Google Elevation ne répond jamais ==');
  muet.elevation = true;
  await preparer();
  await page.click('#analyze');
  await attendreFin(D_RELIEF + 12000);
  const apres = await bouton();
  muet.elevation = false;
  chk('F-003 le trajet s’affiche malgré le relief muet',
    await page.evaluate(() => !document.getElementById('result').classList.contains('hide')));
  chk('F-003 le bouton n’est pas resté figé', !FIGE(apres), `${apres.texte} · grisé ${apres.grise}`);
  const tech = await page.textContent('#techGlobal');
  chk('F-003 la panne relief est nommée au niveau 3', /Relief erreur.*n.a pas répondu en \d+ s/s.test(tech),
    (tech.match(/Relief erreur[^\n]*/) || ['(rien)'])[0]);
  const inconnu = await page.evaluate(() => {
    const z = state.result.zones.filter((x) => x.terrainOcclusion);
    return z.length > 0 && z.every((x) => x.terrainOcclusion.status === 'unknown');
  });
  chk('F-003 le relief reste « inconnu », jamais « soleil libre » par défaut', inconnu);
  chk('F-003 la météo, elle, a bien été interrogée',
    journal.filter((j) => j.chemin === '/api/weather').length > 0);
}

/* ── F-004 — une panne dans la remise à zéro ne doit pas geler la page ──
   Cette région tournait hors du try/finally : n'importe quelle exception y
   laissait le verrou posé et le bouton grisé à vie, sans un mot. */
if (veut('F-004')) {
  console.log('\n== F-004 — une exception avant le réseau ==');
  await preparer();
  await page.evaluate(() => {
    const vrai = window.viderAffichageTrajet || viderAffichageTrajet;
    let tire = false;
    // eslint-disable-next-line no-global-assign
    globalThis.__vider = vrai;
    viderAffichageTrajet = function () {
      if (!tire) { tire = true; throw new TypeError('panne simulée dans la remise à zéro'); }
      return vrai.apply(this, arguments);
    };
  }).catch(() => {});
  const remplacable = await page.evaluate(() => {
    try { return typeof viderAffichageTrajet === 'function'; } catch { return false; }
  });
  const routesAvant = journal.filter((j) => j.chemin === '/api/route').length;
  await page.click('#analyze');
  await page.waitForTimeout(2500);
  const apres = await bouton();
  chk('F-004 la fonction de remise à zéro est bien atteignable par le banc', remplacable);
  chk('F-004 le bouton n’est pas resté figé', !FIGE(apres), `${apres.texte} · grisé ${apres.grise}`);
  chk('F-004 la panne est dite, pas avalée',
    !(await page.evaluate(() => document.getElementById('err').classList.contains('hide'))),
    (await page.textContent('#err')).trim());
  chk('F-004 aucune requête n’est partie sur une remise à zéro ratée',
    journal.filter((j) => j.chemin === '/api/route').length === routesAvant);
}

/* ── F-005 — après une échéance, l'application reste utilisable ── */
if (veut('F-005')) {
  console.log('\n== F-005 — une échéance ne condamne pas la session ==');
  muet.route = true;
  await preparer();
  await page.click('#analyze');
  await attendreFin(D_ROUTE + 8000);
  muet.route = false;
  await page.click('#analyze');
  await attendreFin(20000);
  const apres = await bouton();
  chk('F-005 le second essai aboutit', await page.evaluate(() =>
    !document.getElementById('result').classList.contains('hide')));
  chk('F-005 le bouton est de nouveau disponible', !FIGE(apres), `${apres.texte} · grisé ${apres.grise}`);
  chk('F-005 aucune erreur JavaScript sur tout le banc', erreursJS.length === 0,
    erreursJS.slice(0, 3).join(' | '));
}

for (const s of sockets) { try { s.destroy(); } catch {} }
await nav.close();
serveur.close();
console.log(`\n${ok} contrôle(s) OK, ${ko} en échec.`);
if (ko) { console.log('Échecs : ' + echecs.join(' | ')); process.exit(1); }
