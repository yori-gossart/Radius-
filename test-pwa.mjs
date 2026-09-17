/* Banc de l'enveloppe PWA — manifeste, service worker, identité.
   ------------------------------------------------------------------
   Ce banc lit des fichiers, il ne lance pas de navigateur : le cycle de vie
   d'un service worker ne se rejoue pas honnêtement dans un banc, et prétendre
   le contraire donnerait une fausse assurance. Ce qu'il éprouve, ce sont les
   invariants qu'on peut établir sans exécuter — et le reste est nommé dans le
   rapport comme restant à vérifier sur l'appareil.

       node test-pwa.mjs
*/
import assert from 'node:assert/strict';
import fs from 'node:fs';

const lire = (f) => fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8');
let ok = 0, ko = 0; const echecs = [];
function chk(nom, v, detail = '') {
  if (v) { ok++; console.log(`  PASS  ${nom}${detail ? ' — ' + detail : ''}`); }
  else { ko++; echecs.push(nom); console.log(`  ÉCHEC ${nom}${detail ? ' — ' + detail : ''}`); }
}

console.log('\n== Identité ==');
const manifest = JSON.parse(lire('manifest.json'));
chk('le manifeste porte RADIUS', /^RADIUS/.test(manifest.name), manifest.name);
chk('le nom court aussi', manifest.short_name === 'RADIUS', manifest.short_name);
chk('aucun vestige de l’ancien nom de produit',
  !/Éblouissement —|"Éblouissement"/.test(lire('manifest.json')));
chk('le titre de la page porte RADIUS',
  /<title>RADIUS —/.test(lire('index.html')),
  (lire('index.html').match(/<title>[^<]*/) || [''])[0]);
/* Les URLs ne bougent pas : un raccourci déjà posé sur un écran d'accueil
   continue de pointer au même endroit. */
chk('start_url inchangé', manifest.start_url === './', manifest.start_url);
chk('l’icône est inchangée', manifest.icons[0].src === 'icon.svg');
chk('le mot « éblouissement » reste employé pour le phénomène',
  /éblouissement/i.test(lire('index.html')),
  'c’est le nom du produit qui change, pas celui de la chose');

console.log('\n== Service worker ==');
const sw = lire('sw.js');
const version = (sw.match(/const VERSION = '([^']+)'/) || [])[1];
chk('le cache porte une version', !!version, version);
const fichiers = (sw.match(/const FICHIERS = \[([\s\S]*?)\];/) || [])[1] || '';
/* index.html ne se suffit plus à lui-même : son script est un module. Sans le
   cœur au cache, l'application ne démarre pas hors ligne. */
chk('le cœur commun est mis en cache', /radius-core\.mjs/.test(fichiers), fichiers.replace(/\s+/g, ' ').trim());
chk('index.html et le manifeste aussi',
  /'index\.html'/.test(fichiers) && /manifest\.json/.test(fichiers));
for (const f of JSON.parse('[' + fichiers.replace(/'/g, '"').replace(/\s+/g, '') + ']')) {
  if (f === './') continue;
  chk(`le fichier précaché existe : ${f}`, fs.existsSync(new URL('./' + f, import.meta.url)));
}
/* Servir index.html pour un .mjs absent rendrait du HTML là où le navigateur
   attend un module : l'erreur porterait sur une syntaxe, pas sur le fichier
   manquant, et serait indéchiffrable. */
chk('le repli sur index.html est réservé aux navigations',
  /req\.mode === 'navigate' \? caches\.match\('index\.html'\) : Response\.error\(\)/.test(sw));
chk('les .mjs sont servis réseau d’abord, comme les pages',
  /url\.pathname\.endsWith\('\.mjs'\)/.test(sw));
chk('/api/ n’entre jamais au cache',
  /url\.pathname\.startsWith\('\/api\/'\)\) return;/.test(sw),
  'une altitude ou une météo servie depuis le cache serait un relevé faux');
chk('les anciens caches sont supprimés à l’activation',
  /caches\.keys\(\)[\s\S]*?filter\(\(x\) => x !== CACHE\)[\s\S]*?caches\.delete/.test(sw));

console.log('\n== Les pages chargent ce dont elles dépendent ==');
for (const [page, dep] of [['index.html', 'radius-core.mjs'], ['journey.html', 'journey-core.mjs']]) {
  const src = lire(page);
  const imports = [...src.matchAll(/from '\.\/([^']+)'/g)].map((m) => m[1]);
  chk(`${page} importe ${dep}`, imports.includes(dep), imports.join(', ') || '(aucun)');
  for (const i of imports) {
    chk(`${page} → ${i} existe`, fs.existsSync(new URL('./' + i, import.meta.url)));
    chk(`${page} → ${i} est précaché ou importé par un fichier qui l’est`,
      new RegExp(i.replace('.', '\\.')).test(fichiers) || i === 'radius-core.mjs',
      fichiers.includes(i) ? 'précaché' : 'atteint via un module précaché');
  }
}

console.log('\n== Les deux interfaces sont atteignables ==');
/* Les deux coexistent le temps de la validation. La racine sert index.html ;
   sans lien dans la page, journey.html n'était atteignable qu'en tapant son URL
   à la main — invisible depuis la PWA installée, donc jamais essayé sur la
   route. Aucune page d'accueil intermédiaire : elle coûterait un geste à chaque
   lancement pour la tâche principale, qui reste le trajet. */
const NAV = { 'index.html': './', 'journey.html': 'journey.html' };
for (const [page, courant] of Object.entries(NAV)) {
  const src = lire(page);
  const nav = (src.match(/<nav class="nav-site"[\s\S]*?<\/nav>/) || [])[0] || '';
  chk(`${page} porte la navigation entre interfaces`, !!nav);
  const liens = [...nav.matchAll(/<a href="([^"]+)"([^>]*)>([^<]+)<\/a>/g)];
  chk(`${page} : deux destinations, pas plus`, liens.length === 2,
    liens.map((l) => l[1]).join(' | '));
  chk(`${page} mène au Trajet`, liens.some((l) => l[1] === './'));
  chk(`${page} mène à Journey & Point fixe`, liens.some((l) => l[1] === 'journey.html'));
  /* Deux pages qui se prétendent toutes deux « page courante » ne se
     distinguent plus : on ne sait plus où l'on est. */
  const marques = liens.filter((l) => /aria-current="page"/.test(l[2]));
  chk(`${page} : une seule page marquée courante`, marques.length === 1);
  chk(`${page} se désigne elle-même`, marques.length === 1 && marques[0][1] === courant,
    marques.length === 1 ? marques[0][1] : '(aucune)');
  for (const [, href] of liens) {
    const cible = href === './' ? 'index.html' : href;
    chk(`${page} → ${href} existe (${cible})`, fs.existsSync(new URL('./' + cible, import.meta.url)));
    chk(`${page} → ${href} est précaché`, new RegExp(cible.replace('.', '\\.')).test(fichiers)
      || (href === './' && /'\.\/'/.test(fichiers)));
  }
}
/* Le manifeste ne déclarait aucune portée : la valeur par défaut — le dossier
   de start_url — englobe déjà journey.html, mais rien ne l'écrivait. L'écrire
   ne change aucun comportement ; ça empêche qu'une portée plus étroite soit
   ajoutée un jour sans voir qu'elle éjecterait Journey de l'application. */
chk('la portée est déclarée', manifest.scope === './', manifest.scope);
const dansPortee = (u) => new URL(u, 'https://x/a/').href
  .startsWith(new URL(manifest.scope, 'https://x/a/').href);
chk('journey.html reste dans la portée de l’application', dansPortee('journey.html'));
chk('index.html aussi', dansPortee('index.html') && dansPortee(manifest.start_url));
/* La PWA installée doit rester clairement RADIUS — donc pas de seconde
   application — sans masquer Journey : un raccourci d'icône y mène en direct. */
const raccourcis = manifest.shortcuts || [];
chk('un raccourci mène à Journey depuis l’icône', raccourcis.length === 1
  && raccourcis[0].url === 'journey.html', JSON.stringify(raccourcis.map((r) => r.url)));
chk('la cible du raccourci existe',
  raccourcis.every((r) => fs.existsSync(new URL('./' + r.url, import.meta.url))));
chk('aucune seconde application n’est déclarée', manifest.name.startsWith('RADIUS')
  && manifest.short_name === 'RADIUS');

console.log(`\n${ok} contrôle(s) OK, ${ko} en échec.`);
if (ko) { console.log('Échecs : ' + echecs.join(' | ')); process.exit(1); }
