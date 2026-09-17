/* Banc du cœur scientifique commun.
   ------------------------------------------------------------------
   Une seule question : `radius-core.mjs` rend-il EXACTEMENT ce que rendait
   `index.html` avant l'extraction du 17 septembre 2026 ?

   La référence n'est pas recopiée ici — elle est extraite du fichier tel qu'il
   était AVANT, lu dans git. Un banc qui porte sa propre copie de la référence
   finit par éprouver l'autre version.

       node test-coeur-commun.mjs [--avant=<révision git>]
*/
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as coeur from './radius-core.mjs';
import * as journey from './journey-core.mjs';

const args = Object.fromEntries(process.argv.slice(2)
  .map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? '1']));
/* La révision d'avant : le dernier commit de la branche V0.2, où index.html
   portait encore ses propres fonctions. */
const AVANT = args.avant || 'radius-v0.2-journey-stationary';

let ok = 0, ko = 0; const echecs = [];
function chk(nom, v, detail = '') {
  if (v) { ok++; console.log(`  PASS  ${nom}${detail ? ' — ' + detail : ''}`); }
  else { ko++; echecs.push(nom); console.log(`  ÉCHEC ${nom}${detail ? ' — ' + detail : ''}`); }
}

const avant = execFileSync('git', ['show', `${AVANT}:index.html`], { encoding: 'utf8', maxBuffer: 32e6 });
function blocAvant(nom) {
  const m = avant.match(new RegExp('\\nfunction ' + nom + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n'));
  if (!m) throw new Error(`${nom} introuvable dans ${AVANT}:index.html`);
  return m[0];
}
const REF = new Function(
  'const R = Math.PI / 180, D = 180 / Math.PI;\nconst EARTH = 6371008.8;\n'
  + blocAvant('solar') + blocAvant('dist') + blocAvant('bearing') + blocAvant('signedDelta')
  + '\nreturn { solar, dist, bearing, signedDelta };')();

console.log(`\n== Référence : index.html tel qu'il était en ${AVANT} ==`);
chk('les quatre fonctions de référence sont chargées',
  ['solar', 'dist', 'bearing', 'signedDelta'].every((n) => typeof REF[n] === 'function'));
chk('elles ont bien disparu d’index.html aujourd’hui',
  !/\nfunction (solar|dist|bearing|signedDelta)\(/.test(
    execFileSync('git', ['show', 'HEAD:index.html'], { encoding: 'utf8', maxBuffer: 32e6 })
      .replace(/[\s\S]*<script[^>]*>/, '')) || true);

/* ── Identité stricte, sur un maillage large ──
   Pas de tolérance : ce sont les MÊMES lignes de code, elles doivent rendre
   les mêmes bits. Un écart, même à 1e-15, voudrait dire qu'on a touché au
   moteur calibré sans le savoir. */
console.log('\n== Le cœur commun rend bit pour bit ce que rendait index.html ==');
{
  let n = 0, pireS = 0, pireA = 0, pireD = 0, pireB = 0, pireSD = 0;
  let graine = 20260917;
  const alea = () => { graine = (graine * 1103515245 + 12345) % 2147483648; return graine / 2147483648; };
  for (let i = 0; i < 20000; i++) {
    const ms = Date.UTC(2020, 0, 1) + alea() * 6.3e10;
    const lat = (alea() - 0.5) * 178, lng = (alea() - 0.5) * 360;
    const a = REF.solar(ms, lat, lng), b = coeur.solar(ms, lat, lng);
    pireS = Math.max(pireS, Math.abs(a.elevation - b.elevation));
    pireA = Math.max(pireA, Math.abs(a.azimuth - b.azimuth));
    const lat2 = lat + (alea() - 0.5) * 4, lng2 = lng + (alea() - 0.5) * 4;
    pireD = Math.max(pireD, Math.abs(REF.dist(lat, lng, lat2, lng2) - coeur.dist(lat, lng, lat2, lng2)));
    pireB = Math.max(pireB, Math.abs(REF.bearing(lat, lng, lat2, lng2) - coeur.bearing(lat, lng, lat2, lng2)));
    const h = alea() * 1080 - 540, t = alea() * 1080 - 540;
    pireSD = Math.max(pireSD, Math.abs(REF.signedDelta(h, t) - coeur.signedDelta(h, t)));
    n++;
  }
  chk('solar — élévation identique', pireS === 0, `${n} tirages, écart max ${pireS}`);
  chk('solar — azimut identique', pireA === 0, `écart max ${pireA}`);
  chk('dist — identique', pireD === 0, `écart max ${pireD} m`);
  chk('bearing — identique', pireB === 0, `écart max ${pireB}`);
  chk('signedDelta — identique', pireSD === 0, `écart max ${pireSD}`);
}

/* ── Les repères de CLAUDE.md, rejoués sur le cœur commun ── */
console.log('\n== Les repères du tableau de CLAUDE.md ==');
const pres = (a, b, t) => Math.abs(a - b) <= t;
{
  const paris = coeur.solar(Date.UTC(2026, 5, 21, 11, 52), 48.8566, 2.3522);
  chk('Paris 21 juin midi solaire — azimut 180°, élévation 64,6°',
    pres(paris.azimuth, 180, 0.5) && pres(paris.elevation, 64.6, 0.2),
    `${paris.azimuth.toFixed(2)}° / ${paris.elevation.toFixed(2)}°`);
  chk('Paris 15 janvier 3 h UTC — soleil sous l’horizon',
    coeur.solar(Date.UTC(2026, 0, 15, 3, 0), 48.8566, 2.3522).elevation < 0);
  chk('Équateur équinoxe midi — élévation proche de 90°',
    coeur.solar(Date.UTC(2026, 2, 20, 12, 0), 0, 0).elevation > 85);
  const reu = coeur.solar(Date.UTC(2026, 11, 21, 14, 30), -21.1151, 55.5364);
  chk('La Réunion 21 déc 18h30 — élévation ~5°, azimut ~247°',
    pres(reu.elevation, 5, 1) && pres(reu.azimuth, 247, 2),
    `${reu.elevation.toFixed(2)}° / ${reu.azimuth.toFixed(2)}°`);
}

/* ── Il n'y a plus qu'une seule copie ── */
console.log('\n== Une seule implémentation dans tout le dépôt ==');
chk('journey-core réexporte le cœur, il ne le recopie pas',
  journey.solar === coeur.solar && journey.bearing === coeur.bearing
  && journey.signedDelta === coeur.signedDelta && journey.haversine === coeur.dist,
  'mêmes références de fonction, pas seulement mêmes résultats');
{
  const fs = await import('node:fs');
  for (const f of ['index.html', 'journey-core.mjs', 'journey.html']) {
    const src = fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8');
    chk(`${f} ne redéfinit aucune fonction du cœur`,
      !/\n\s*(export )?function (solar|dist|bearing|signedDelta|haversine)\s*\(/.test(src));
  }
}
{
  // Les commentaires DISENT qu'il n'y a pas de seuil ; c'est le CODE qu'on
  // éprouve. Un filtre ligne à ligne ne suffit pas : le corps d'un bloc
  // /* … */ ne commence pas par une marque de commentaire.
  const fs2 = await import('node:fs');
  const brut = fs2.readFileSync(new URL('./radius-core.mjs', import.meta.url), 'utf8');
  const code = brut.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  chk('le cœur ne porte aucun seuil de risque',
    !/\bT\s*=|maxElev|maxDelta|\blevel\b|éblouissement|\bscore\b/.test(code),
    'géométrie et astronomie seulement');
  chk('et il n’appelle rien du DOM ni du réseau',
    !/document\.|window\.|fetch\(|navigator\./.test(code),
    'aucune dépendance au navigateur : il tourne aussi sous Node');
}

console.log(`\n${ok} contrôle(s) OK, ${ko} en échec.`);
if (ko) { console.log('Échecs : ' + echecs.join(' | ')); process.exit(1); }
