import assert from 'node:assert/strict';
import {
  bearing, signedDelta, solar, routeSamples, stationarySamples,
  sunRelativeLabel, compassHeadingFromEvent, fetchBorne,
  cardinal, directionLisible, qualitePosition, PRECISION_TERRAIN_M,
  fenetrePrevision, previsionDisponible, nombreEchantillons, echantillonsPointFixe,
  HORIZON_PREVISION_JOURS, secteurRelatif, libelleSecteur, SECTEURS_RELATIFS,
  pointRose, ROSE_CENTRE, mod360,
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
/* Une absence de mesure n'est pas zéro. Un téléphone sans magnétomètre émet un
   événement dont `alpha` est `null` ; `Number(null)` valant 0, il devenait un
   cap de 0° — plein Nord — annoncé comme une mesure absolue. */
for (const sourd of [{ alpha: null, absolute: true }, { alpha: null }, { alpha: undefined },
  { webkitCompassHeading: null, alpha: null }, { alpha: '' }, { alpha: '  ' },
  { alpha: 'nord' }, {}, null, undefined]) {
  assert.equal(compassHeadingFromEvent(sourd), null,
    `aucun cap inventé pour ${JSON.stringify(sourd)}`);
}
assert.deepEqual(compassHeadingFromEvent({ alpha: 0, absolute: true }),
  { heading: 0, absolute: true, source: 'deviceorientationabsolute' },
  'un vrai zéro mesuré reste un cap valide');

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
  assert.ok(/Soleil couché/.test(j) && /Aucune exposition solaire \$\{quand\}/.test(j),
    'le Soleil sous l’horizon est dit en clair, à l’instant représenté');
  assert.ok(/directionLisible\(/.test(j), 'le cap principal passe par les mots');
  // Le gros chiffre nu a disparu de l'écran principal.
  assert.ok(!/\$\('heading'\)\.textContent=`\$\{Math\.round/.test(j.replace(/\s/g, '')),
    'plus de « 150° » seul comme information principale');
  assert.ok(/qualitePosition\(/.test(j), 'la précision GPS est qualifiée');
  assert.ok(/pas un vrai nord magnétique/.test(j),
    'une orientation relative n’est jamais présentée comme un nord magnétique');
}

/* ── Point fixe à l'heure choisie (16 septembre 2026) ── */

// La fenêtre est celle qu'`api/journey-weather.js` peut RÉELLEMENT servir :
// forecast_days plafonné à 7, en timezone=UTC, donc de minuit UTC du jour à
// minuit UTC + 7 jours.
{
  const maintenant = Date.UTC(2026, 8, 16, 13, 0);
  const f = fenetrePrevision(maintenant);
  assert.equal(new Date(f.debutMs).toISOString(), '2026-09-16T00:00:00.000Z',
    'la fenêtre commence à minuit UTC du jour');
  assert.equal(f.finMs - f.debutMs, HORIZON_PREVISION_JOURS * 86400000,
    'elle dure exactement l’horizon annoncé');
  assert.equal(HORIZON_PREVISION_JOURS, 7);

  const cas = [
    ['la veille au soir', Date.UTC(2026, 8, 15, 23, 0), 'avant'],
    ['une heure passée du jour même', Date.UTC(2026, 8, 16, 2, 0), null],
    ['l’instant présent', maintenant, null],
    ['dans six jours', Date.UTC(2026, 8, 22, 22, 0), null],
    ['dernière heure servable', f.finMs - 3600000, null],
    ['le jour de trop', Date.UTC(2026, 8, 23, 1, 0), 'apres'],
    ['le 21 décembre', Date.UTC(2026, 11, 21, 14, 30), 'apres'],
    ['heure illisible', NaN, 'invalide'],
  ];
  for (const [nom, t, attendu] of cas) {
    const v = previsionDisponible(t, maintenant);
    assert.equal(v.raison, attendu, `fenêtre de prévision — ${nom}`);
    assert.equal(v.disponible, attendu === null, `disponibilité — ${nom}`);
  }
  // Une date hors fenêtre n'est jamais remplacée par « maintenant » en silence :
  // la fonction dit non, et c'est à l'appelant de ne pas envoyer la requête.
  const refus = previsionDisponible(Date.UTC(2020, 0, 1), maintenant);
  assert.equal(refus.disponible, false);
  assert.ok(refus.fenetre.debutMs > 0, 'le refus porte ses bornes, pour pouvoir les dire');
}

// « Instant précis » est UN instant, pas un horizon de zéro échantillonné deux
// fois : deux lignes identiques laisseraient croire à une évolution.
assert.equal(nombreEchantillons(0), 1, 'instant précis → un seul échantillon');
assert.equal(nombreEchantillons(30), 3);
assert.equal(nombreEchantillons(60), 3);
assert.equal(nombreEchantillons(120), 4);
assert.equal(nombreEchantillons(240), 6);
assert.equal(nombreEchantillons(360), 7);
{
  const P = { lat: -21.03, lng: 55.72 };
  const debut = Date.UTC(2026, 11, 21, 10, 0);

  const instant = echantillonsPointFixe(P, debut, 0);
  assert.equal(instant.length, 1);
  assert.equal(instant[0].passageTimeMs, debut, 'l’instant analysé est celui demandé');
  assert.equal(instant[0].lat, P.lat); assert.equal(instant[0].lng, P.lng);

  const deuxHeures = echantillonsPointFixe(P, debut, 120);
  assert.equal(deuxHeures.length, 4);
  assert.equal(deuxHeures[0].passageTimeMs, debut, 'la timeline commence à l’heure choisie');
  assert.equal(deuxHeures.at(-1).passageTimeMs, debut + 120 * 60000, 'et finit à début + horizon');
  assert.deepEqual(deuxHeures.map((x) => x.passageTimeMs - debut),
    [0, 2400000, 4800000, 7200000], 'les instants sont régulièrement espacés');
  assert.ok(deuxHeures.every((x) => x.lat === P.lat && x.lng === P.lng),
    'le point ne bouge pas : c’est un point FIXE');

  // Aucun échantillon ne retombe sur « maintenant ».
  const loin = echantillonsPointFixe(P, Date.UTC(2027, 5, 1, 5, 0), 360);
  assert.ok(loin.every((x) => Math.abs(x.passageTimeMs - Date.now()) > 86400000),
    'une date lointaine n’est jamais silencieusement ramenée à maintenant');

  assert.deepEqual(echantillonsPointFixe(null, debut, 60), [], 'pas de point, pas d’échantillon');
  assert.deepEqual(echantillonsPointFixe(P, NaN, 60), [], 'pas d’heure, pas d’échantillon');
}

// Le Soleil se calcule à n'importe quelle date, même hors fenêtre météo :
// c'est de l'astronomie, pas une prévision.
{
  const horsFenetre = Date.UTC(2031, 11, 21, 14, 30);
  const s2 = solar(horsFenetre, -21.1151, 55.5364);
  assert.ok(Number.isFinite(s2.elevation) && Number.isFinite(s2.azimuth),
    'la géométrie solaire reste disponible hors fenêtre de prévision');
  assert.equal(previsionDisponible(horsFenetre).disponible, false,
    'alors que la météo, elle, ne l’est pas');
}

/* ── L'écran du point fixe ── */
{
  const j = fs.readFileSync(new URL('./journey.html', import.meta.url), 'utf8');
  const nu = j.replace(/\s/g, '');
  assert.ok(/id="statDate"/.test(j) && /id="statTime"/.test(j),
    'date et heure d’observation sont saisissables');
  assert.ok(/id="statMaintenant"/.test(j), 'le bouton Maintenant existe');
  assert.ok(/Prévoir à ce point/.test(j), 'le bouton principal porte le libellé demandé');
  assert.ok(/value="0">Instant précis/.test(nu.replace(/&nbsp;/g, '')) || /Instant précis/.test(j),
    'l’horizon « Instant précis » est proposé');
  for (const h of ['30 min', '1 h', '2 h', '4 h', '6 h']) {
    assert.ok(j.includes(`>${h}<`), `l’horizon ${h} est proposé`);
  }
  // « Maintenant » remplit et ne lance rien.
  assert.ok(/functionstatMaintenant\(\)\{[^}]*\}/.test(nu), 'statMaintenant est une fonction à part');
  const corps = nu.match(/functionstatMaintenant\(\)\{([^}]*)\}/)[1];
  assert.ok(!/planStationary|prevoir\(\)/.test(corps),
    '« Maintenant » remplit les champs et ne déclenche aucun calcul');
  // Le calcul lit le formulaire, pas l'horloge.
  assert.ok(/constdebut=lireDebutPointFixe\(\)/.test(nu),
    'le début vient du formulaire');
  assert.ok(!/echantillonsPointFixe\(p,Date\.now\(\)/.test(nu),
    'jamais Date.now() comme début du point fixe');
  // La fenêtre est vérifiée AVANT l'appel.
  const planif = nu.slice(nu.indexOf('asyncfunctionplanStationary'));
  const iVerdict = planif.indexOf('previsionDisponible');
  const iAppel = planif.indexOf('awaitweather(');
  assert.ok(iVerdict > 0 && iAppel > 0 && iVerdict < iAppel,
    'la disponibilité est vérifiée avant d’appeler Open-Meteo');
  assert.ok(/servables=samples\.filter/.test(nu),
    'seuls les instants servables partent à l’API');
  assert.ok(/Prévisionindisponiblepourcettedate/.test(nu),
    'la phrase exacte demandée est affichée');
  // Ce qui reste sur « maintenant », c'est l'ORIENTATION — la seule chose qui
  // ne se simule pas. Le Soleil de la carte, lui, suit la rose : sinon l'écran
  // affiche un Soleil couché au-dessus d'un « Soleil à droite ».
  assert.ok(/constt=instantRose\(\);/.test(nu),
    'la phrase de la carte décrit le même instant que la rose');
  assert.ok(/constsun=solar\(t,state\.stationaryPoint/.test(nu),
    'et c’est bien cet instant-là qui est calculé');
  assert.ok(/constn=solar\(Date\.now\(\),p2\.lat,p2\.lng\)/.test(nu),
    'le niveau 3 conserve malgré tout le Soleil de maintenant');
  // L'orientation ne vient QUE du capteur : une seule affectation, et c'est
  // celle que compassHeadingFromEvent a lue. Aucune heure simulée ne peut
  // la fabriquer.
  const affectations = nu.match(/state\.heading=[^;,)]*/g) || [];
  assert.deepEqual(affectations, ['state.heading=h.heading'],
    `l’orientation ne vient que du capteur — trouvé ${JSON.stringify(affectations)}`);
  assert.ok(/pascelled’unvéhicule/.test(nu),
    'l’orientation n’est jamais présentée comme celle d’une voiture');
  // Aucun seuil météo introduit.
  const carte = nu.slice(nu.indexOf('functioncarteInstant'), nu.indexOf('constcardinalDe'));
  for (const v of ['cloudCover', 'visibility', 'directNormalIrradiance', 'windGusts', 'precipitation']) {
    assert.ok(!new RegExp(`${v}[^,;]*[<>]=?\\s*\\d`).test(carte),
      `aucun seuil appliqué à ${v} dans la carte instant`);
  }
  for (const champ of ['temperature', 'cloudCover', 'precipitation', 'visibility', 'windSpeed',
    'windGusts', 'windDirection', 'directNormalIrradiance', 'weatherCode',
    'instantValidTime', 'provider']) {
    assert.ok(carte.includes(`w.${champ}`), `l’instant précis affiche ${champ}`);
  }
}

/* ── Les huit secteurs relatifs (16 septembre 2026) ── */
assert.deepEqual(SECTEURS_RELATIFS, ['devant', 'devant-droite', 'droite', 'derriere-droite',
  'derriere', 'derriere-gauche', 'gauche', 'devant-gauche'],
  'les huit secteurs demandés, dans l’ordre horaire');

// Les bornes sont celles de sunRelativeLabel, figées : 15, 45, 110, 160.
const BASCULES = [
  [0, 'devant'], [15, 'devant'], [15.0001, 'devant-droite'],
  [45, 'devant-droite'], [45.0001, 'droite'],
  [110, 'droite'], [110.0001, 'derriere-droite'],
  [160, 'derriere-droite'], [160.0001, 'derriere'], [180, 'derriere'],
  [-15, 'devant'], [-15.0001, 'devant-gauche'],
  [-45, 'devant-gauche'], [-45.0001, 'gauche'],
  [-110, 'gauche'], [-110.0001, 'derriere-gauche'],
  [-160, 'derriere-gauche'], [-160.0001, 'derriere'], [-180, 'derriere'],
];
for (const [d, attendu] of BASCULES) {
  assert.equal(secteurRelatif(d), attendu, `secteur à ${d}°`);
}
assert.equal(secteurRelatif(NaN), null, 'aucun secteur sans écart mesurable');
assert.equal(secteurRelatif(undefined), null);
// Un écart hors [-180,180] est ramené dans le tour, jamais refusé.
assert.equal(secteurRelatif(370), 'devant', '370° = 10°');
assert.equal(secteurRelatif(-370), 'devant');
assert.equal(secteurRelatif(200), 'derriere-gauche', '200° = -160°');

// Tout le tour est couvert, sans trou, par exactement huit secteurs.
{
  const vus = new Set();
  for (let d = -180; d < 180; d += 0.25) {
    const sec = secteurRelatif(d);
    assert.ok(sec, `un secteur existe à ${d}°`);
    assert.ok(SECTEURS_RELATIFS.includes(sec), `secteur connu à ${d}°`);
    vus.add(sec);
  }
  assert.equal(vus.size, 8, 'huit secteurs, ni plus ni moins');
}

// LE POINT QUI COMPTE : la rose et la phrase désignent le même secteur. Deux
// tables d'angles séparées finiraient par diverger — ce dépôt s'est déjà fait
// prendre à entretenir deux soleils.
for (let cap = 0; cap < 360; cap += 7) {
  for (let az = 0; az < 360; az += 3) {
    const phrase = sunRelativeLabel(cap, { azimuth: az, elevation: 12 });
    const sec = secteurRelatif(signedDelta(cap, az));
    assert.equal(phrase, `Soleil ${libelleSecteur(sec)}`,
      `rose et texte d’accord — cap ${cap}°, azimut ${az}°`);
  }
}
for (const sec of SECTEURS_RELATIFS) {
  assert.ok(typeof libelleSecteur(sec) === 'string' && libelleSecteur(sec).length > 2,
    `le secteur ${sec} a un libellé lisible`);
  assert.ok(!/éblou|gên|dangereu/i.test(libelleSecteur(sec)),
    `le secteur ${sec} décrit une géométrie, jamais une gêne`);
}
assert.equal(libelleSecteur('inconnu'), null);

/* ── Projection sur la rose : Nord en haut, horaire ── */
assert.equal(ROSE_CENTRE, 100);
{
  const r = 80;
  const proche = (p, x, y, m) => {
    assert.ok(Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9,
      `${m} — attendu (${x}, ${y}), obtenu (${p.x.toFixed(3)}, ${p.y.toFixed(3)})`);
  };
  proche(pointRose(0, r), 100, 20, 'Nord est EN HAUT');
  proche(pointRose(90, r), 180, 100, 'Est est à droite');
  proche(pointRose(180, r), 100, 180, 'Sud est en bas');
  proche(pointRose(270, r), 20, 100, 'Ouest est à gauche');
  proche(pointRose(360, r), 100, 20, 'le tour complet revient au Nord');
  // Le sens est horaire : à 45°, on est en haut À DROITE.
  const ne = pointRose(45, r);
  assert.ok(ne.x > 100 && ne.y < 100, 'le Nord-Est est en haut à droite');
  const so = pointRose(225, r);
  assert.ok(so.x < 100 && so.y > 100, 'le Sud-Ouest est en bas à gauche');
  // Le rayon est respecté : tout point est à `rayon` du centre.
  for (let d = 0; d < 360; d += 11) {
    const p = pointRose(d, r);
    assert.ok(Math.abs(Math.hypot(p.x - 100, p.y - 100) - r) < 1e-9,
      `le point à ${d}° est bien sur le cercle`);
  }
  assert.equal(pointRose(NaN, r), null, 'aucun point sans direction');
  assert.equal(pointRose(0, NaN), null);
}

/* ── La rose dans la page ── */
{
  const j = fs.readFileSync(new URL('./journey.html', import.meta.url), 'utf8');
  const nu = j.replace(/\s/g, '');
  assert.ok(/id="rose"/.test(j) && /viewBox="0 0 200 200"/.test(j),
    'la rose est un SVG natif, sans bibliothèque');
  assert.ok(!/<script src=/.test(j) && !/import .* from ['"]http/.test(j),
    'aucune dépendance externe');
  assert.ok(/functiondessinerRose\(\)/.test(nu));
  // L'instant représenté est l'heure choisie si elle existe, maintenant sinon.
  assert.ok(/Number\.isFinite\(state\.statDebutMs\)\?state\.statDebutMs:Date\.now\(\)/.test(nu),
    'la rose représente l’heure d’observation choisie, l’heure courante sinon');
  // La flèche est le téléphone, jamais un véhicule.
  assert.ok(/Jamaislecapd'unvéhicule\./.test(nu.replace(/’/g, "'"))
    || /Jamaislecapd’unvéhicule/.test(nu),
    'la flèche est annoncée comme le haut du téléphone, jamais le cap d’un véhicule');
  // Aucun seuil ni formule d'éblouissement dans le dessin.
  const rose = nu.slice(nu.indexOf('functiondessinerRose'), nu.indexOf('functionetiquetteRose'));
  assert.ok(!/\bT\.|maxElev|maxDelta|score|éblou/i.test(rose),
    'la rose n’introduit ni seuil ni formule d’éblouissement');
  // Le niveau 3 garde tout ce qui est demandé.
  const iTech = nu.indexOf('functionorientationTech');
  assert.ok(iTech > 0, 'orientationTech existe');
  const tech = nu.slice(iTech, nu.indexOf('setInterval(updateLiveSun', iTech));
  for (const [quoi, motif] of [
    ['azimut', /Soleilazimut/], ['élévation', /élévation/],
    ['heading', /Captéléphone/], ['delta heading→soleil', /Écartcap→Soleil/],
    ['secteur', /secteur\$\{secteurRelatif/], ['absolu/relatif', /absolue\(référencéeaunord\)/],
    ['source capteur', /sourcex?\$?\{?state\.compassSource|compassSource/],
  ]) assert.ok(motif.test(tech), `le niveau 3 conserve ${quoi}`);
}

console.log('RADIUS V0.2 Journey + Stationary — Soleil aligné sur index.html, échéances et règles figées OK');
