# RADIUS V0.2 — Journey + Stationary

Date : 16 septembre 2026

## But

Tester RADIUS sans élargir le moteur de risque : une sortie est une séquence temporelle complète, pas seulement un trajet.

`ALLER -> SUR PLACE -> RETOUR`

Chaque phase garde sa propre horloge. Le retour est recalculé par Google Routes à l'heure réelle de départ retour ; sa géométrie n'est jamais obtenue en inversant l'aller.

## Fichiers ajoutés

- `journey.html` : interface mobile-first dédiée au prototype Journey + Stationary.
- `journey-core.mjs` : géométrie, position solaire NOAA, échantillonnage temporel du trajet et boussole.
- `api/journey-weather.js` : météo descriptive pour Journey/Stationary, sans modifier l'API météo V0.4 existante.
- `test-journey-v02.mjs` : tests déterministes sans dépendance.

## Journey

Entrées :
- départ (adresse ou GPS actuel) ;
- destination ;
- date/heure de départ ;
- temps passé sur place ;
- retour oui/non.

Calcul :
1. géocodage via Nominatim ;
2. itinéraire aller via `/api/route` ;
3. heure d'arrivée = départ + durée Google Routes ;
4. période stationnaire à la destination ;
5. itinéraire retour recalculé via `/api/route` à l'heure de fin du séjour ;
6. échantillons temporels le long de chaque trajet ;
7. météo descriptive et géométrie solaire à chaque échantillon.

La direction du Soleil est exprimée relativement au cap du segment routier. Cela décrit une géométrie, pas une gêne calibrée.

## Stationary

Le mode point fixe :
- capture le GPS ;
- prévoit les conditions au même endroit pendant 1 à 6 heures ;
- calcule la position du Soleil à chaque échéance ;
- peut lire l'orientation du téléphone via `DeviceOrientationEvent` ;
- actualise la relation entre l'orientation regardée et le Soleil.

Sur route, l'orientation du téléphone n'est pas la source de vérité : le cap du trajet/GPS reste prioritaire.

## Météo

`api/journey-weather.js` ajoute pour cette expérience :
- température 2 m ;
- précipitation sur l'heure ;
- couverture nuageuse ;
- visibilité ;
- vent 10 m ;
- rafales ;
- direction du vent ;
- DNI ;
- code météo WMO.

Ces variables restent **passives et descriptives**. Aucun seuil de danger, aucune formule d'éblouissement et aucun score météo n'est introduit.

Attribution : `Weather data by Open-Meteo.com (CC BY 4.0)`.

## Limites assumées

- prototype personnel, pas produit commercial ;
- météo = prévision de modèle, pas observation directe ;
- gêne solaire non calibrée ;
- boussole navigateur dépend du capteur, du navigateur, des permissions et de la calibration du téléphone ;
- l'échantillonnage V0.2 vise la vérification produit, pas une cartographie météo continue de chaque mètre de route.

## Corrections apportées à l'intégration

Le paquet livré a été intégré tel quel sauf sur quatre points, tous imposés par
des décisions déjà figées du projet :

1. **Réfraction atmosphérique ajoutée à `solar()`.** La copie livrée ne
   l'appliquait pas : jusqu'à **0,27° d'écart en élévation** avec `index.html` à
   l'approche de l'horizon, soit exactement le régime où vit le produit et où
   `T.high.maxElev` vaut 8°. Un relevé fait sur `journey.html` aurait été
   incomparable avec un relevé fait sur `index.html`. Le bloc d'`index.html` a
   été repris à l'identique ; un test rejoue désormais les deux implémentations
   l'une contre l'autre, la référence étant extraite d'`index.html` à
   l'exécution.
2. **Aucun `fetch()` nu.** Les trois appels de `journey.html` — Nominatim,
   `/api/route`, `/api/journey-weather` — passent par `fetchBorne()`, qui lit le
   corps sous la même échéance que la connexion. C'est la règle figée le
   5 septembre après un calcul resté figé en production.
3. **La météo ne bloque plus aucun résultat.** Sa panne dégrade son propre
   statut, se dit à l'écran avec sa durée, et laisse le trajet, le séjour et la
   géométrie solaire s'afficher.
4. **Codes d'erreur alignés** sur les trois autres endpoints
   (`TYPE_INCORRECT`, `CORPS_TROP_GROS`, `ORIGINE_ETRANGERE`), et **refus d'un
   fournisseur autre que `google-routes`**, sans repli silencieux.

Le service worker traite maintenant les `.mjs` comme les pages, en réseau
d'abord : `journey-core.mjs` porte la position solaire, et une copie en cache
sous une page fraîche ferait relever le terrain avec un moteur qu'on croit
remplacé.

`index.html` et le moteur scientifique ne sont pas touchés.

## Test local

```bash
node test-journey-v02.mjs          # fonctions pures, accord solaire, échéances
node test-journey-navigateur.mjs   # 165 contrôles Playwright sur la page réelle
node test-api.mjs                  # dont le durcissement de /api/journey-weather
```

Le premier couvre : caps cardinaux, delta angulaire, bornes NOAA, **accord exact
avec le `solar()` d'`index.html`**, timeline route, timeline stationnaire,
libellés Soleil, conversion boussole, échéances réseau et absence de seuil météo.

Le second charge réellement la page : sortie complète aller/séjour/retour, deux
itinéraires Google distincts, panne météo, panne Google Routes, point fixe et
boussole.

## Gate suivant

Utiliser `journey.html` plusieurs jours en mode Stationary depuis un point fixe : comparer heures prévues/réelles du Soleil, pluie, nuages, température et vent. Ensuite seulement passer aux petits trajets routiers.
