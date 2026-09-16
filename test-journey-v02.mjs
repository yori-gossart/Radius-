import assert from 'node:assert/strict';
import {
  bearing, signedDelta, solar, routeSamples, stationarySamples,
  sunRelativeLabel, compassHeadingFromEvent, fetchBorne,
  cardinal, directionLisible, qualitePosition, PRECISION_TERRAIN_M,
} from './journey-core.mjs';

const near = (a,b,t=1e-6) => Math.abs(a-b) <= t;

assert.ok(near(bearing(0,0,1,0), 0, 0.01), 'cap nord');
assert.ok(near(bearing(0,0,0,1), 90, 0.01), 'cap est');
assert.equal(signedDelta(350,10), 20, 'delta traverse 0°');
assert.equal(signedDelta(10,350), -20, 'delta négatif traverse 0°');

const sun = solar(Date.UTC(2026,8,16,8,0,0), -21.1, 55.5);
assert.ok(sun.azimuth >= 0 && sun.azimuth < 360, 'azimut solaire borné');
assert.ok(sun.elevation > -90 && sun.elevation < 90, 'élévation solaire bornée');

const route = {
  durationSeconds: 600,
  staticDurationSeconds: 600,
  trafficFactor: 1,
  geometry: [[0,0],[0,0.1]],
  steps: [{ staticDurationSeconds: 600, coordinates: [[0,0],[0,0.1]] }],
};
const samples = routeSamples(route, 1_000_000, 5);
assert.equal(samples.length, 5, '5 échantillons trajet');
assert.equal(samples[0].passageTimeMs, 1_000_000, 'départ exact');
assert.equal(samples.at(-1).passageTimeMs, 1_600_000, 'arrivée exacte');
assert.ok(samples.every((s) => near(s.heading,90,0.01)), 'cap est conservé');

const stationary = stationarySamples({lat:-21.03,lng:55.72}, 0, 3_600_000, 5);
assert.deepEqual(stationary.map((s)=>s.passageTimeMs), [0,900000,1800000,2700000,3600000]);
assert.equal(sunRelativeLabel(90,{azimuth:100,elevation:15}), 'Soleil droit devant');
assert.equal(sunRelativeLabel(90,{azimuth:170,elevation:15}), 'Soleil à droite');
assert.equal(sunRelativeLabel(90,{azimuth:100,elevation:-2}), 'Soleil sous l’horizon');
// Les bornes n'ont pas bougé le 16 septembre : seuls les mots ont changé.
assert.equal(sunRelativeLabel(90,{azimuth:105,elevation:15}), 'Soleil droit devant', '15° reste « droit devant »');
assert.equal(sunRelativeLabel(90,{azimuth:106,elevation:15}), 'Soleil devant à droite', '16° bascule');
assert.equal(sunRelativeLabel(90,{azimuth:135,elevation:15}), 'Soleil devant à droite', '45° reste « devant à »');
assert.equal(sunRelativeLabel(90,{azimuth:136,elevation:15}), 'Soleil à droite', '46° bascule');
assert.equal(sunRelativeLabel(90,{azimuth:200,elevation:15}), 'Soleil à droite', '110° reste « à »');
assert.equal(sunRelativeLabel(90,{azimuth:201,elevation:15}), 'Soleil derrière à droite', '111° bascule');
assert.equal(sunRelativeLabel(90,{azimuth:251,elevation:15}), 'Soleil droit derrière', '161° bascule');
assert.equal(sunRelativeLabel(90,{azimuth:60,elevation:15}), 'Soleil devant à gauche', 'le côté gauche est dit gauche');
assert.equal(sunRelativeLabel(90,{azimuth:44,elevation:15}), 'Soleil à gauche', '46° d’écart : au-delà de « devant »');
// Aucune phrase ne conclut à une gêne vécue, quel que soit l'angle.
for (let az = 0; az < 360; az += 3) {
  const t = sunRelativeLabel(90, { azimuth: az, elevation: 4 });
  assert.ok(!/éblou|gên|dangereu|fort/i.test(t), `phrase descriptive à ${az}° : ${t}`);
}

assert.deepEqual(compassHeadingFromEvent({webkitCompassHeading:275}), {heading:275,absolute:true,source:'webkitCompassHeading'});
assert.deepEqual(compassHeadingFromEvent({alpha:90,absolute:true}), {heading:270,absolute:true,source:'deviceorientationabsolute'});

console.log('RADIUS V0.2 Journey + Stationary — tests déterministes OK');

/* ── Le Soleil de journey-core doit être CELUI d'index.html ──
   Deux implémentations NOAA dans le même dépôt, c'est deux soleils qui
   divergent en silence. À la livraison, journey-core n'appliquait pas la
   réfraction atmosphérique : jusqu'à 0,27° d'écart en élévation à l'approche
   de l'horizon — exactement le régime où vit le produit, et où T.high.maxElev
   vaut 8°. Un relevé fait sur journey.html aurait été incomparable avec un
   relevé fait sur index.html.
   La fonction de référence est EXTRAITE d'index.html à l'exécution : un banc
   qui porte sa propre copie finit par éprouver l'autre version. */
import fs from 'node:fs';

const SRC_INDEX = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const corpsSolaire = SRC_INDEX.match(/function solar\(dateMs, lat, lng\) \{[\s\S]*?\n\}\n/);
assert.ok(corpsSolaire, 'solar() introuvable dans index.html');
const solarIndex = new Function(
  'const R = Math.PI / 180, D = 180 / Math.PI;\n' + corpsSolaire[0] + '\nreturn solar;')();

const CAS_SOLAIRES = [
  ['Paris 21 juin midi solaire', Date.UTC(2026, 5, 21, 11, 52), 48.8566, 2.3522],
  ['Paris 15 janvier 3 h UTC', Date.UTC(2026, 0, 15, 3, 0), 48.8566, 2.3522],
  ['Équateur équinoxe midi', Date.UTC(2026, 2, 20, 12, 0), 0, 0],
  ['La Réunion 21 déc 18h30 locale', Date.UTC(2026, 11, 21, 14, 30), -21.1151, 55.5364],
  ['Saint-Leu soleil rasant', Date.UTC(2026, 8, 16, 14, 0), -21.17, 55.29],
  ['Saint-Leu sous l’horizon', Date.UTC(2026, 8, 16, 15, 0), -21.17, 55.29],
];
for (const [nom, ms, lat, lng] of CAS_SOLAIRES) {
  const a = solarIndex(ms, lat, lng);
  const b = solar(ms, lat, lng);
  assert.ok(near(a.elevation, b.elevation, 1e-9), `élévation identique à index.html — ${nom}`);
  assert.ok(near(signedDelta(a.azimuth, b.azimuth), 0, 1e-9), `azimut identique à index.html — ${nom}`);
}

// Les repères du tableau de CLAUDE.md, rejoués sur journey-core.
const paris = solar(Date.UTC(2026, 5, 21, 11, 52), 48.8566, 2.3522);
assert.ok(near(paris.azimuth, 180, 0.5), 'Paris 21 juin : azimut ~180°');
assert.ok(near(paris.elevation, 64.6, 0.2), 'Paris 21 juin : élévation ~64,6°');
assert.ok(solar(Date.UTC(2026, 0, 15, 3, 0), 48.8566, 2.3522).elevation < 0,
  'Paris 15 janvier 3 h UTC : soleil sous l’horizon');
const reunion = solar(Date.UTC(2026, 11, 21, 14, 30), -21.1151, 55.5364);
assert.ok(near(reunion.elevation, 5, 1), 'La Réunion 21 déc 18h30 : élévation ~5°');
assert.ok(near(reunion.azimuth, 247, 2), 'La Réunion 21 déc 18h30 : azimut ~247°');

/* ── Aucune attente sans échéance (décision du 5 septembre 2026) ── */
/** Un `fetch` muet fidèle : comme le vrai, il ne répond jamais de lui-même et
    ne rejette que sur le signal d'abandon. C'est ce contrat que fetchBorne
    exploite ; un faux qui ignore le signal ne prouverait rien. */
const muet = (init) => new Promise((_, rejeter) => {
  const stop = () => rejeter(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  if (init?.signal?.aborted) return stop();
  init?.signal?.addEventListener('abort', stop, { once: true });
});
const jamaisConnexion = (url, init) => muet(init);
const jamaisCorps = async (url, init) => ({ ok: true, status: 200, text: () => muet(init) });

const t0 = Date.now();
await assert.rejects(
  () => fetchBorne('http://exemple.invalide', {}, 120, 'Le banc', jamaisConnexion),
  /n.a pas répondu en 0 s/,
  'une connexion qui n’aboutit jamais est bornée, pas attendue indéfiniment');
assert.ok(Date.now() - t0 < 3000, 'l’échéance coupe réellement l’attente');

// Le CORPS est lu sous la même échéance que la connexion : c'est là que
// l'attente se perdait en production, pas à l'établissement.
await assert.rejects(
  () => fetchBorne('http://exemple.invalide', {}, 120, 'Le banc', jamaisCorps),
  /n.a pas répondu en 0 s/,
  'un corps qui n’arrive jamais est borné lui aussi');

const bon = await fetchBorne('http://exemple.invalide', {}, 5000, 'Le banc',
  async () => ({ ok: true, status: 200, text: async () => '{"provider":"open-meteo"}' }));
assert.deepEqual(bon, { ok: true, status: 200, json: { provider: 'open-meteo' } },
  'une réponse normale traverse fetchBorne sans dommage');

const casse = await fetchBorne('http://exemple.invalide', {}, 5000, 'Le banc',
  async () => ({ ok: false, status: 502, text: async () => '<html>erreur</html>' }));
assert.deepEqual(casse, { ok: false, status: 502, json: null },
  'un corps non-JSON ne fait pas exploser l’appel');

/* ── journey.html est soumis aux mêmes règles qu'index.html ── */
const SRC_JOURNEY = fs.readFileSync(new URL('./journey.html', import.meta.url), 'utf8');
assert.equal((SRC_JOURNEY.match(/await fetch\(/g) || []).length, 0,
  'aucun fetch() nu dans journey.html : tout passe par fetchBorne');
assert.ok(/provider!=='google-routes'/.test(SRC_JOURNEY.replace(/\s/g, '')),
  'aucun repli silencieux : un autre fournisseur que Google Routes est refusé');
assert.ok(/Weather data by Open-Meteo\.com \(CC BY 4\.0\)/.test(SRC_JOURNEY),
  'attribution Open-Meteo CC BY 4.0 présente');

/* ── La météo ne bloque jamais un résultat (couche passive) ── */
assert.ok(/catch\(e\)\{meteoErreur=/.test(SRC_JOURNEY.replace(/\s/g, '')),
  'une panne météo est rattrapée, le trajet et le Soleil s’affichent quand même');

/* ── Aucun seuil de danger météo introduit ──
   On n'éprouve pas le mot « score » dans les commentaires — ils disent
   justement qu'il n'y en a pas. On éprouve le CODE : aucune comparaison de
   variable météo à une constante, donc aucun seuil, et aucun champ de verdict
   dans la réponse. Le contrôle des clés effectivement renvoyées est fait par
   test-api.mjs, sur une vraie réponse. */
const SRC_WX = fs.readFileSync(new URL('./api/journey-weather.js', import.meta.url), 'utf8');
const codeWx = SRC_WX.split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join('\n');
for (const interdit of [/\bscore\b/i, /\bdanger\b/i, /éblouissement/i, /\brisque\b/i, /\bniveau\b/i]) {
  assert.ok(!interdit.test(codeWx.replace(/note:[^\n]*/g, '')),
    `api/journey-weather.js n’introduit aucune notion de ${interdit}`);
}
for (const variable of ['cloud_cover', 'visibility', 'direct_normal_irradiance_instant',
  'wind_gusts_10m', 'precipitation']) {
  assert.ok(!new RegExp(`${variable}[^\\n]*[<>]=?\\s*\\d`).test(codeWx),
    `aucun seuil numérique appliqué à ${variable}`);
}

/* ── La direction se dit en mots (16 septembre 2026) ── */
assert.equal(directionLisible(150), 'Sud-Est · 150°', 'l’exemple demandé');
assert.equal(cardinal(0), 'Nord');
assert.equal(cardinal(360), 'Nord', 'le tour complet revient au Nord');
assert.equal(cardinal(359), 'Nord', 'juste avant le Nord');
assert.equal(cardinal(22), 'Nord');
assert.equal(cardinal(23), 'Nord-Est', 'la bascule est à 22,5°');
assert.equal(cardinal(45), 'Nord-Est');
assert.equal(cardinal(90), 'Est');
assert.equal(cardinal(135), 'Sud-Est');
assert.equal(cardinal(180), 'Sud');
assert.equal(cardinal(225), 'Sud-Ouest');
assert.equal(cardinal(270), 'Ouest');
assert.equal(cardinal(315), 'Nord-Ouest');
assert.equal(cardinal(-45), 'Nord-Ouest', 'un cap négatif est ramené dans le tour');
assert.equal(cardinal(NaN), null, 'aucune direction inventée sans mesure');
assert.equal(cardinal(undefined), null);
assert.equal(directionLisible(NaN), 'Direction inconnue');
// Les huit secteurs couvrent le tour sans trou ni chevauchement.
const vus = new Set();
for (let d = 0; d < 360; d += 0.5) vus.add(cardinal(d));
assert.equal(vus.size, 8, 'huit directions, ni plus ni moins');
assert.ok(!vus.has(null), 'aucun angle du tour ne reste sans mot');

/* ── La précision GPS se dit, et ne bloque rien ── */
assert.equal(PRECISION_TERRAIN_M, 100, 'le seuil demandé');
const flou = qualitePosition(2000);
assert.equal(flou.fiable, false);
assert.equal(flou.metres, 2000, 'le chiffre n’est jamais masqué');
assert.match(flou.texte, /2000 m/, 'la précision reste lisible');
assert.match(flou.texte, /trop imprécise pour un relevé terrain fiable/,
  'le relevé est déclaré non fiable, en clair');
const net = qualitePosition(18);
assert.equal(net.fiable, true);
assert.match(net.texte, /18 m/);
assert.ok(!/trop imprécise/.test(net.texte), 'une position nette n’est pas dénigrée');
assert.equal(qualitePosition(100).fiable, true, '100 m exactement reste acceptable');
assert.equal(qualitePosition(101).fiable, false, 'au-delà de 100 m, non fiable');
const inconnu = qualitePosition(undefined);
assert.equal(inconnu.fiable, false);
assert.equal(inconnu.metres, null);
assert.match(inconnu.texte, /inconnue/, 'une précision absente n’est pas prise pour bonne');
// Ces valeurs qualifient une DONNÉE, jamais le ciel.
assert.ok(!/level|score|high|moderate/i.test(JSON.stringify([flou, net, inconnu])),
  'la qualité GPS ne produit aucun niveau de risque');

/* ── L'écran principal est humain, le brut descend au niveau 3 ── */
{
  const j = fs.readFileSync(new URL('./journey.html', import.meta.url), 'utf8');
  assert.ok(/id="compassTech"/.test(j), 'un bloc de détails techniques existe');
  assert.ok(/Direction vers laquelle pointe le haut du téléphone/.test(j),
    'l’écran explique ce que la direction représente');
  assert.ok(/Soleil couché/.test(j) && /Aucune exposition solaire actuellement/.test(j),
    'le Soleil sous l’horizon est dit en clair');
  assert.ok(/directionLisible\(/.test(j), 'le cap principal passe par les mots');
  // Le gros chiffre nu a disparu de l'écran principal.
  assert.ok(!/\$\('heading'\)\.textContent=`\$\{Math\.round/.test(j.replace(/\s/g, '')),
    'plus de « 150° » seul comme information principale');
  assert.ok(/qualitePosition\(/.test(j), 'la précision GPS est qualifiée');
  assert.ok(/pas un vrai nord magnétique/.test(j),
    'une orientation relative n’est jamais présentée comme un nord magnétique');
}

console.log('RADIUS V0.2 Journey + Stationary — Soleil aligné sur index.html, échéances et règles figées OK');
