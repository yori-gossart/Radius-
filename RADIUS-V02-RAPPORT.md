# RADIUS V0.2 — Journey + Stationary · rapport

**Branche** `radius-v0.2-journey-stationary` — poussée, **non fusionnée**.
**Commit** `c86d801`
**Preview Vercel** https://radius-eblouissement-git-radius-v02-journ-c42a9b-nutricyclev01a.vercel.app/journey.html
La production (`radius-eblouissement.vercel.app`) n'a pas bougé.

## ⚠ Action manuelle à faire — c'est la seule chose qui débloque Journey

`/api/route` répond **503**. Ce statut ne sort que d'**une seule branche** de
`api/route.js` : celle où `process.env.GOOGLE_MAPS_API_KEY` est absent. Les
journaux du preview le confirment — `/api/journey-weather` répond 200 au même
moment, parce qu'Open-Meteo ne demande aucune clé. C'est pour cela que le mode
Point fixe marche et que Journey ne marche pas.

La variable est portée par l'environnement **Production** et n'a jamais été
étendue à **Preview**. Aucun code n'est en cause.

1. Vercel → projet `radius-eblouissement` → **Settings → Environment Variables**
2. Ligne `GOOGLE_MAPS_API_KEY` → **Edit**
3. Cocher **Preview** en plus de Production. Si l'option de branche est
   proposée, restreindre à `radius-v0.2-journey-stationary` — la clé est
   facturée, autant ne pas l'ouvrir à toutes les branches futures.
4. **Save**, puis **Redeploy** du dernier déploiement de la branche : une
   variable d'environnement n'est lue qu'au déploiement.

Cela débloque aussi `/api/elevation`, qui porte le même garde.

**Ne pas créer de seconde clé. Ne jamais écrire la clé dans le dépôt.**

Réserve : exposer la clé facturée à Preview augmente la surface de dépense, et
**le plafond de budget Google Cloud n'est toujours pas posé**. Restreindre à la
branche limite les dégâts ; cela ne remplace pas le plafond.

## Corrections du 16 septembre

**Boussole — l'écran suit les trois niveaux, comme le reste du produit.**

- niveau 1, le mot avant le chiffre : **« Sud-Est · 150° »**, huit directions
  cardinales. Au-delà de huit, on prétendrait une finesse que ni le
  magnétomètre du téléphone ni sa calibration ne garantissent ;
- l'écran dit **ce que cette direction représente** : celle vers laquelle pointe
  le haut du téléphone, pas celle d'une route ;
- Soleil sous l'horizon : **« Soleil couché — aucune exposition solaire
  actuellement »**, et aucune direction n'est suggérée. « Soleil derrière à
  gauche » à 22 h laisserait croire à une exposition qui n'existe pas ;
- Soleil levé : sa position **relativement à l'orientation regardée** — droit
  devant, devant à droite, à droite, derrière à droite, droit derrière ;
- niveau 3 : azimut, élévation, cap brut, écart cap→Soleil, orientation absolue
  ou relative, source du capteur, point GPS et sa précision. **Rien ne
  disparaît.**

Les bornes de `sunRelativeLabel()` — 15, 45, 110, 160 — **n'ont pas bougé d'un
degré** ; les tests les vérifient une par une, de part et d'autre de chaque
bascule. Seuls les mots ont changé : « Soleil sur le côté droite » n'est pas du
français.

**GPS — la précision n'est jamais masquée.** Au-delà de `PRECISION_TERRAIN_M`
= 100 m : **« Précision GPS ≈ 2000 m — position trop imprécise pour un relevé
terrain fiable »**, en encadré d'alerte, chiffre en clair, **sans empêcher le
prototype de tourner** — c'est en marchant qu'on découvre que le GPS dérive. Ce
seuil qualifie une **donnée**, pas le ciel : il ne lit pas `T`.

Aucune formule scientifique touchée : `index.html` et les trois handlers restent
byte-identiques, et le diff de `journey-core.mjs` ne contient aucune ligne de
`solar()`.

## Tests — 285 contrôles, 0 échec

| Banc | Contrôles |
|---|---|
| `test-journey-v02.mjs` (étendu) | déterministes, accord solaire, échéances, cardinaux, qualité GPS |
| `test-journey-navigateur.mjs` | 53 |
| `test-api.mjs` (étendu) | 97 dont 19 sur `/api/journey-weather` |
| `test-corrections.mjs` | 57 |
| `test-aller-retour.mjs` | 53 |
| `test-figeage.mjs` | 22 |
| `test-episodes.mjs` | 53 |
| `test-route.mjs` | 4 |

## Fichiers

**Créés** — `journey.html`, `journey-core.mjs`, `api/journey-weather.js`,
`test-journey-v02.mjs`, `test-journey-navigateur.mjs`,
`RADIUS-V02-JOURNEY-STATIONARY.md`

**Modifiés** — `sw.js` (les `.mjs` en réseau d'abord, cache v5),
`test-api.mjs` (couverture du 4ᵉ endpoint), `CLAUDE.md` (décisions V0.2)

**Intacts** — `index.html`, `api/route.js`, `api/elevation.js`, `api/weather.js`

## Quatre corrections à l'intégration

1. **Réfraction atmosphérique ajoutée à `solar()`.** Le paquet livré ne
   l'appliquait pas : **jusqu'à 0,27° d'écart en élévation** avec `index.html`
   à l'approche de l'horizon — le régime où vit le produit, et où
   `T.high.maxElev` vaut 8°. Les deux pages auraient décrit deux soleils.
   L'azimut, lui, concordait exactement.
2. **Aucun `fetch()` nu** dans `journey.html` : les trois appels passent par
   `fetchBorne()`.
3. **La météo ne bloque plus aucun résultat** : sa panne se dit avec sa durée
   et laisse le trajet, le séjour et le Soleil s'afficher.
4. **Codes d'erreur alignés** sur les trois autres endpoints, et refus d'un
   fournisseur autre que `google-routes`.

Aucun seuil scientifique introduit. `/api/journey-weather` ne renvoie aucun
champ de verdict — éprouvé sur une vraie réponse.

## À tester physiquement sur le Galaxy A55

Chromium n'a pas de capteur et je n'ai appelé ni Google ni Open-Meteo en réel.
Restent donc à vérifier sur l'appareil :

1. **La boussole.** Si `deviceorientationabsolute` est réellement émis, et si
   l'orientation annoncée absolue l'est vraiment. J'ai injecté des événements
   synthétiques — la conversion α→cap, le mot cardinal et le refus d'écraser une
   orientation absolue par une relative sont vérifiés, le capteur ne l'est pas.
   Faire le 8 de calibration avant de juger.
   **Vérifier que le mot cardinal affiché correspond à ce que tu regardes
   vraiment.** Si le téléphone annonce « Sud-Est » alors que tu fais face à
   l'ouest, c'est le capteur ou sa calibration, pas le calcul.
2. **L'accord boussole / Soleil.** Pointer le haut du téléphone vers le Soleil
   et vérifier que la phrase dit bien « presque dans l'axe devant ».
3. **Le GPS** : demande de permission, précision annoncée, comportement en cas
   de refus.
4. **Une vraie sortie** avec Google Routes et Open-Meteo réels — **après**
   l'action Vercel ci-dessus : cohérence de l'heure d'arrivée, du départ retour,
   et des neuf variables météo.
7. **La précision GPS en extérieur dégagé.** Les 2000 m relevés viennent
   probablement d'une position réseau/Wi-Fi plutôt que satellite. Vérifier si
   elle descend sous 100 m une fois dehors, écran allumé, après quelques
   secondes.
5. **Le service worker.** Le preview est un autre domaine que la production :
   il a son propre worker. Recharger une fois sur le preview.
6. **Lisibilité en plein soleil** de la timeline et du cadran.

## Réserves

- La météo reste un **modèle de prévision**, pas une observation ; aucune
  conclusion n'en est tirée.
- Les libellés de direction (15° / 45° / 110° / 160°) décrivent une géométrie.
  Ce ne sont **pas** des seuils calibrés et ils ne lisent pas `T`.
- L'échantillonnage vise la vérification produit, pas une cartographie continue.
