/* Banc de test aller / retour.
   ------------------------------------------------------------------
   Pilote index.html dans un vrai navigateur, devant un faux Google
   Routes / Elevation / Open-Meteo qui enregistre chaque requête reçue.
   C'est le seul moyen de prouver ce que la mission demande : que le
   retour DEMANDE une nouvelle route et n'inverse pas la géométrie.

   Prérequis (hors dépôt, aucune dépendance ajoutée) :
     NODE_PATH=$(npm root -g) node test-aller-retour.mjs

   Options :
     --racine=<dossier>   servir index.html depuis ailleurs (test M)
     --scenario=aller     ne jouer que l'aller (test M)
*/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const args = Object.fromEntries(process.argv.slice(2)
  .map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? '1']));
const RACINE = path.resolve(args.racine || process.cwd());
const SCENARIO = args.scenario || 'complet';

let playwright;
try {
  playwright = createRequire(import.meta.url)('playwright');
} catch {
  console.error('Playwright introuvable. Lancer avec : NODE_PATH=$(npm root -g) node test-aller-retour.mjs');
  process.exit(2);
}

/* ══════════ géométrie fictive ══════════
   L'aller est une droite ; le retour est un tout autre chemin, à trois
   sommets, plus long, dont la grande branche part au sud-ouest. Si un jour
   quelqu'un remplace la requête retour par oldCoords.reverse(), la géométrie
   analysée cessera de passer par C et le test le verra. */
const A = { lat: -20.88, lng: 55.45, label: 'Point A — Réunion est' };
const B = { lat: -20.94117, lng: 55.57849, label: 'Point B — Réunion ouest' };
const B2 = { lat: -20.923476, lng: 55.575151 };         // amorce nord, propre au retour
const C  = { lat: -20.969029, lng: 55.470588 };         // longue branche au sud-ouest

/* Trajet « riche » : six branches dont les caps balaient l'azimut du soleil
   levant, séparées par des tronçons hors axe plus longs que mergeGapMeters.
   Il produit les trois niveaux à la fois — sans quoi l'empreinte de
   non-régression ne porterait que sur une zone, et les zones faibles ne
   seraient jamais exercées. */
const D = { lat: -21.027954, lng: 55.550229, label: 'Point D — sud de l’île' };
const GEOM_RICHE = [
  [-20.88, 55.45], [-20.90106, 55.503108], [-20.912729, 55.495896],
  [-20.948795, 55.538772], [-20.960464, 55.53156], [-21.004615, 55.564652],
  [-21.027954, 55.550229],
];
const DEPART_RICHE = '2026-12-21T06:00';

const MAINTENANT = new Date(args.maintenant || '2026-12-21T18:05:00+04:00').getTime();
const DEPART_ALLER = '2026-12-21T06:15';                // saisi dans le formulaire

const GEOM_ALLER  = [[A.lat, A.lng], [B.lat, B.lng]];
const GEOM_RETOUR = [[B.lat, B.lng], [B2.lat, B2.lng], [C.lat, C.lng], [A.lat, A.lng]];

/* ══════════ faux serveur ══════════ */
const journal = [];
let prochaineRouteEchoue = false;
let delaiRouteMs = 0;

function metres(g) {
  const Rt = 6371008.8, r = Math.PI / 180;
  let t = 0;
  for (let i = 1; i < g.length; i++) {
    const [la0, lo0] = g[i - 1], [la1, lo1] = g[i];
    const x = (lo1 - lo0) * r * Math.cos((la0 + la1) / 2 * r);
    const y = (la1 - la0) * r;
    t += Rt * Math.hypot(x, y);
  }
  return t;
}

function reponseRoute(geom) {
  const m = metres(geom);
  const statique = m / 16;                      // ~58 km/h
  const steps = [];
  for (let i = 1; i < geom.length; i++) {
    const seg = [geom[i - 1], geom[i]];
    const sm = metres(seg);
    steps.push({ distanceMeters: sm, staticDurationSeconds: sm / 16, coordinates: seg });
  }
  return {
    provider: 'google-routes', routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
    trafficModel: 'BEST_GUESS', trafficBasis: 'REQUESTED_DEPARTURE',
    distanceMeters: m, durationSeconds: statique * 1.1, staticDurationSeconds: statique,
    trafficFactor: 1.1, geometry: geom, steps,
  };
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
               '.svg': 'image/svg+xml' };

const serveur = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const envoyer = (o, s = 200) => {
    res.writeHead(s, { 'content-type': 'application/json' });
    res.end(JSON.stringify(o));
  };

  if (req.method === 'POST') {
    const brut = await new Promise((ok) => {
      let d = ''; req.on('data', (c) => { d += c; }); req.on('end', () => ok(d));
    });
    let corps = null;
    try { corps = JSON.parse(brut); } catch {}
    journal.push({ chemin: url.pathname, corps, tMs: Date.now() });

    if (url.pathname === '/api/route') {
      if (delaiRouteMs) await new Promise((r2) => setTimeout(r2, delaiRouteMs));
      if (prochaineRouteEchoue) {
        prochaineRouteEchoue = false;
        return envoyer({ error: 'Panne simulée du service d’itinéraire.' }, 502);
      }
      // Le sens est décidé par les coordonnées reçues, jamais par un compteur :
      // c'est ce qui rend le test D significatif.
      const o = corps?.origin, d = corps?.destination;
      const proche = (p, q) => Math.abs(p.lat - q.lat) < 1e-6 && Math.abs(p.lng - q.lng) < 1e-6;
      if (proche(o, A) && proche(d, B)) return envoyer(reponseRoute(GEOM_ALLER));
      if (proche(o, B) && proche(d, A)) return envoyer(reponseRoute(GEOM_RETOUR));
      if (proche(o, A) && proche(d, D)) return envoyer(reponseRoute(GEOM_RICHE));
      return envoyer({ error: 'Couple origine/destination inconnu du banc de test.' }, 404);
    }

    if (url.pathname === '/api/elevation') {
      return envoyer({
        provider: 'google-elevation',
        elevations: (corps?.points || []).map(() => ({ elevationM: 0, resolutionM: 9.6 })),
      });
    }

    if (url.pathname === '/api/weather') {
      const obs = corps?.observations || [];
      return envoyer({
        provider: 'open-meteo',
        attribution: 'Weather data by Open-Meteo.com (CC BY 4.0)',
        resultats: obs.map((o) => ({
          status: 'ok', directNormalIrradiance: 640, cloudCover: 12, visibility: 24000,
          precipitation: 0, weatherCode: 1,
          instantValidTime: new Date(o.passageTimeMs).toISOString().slice(0, 16),
          passageTime: new Date(o.passageTimeMs).toISOString().slice(0, 19),
          deltaTimeMinutes: 0, provider: 'open-meteo',
          fetchedAt: new Date().toISOString(), warnings: [],
        })),
      });
    }
    return envoyer({ error: 'inconnu' }, 404);
  }

  const nom = url.pathname === '/' ? '/index.html' : url.pathname;
  const f = path.join(RACINE, nom);
  if (!f.startsWith(RACINE) || !fs.existsSync(f)) { res.writeHead(404); return res.end('non'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'text/plain' });
  res.end(fs.readFileSync(f));
});

/* ══════════ contrôles ══════════ */
let ok = 0, ko = 0;
const echecs = [];
function chk(nom, condition, detail = '') {
  if (condition) { ok++; console.log(`  PASS  ${nom}${detail ? ' — ' + detail : ''}`); }
  else { ko++; echecs.push(nom); console.log(`  ÉCHEC ${nom}${detail ? ' — ' + detail : ''}`); }
}
const routes = () => journal.filter((j) => j.chemin === '/api/route');
const elevations = () => journal.filter((j) => j.chemin === '/api/elevation');
const meteos = () => journal.filter((j) => j.chemin === '/api/weather');

/* Distance d'un point à un segment, en mètres — sert à prouver qu'un point
   interrogé appartient bien à la géométrie retour et pas à celle de l'aller. */
function distPolyline(lat, lng, geom) {
  const r = Math.PI / 180, Rt = 6371008.8;
  const X = (la, lo) => [Rt * lo * r * Math.cos(lat * r), Rt * la * r];
  const [px, py] = X(lat, lng);
  let best = Infinity;
  for (let i = 1; i < geom.length; i++) {
    const [ax, ay] = X(geom[i - 1][0], geom[i - 1][1]);
    const [bx, by] = X(geom[i][0], geom[i][1]);
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

/* ══════════ pilotage ══════════ */
const port = await new Promise((r2) => serveur.listen(0, () => r2(serveur.address().port)));
const base = `http://127.0.0.1:${port}`;
const navigateur = await playwright.chromium.launch();
const contexte = await navigateur.newContext({
  timezoneId: 'Indian/Reunion', locale: 'fr-FR',
  permissions: ['geolocation', 'notifications'],
  geolocation: { latitude: A.lat, longitude: A.lng },
});

// Horloge figée : sans elle, « maintenant » dépendrait du jour où le test tourne
// et le soleil du retour ne serait pas reproductible. Seul Date est décalé ;
// les minuteries restent réelles.
await contexte.addInitScript((maintenant) => {
  const Vraie = Date;
  const decalage = maintenant - Vraie.now();
  const D = function (...a) { return a.length ? new Vraie(...a) : new Vraie(Vraie.now() + decalage); };
  D.prototype = Vraie.prototype;
  D.now = () => Vraie.now() + decalage;
  D.parse = Vraie.parse; D.UTC = Vraie.UTC;
  window.Date = D;
}, MAINTENANT);

const page = await contexte.newPage();
const navigations = [];
// Les webfonts sortent du réseau et n'ont aucun effet sur le calcul : les
// couper rend le test plus rapide et surtout indépendant de l'accès internet.
await page.route('**://fonts.googleapis.com/**', (r) => r.abort());
await page.route('**://fonts.gstatic.com/**', (r) => r.abort());
await page.route('**/nominatim.openstreetmap.org/**', (r) => {
  const q = decodeURIComponent(new URL(r.request().url()).searchParams.get('q') || '');
  // « ouest » contient « est » : le discriminant doit être le nom du point.
  const p = /point a/i.test(q) ? A : /point d/i.test(q) ? D : B;
  r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify([{ display_name: p.label, lat: String(p.lat), lon: String(p.lng) }]) });
});
await page.route('**://www.google.com/**', (r) => {
  navigations.push(r.request().url());
  r.fulfill({ status: 200, contentType: 'text/html', body: 'maps' });
});
await page.route('**://waze.com/**', (r) => {
  navigations.push(r.request().url());
  r.fulfill({ status: 200, contentType: 'text/html', body: 'waze' });
});

async function choisir(champ, texte) {
  await page.fill(`#${champ}`, '');
  await page.type(`#${champ}`, texte, { delay: 10 });
  const liste = champ === 'from' ? '#sugFrom' : '#sugTo';
  await page.waitForSelector(`${liste} li`, { timeout: 5000 });
  await page.click(`${liste} li`);
}

async function saisirAller() {
  await choisir('from', 'Point A est');
  await choisir('to', 'Point B ouest');
  const [d, h] = DEPART_ALLER.split('T');
  await page.fill('#date', d);
  await page.fill('#time', h);
}

/* Pendant un retour, l'écran de résultat reste affiché mais vidé : attendre
   « #result visible » rendrait la main tout de suite et on lirait l'écran
   vide. Le seul signal fiable est un verdict rendu, ou une erreur montrée. */
async function attendreFinAnalyse() {
  await page.waitForFunction(() => {
    const t = document.getElementById('bilanGrand')       // UX V1
           || document.getElementById('vTitle');          // version d'avant l'UX V1
    const e = document.getElementById('err');
    return (t && t.textContent.length > 0) || !e.classList.contains('hide');
  }, null, { timeout: 20000 });
}

/* Le retour n'est plus un clic mais une intention : ouvrir le panneau,
   choisir une heure, puis calculer. C'est tout l'objet du correctif. */
async function ouvrirRetour(depuis = 'resultat') {
  await page.click(depuis === 'suivi' ? '#retourTrack' : '#retourResult');
  await page.waitForSelector('#retourPanneau:not(.hide)', { timeout: 5000 });
  return page.evaluate(() => ({
    date: document.getElementById('retourDate').value,
    heure: document.getElementById('retourTime').value,
    sens: document.getElementById('retourSens').textContent.trim(),
    boutonActif: !document.getElementById('retourCalculer').disabled,
    avisSuivi: !document.getElementById('retourAvis').classList.contains('hide'),
  }));
}

async function calculerRetour({ date, heure, maintenant } = {}) {
  if (maintenant) await page.click('#retourMaintenant');
  if (date) await page.fill('#retourDate', date);
  if (heure) await page.fill('#retourTime', heure);
  await page.click('#retourCalculer');
  await attendreFinAnalyse();
}

async function analyser() {
  await page.click('#analyze');
  await attendreFinAnalyse();
  if (await page.isVisible('#err')) {
    throw new Error('analyse refusée par l’application : ' + (await page.textContent('#err')));
  }
}

/* Empreinte du résultat lisible SUR LES DEUX VERSIONS — avant et après l'UX
   V1. Elle ne compare que ce que les deux savent montrer : le nombre de zones,
   leur niveau, et pour chacune la distance, la longueur et l'heure affichées.
   Les valeurs exactes se comparent ailleurs, sur les charges utiles réseau. */
async function etatResultat() {
  return page.evaluate(() => {
    const nombres = (t) => (t.match(/[\d]+[,.]?[\d]*\s*(?:km|m)\b/g) || []).join(' | ');
    const cartes = [...document.querySelectorAll('.zc')];
    let zones;
    if (cartes.length) {                                   // UX V1
      zones = cartes.map((c) => ({
        niveau: ['low', 'moderate', 'high'].find((k) => c.classList.contains(k)),
        heure: (c.querySelector('.heure').textContent.match(/\d{2}:\d{2}/) || [''])[0],
        ou: nombres(c.querySelector('.ou').textContent),
      }));
    } else {                                               // version d'avant
      zones = [...document.querySelectorAll('#zoneList li')].map((li) => ({
        niveau: ['low', 'moderate', 'high'].find(
          (k) => li.querySelector('.dot') && li.querySelector('.dot').classList.contains(k)),
        heure: ((li.querySelector('.zk') || { textContent: '' }).textContent
          .match(/\d{2}:\d{2}/) || [''])[0],
        ou: nombres((li.querySelector('.zt span') || { textContent: '' }).textContent),
      }));
    }
    zones = zones.filter((z) => z.niveau).sort((a, b) => a.ou.localeCompare(b.ou));
    return { nZones: zones.length, zones };
  });
}

await page.goto(base + '/index.html');
console.log(`\nRadius aller/retour — racine ${RACINE}, scénario ${SCENARIO}\n`);

/* ---------- scénario « retour planifié » : le correctif ----------
   Horloge figée la VEILLE de l'aller. Si le panneau Retour proposait la date
   du jour, il proposerait le 20 pour un aller le 21 — c'est exactement le
   défaut corrigé ici. */
if (SCENARIO === 'planifie') {
  const JOUR_ALLER = '2026-12-21';
  const HEURE_ALLER = '06:15';
  const HEURE_RETOUR = '17:30';
  /* L'attendu doit être lu dans le fuseau de la PAGE (Indian/Reunion), pas
     dans celui du conteneur qui fait tourner le test — sans quoi le test
     accuserait le produit d'un décalage qui est le sien. */
  const p2 = (v) => String(v).padStart(2, '0');
  const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Indian/Reunion',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const [JOUR_AUJOURD_HUI, HEURE_AUJOURD_HUI] = fmt.format(new Date(MAINTENANT)).split(' ');
  console.log(`horloge de l’appareil : ${JOUR_AUJOURD_HUI} ${HEURE_AUJOURD_HUI} `
    + `(heure de La Réunion) · aller demandé le ${JOUR_ALLER} à ${HEURE_ALLER}\n`);

  await choisir('from', 'Point A est');
  await choisir('to', 'Point B ouest');
  await page.fill('#date', JOUR_ALLER);
  await page.fill('#time', HEURE_ALLER);
  await analyser();
  const routeAllerP = routes().at(-1);
  chk('préalable — l’aller est bien analysé à la date demandée',
    routeAllerP.corps.departureMs === new Date(`${JOUR_ALLER}T${HEURE_ALLER}:00+04:00`).getTime());

  /* ---- TEST A ---- */
  const avantOuverture = routes().length;
  const pan = await ouvrirRetour();
  chk('TEST A — la date proposée est celle de l’ALLER, pas aujourd’hui',
    pan.date === JOUR_ALLER, `proposé ${pan.date} · aujourd’hui ${JOUR_AUJOURD_HUI}`);
  chk('TEST A — aucune heure n’est inventée', pan.heure === '', `heure « ${pan.heure} »`);
  chk('TEST A — rien ne peut être calculé sans choix explicite', !pan.boutonActif);
  chk('TEST A — ouvrir le panneau ne déclenche aucune requête Google',
    routes().length === avantOuverture);
  chk('TEST A — le panneau annonce le sens du retour',
    /Point B.*→.*Point A/.test(pan.sens), pan.sens);

  /* Annuler ne doit rien avoir changé : les endpoints restent dans le sens aller. */
  await page.click('#retourAnnuler');
  chk('TEST A — Annuler n’inverse rien et ne calcule rien',
    !(await page.isVisible('#retourPanneau')) && routes().length === avantOuverture);

  /* ---- TEST B ---- */
  await ouvrirRetour();
  await calculerRetour({ heure: HEURE_RETOUR });
  const routeRet = routes().at(-1);
  const attendu = new Date(`${JOUR_ALLER}T${HEURE_RETOUR}:00+04:00`).getTime();
  chk('TEST B — nouvelle requête Google B → A',
    routes().length === avantOuverture + 1
    && routeRet.corps.origin.lat === B.lat && routeRet.corps.destination.lat === A.lat);
  chk('TEST B — departureMs = la date ET l’heure choisies',
    routeRet.corps.departureMs === attendu,
    `${new Date(routeRet.corps.departureMs).toISOString()} attendu ${new Date(attendu).toISOString()}`);
  chk('TEST B — surtout : ce n’est PAS l’heure de l’appareil',
    Math.abs(routeRet.corps.departureMs - MAINTENANT) > 3600000,
    `${Math.round((routeRet.corps.departureMs - MAINTENANT) / 60000)} min d’écart avec « maintenant »`);

  /* ---- TEST D ---- */
  chk('TEST D — deux requêtes Google, deux géométries indépendantes',
    routes().length === 2
    && JSON.stringify(routes()[0].corps.origin) !== JSON.stringify(routes()[1].corps.origin));

  /* ---- TEST E ---- */
  const obsRetour = meteos().at(-1).corps.observations;
  const obsAller = meteos()[0].corps.observations;
  chk('TEST E — les passages météo du retour sont à l’heure du RETOUR',
    obsRetour.length > 0 && obsRetour.every((o) => o.passageTimeMs >= attendu
      && o.passageTimeMs < attendu + 4 * 3600000),
    obsRetour.map((o) => new Date(o.passageTimeMs).toISOString().slice(11, 16)).join(' '));
  chk('TEST E — aucun passage de l’aller n’est réutilisé',
    !obsRetour.some((o) => obsAller.some((a) => a.passageTimeMs === o.passageTimeMs)));
  chk('TEST E — le relief est réinterrogé sur les zones du retour',
    elevations().length === 2 && elevations()[0].corps.points[0][0] !== elevations()[1].corps.points[0][0]);

  /* ---- TEST C : « Maintenant » reste possible, mais volontairement ---- */
  await ouvrirRetour();
  const avantMaintenant = await page.inputValue('#retourTime');
  await page.click('#retourMaintenant');
  const apresMaintenant = await page.evaluate(() => ({
    date: document.getElementById('retourDate').value,
    heure: document.getElementById('retourTime').value,
  }));
  chk('TEST C — « Maintenant » remplit les champs avec l’heure réelle',
    apresMaintenant.date === JOUR_AUJOURD_HUI
    && apresMaintenant.heure === HEURE_AUJOURD_HUI,
    `${apresMaintenant.date} ${apresMaintenant.heure}`);
  chk('TEST C — « Maintenant » ne lance aucun calcul par lui-même',
    routes().length === 2 && avantMaintenant !== apresMaintenant.heure);
  const avantC = routes().length;
  await page.click('#retourCalculer');
  await attendreFinAnalyse();
  chk('TEST C — le calcul lancé après « Maintenant » utilise bien l’heure réelle',
    routes().length === avantC + 1
    && Math.abs(routes().at(-1).corps.departureMs - MAINTENANT) < 60000);

  /* ---- TEST F ---- */
  await page.click('#back');
  const avantF = await page.evaluate(() => [document.getElementById('from').value,
                                            document.getElementById('to').value]);
  const routesAvantF = routes().length;
  await page.click('#swap');
  const apresF = await page.evaluate(() => [document.getElementById('from').value,
                                            document.getElementById('to').value]);
  chk('TEST F — ↕ Inverser fonctionne toujours seul, sans requête',
    apresF[0] === avantF[1] && apresF[1] === avantF[0] && routes().length === routesAvantF);

  if (args.capture) {
    // On est déjà sur l'écran de saisie après le TEST F, champs inversés.
    await page.fill('#date', JOUR_ALLER); await page.fill('#time', HEURE_ALLER);
    await analyser();
    await ouvrirRetour();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${args.capture}/panneau-retour.png`, fullPage: true });
    console.log('capture écrite');
  }
  await navigateur.close(); serveur.close();
  console.log(`\n${ok} contrôle(s) PASS, ${ko} ÉCHEC.`);
  if (ko) { console.log('Échecs : ' + echecs.join(' | ')); process.exit(1); }
  process.exit(0);
}

/* ---------- scénario « riche » : trois niveaux dans un seul trajet ---------- */
if (SCENARIO === 'riche') {
  await choisir('from', 'Point A est');
  await choisir('to', 'Point D sud');
  const [d0, h0] = DEPART_RICHE.split('T');
  await page.fill('#date', d0); await page.fill('#time', h0);
  await page.click('#analyze');
  await attendreFinAnalyse();
  if (await page.isVisible('#err')) throw new Error(await page.textContent('#err'));
  const res = await etatResultat();
  fs.writeFileSync(args.sortie || '/dev/stdout', JSON.stringify({
    resultat: res,
    route: routes().at(-1)?.corps,
    elevationPoints: elevations().at(-1)?.corps?.points ?? [],
    meteoObservations: meteos().at(-1)?.corps?.observations ?? [],
    appels: { route: routes().length, elevation: elevations().length, meteo: meteos().length },
  }, null, 2));
  console.log('RICHE :', JSON.stringify(res));
  if (args.ux) {
    const n1r = await page.evaluate(() => {
      const n = document.querySelector('#result').cloneNode(true);
      n.querySelectorAll('details, .hide').forEach((x) => x.remove());
      return n.textContent.replace(/\s+/g, ' ').trim();
    });
    const compte = await page.evaluate(() => ({
      importantes: document.getElementById('zoneCartes').querySelectorAll('.zc').length,
      faibles: document.getElementById('zoneFaibles').querySelectorAll('.zc').length,
      boutonVisible: !document.getElementById('voirFaibles').classList.contains('hide'),
      faiblesCachees: document.getElementById('zoneFaibles').classList.contains('hide'),
      marques: document.querySelectorAll('#ligneRail .marque').length,
    }));
    console.log('\nUX sur trajet à trois niveaux');
    chk('§8 — les zones importantes sont en tête', compte.importantes >= 2,
      `${compte.importantes} importante(s)`);
    chk('§8 — les zones faibles sont repliées derrière un bouton',
      compte.faibles >= 1 && compte.faiblesCachees && compte.boutonVisible,
      `${compte.faibles} faible(s)`);
    chk('§7 — une marque par zone sur la ligne de trajet',
      compte.marques === compte.importantes + compte.faibles, `${compte.marques} marque(s)`);
    chk('§8 — aucune zone n’est supprimée des données',
      compte.importantes + compte.faibles === res.nZones);
    chk('§21 — pas de jargon malgré trois niveaux',
      !['DNI', 'W/m²', 'UTC', 'seuil', 'score'].some((j) => n1r.includes(j)));
    await page.click('#voirFaibles');
    chk('§8 — le bouton révèle bien les passages faibles',
      await page.evaluate(() => !document.getElementById('zoneFaibles').classList.contains('hide')));
    console.log(`\n${ok} contrôle(s) PASS, ${ko} ÉCHEC.`);
  }
  if (args.capture) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${args.capture}/resultat.png`, fullPage: true });
    await page.click('#sim');
    await page.waitForSelector('#tracking:not(.hide)');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${args.capture}/suivi.png`, fullPage: true });
    await page.click('#stopTrack');
    await page.evaluate(() => document.querySelectorAll('details')
      .forEach((d) => { d.open = true; }));
    await page.screenshot({ path: `${args.capture}/ouvert.png`, fullPage: true });
    await page.goto(base + '/index.html');
    await page.screenshot({ path: `${args.capture}/saisie.png`, fullPage: true });
    console.log('captures écrites dans ' + args.capture);
  }
  await navigateur.close(); serveur.close();
  process.exit(ko ? 1 : 0);
}

/* ---------- ALLER (sert aussi de référence au TEST M) ---------- */
await saisirAller();
await analyser();
const refAller = await etatResultat();
const routeAller = routes().at(-1);
const elevAller = elevations().at(-1);
const meteoAller = meteos().at(-1);

console.log('ALLER de référence :', JSON.stringify(refAller));

if (SCENARIO === 'aller') {
  fs.writeFileSync(args.sortie || '/dev/stdout', JSON.stringify({
    resultat: refAller,
    // Charges utiles réseau : ce sont des SORTIES du moteur, aux flottants
    // près — lat, lng, azimut et instant de passage de chaque zone retenue,
    // dans l'ordre RANK puis score. Identiques des deux côtés ou le moteur a bougé.
    route: routeAller?.corps,
    elevationPoints: elevAller?.corps?.points ?? [],
    meteoObservations: meteoAller?.corps?.observations ?? [],
    appels: { route: routes().length, elevation: elevations().length, meteo: meteos().length },
  }, null, 2));
  await navigateur.close(); serveur.close();
  process.exit(0);
}

chk('aller — une seule requête Google', routes().length === 1);
chk('aller — origin = A, destination = B',
  Math.abs(routeAller.corps.origin.lat - A.lat) < 1e-9
  && Math.abs(routeAller.corps.destination.lng - B.lng) < 1e-9);
chk('aller — des zones existent (sinon relief et météo ne seraient jamais appelés)',
  refAller.nZones > 0, `${refAller.nZones} zone(s)`);
chk('aller — relief et météo interrogés', elevations().length === 1 && meteos().length === 1);

/* ---------- TEST A / B / C : inversion pure ---------- */
console.log('\nTEST A/B/C — inversion des champs');
await page.click('#back');
const avant = await page.evaluate(() => [document.getElementById('from').value,
                                         document.getElementById('to').value]);
const routesAvantInversion = routes().length;
await page.click('#swap');
const apres = await page.evaluate(() => [document.getElementById('from').value,
                                         document.getElementById('to').value]);
chk('TEST A — les libellés visibles sont échangés',
  apres[0] === avant[1] && apres[1] === avant[0], `${avant[0]} / ${avant[1]} → ${apres[0]} / ${apres[1]}`);
chk('TEST A — aucune requête Google déclenchée par le bouton Inverser',
  routes().length === routesAvantInversion);

await analyser();
const routeInverse = routes().at(-1);
chk('TEST B — coordonnées exactement échangées, sans nouveau géocodage',
  routeInverse.corps.origin.lat === B.lat && routeInverse.corps.origin.lng === B.lng
  && routeInverse.corps.destination.lat === A.lat && routeInverse.corps.destination.lng === A.lng);

await page.click('#back');
await page.click('#swap');
const retourTexte = await page.evaluate(() => [document.getElementById('from').value,
                                               document.getElementById('to').value]);
chk('TEST C — double inversion : libellés identiques à l’origine',
  retourTexte[0] === avant[0] && retourTexte[1] === avant[1]);
await page.fill('#date', DEPART_ALLER.split('T')[0]);
await page.fill('#time', DEPART_ALLER.split('T')[1]);
await analyser();
const routeRevenue = routes().at(-1);
chk('TEST C — double inversion : coordonnées identiques au bit près',
  JSON.stringify({ o: routeRevenue.corps.origin, d: routeRevenue.corps.destination })
  === JSON.stringify({ o: routeAller.corps.origin, d: routeAller.corps.destination }));
const allerRejoue = await etatResultat();
chk('TEST C — aucune dérive du résultat après deux inversions',
  JSON.stringify(allerRejoue) === JSON.stringify(refAller));

/* ---------- TEST D à I : le retour ---------- */
console.log('\nTEST D à I — le retour est une analyse complète');
const avantRetour = { routes: routes().length, elev: elevations().length, meteo: meteos().length };
const allerCourant = routes().at(-1);
await ouvrirRetour();
await calculerRetour({ maintenant: true });
const routeRetour = routes().at(-1);
if (await page.isVisible('#err')) {
  console.log('  >> le retour a été refusé : ' + (await page.textContent('#err')));
}
const resRetour = await etatResultat();

chk('TEST D — une deuxième requête /api/route est bien partie',
  routes().length === avantRetour.routes + 1);
chk('TEST D — origin = ancien B, destination = ancien A',
  routeRetour.corps.origin.lat === B.lat && routeRetour.corps.origin.lng === B.lng
  && routeRetour.corps.destination.lat === A.lat && routeRetour.corps.destination.lng === A.lng);

chk('TEST E — la géométrie analysée est celle renvoyée par le serveur pour B→A',
  Math.abs(metres(GEOM_RETOUR) - metres(GEOM_ALLER)) > 5000
  && JSON.stringify(resRetour) !== JSON.stringify(refAller),
  `aller ${metres(GEOM_ALLER).toFixed(0)} m, retour ${metres(GEOM_RETOUR).toFixed(0)} m`);

const ptsRetour = elevations().at(-1).corps.points;
const surRetour = ptsRetour.filter((p) => distPolyline(p[0], p[1], GEOM_RETOUR) < 50).length;
const surAller = ptsRetour.filter((p) => distPolyline(p[0], p[1], GEOM_ALLER) < 50).length;
chk('TEST E — l’observateur relief du retour est sur la géométrie retour, pas sur celle de l’aller',
  surRetour >= 1 && surAller === 0,
  `${surRetour}/${ptsRetour.length} points sur le retour, ${surAller} sur l’aller`);

const depAller = routeAller.corps.departureMs;
const depRetour = routeRetour.corps.departureMs;
chk('TEST F — departureMs retour ≠ departureMs aller',
  depRetour !== depAller,
  `${new Date(depAller).toISOString()} → ${new Date(depRetour).toISOString()}`);
chk('TEST F — le retour part bien de « maintenant » (horloge de l’appareil)',
  Math.abs(depRetour - MAINTENANT) < 60000);

const passagesAller = (meteoAller.corps.observations || []).map((o) => o.passageTimeMs);
const passagesRetour = (meteos().at(-1).corps.observations || []).map((o) => o.passageTimeMs);
chk('TEST F — les passageTimeMs des zones ont été recalculés sur la nouvelle timeline',
  passagesRetour.length > 0
  && passagesRetour.every((t) => t >= depRetour && t <= depRetour + 4 * 3600000)
  && !passagesRetour.some((t) => passagesAller.includes(t)));

chk('TEST G — analyze() a bien été rejoué : zones et verdict recalculés',
  JSON.stringify(resRetour.zones) !== JSON.stringify(refAller.zones)
  && resRetour.nZones > 0,
  `retour : ${resRetour.nZones} zone(s)`);

chk('TEST H — nouvel appel Elevation pour le retour',
  elevations().length === avantRetour.elev + 1);
chk('TEST I — nouvel appel Open-Meteo pour le retour',
  meteos().length === avantRetour.meteo + 1);

const journalTexte = await page.evaluate(() => document.getElementById('log').textContent);
chk('TEST H/I — le journal du retour ne cumule pas les appels de l’aller',
  /Relief — 1 requête\(s\)/.test(journalTexte) && /Weather — 1 requête\(s\)/.test(journalTexte));

/* ---- UX V1 : les sept questions de §25, sans ouvrir un seul repli ---- */
console.log('\nUX V1 — l’écran principal répond seul');

/* Texte du niveau 1 : ce qui est visible SANS ouvrir un <details>, et sans les
   blocs masqués. C'est là-dessus que porte le contrôle de jargon. */
async function texteNiveau1(sel) {
  return page.evaluate((s2) => {
    const n = document.querySelector(s2).cloneNode(true);
    n.querySelectorAll('details').forEach((d) => d.remove());
    n.querySelectorAll('.hide').forEach((d) => d.remove());
    return n.textContent.replace(/\s+/g, ' ').trim();
  }, sel);
}

const n1 = await texteNiveau1('#result');

chk('§25.1 — « y a-t-il quelque chose d’important ? » répondu en clair',
  /période|passage|Rien d.{1,3}important/i.test(n1),
  (await page.textContent('#bilanGrand')).slice(0, 62));
chk('§25.2 — « dans combien de temps ? »', /min après le départ/.test(n1));
chk('§25.3 — « pendant combien de temps ? »',
  /pendant ~\d+ min|~\d+ min concernées/.test(n1));
chk('§25.4 — « de face ou sur le côté ? »',
  /dans l.{1,3}axe|champ de vision|sur la (gauche|droite)/i.test(n1));
chk('§25.5 — « le relief le masque-t-il ? »',
  /Relief naturel : (horizon dégagé|soleil masqué|non vérifié)/.test(n1));
chk('§25.6 — « où dans le trajet ? »',
  (await page.evaluate(() => document.querySelectorAll('#ligneRail .marque').length)) > 0
  && /à partir de .* du départ/.test(n1));
chk('§25.7 — « comment lancer le retour ? »', /Préparer le retour/.test(n1));

/* §21 — le jargon ne doit plus exister au niveau 1. Il n'a pas disparu :
   il est descendu au niveau 3, ce que le contrôle suivant vérifie. */
const JARGON = ['DNI', 'W/m²', 'UTC', 'delta', 'seuil', 'provider', 'score',
                'terrainOcclusion', 'weatherContext', 'startD', 'budget d’appels',
                'Éblouissement fort', 'Éblouissement modéré'];
const fuites = JARGON.filter((j) => n1.includes(j));
chk('§21 — aucun terme de laboratoire sur l’écran principal',
  fuites.length === 0, fuites.length ? 'fuites : ' + fuites.join(', ') : 'aucun');

const tech = await page.evaluate(() => document.getElementById('tech').textContent);
const absents = ['DNI', 'W/m²', 'startD', 'endD', 'startAt', 'delta', 'score',
                 'provider', 'seuil', 'observateur', 'validTime', 'Cap',
                 'niveau d’exposition géométrique'].filter((j) => !tech.includes(j));
chk('§24-L — rien n’est perdu : le debug est intégralement dans Détails techniques',
  absents.length === 0, absents.length ? 'manquants : ' + absents.join(', ') : 'tout est là');

chk('§14 — le journal est dans Détails techniques, plus sur la page principale',
  await page.evaluate(() => document.getElementById('tech')
    .contains(document.getElementById('log'))));
chk('§2 — tous les replis sont fermés par défaut',
  await page.evaluate(() => [...document.querySelectorAll('details')].every((d) => !d.open)));
chk('§6 — la vue pare-brise n’est plus l’élément principal',
  await page.evaluate(() => document.getElementById('tech')
    .contains(document.getElementById('glassSvg'))));
chk('§8 — les zones faibles sont derrière un bouton, jamais supprimées',
  await page.evaluate(() => {
    const cachees = document.getElementById('zoneFaibles');
    const nF = cachees.querySelectorAll('.zc').length;
    return nF === 0 || (cachees.classList.contains('hide')
      && !document.getElementById('voirFaibles').classList.contains('hide'));
  }));
/* La propriété à tenir n'est pas « la pastille porte du texte » — une pastille
   est vide par nature — mais « la couleur n'est jamais seule porteuse du
   sens ». Donc : toute pastille a un mot à côté d'elle, et la ligne de trajet,
   qui n'est faite que de couleurs, porte une description accessible. */
chk('§22 — chaque pastille de couleur est accompagnée d’un mot',
  await page.evaluate(() => [...document.querySelectorAll('.dot')]
    .every((d) => d.parentElement.textContent.trim().length > 0)));
chk('§22 — la ligne de trajet, purement colorée, a une description accessible',
  await page.evaluate(() => {
    const r = document.getElementById('ligneRail');
    return (r.getAttribute('aria-label') || '').length > 20
      && document.getElementById('ligneLegende').textContent.trim().length > 0;
  }),
  (await page.getAttribute('#ligneRail', 'aria-label') || '').slice(0, 70));

await page.setViewportSize({ width: 360, height: 780 });
const deborde = await page.evaluate(() =>
  document.documentElement.scrollWidth > document.documentElement.clientWidth);
chk('§22 — aucun débordement horizontal à 360 px', !deborde);
await page.setViewportSize({ width: 390, height: 844 });

/* ---------- TEST J : Google Maps ---------- */
console.log('\nTEST J — Google Maps reçoit le nouveau sens');
navigations.length = 0;
await page.click('#openMapsResult');
await page.waitForTimeout(600);
const urlMaps = navigations.find((u) => u.includes('/maps/dir/')) || '';
chk('TEST J — origin = ancien B, destination = ancien A',
  urlMaps.includes(`origin=${B.lat},${B.lng}`) && urlMaps.includes(`destination=${A.lat},${A.lng}`),
  urlMaps.slice(0, 110));

/* ---------- TEST K : simulation ---------- */
console.log('\nTEST K — la simulation suit le retour');
await page.goto(base + '/index.html');   // la navigation Maps a quitté la page
await saisirAller();
await page.click('#swap');
await page.fill('#date', '2026-12-21'); await page.fill('#time', '18:05');
await analyser();                        // B→A, mêmes entrées que le retour
const zonesSim = await etatResultat();
await page.click('#sim');
await page.waitForSelector('#tracking:not(.hide)');
await page.waitForTimeout(4000);
const zonesLive = await page.evaluate(() => [...document.querySelectorAll('#liveZones li')]
  .map((li) => li.textContent.replace(/\s+/g, ' ').trim()));
chk('TEST K — le mode test rejoue les zones du trajet B→A',
  zonesLive.length === zonesSim.nZones && zonesLive.length > 0,
  `${zonesLive.length} zone(s) à l’écran`);
const jSim = await page.evaluate(() => document.getElementById('log').textContent);
chk('TEST K — une annonce est partie sur ce trajet', /Annonce 1\/4/.test(jSim));

/* ---------- TEST §12 : retour depuis l’écran de suivi ---------- */
console.log('\nTEST §12 — retour pendant le suivi');
const panSuivi = await ouvrirRetour('suivi');
chk('§12 — un panneau apparaît, pas un basculement brutal',
  await page.isVisible('#retourPanneau'));
chk('§12 — il prévient que le suivi sera arrêté', panSuivi.avisSuivi);
await page.click('#retourAnnuler');
chk('§12 — Annuler referme sans rien lancer', !(await page.isVisible('#retourPanneau')));
const avantR2 = routes().length;
await ouvrirRetour('suivi');
await calculerRetour({ maintenant: true });
chk('§12 — une nouvelle analyse est partie', routes().length === avantR2 + 1);
chk('§12 — elle repart dans l’autre sens, A→B',
  routes().at(-1).corps.origin.lat === A.lat && routes().at(-1).corps.destination.lat === B.lat);
const suiviCoupe = await page.evaluate(() => ({
  sim: !!window.__radiusSim, suivi: document.getElementById('tracking').classList.contains('hide'),
  banniere: document.getElementById('modeBanner').classList.contains('hide'),
}));
chk('§12 — le suivi précédent a été coupé proprement',
  suiviCoupe.suivi && suiviCoupe.banniere);

/* ---------- TEST L : suivi réel sur la nouvelle route ---------- */
console.log('\nTEST L — le suivi réel travaille sur la nouvelle route');
await ouvrirRetour(); await calculerRetour({ maintenant: true });   // repasse en B→A
// Un point posé sur la branche B→C : il appartient au retour et à rien d'autre.
const surBrancheBC = { latitude: (B2.lat + C.lat) / 2, longitude: (B2.lng + C.lng) / 2 };
chk('TEST L — le point de test est bien hors de la géométrie aller',
  distPolyline(surBrancheBC.latitude, surBrancheBC.longitude, GEOM_ALLER) > 2000,
  `${distPolyline(surBrancheBC.latitude, surBrancheBC.longitude, GEOM_ALLER).toFixed(0)} m de l’aller`);
await contexte.setGeolocation(surBrancheBC);
await page.click('#start');
await page.waitForSelector('#tracking:not(.hide)', { timeout: 10000 });
await page.waitForTimeout(2500);
const grand = await page.textContent('#suivTitre');
chk('TEST L — le suivi raccroche la position sur la route retour',
  grand !== 'Hors itinéraire' && grand !== 'En attente du GPS…', `« ${grand} »`);
await page.click('#stopTrack');

/* ---------- TEST §17 : échec du retour ---------- */
console.log('\nTEST §17 — un retour qui échoue ne se déguise pas en succès');
prochaineRouteEchoue = true;
const avantEchec = routes().length;
await ouvrirRetour();
await page.click('#retourMaintenant');
await page.click('#retourCalculer');
await page.waitForSelector('#err:not(.hide)', { timeout: 20000 });
const messageErreur = await page.textContent('#err');
chk('§17 — message explicite',
  /Impossible d.{1,3}analyser le trajet retour/.test(messageErreur), messageErreur.slice(0, 90));
chk('§17 — l’ancien résultat n’est pas réaffiché comme s’il était le retour',
  await page.isHidden('#result'));
const zonesRestantes = await page.evaluate(() => document.querySelectorAll('.zc').length);
chk('§17 — aucune zone de l’ancien trajet ne subsiste à l’écran', zonesRestantes === 0);
await page.click('#analyze');                       // réessai immédiat
await attendreFinAnalyse();
chk('§17 — from/to restent dans le nouveau sens : le réessai repart bien de là',
  routes().at(-1).corps.origin.lat === routes()[avantEchec].corps.origin.lat
  && routes().at(-1).corps.destination.lat === routes()[avantEchec].corps.destination.lat);

/* ---------- TEST §16 : double appui ---------- */
console.log('\nTEST §16 — deux sens ne peuvent pas être calculés en même temps');
delaiRouteMs = 1200;
const avantDouble = routes().length;
await ouvrirRetour();
await page.click('#retourMaintenant');
await page.evaluate(() => {
  document.getElementById('retourCalculer').click();
  document.getElementById('retourCalculer').click();
  document.getElementById('analyze').click();
});
await attendreFinAnalyse();
delaiRouteMs = 0;
chk('§16 — une seule requête malgré trois appuis', routes().length === avantDouble + 1,
  `${routes().length - avantDouble} requête(s)`);

await navigateur.close();
serveur.close();
console.log(`\n${ok} contrôle(s) PASS, ${ko} ÉCHEC.`);
if (ko) { console.log('Échecs : ' + echecs.join(' | ')); process.exit(1); }
