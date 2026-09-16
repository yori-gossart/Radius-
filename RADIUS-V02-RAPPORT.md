# RADIUS V0.2 — Journey + Stationary · rapport

**Branche** `radius-v0.2-journey-stationary` — poussée, **non fusionnée**.
**Commit** `7c71753`
**Preview Vercel** https://radius-eblouissement-git-radius-v02-journ-c42a9b-nutricyclev01a.vercel.app/journey.html
La production (`radius-eblouissement.vercel.app`) n'a pas bougé.

## Tests — 262 contrôles, 0 échec

| Banc | Contrôles |
|---|---|
| `test-journey-v02.mjs` (étendu) | déterministes + accord solaire + échéances |
| `test-journey-navigateur.mjs` (nouveau) | 30 |
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
   synthétiques — la conversion α→cap et le refus d'écraser une orientation
   absolue par une relative sont vérifiés, le capteur ne l'est pas.
   Faire le 8 de calibration avant de juger.
2. **L'accord boussole / Soleil.** Pointer le haut du téléphone vers le Soleil
   et vérifier que la phrase dit bien « presque dans l'axe devant ».
3. **Le GPS** : demande de permission, précision annoncée, comportement en cas
   de refus.
4. **Une vraie sortie** avec Google Routes et Open-Meteo réels : cohérence de
   l'heure d'arrivée, du départ retour, et des neuf variables météo.
5. **Le service worker.** Le preview est un autre domaine que la production :
   il a son propre worker. Recharger une fois sur le preview.
6. **Lisibilité en plein soleil** de la timeline et du cadran.

## Réserves

- La météo reste un **modèle de prévision**, pas une observation ; aucune
  conclusion n'en est tirée.
- Les libellés de direction (15° / 45° / 110° / 160°) décrivent une géométrie.
  Ce ne sont **pas** des seuils calibrés et ils ne lisent pas `T`.
- L'échantillonnage vise la vérification produit, pas une cartographie continue.
