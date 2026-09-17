# RADIUS — rapport de stabilisation

Branche `radius-stabilization`, 17 septembre 2026.
Partie de `radius-v0.2-journey-stationary`. **Rien n'est fusionné** — ni dans la
branche source, ni en production.

---

## Ce qui a été trouvé

### 1. Les deux moteurs solaires divergeaient, et le banc ne pouvait pas le voir

`index.html` et `journey-core.mjs` portaient chacun leur propre `solar()`,
`dist()`, `bearing()` et `signedDelta()`. Le banc les comparait sur **six cas
choisis**, où ils s'accordent à 1e-11. Sur vingt mille tirages :

| Régime | Écart max d'azimut |
|---|---|
| élévation −1° à 8° — **le régime du produit** | 0,004° |
| 8° à 20° | 0,004° |
| 20° à 60° | 0,008° |
| 60° à 85° | 0,035° |
| 85° à 90° | **0,27°** |

L'écart grandit vers le zénith, où l'azimut est mal conditionné : les deux
fichiers n'employaient pas la même formule d'azimut. Et `dist()` prenait
**6 371 008,8 m** de rayon terrestre d'un côté, **6 371 000** de l'autre — 0,2 m
sur une centaine de kilomètres.

**Six points ne prouvent pas une identité.**

### 2. Une troisième copie de l'interpolation, avec un cap dégradé

`journey-core.mjs` portait sa propre `pointAtDistance()` et rendait le cap de la
**corde** du sous-segment. Le moteur, lui, lit le cap sur une fenêtre symétrique
de ±20 m — elle existe précisément parce que la corde lisse le virage et donne la
tangente un demi-pas trop loin, ce qui vaut 19° d'erreur sur un rayon de 150 m, à
comparer aux 12° qui séparent « de face » du reste.

### 3. Une régression hors ligne, introduite en cours de route

Rendre le script d'`index.html` modulaire crée une dépendance à
`radius-core.mjs`, qui **n'était pas** dans la liste précachée du service worker.
Pire : le repli servait `index.html` pour toute requête « page-like », donc **du
HTML là où le navigateur attend un module**. L'erreur aurait porté sur une
syntaxe, pas sur le fichier manquant.

### 4. Un verdict posé au-dessus d'une description

La pastille de chaque carte disait « Élevé », « Modéré », « Faible », au-dessus
d'un titre qui décrivait déjà la géométrie. Tant que `T` n'est pas calibré,
« élevé » se lit « ça va t'éblouir » alors que le moteur a seulement constaté un
soleil bas dans l'axe.

### 5. Le premier point GPS n'est pas le bon

Il vient souvent du réseau ou du Wi-Fi, pas des satellites : c'est ce qui
produisait les 2 km relevés sur le terrain.

### 6. `Number(null) === 0`, quatrième occurrence

Une précision GPS absente aurait été lue « 0 m », donc **la meilleure mesure
possible**. Même piège que l'alpha nul du capteur, le cap nul de la rose et la
latitude nulle devenue l'équateur.

### 7. Défauts dans les bancs eux-mêmes

- un lecteur de niveau 1 lisait du texte **masqué** : un contrôle pouvait passer
  sur ce que personne ne voit ;
- une attente se résolvait instantanément et faisait passer trois contrôles sur
  le texte par défaut ;
- `LABEL` était déclaré et jamais employé.

---

## Ce qui a été corrigé

| Lot | Commit | Ce qui change |
|---|---|---|
| 1 | `62dfa73` | `radius-core.mjs` : une seule copie de la géométrie et de l'astronomie, reprise **mot pour mot** d'`index.html`. `journey-core` et `route-audit` la chargent. |
| 2 | `290c3d7` | Acquisition GPS de 8 s, meilleure mesure retenue, arrêt anticipé, abandon possible, alerte >100 m conservée. |
| 3 | `c6e417f` | « Figer cette orientation » / « Reprendre la boussole en direct », dans une **seconde** variable. |
| 4 | `307b1a2` | Journey emploie le cap ±20 m du moteur ; inventaire de ce qu'il ne réutilise pas. |
| 5 | `defbabb` | Le niveau 1 décrit la géométrie ; le niveau brut descend au niveau 3. |
| 6 | `ca9150e` | Cœur précaché, repli restreint aux navigations, cache `v6`, identité RADIUS. |
| 7 | `f5a8019` | CI GitHub Actions, sans aucune dépendance nouvelle. |
| — | `f9acacc` | Comptes de tests obsolètes corrigés. |

**Ce qui n'a pas bougé** : `T`, `STEP_METERS`, `HEADING_HALF_WINDOW`,
`MAX_ALERTS`, `COOLDOWN_MS`, `MIN_LEAD_SECONDS`, `EPISODE_GAP_S`, les bornes
15 / 45 / 110 / 160, les règles d'épisode et la règle de parole. `index.html`
rend **bit pour bit** ce qu'il rendait avant : écart max **exactement 0** sur
vingt mille tirages, contre la version d'avant extraite de git.

---

## Ce qui reste ouvert, volontairement

**Journey ne vérifie pas le raccrochage de Google.** `index.html` refuse un
trajet dont Google a raccroché le départ à plus de `SNAP_MAX_M` = 2000 m
(`routeGoogleVersTimeline`). Journey lit la réponse `/api/route` directement : un
itinéraire raccroché de travers y passerait **en silence**. Non corrigé parce que
ce serait une règle de refus nouvelle dans une page qui n'en a pas, et la
consigne excluait toute fonction produit nouvelle. **À décider.**

**Journey ne réutilise toujours pas :** `resample()` / `STEP_METERS` (il
échantillonne par le temps, il ne détecte pas de zones), `analyze()` /
`classify()` / `T` / `RANK` (il décrit, il ne classe pas), la couche relief (un
appel Elevation par instant simulé), les épisodes et la règle de parole (il ne
parle pas). Chacun pour une raison écrite dans `CLAUDE.md`, pas par oubli.

**`index.html` et `journey.html` ne sont pas fusionnés.** Le gain serait mince,
le risque réel.

**Le plafond de budget Google Cloud n'est toujours pas posé.** C'est la seule
protection réelle contre un abus de quota, et c'est une action de compte.

**`GOOGLE_MAPS_API_KEY` n'est pas étendue à l'environnement Preview**, donc
`/api/route` y répond 503 et Journey reste bloqué. Le mode Point fixe, qui ne
dépend que d'Open-Meteo, fonctionne.

**Aucun relevé de terrain pour `T`.** La phase de mesure n'a pas commencé.

---

## Tests

**Tous verts, mesurés sur l'état final de la branche.**

| Banc | Contrôles | Navigateur | Dans la CI |
|---|---|---|---|
| `test-journey-v02.mjs` | 235 assertions | non | oui |
| `test-api.mjs` | 97 | non | oui |
| `test-episodes.mjs` | 53 | non | oui |
| `test-pwa.mjs` *(nouveau)* | 26 | non | oui |
| `test-coeur-commun.mjs` *(nouveau)* | 17 | non | oui |
| `test-route.mjs` | 4 | non | oui |
| `test-journey-navigateur.mjs` | 165 | oui | **non** |
| `test-corrections.mjs` | 72 | oui | **non** |
| `test-aller-retour.mjs` | 53 + 18 scénarios | oui | **non** |
| `test-figeage.mjs` | 22 | oui | **non** |

**La CI ne couvre pas les quatre bancs navigateur** — Playwright n'est pas sur
les exécuteurs GitHub et le workflow ne l'installe pas. Elle le dit à chaque
exécution. Une CI qui prétend plus qu'elle ne fait est pire que pas de CI.

**Aucune fusion ne doit être recommandée si un banc échoue**, y compris parmi les
quatre qui ne sont pas automatisés.

Deux bancs ont changé de nature en mieux :

- `test-coeur-commun.mjs` compare le cœur à la version d'**avant**, extraite de
  git — la référence n'est pas recopiée dans le banc, sans quoi il finirait par
  éprouver l'autre version ;
- `F-004` de `test-figeage.mjs` simulait une panne en remplaçant une fonction
  interne ; il provoque désormais la **vraie** en retirant `#techEpisodes` du DOM.

---

## Fichiers modifiés ou créés

**Créés** — `radius-core.mjs`, `test-coeur-commun.mjs`, `test-pwa.mjs`,
`.github/workflows/tests.yml`, ce rapport.

**Modifiés** — `index.html`, `journey.html`, `journey-core.mjs`,
`route-audit.html`, `sw.js`, `manifest.json`, `CLAUDE.md`, les six bancs,
`RADIUS-V02-RAPPORT.md`, `RADIUS-V02-JOURNEY-STATIONARY.md`.

`RADIUS-V02-RAPPORT.md` n'a **pas** vu ses chiffres réécrits : il décrivait l'état
au 16 septembre, et les changer ferait croire qu'il annonçait autre chose. Son
tableau est daté et renvoie ici.

---

## À vérifier physiquement sur le Galaxy A55

Aucun banc ne peut remplacer ces essais.

1. **Le hors-ligne.** C'est le point le plus important de cette branche : la
   régression du service worker n'a été trouvée qu'en lisant le code, et la
   correction n'a été éprouvée que sur les fichiers. Ouvrir RADIUS, couper le
   réseau, recharger. La page doit s'ouvrir ; si elle reste blanche avec une
   erreur de syntaxe, le module n'est pas servi.
2. **L'acquisition GPS.** Dehors, écran allumé : la précision doit descendre de
   plusieurs centaines de mètres à quelques dizaines en quelques secondes.
   Vérifier que « Meilleure de N mesures » augmente, et que « Arrêter
   l'acquisition » rend bien la meilleure obtenue.
3. **La boussole.** Que `deviceorientationabsolute` soit réellement émis, et que
   l'orientation annoncée absolue le soit. Faire le 8 de calibration. Vérifier
   que le mot cardinal correspond à ce qu'on regarde vraiment.
4. **Le gel d'orientation.** Figer face à une direction, tourner le téléphone :
   le radar ne doit pas bouger, et le bandeau doit montrer la dérive.
5. **Le nouveau nom.** Retirer et reposer le raccourci sur l'écran d'accueil :
   il doit afficher RADIUS et pointer au même endroit.
6. **Journey**, seulement après avoir étendu `GOOGLE_MAPS_API_KEY` à Preview.
7. **Lisibilité en plein soleil** du radar et des nouvelles étiquettes.
