/* Tests de la couche épisodes et du plan d'annonces — V0.5.
   ------------------------------------------------------------------
   Le code testé est EXTRAIT de index.html à l'exécution, comme le fait déjà
   route-audit.html : une copie pourrait diverger de la production sans que le
   test le voie. Si l'extraction échoue, le fichier refuse de tester.

       node test-episodes.mjs
*/
import fs from 'node:fs';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));

function extraireBloc(nom) {
  const re = new RegExp('^(?:async )?function ' + nom + '\\s*\\(', 'm');
  const m = re.exec(js);
  if (!m) throw new Error('fonction introuvable dans index.html : ' + nom);
  const reste = js.slice(m.index);
  const fin = /^\}$/m.exec(reste);
  if (!fin) throw new Error('fin de fonction introuvable : ' + nom);
  return reste.slice(0, fin.index + fin[0].length);
}
function extraireConstante(nom) {
  const m = new RegExp('^const ' + nom + ' = ([^;]+);', 'm').exec(js);
  if (!m) throw new Error('constante introuvable dans index.html : ' + nom);
  return `const ${nom} = ${m[1]};`;
}

const source = [
  extraireConstante('RANK'),
  extraireConstante('MIN_LEAD_SECONDS'),
  extraireConstante('MAX_ALERTS'),
  extraireConstante('COOLDOWN_MS'),
  extraireConstante('EPISODE_GAP_S'),
  extraireConstante('LEAD_HIGH_FACE_LONG_S'),
  extraireConstante('LEAD_HIGH_S'),
  extraireConstante('LEAD_MODERATE_S'),
  extraireConstante('LEAD_LONG_S'),
  extraireConstante('LEAD_PLANCHER_UX_S'),
  extraireBloc('coteOppose'),
  extraireBloc('zoneUtilisable'),
  extraireBloc('construireEpisodes'),
  extraireBloc('leadCibleSecondes'),
  extraireBloc('comparerEpisodes'),
  extraireBloc('construirePlanAnnonces'),
  extraireBloc('titreEpisode'),
  `return { construireEpisodes, construirePlanAnnonces, leadCibleSecondes, titreEpisode,
            EPISODE_GAP_S, MAX_ALERTS, COOLDOWN_MS, MIN_LEAD_SECONDS };`,
].join('\n\n');

const P = new Function(source)();

let ok = 0, ko = 0; const echecs = [];
function chk(nom, condition, detail = '') {
  if (condition) { ok++; console.log(`  PASS  ${nom}${detail ? ' — ' + detail : ''}`); }
  else { ko++; echecs.push(nom); console.log(`  ÉCHEC ${nom}${detail ? ' — ' + detail : ''}`); }
}

const T0 = Date.parse('2026-12-22T17:30:00+04:00');
/** Zone synthétique : minute de début, durée en minutes, niveau, côté. */
function z(minDebut, dureeMin, level = 'high', side = 'face', delta = 3) {
  const startAt = T0 + minDebut * 60000;
  const seconds = dureeMin * 60;
  const startD = minDebut * 16 * 60;              // 16 m/s, pour des distances cohérentes
  const length = seconds * 16;
  return { level, side, delta, seconds, startAt, endAt: startAt + seconds * 1000,
    startD, endD: startD + length, length, elev: 6, score: 1 };
}
const min = (ep, champ) => Math.round(ep[champ] / 60000);

/* ══════════════ ÉPISODES ══════════════ */
console.log('\n== construireEpisodes — regroupement ==');
chk('1. zéro zone → zéro épisode', P.construireEpisodes([]).length === 0);
chk('1b. entrée absente → zéro épisode', P.construireEpisodes(undefined).length === 0);
chk('2. une zone → un épisode', P.construireEpisodes([z(0, 3)]).length === 1);
{
  const e = P.construireEpisodes([z(0, 3)])[0];
  chk('2b. l’épisode reprend exactement les bornes de sa zone',
    e.startAt === T0 && e.durationMs === 180000 && e.sourceZoneCount === 1
    && e.exposedSeconds === 180);
}
{
  // Zones chevauchantes : la seconde commence avant la fin de la première.
  const eps = P.construireEpisodes([z(0, 5), z(3, 5)]);
  chk('3. zones chevauchantes → un seul épisode', eps.length === 1, `${eps.length}`);
  chk('3b. l’étendue couvre les deux', min(eps[0], 'durationMs') === 8);
}
{
  const eps = P.construireEpisodes([z(0, 2), z(3, 2), z(6, 2), z(9, 2)]);
  chk('4. quatre zones proches → un seul épisode', eps.length === 1, `${eps.length} épisode(s)`);
  chk('4b. traçabilité complète',
    JSON.stringify(eps[0].sourceZoneIndexes) === '[0,1,2,3]');
  chk('4c. exposition réelle, pas l’étendue',
    eps[0].exposedSeconds === 480 && min(eps[0], 'durationMs') === 11,
    `${eps[0].exposedSeconds} s exposées sur ${min(eps[0], 'durationMs')} min d’étendue`);
}

console.log('\n== frontière du gap (EPISODE_GAP_S = ' + P.EPISODE_GAP_S + ' s) ==');
{
  // Une zone de 2 min à t=0 finit à t=2 min. La suivante démarre à 2 + gap.
  const gapExact = 2 + P.EPISODE_GAP_S / 60;
  chk('5. gap exactement à la frontière → même épisode',
    P.construireEpisodes([z(0, 2), z(gapExact, 2)]).length === 1);
  chk('6. gap juste sous la frontière → même épisode',
    P.construireEpisodes([z(0, 2), z(gapExact - 0.5, 2)]).length === 1);
  chk('7. gap juste au-dessus → deux épisodes',
    P.construireEpisodes([z(0, 2), z(gapExact + 0.5, 2)]).length === 2);
}
{
  const eps = P.construireEpisodes([z(0, 3, 'high', 'face'), z(4, 3, 'moderate', 'face')]);
  chk('8. high puis moderate contigus → un épisode de niveau high',
    eps.length === 1 && eps[0].maxLevel === 'high', `${eps.length}, ${eps[0].maxLevel}`);
}
{
  const memeCote = P.construireEpisodes([z(0, 3, 'high', 'face'), z(4, 3, 'high', 'gauche')]);
  chk('9. face → gauche ne coupe pas : c’est le même soleil qui glisse',
    memeCote.length === 1, `${memeCote.length}`);
  const oppose = P.construireEpisodes([z(0, 3, 'high', 'gauche'), z(4, 3, 'high', 'droite')]);
  chk('9b. gauche → droite coupe : ce n’est plus le même geste',
    oppose.length === 2, `${oppose.length}`);
}
{
  const eps = P.construireEpisodes([z(0, 2), z(3, 2), z(40, 2), z(43, 2), z(90, 2)]);
  chk('10. trois groupes distincts', eps.length === 3, `${eps.length}`);
  chk('10b. aucune zone perdue ni dupliquée',
    JSON.stringify(eps.flatMap((e) => e.sourceZoneIndexes).sort((a, b) => a - b)) === '[0,1,2,3,4]');
}
{
  const desordre = [z(40, 2), z(0, 2), z(3, 2), z(43, 2)];
  const eps = P.construireEpisodes(desordre);
  chk('11. ordre d’entrée non trié → même résultat', eps.length === 2, `${eps.length}`);
  chk('11b. les index désignent bien les positions D’ORIGINE',
    JSON.stringify(eps[0].sourceZoneIndexes) === '[1,2]'
    && JSON.stringify(eps[1].sourceZoneIndexes) === '[0,3]',
    JSON.stringify(eps.map((e) => e.sourceZoneIndexes)));
}
{
  const sales = [z(0, 3), null, { level: 'high' }, { ...z(5, 3), startAt: NaN },
                 { ...z(9, 3), endD: -1 }, z(12, 3)];
  const eps = P.construireEpisodes(sales);
  const gardees = eps.flatMap((e) => e.sourceZoneIndexes);
  chk('12. données invalides écartées sans planter',
    JSON.stringify(gardees) === '[0,5]', JSON.stringify(gardees));
}
{
  const minuit = Date.parse('2026-12-22T23:58:00+04:00');
  const a = { ...z(0, 3), startAt: minuit, endAt: minuit + 180000 };
  const b = { ...z(5, 3), startAt: minuit + 300000, endAt: minuit + 480000 };
  const eps = P.construireEpisodes([a, b]);
  chk('13. franchissement de minuit → un épisode continu',
    eps.length === 1 && eps[0].endAt > eps[0].startAt, `${eps.length}`);
}
{
  const eps = P.construireEpisodes([{ ...z(0, 3), seconds: 0 }, { ...z(4, 3), seconds: -5 }]);
  chk('14. durées nulle ou négative → exposition jamais négative',
    eps.every((e) => e.exposedSeconds >= 0), `${eps.map((e) => e.exposedSeconds).join(', ')} s`);
}
{
  const zones = [z(0, 4, 'moderate', 'face', 20), z(5, 4, 'high', 'face', 2),
                 z(10, 9, 'moderate', 'gauche', 18)];
  const e = P.construireEpisodes(zones)[0];
  chk('15. zone représentative : niveau max d’abord', e.representativeZoneIndex === 1,
    `index ${e.representativeZoneIndex}`);
  chk('15b. côté dominant : celui qui totalise le plus de temps',
    e.dominantSide === 'gauche', `${e.dominantSide}`);
  chk('15c. containsFace reste vrai si une source est frontale', e.containsFace === true);
}

/* ══════════════ PLAN D'ANNONCES ══════════════ */
console.log('\n== construirePlanAnnonces ==');
const ep = (over) => ({ id: 'X', startAt: T0, exposedSeconds: 600, maxLevel: 'high',
  dominantSide: 'face', ...over });

chk('1. zéro épisode → zéro annonce', P.construirePlanAnnonces([]).length === 0);
{
  const p = P.construirePlanAnnonces([ep({ maxLevel: 'low' })]);
  chk('2. un épisode faible → jamais annoncé', p.length === 0, `${p.length} entrée(s)`);
}
{
  const p = P.construirePlanAnnonces([ep({ id: 'A', maxLevel: 'moderate' })]);
  chk('3. un moderate → au plus une annonce',
    p.filter((x) => x.selected).length === 1);
}
{
  const eps = Array.from({ length: 6 }, (_, i) => ep({
    id: 'E' + i, startAt: T0 + i * 25 * 60000, maxLevel: i < 3 ? 'high' : 'moderate' }));
  const p = P.construirePlanAnnonces(eps);
  const pris = p.filter((x) => x.selected);
  chk('4. six épisodes éligibles → quatre annonces au maximum',
    pris.length === P.MAX_ALERTS, `${pris.length} retenues sur ${p.length}`);
  chk('4b. les écartés portent une raison, ils ne disparaissent pas',
    p.filter((x) => !x.selected).every((x) => !!x.rejet),
    p.filter((x) => !x.selected).map((x) => x.rejet).join(' | '));
  chk('5. high retenu avant moderate',
    pris.filter((x) => /^E[012]$/.test(x.episodeId)).length === 3,
    pris.map((x) => x.episodeId).join(','));
}
{
  // Deux épisodes simultanés : le cooldown n'en laisse passer qu'un. Celui qui
  // reste est celui que la priorité a choisi — c'est la preuve directe.
  const p = P.construirePlanAnnonces([
    ep({ id: 'COTE', dominantSide: 'droite', startAt: T0 }),
    ep({ id: 'FACE', dominantSide: 'face', startAt: T0 }),
  ]);
  chk('6. à niveau égal, face passe avant côté',
    p.find((x) => x.episodeId === 'FACE').selected === true
    && p.find((x) => x.episodeId === 'COTE').selected === false,
    p.map((x) => `${x.episodeId}:${x.selected}`).join(' '));
  const seuls = P.construirePlanAnnonces([
    ep({ id: 'C', dominantSide: 'droite' }), ep({ id: 'F', dominantSide: 'face' }),
    ep({ id: 'C2', dominantSide: 'gauche', startAt: T0 + 1 }),
    ep({ id: 'C3', dominantSide: 'droite', startAt: T0 + 2 }),
    ep({ id: 'C4', dominantSide: 'gauche', startAt: T0 + 3 }),
  ]);
  chk('6b. avec cinq candidats simultanés, le frontal est retenu',
    seuls.find((x) => x.episodeId === 'F').selected === true);
}
{
  const p = P.construirePlanAnnonces([
    ep({ id: 'COURT', exposedSeconds: 120, startAt: T0 }),
    ep({ id: 'LONG', exposedSeconds: 900, startAt: T0 }),
  ]);
  chk('7. à critères égaux, le plus long est prioritaire',
    p.find((x) => x.episodeId === 'LONG').selected === true
    && p.find((x) => x.episodeId === 'COURT').selected === false,
    p.map((x) => `${x.episodeId}:${x.selected}`).join(' '));
  const cinq = P.construirePlanAnnonces([
    ...Array.from({ length: 4 }, (_, i) => ep({ id: 'X' + i, exposedSeconds: 900, startAt: T0 + i * 25 * 60000 })),
    ep({ id: 'COURT', exposedSeconds: 120, startAt: T0 + 5 }),
  ]);
  chk('7b. l’épisode court est le premier écarté',
    cinq.find((x) => x.episodeId === 'COURT').selected === false,
    cinq.find((x) => x.episodeId === 'COURT').rejet);
}
{
  const eps = Array.from({ length: 5 }, (_, i) => ep({ id: 'S' + i, startAt: T0 + i * 25 * 60000 }));
  const a = JSON.stringify(P.construirePlanAnnonces(eps));
  const b = JSON.stringify(P.construirePlanAnnonces(eps.slice().reverse()));
  chk('8. priorité déterministe, indépendante de l’ordre d’entrée', a === b);
}
{
  // Deux épisodes dont les instants d'annonce sont à moins de trois minutes.
  const p = P.construirePlanAnnonces([
    ep({ id: 'A', startAt: T0 }),
    ep({ id: 'B', startAt: T0 + 60000 }),
  ]);
  const pris = p.filter((x) => x.selected);
  chk('9. cooldown : deux annonces ne peuvent pas être à moins de trois minutes',
    pris.length === 1, `${pris.length} retenue(s)`);
  chk('9b. l’épisode écarté dit que c’est le cooldown',
    /cooldown/.test(p.find((x) => !x.selected).rejet),
    p.find((x) => !x.selected).rejet);
}
{
  chk('10. le plancher MIN_LEAD_SECONDS est respecté',
    P.leadCibleSecondes(ep({ exposedSeconds: 1 })) >= P.MIN_LEAD_SECONDS,
    `${P.leadCibleSecondes(ep({ exposedSeconds: 1 }))} s`);
}
{
  const decisions = [];
  for (const meteo of [null, { status: 'ok', cloudCover: 100, directNormalIrradiance: 0 }]) {
    for (const relief of [null, { checked: true, blocked: true }]) {
      const e = ep({ id: 'M', weatherContext: meteo, terrainOcclusion: relief });
      decisions.push(JSON.stringify(P.construirePlanAnnonces([e])));
    }
  }
  chk('13/14. ni météo ni relief n’entrent dans la décision',
    new Set(decisions).size === 1, `${new Set(decisions).size} résultat(s) distinct(s)`);
}

console.log('\n== lead adaptatif ==');
{
  const cas = [
    ['high · face · long',   ep({ maxLevel: 'high', dominantSide: 'face', exposedSeconds: 720 })],
    ['high · face · court',  ep({ maxLevel: 'high', dominantSide: 'face', exposedSeconds: 120 })],
    ['high · côté',          ep({ maxLevel: 'high', dominantSide: 'droite', exposedSeconds: 600 })],
    ['moderate',             ep({ maxLevel: 'moderate', dominantSide: 'face', exposedSeconds: 600 })],
    ['très court (40 s)',    ep({ maxLevel: 'high', dominantSide: 'face', exposedSeconds: 40 })],
  ];
  for (const [nom, e] of cas) console.log(`      ${nom.padEnd(22)} → ${P.leadCibleSecondes(e)} s`);
  chk('11. un long high frontal est annoncé plus tôt qu’un moderate',
    P.leadCibleSecondes(cas[0][1]) > P.leadCibleSecondes(cas[3][1]));
  chk('11b. un high de côté est annoncé plus tôt qu’un moderate',
    P.leadCibleSecondes(cas[2][1]) > P.leadCibleSecondes(cas[3][1]));
  chk('12. un épisode de quarante secondes n’est pas annoncé cinq minutes avant',
    P.leadCibleSecondes(cas[4][1]) <= 120, `${P.leadCibleSecondes(cas[4][1])} s`);
  chk('12b. toutes les anticipations restent bornées',
    cas.every(([, e]) => P.leadCibleSecondes(e) <= 300 && P.leadCibleSecondes(e) >= 15));
}

/* ══════════════ SCÉNARIOS CONDUCTEUR ══════════════ */
console.log('\n== scénarios conducteur A à F ==');
{
  const A = P.construireEpisodes([z(0, 3), z(4, 3), z(8, 3), z(12, 3)]);
  const pA = P.construirePlanAnnonces(A);
  chk('A. quatre zones high/face proches → 1 épisode, 1 annonce',
    A.length === 1 && pA.filter((x) => x.selected).length === 1,
    `${A.length} épisode(s), ${pA.filter((x) => x.selected).length} annonce(s)`);
}
{
  const B = P.construireEpisodes([z(0, 4, 'high', 'face'), z(30, 4, 'moderate', 'droite')]);
  const pB = P.construirePlanAnnonces(B);
  chk('B. deux phénomènes distincts → 2 épisodes',
    B.length === 2 && pB.filter((x) => x.selected).length === 2,
    `${B.length} épisode(s), ${pB.filter((x) => x.selected).length} annonce(s)`);
}
{
  const zones = [];
  for (const base of [0, 45, 95]) for (let k = 0; k < 4; k++) zones.push(z(base + k * 4, 3));
  const C = P.construireEpisodes(zones);
  const pC = P.construirePlanAnnonces(C);
  chk('C. douze zones, trois phénomènes → 3 épisodes, jamais douze annonces',
    C.length === 3 && pC.filter((x) => x.selected).length <= 3,
    `${zones.length} zones → ${C.length} épisodes → ${pC.filter((x) => x.selected).length} annonces`);
  chk('C2. les douze zones sont toutes retrouvables',
    C.flatMap((e) => e.sourceZoneIndexes).length === 12);
}
{
  const zones = Array.from({ length: 6 }, (_, i) => z(i * 25, 5, i % 2 ? 'moderate' : 'high'));
  const D = P.construireEpisodes(zones);
  const pD = P.construirePlanAnnonces(D);
  chk('D. six épisodes → au plus quatre annonces',
    D.length === 6 && pD.filter((x) => x.selected).length <= P.MAX_ALERTS,
    `${D.length} épisodes, ${pD.filter((x) => x.selected).length} annonces`);
  chk('D2. le journal peut expliquer chaque écart',
    pD.filter((x) => !x.selected).every((x) => !!x.rejet),
    pD.filter((x) => !x.selected).map((x) => `${x.episodeId}: ${x.rejet}`).join(' | ') || 'aucun écart');
}
{
  const E = P.construireEpisodes([z(0, 3, 'low', 'droite'), z(20, 3, 'low', 'face')]);
  const pE = P.construirePlanAnnonces(E);
  chk('E. trajet sans soleil pertinent → aucun épisode annonçable',
    pE.length === 0, `${E.length} épisode(s) faible(s), ${pE.length} entrée(s) de plan`);
}
{
  const F = [
    P.leadCibleSecondes(ep({ maxLevel: 'moderate', exposedSeconds: 150 })),
    P.leadCibleSecondes(ep({ maxLevel: 'high', dominantSide: 'droite', exposedSeconds: 600 })),
    P.leadCibleSecondes(ep({ maxLevel: 'high', dominantSide: 'face', exposedSeconds: 900 })),
  ];
  chk('F. les trois profils donnent trois anticipations croissantes',
    F[0] < F[1] && F[1] < F[2], F.join(' s < ') + ' s');
}

console.log('\n== phrases de niveau 1 ==');
for (const e of [ep({ maxLevel: 'high', dominantSide: 'face' }),
                 ep({ maxLevel: 'moderate', dominantSide: 'face' }),
                 ep({ maxLevel: 'high', dominantSide: 'droite' }),
                 ep({ maxLevel: 'moderate', dominantSide: 'gauche' })]) {
  console.log(`      ${e.maxLevel.padEnd(9)} ${e.dominantSide.padEnd(8)} → « ${P.titreEpisode(e)} »`);
}
{
  const interdits = /éblou|danger|risque|gêné|critique|intense/i;
  const toutes = ['high', 'moderate'].flatMap((l) => ['face', 'gauche', 'droite']
    .map((c) => P.titreEpisode(ep({ maxLevel: l, dominantSide: c }))));
  chk('les phrases décrivent une géométrie, jamais une gêne vécue',
    !toutes.some((t) => interdits.test(t)));
}

console.log(`\n${ok} contrôle(s) PASS, ${ko} ÉCHEC.`);
if (ko) { console.log('Échecs : ' + echecs.join(' | ')); process.exit(1); }
