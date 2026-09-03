# Contexte du projet

À lire avant toute modification. Ce fichier existe pour éviter que des choix
délibérés soient pris pour des oublis.

## Ce que fait le produit

Il prévoit **où et quand le soleil sera dans les yeux du conducteur** sur un
trajet donné, et l'annonce avant qu'il y arrive. Il ne remplace aucun GPS : il
travaille par-dessus Waze ou Google Maps, et leur passe la main pour la
navigation.

Il fonctionne partout dans le monde. La Réunion est le terrain d'essai du
fondateur, pas le marché. Le marché est la France métropolitaine puis
l'espace francophone.

**Cœur de cible :** les gens dont la route est le métier — infirmiers
libéraux, ambulanciers, aides à domicile, artisans en tournée, techniciens
itinérants, livreurs. Ils roulent aux heures d'éblouissement, tous les jours,
et ne choisissent ni leur horaire ni leur itinéraire.

## Stade actuel

Prototype personnel. Un seul utilisateur : le fondateur. Objectif unique de
cette phase : **vérifier sur la route que la prédiction est juste.**

Ce n'est pas une phase de fonctionnalités. C'est une phase de mesure.

## Décisions à ne pas défaire

**Google Routes est la source de vérité du trajet.** Décision du 25 août 2026,
qui **remplace explicitement** la règle précédente « aucune clé d'API, aucune
facturation, ne pas proposer Google Routes ». Le prototype a désormais un projet
Google Cloud facturé, et un budget à surveiller.

- appel uniquement via `/api/route`, côté Vercel ;
- secret `GOOGLE_MAPS_API_KEY`, jamais présent dans `index.html` ;
- `travelMode = DRIVE`, `routingPreference = TRAFFIC_AWARE_OPTIMAL`,
  `trafficModel = BEST_GUESS`, polyline `HIGH_QUALITY` en GeoJSON LineString ;
- Nominatim reste provisoirement le géocodeur d'adresses ;
- OSRM n'est plus la source de production et **ne doit jamais redevenir un
  repli silencieux** : si Google échoue, l'interface le dit.

**Aucun build, aucune dépendance, aucun `package.json`.** Des fichiers
statiques, plus une seule fonction Vercel — `api/route.js`, sans dépendance,
qui n'existe que pour tenir la clé Google hors du navigateur. Le fondateur
travaille depuis un téléphone : chaque outil ajouté est une friction réelle.
Ne pas introduire de bundler, de framework ou de gestionnaire de paquets.

**Le relief est branché depuis la V0.3 — première couche seulement.** Décision
du 27 août 2026, qui **remplace** la règle précédente « le relief n'est pas
branché, c'est volontaire ».

- source : Google Elevation, via `/api/elevation`, même clé serveur ;
- interrogé **uniquement** au point représentatif des zones déjà détectées,
  six au maximum, les plus fortes d'abord : une requête par trajet type ;
- un rayon de douze distances vers l'azimut du soleil, de 100 m à 20 km,
  avec correction de courbure et de réfraction ;
- le résultat vit dans `terrainOcclusion`, **à côté** du risque solaire : il ne
  modifie ni `level`, ni `score`, ni `T`.

Ce qui reste vrai : seul le **terrain naturel** est pris en compte. Ni bâtiments,
ni végétation. Un soleil caché par un immeuble ou un rideau d'arbres sera encore
annoncé à tort. La marge `TERRAIN_MARGIN_DEG` est une incertitude numérique, pas
une valeur calibrée, et ne se mélange jamais à `T`.

**Le maintien en arrière-plan est un contournement assumé.** Un flux audio
inaudible empêche Android d'endormir la page pendant que Waze est au premier
plan. Ce n'est pas propre. Seule une application native le fera correctement.
Ne pas tenter de « réparer » ça, ne pas proposer de service worker périodique
ou de Web Push : ça ne résoudra pas le problème et ça ajoutera de la
complexité.

**Weather V0.4 est branché comme couche de mesure passive.** Décision du
28 août 2026, qui **remplace** la règle précédente « pas de météo ».

Elle ne modifie ni le risque, ni `T`, ni les annonces, ni `terrainOcclusion`.
Toute utilisation décisionnelle de la météo exige d'abord une validation
terrain. **Cela ne veut pas dire que la météo est validée** : elle est branchée,
elle enregistre, elle ne conclut pas.

- fournisseur : Open-Meteo, via `/api/weather`, jamais appelé depuis le
  navigateur ;
- interrogée **après** la détection des zones, six au maximum, une seule
  requête, jamais pendant la conduite ;
- variables brutes conservées séparément — DNI, couverture nuageuse,
  visibilité, précipitation, code météo — sans aucune formule qui les combine ;
- **aucun seuil météo n'existe** : on ignore combien de W/m² gênent réellement,
  et quel taux de nuages masque le disque solaire ;
- le DNI vient d'un **modèle de prévision**, pas d'une observation du disque
  solaire. Ce n'est pas une vérité terrain.

**Licence.** Les données Open-Meteo sont sous CC BY 4.0 : l'attribution
« Weather data by Open-Meteo.com » est obligatoire et affichée dès qu'une
donnée atmosphérique est montrée. L'API gratuite est réservée à l'usage **non
commercial** — ce prototype personnel l'est. Un produit commercial devra passer
par l'offre payante et son *customer endpoint*.

**Aller / retour est une fonction cœur.** Un retour n'est **jamais** obtenu en
inversant la géométrie de l'aller — sens uniques, échangeurs, restrictions et
trafic font que Google ne renvoie pas la même route dans l'autre sens.

L'action Retour échange les endpoints — les objets eux-mêmes, donc les
coordonnées déjà retenues, sans nouveau géocodage — puis demande une nouvelle
route Google et recalcule intégralement timeline, soleil, zones, relief et
météo au nouvel horaire.

Aucune donnée environnementale de l'aller n'est réutilisée pour conclure sur le
retour. `reporterRelief()` et `reporterMeteo()` restent réservés aux réanalyses
d'un **même** trajet, où la géométrie n'a pas bougé ; les employer entre aller
et retour ferait passer un relevé pour un autre.

« Ma position » désigne le point capturé au moment du clic. Devenu une arrivée
après inversion, il reste ce point figé : le retour ne relit jamais le GPS.
« Retour depuis ma position » serait une autre fonction, elle n'existe pas.

**Pas d'itinéraires alternatifs.** Reste une V2 identifiée.

**Le trafic entre comme horloge, jamais comme contenu.** L'ETA `TRAFFIC_AWARE_OPTIMAL`
sert à placer le soleil au bon moment sur le trajet. Le trafic détaillé par
segment (`speedReadingIntervals`) et le recalcul de route en roulant restent hors
périmètre.

**Jamais de radars, d'incidents, ni d'affichage de trafic.** Waze le fait mieux.
Chaque ajout dans ce registre dilue la raison d'exister du produit.

## La règle de parole

Le produit parle **par-dessus un GPS qui parle déjà**, et aucun système
d'exploitation n'arbitre entre deux applications. La seule réponse est de
parler très peu :

- quatre annonces maximum par trajet
- 3,5 secondes maximum par phrase
- jamais deux à moins de trois minutes d'écart
- rien en dessous du risque « modéré » — le faible reste visuel
- rien si la zone commence dans moins de quinze secondes : trop tard

Ces plafonds ne sont pas des réglages de confort. Ils sont ce qui rend la voix
supportable. Ne pas les assouplir.

## Ce qui va changer, et comment

Les seuils de détection sont dans l'objet `T`, en haut de `index.html`. Ce sont
**les seuls chiffres destinés à bouger** dans cette phase, et ils bougeront sur
la foi de relevés de terrain, pas d'intuition.

Après chaque série de trajets, le fondateur apportera des observations du type
« annoncé mais rien vu » ou « gêné sans avoir été prévenu ». Le travail consiste
alors à ajuster `T` et à vérifier que les cas déjà validés ne régressent pas.

Ne jamais modifier `T` sans une observation de terrain qui le justifie.

## Ce que mesure la V0.2

Vérifier que le moteur solaire fonctionne sur une route Google réaliste et sur
une ETA qui tient compte du trafic.

Google donne l'ETA trafic de la route entière et des durées **statiques** par
étape. La timeline interne conserve le profil de vitesse statique des étapes,
puis applique le facteur global `duration / staticDuration` pour aligner
exactement l'arrivée sur l'ETA trafic. **Cette approximation est locale, connue,
et doit rester visible dans le code** : un bouchon concentré sur un seul tronçon
est lissé sur tout le trajet.

`bestDeparture()` reste une fonction déterministe, mais **son affichage est
désactivé en V0.2**. Rejouer ±90 minutes sans redemander une route à Google pour
chaque heure candidate donnerait une fausse optimisation trafic.

`T.faceDelta` fait exception : c'est la définition de « de face » dans les
phrases prononcées, pas un seuil de détection. Il ne se calibre pas.

## Piège de calibration

À La Réunion, le relief coupe le soleil trente à soixante minutes avant
l'horizon astronomique. Conséquence directe sur les relevés : **l'observation la
plus fréquente sera « annoncé mais rien vu », alors que l'annonce était
astronomiquement juste.**

Depuis la V0.3, `terrainOcclusion` aide à trier : une zone marquée « soleil
masqué » explique le « rien vu » sans qu'on touche à `T`. Ce n'est pas une
dispense pour autant — la couche relief ignore bâtiments et végétation,
échantillonne grossièrement au-delà de dix kilomètres, et son statut peut valoir
`unknown`. Un « soleil libre » ne prouve donc pas que la gêne était réelle.

Céder à ces relevés-là reviendrait à resserrer `T` pour corriger une erreur que
`T` n'a pas commise — et à casser le moteur pour la France métropolitaine, qui
est le marché et dont l'horizon est largement dégagé.

Règle :

- `T` ne se calibre que sur des **tronçons à horizon dégagé** — côte ouest face
  à la mer au coucher.
- Les observations en terrain masqué vont dans un **second seau**. Elles se
  notent, elles s'analysent, elles ne touchent **jamais** à `T`.
- Noter l'**élévation solaire** à côté de chaque observation. Sans elle, on ne
  peut plus trancher après coup entre les deux seaux.

## Vérifier une modification du moteur

Après toute retouche du calcul, contrôler au minimum ces repères :

| Situation | Attendu |
|---|---|
| Paris, 21 juin, midi solaire (11h52 UTC) | azimut 180°, élévation 64,6° |
| Paris, 15 janvier, 3 h UTC | soleil sous l'horizon |
| Équateur, équinoxe, midi | élévation proche de 90° |
| La Réunion, 21 déc, 18h30 locale | élévation ~5°, azimut ~247° |
| Route alignée sur l'azimut du soleil, soleil bas | niveau élevé, côté « face » |
| Même route à midi | aucune zone |
| Même route de nuit | aucune zone |
| Route nord-sud, même instant | nettement moins exposée |
| Même géométrie, densités de nœuds différentes | même longueur de zone à moins de 10 % |

Le dernier repère est celui qui manquait. L'itinéraire est rééchantillonné à
pas fixe de 100 m avant analyse, précisément pour que `minZoneMeters` et
`mergeGapMeters` mesurent le ciel et non l'espacement des nœuds OSM. Toute
retouche de ce rééchantillonnage doit le rejouer.

**Un piège à connaître :** en France métropolitaine, un axe est-ouest s'aligne
avec le soleil **en été**, pas en hiver. Le soleil d'hiver est bas mais se lève
au sud-est. Une intuition contraire est fausse et a déjà induit des tests en
erreur.

## Style

Code et commentaires en français. Les commentaires expliquent **pourquoi**, pas
quoi — le quoi se lit dans le code. Pas de commentaire décoratif.
