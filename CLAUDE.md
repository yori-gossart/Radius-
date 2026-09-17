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

**Un trajet retour possède sa propre heure de départ.** Décision du 4 septembre
2026, qui **remplace** la règle précédente « le retour part à partir de
maintenant ». Radius ne suppose jamais qu'un retour planifié commence
maintenant : un aller demandé pour demain 13h20 n'implique aucun horaire de
retour, et en inventer un ferait analyser un trajet que personne n'a demandé.

L'action Retour **prépare** le trajet inverse — elle affiche le sens, propose la
**date de l'aller**, laisse l'heure vide — puis n'emploie que la date et l'heure
explicitement choisies. Aucun calcul ne part tant que l'heure n'est pas saisie.
« Maintenant » est un raccourci volontaire, jamais une valeur imposée : il
remplit les champs et ne lance rien.

Aucune heure de séjour n'est déduite. Radius ne sait pas combien de temps dure
une visite, et le deviner serait une invention de plus dans une phase qui n'en
supporte aucune.

Ensuite, comme auparavant : les endpoints sont échangés — les objets eux-mêmes,
donc les coordonnées déjà retenues, sans nouveau géocodage — puis une nouvelle
route Google est demandée et timeline, soleil, zones, relief et météo sont
intégralement recalculés à l'horaire choisi.

Aucune donnée environnementale de l'aller n'est réutilisée pour conclure sur le
retour. `reporterRelief()` et `reporterMeteo()` restent réservés aux réanalyses
d'un **même** trajet, où la géométrie n'a pas bougé ; les employer entre aller
et retour ferait passer un relevé pour un autre.

« Ma position » désigne le point capturé au moment du clic. Devenu une arrivée
après inversion, il reste ce point figé : le retour ne relit jamais le GPS.
« Retour depuis ma position » serait une autre fonction, elle n'existe pas.

**L'interface grand public suit trois niveaux.** Décision du 4 septembre 2026.

1. l'information immédiatement utile : quand, où dans le trajet, combien de
   temps, de quel côté, et si le relief masque le soleil ;
2. l'explication humaine, sous « Comprendre » ;
3. les données techniques, sous « Détails techniques », replié.

Les valeurs scientifiques brutes — angles, seuils, scores, DNI, horodatages UTC,
provider, warnings, journal — ne sont plus l'interface principale. Elles ne sont
pas supprimées pour autant : **rien ne doit jamais disparaître**, tout descend au
niveau 3. La phase reste une phase de mesure ; un relevé impossible à
reconstituer est un relevé perdu.

Les phrases du niveau 1 décrivent une géométrie, elles ne concluent pas sur une
gêne vécue : « Soleil très bas, presque dans l'axe », jamais « Éblouissement
fort ». Tant que `T` n'est pas calibré, affirmer l'éblouissement serait
promettre ce que rien n'a mesuré.

La météo reste passive et ne doit jamais être transformée en conclusion
utilisateur tant qu'elle n'est pas calibrée : on montre les grandeurs, on ne les
interprète pas.

Le tri « important / faible » de l'écran de résultat est une **hiérarchie de
lecture**. Aucune zone n'est retirée des données, aucune annonce n'est modifiée.

Le redesign UX ne modifie aucun résultat scientifique.

**Pas d'itinéraires alternatifs.** Reste une V2 identifiée.

**Le trafic entre comme horloge, jamais comme contenu.** L'ETA `TRAFFIC_AWARE_OPTIMAL`
sert à placer le soleil au bon moment sur le trajet. Le trafic détaillé par
segment (`speedReadingIntervals`) et le recalcul de route en roulant restent hors
périmètre.

**Jamais de radars, d'incidents, ni d'affichage de trafic.** Waze le fait mieux.
Chaque ajout dans ce registre dilue la raison d'exister du produit.

## Ce que les corrections post-audit ont figé

Décisions du 5 septembre 2026, issues de l'audit du 4. Elles répondent toutes à
la même famille de défaut : un composant conforme à une ancienne spécification,
devenu faux depuis que les trajets planifiés existent.

**Aucune mutation temporelle implicite.** « Démarrer le suivi » ne change jamais
l'heure d'une analyse en silence. Au-delà de dix minutes d'écart, un panneau
nomme la date prévue et propose de recalculer ; annuler laisse l'analyse
strictement intacte, sans une requête. En deçà, le suivi démarre tel quel.

**Un départ passé est refusé avant tout appel réseau.** `api/route` retombe sur
« maintenant » pour ne pas être refusé par Google, tandis que le moteur solaire
calcule à la date demandée : le résultat mélangeait deux instants sans le dire.
Radius n'a pas de fonction historique. La tolérance de deux minutes couvre
l'arrondi à la minute du champ heure, rien de plus.

**Une seule source de progression à la fois** — aucune, le suivi réel, ou la
simulation. Le drapeau est posé avant le premier `await` de `$('start')` : sans
cela, `#sim` restait cliquable pendant la demande de permission, les deux modes
démarraient, et le bandeau affirmait que le GPS n'était pas utilisé alors qu'il
l'était.

**Une panne de position mène à un état fini.** Refus, délai dépassé ou
indisponibilité sont dits en clair, avec l'issue. Une panne muette se note
« rien annoncé, rien vu » et se compte pour un vrai négatif.

**La date s'affiche.** Hier, demain et dans trois jours ne doivent jamais être
indiscernables, et un trajet franchissant minuit le signale.

**Le mode test exerce la vraie règle de parole.** Le cooldown est arbitré par
l'horloge du trajet, qui défile en accéléré en simulation. Il n'est plus
neutralisé. Le journal horodate chaque annonce sur cette horloge — sans quoi
l'espacement réel reste invisible, et c'est ce qui avait laissé le défaut passer.

**Le cache du service worker porte une version**, et `/api/` n'y entre jamais :
une altitude ou une météo servie depuis le cache serait un relevé faux.

**La voix peut être coupée** sans arrêter le suivi. Les annonces restent
détectées et journalisées : on peut relever un trajet en silence sans rien perdre.

**« Position enregistrée au départ »** est le nom d'un point « Ma position »
devenu une arrivée. Ce n'est pas la position actuelle, et le libellé le dit.

**Ce que Radius transmet est écrit dans l'interface.** L'ancienne phrase
« Aucune donnée de position n'est transmise ni conservée » était fausse : elle
n'était vraie que de la position suivie en roulant. Le bloc « Données utilisées »
nomme chaque destinataire — Google Routes, Google Elevation, Open-Meteo,
Nominatim, Vercel — et ne promet rien sur ce que ces tiers conservent.
L'attribution OpenStreetMap/ODbL est affichée là où l'adresse est saisie.

**Le contrôle d'origine des endpoints est une friction, pas une
authentification.** `Origin` et `Referer` sont posés par le navigateur et
forgeables par tout client qui n'en est pas un. Il écarte l'appel depuis une
autre page web ; il n'arrête pas un script. **La seule protection réelle contre
un abus de quota est le plafond de budget côté Google Cloud**, qui est une
action de compte, pas de code. `RADIUS_ORIGINES` permet d'ajouter des hôtes sans
redéployer si le domaine change.

## V0.5 — Épisodes et alertes utiles

Décision du 5 septembre 2026. Elle ajoute une couche PRODUIT au-dessus des
données existantes, sans toucher à une seule ligne du moteur.

**Une zone scientifique n'est pas un événement utilisateur.** Quatre zones
« high / face » séparées de deux minutes décrivent un seul moment vécu. Le
conducteur n'a pas à recevoir quatre cartes ni quatre interruptions pour cela.

La chaîne est désormais : trajet → échantillons → **zones scientifiques** →
**épisodes** → **plan d'annonces** → écran.

**Le regroupement est une règle d'interface, pas une règle scientifique.** Deux
coupures, et deux seulement : un silence de plus de `EPISODE_GAP_S` = 300 s
entre deux zones, ou un changement de côté franc — gauche vers droite ou
l'inverse. Passer de face à un côté ne coupe pas : c'est le même soleil qui
glisse. Cinq minutes ont été choisies après avoir rejoué des cas synthétiques :
à trois, une route sinueuse produit encore trois cartes pour un seul coucher ;
à dix, deux phénomènes distincts fusionnent et la durée cesse d'être honnête.

**Les constantes V0.5 ne sont pas des seuils scientifiques.** `EPISODE_GAP_S`,
`LEAD_HIGH_FACE_LONG_S`, `LEAD_HIGH_S`, `LEAD_MODERATE_S`, `LEAD_LONG_S`,
`LEAD_PLANCHER_UX_S` et `PHRASE_MAX_CARACTERES` sont **non calibrées**. Elles
attendent des relevés de terrain comme `T`, mais d'une autre nature : « trop
d'annonces », « annonce trop tôt », « je n'ai pas compris » — jamais « rien vu ».
Elles ne lisent pas `T` et ne s'y mélangent jamais.

**`MAX_ALERTS = 4` est un plafond, pas un objectif.** Zéro annonce est un
résultat valide. Jamais une annonce pour remplir un quota.

**Un épisode ne parle qu'une fois**, quel que soit le nombre de zones qu'il
regroupe. Une seconde annonce dans le même épisode n'est pas implémentée :
définir « transition significative » demanderait des seuils arbitraires non
testés, et dans le doute Radius se tait.

**L'anticipation s'adapte à l'épisode** — cinq minutes pour un soleil très bas
dans l'axe qui dure, trois pour un autre niveau élevé, deux pour un modéré — et
ne dépasse jamais le double de l'exposition : on ne prévient pas cinq minutes à
l'avance pour quarante secondes de soleil. `MIN_LEAD_SECONDS` reste le plancher,
`COOLDOWN_MS` le garde-fou absolu.

**Un épisode écarté ne disparaît jamais en silence.** Le plan porte sa raison —
plafond, cooldown, trop tard — et le journal technique la montre. C'est ce qui
permet enfin d'auditer pourquoi Radius parle ou se tait.

**Traçabilité totale.** Chaque épisode garde `sourceZoneIndexes` vers ses zones
d'origine, aucune n'est perdue ni dupliquée, et le niveau 3 continue de les
exposer toutes avec leurs valeurs exactes.

**La météo n'entre dans aucune décision** — ni épisode, ni priorité, ni
anticipation, ni annonce. **Le relief non plus** : il s'affiche, il ne décide
pas. « Terrain bloqué donc silence » reste hors périmètre tant que rien ne l'a
validé sur la route.

**Réel et simulation partagent la même couche** : mêmes épisodes, même plan,
mêmes priorités, même cooldown. Seule l'horloge diffère.

Tests ajoutés : `test-episodes.mjs`, 53 contrôles sur du code extrait de
`index.html` à l'exécution, plus deux scénarios navigateur — « riche » pour la
fusion, « moments » pour la séparation.

## Aucune attente sans échéance

Décision du 5 septembre 2026, prise sur un relevé de terrain : à 17:26, le
bouton est resté « Calcul en cours… », grisé, sans un mot. Les journaux Vercel
montrent pourtant les trois appels sortis et répondus dans la seconde — route,
elevation, weather en 200 — une minute après un 502 sur ce même `/api/weather`.
Le serveur avait fini ; la page, non.

Tout ce qui suit le dernier `await` de `analyserTrajet()` est synchrone, et une
exception y serait rattrapée puis affichée. Un bouton figé sans message ne
pouvait donc venir que d'une attente sans fin : un corps de réponse qui n'arrive
pas au bout, et `await r.json()` qui n'a pas de fin. **Un `try/catch` n'y peut
rien : il attrape un rejet, pas une absence.**

- tout appel réseau passe par `fetchBorne()`, jamais par `fetch()` nu ;
- le **corps** est lu sous la même échéance que la connexion — c'est là que
  l'attente s'était perdue ;
- `DELAI_ROUTE_MS`, `DELAI_RELIEF_MS`, `DELAI_METEO_MS` et `DELAI_GEOCODE_MS`
  bornent une attente, ils ne mesurent rien : ce ne sont pas des seuils
  scientifiques et ils ne se mêlent jamais à `T` ;
- une échéance dépassée est **nommée avec sa durée**, jamais avalée.

**Le relief et la météo ne peuvent jamais bloquer un résultat.** Ce sont des
couches passives : leur retard dégrade leur propre statut en `unknown` et le
trajet s'affiche quand même. Une couche qui n'entre dans aucune décision ne peut
pas non plus empêcher d'en rendre une.

**La remise à zéro est dans le `try`.** Hors de lui, une exception dans
`resetAnalyseTrajet()` laissait le verrou posé et le bouton grisé à vie. Toute
la chaîne entre la pose du verrou et le `finally` qui le retire doit rester
gardée : une panne se dit, elle ne fige pas la page.

Banc : `test-figeage.mjs`, 22 contrôles, dont un serveur qui ne répond jamais et
ne ferme jamais la socket — la seule façon de reproduire ce qu'a vu le téléphone.

## V0.2 Journey + Stationary — branche d'expérimentation

Branche `radius-v0.2-journey-stationary`, 16 septembre 2026. **Elle ne fusionne
pas dans la branche principale.** `index.html` n'est pas touché : la V0.2 vit
dans `journey.html`, `journey-core.mjs` et `api/journey-weather.js`, à côté du
produit, jamais à sa place.

Ce qu'elle ajoute : une sortie est une séquence temporelle complète — aller,
temps sur place, retour — et non un trajet isolé. Chaque phase garde son
horloge, et le retour est **redemandé à Google Routes** à l'heure réelle de fin
de séjour, jamais obtenu en inversant la géométrie de l'aller. C'est la même
règle qu'en V0.5, appliquée à une sortie entière.

**Il n'y a qu'un seul Soleil.** `journey-core.mjs` embarque sa propre copie de
`solar()` parce que `index.html` n'exporte rien. À la livraison, cette copie
**n'appliquait pas la réfraction atmosphérique** : jusqu'à 0,27° d'écart en
élévation à l'approche de l'horizon — exactement le régime où vit le produit, et
où `T.high.maxElev` vaut 8°. Deux pages auraient décrit deux soleils, et un
relevé fait sur `journey.html` aurait été incomparable avec un relevé fait sur
`index.html`. Le bloc de réfraction d'`index.html` y a été repris à l'identique,
et `test-journey-v02.mjs` rejoue les deux implémentations l'une contre l'autre,
la référence étant **extraite d'`index.html` à l'exécution**. Elles ne peuvent
plus diverger en silence.

**Les libellés de direction ne sont pas des seuils.** `sunRelativeLabel()`
découpe l'écart cap/azimut en « dans l'axe », « devant », « sur le côté »,
« derrière ». Ce sont des mots pour décrire une géométrie, pas des niveaux de
risque : ils ne lisent pas `T`, ne produisent aucun `level`, et ne concluent
jamais à une gêne vécue.

**`api/journey-weather.js` est descriptif par contrat.** Neuf variables —
température, précipitation, couverture nuageuse, visibilité, vent, rafales,
direction du vent, DNI, code météo — plus l'heure de validité et la provenance.
**Aucun seuil, aucun score, aucun champ de verdict.** `test-api.mjs` l'éprouve
sur une vraie réponse en refusant toute clé qui ressemblerait à une conclusion,
et le fait passer par le même durcissement d'entrée que les trois autres
endpoints, avec les mêmes codes d'erreur.

**La boussole ne sert qu'au point fixe.** Sur route, le cap de référence reste
celui du trajet ou du GPS ; l'orientation physique du téléphone ne le remplace
jamais. Une orientation **relative** n'est jamais présentée comme un nord
magnétique, et une orientation absolue déjà obtenue n'est jamais écrasée par une
relative. Sans capteur, sans permission ou sans navigateur compatible, la page
continue de fonctionner : la boussole est un supplément, pas une dépendance.

**L'écran de la boussole suit les trois niveaux, comme le reste.** Correction du
16 septembre 2026, sur un relevé de terrain : « 150° » ne se lit pas sur une
terrasse.

- niveau 1 : **le mot avant le chiffre** — « Sud-Est · 150° », huit directions
  cardinales. Au-delà de huit, on prétendrait une finesse que ni le
  magnétomètre du téléphone ni sa calibration ne garantissent ;
- l'écran dit **ce que cette direction représente** : celle vers laquelle pointe
  le haut du téléphone, pas celle d'une route ;
- Soleil sous l'horizon : **« Soleil couché — aucune exposition solaire
  actuellement »**, et aucune direction n'est suggérée. « Soleil derrière à
  gauche » à 22 h laisserait croire à une exposition qui n'existe pas ;
- Soleil levé : sa position **relativement à l'orientation regardée** — droit
  devant, devant à droite, à droite, derrière à droite, droit derrière —
  toujours descriptive, jamais une gêne vécue ;
- niveau 3 : azimut, élévation, cap brut, écart cap→Soleil, type d'orientation
  absolue ou relative, source du capteur, point GPS et sa précision. **Rien ne
  disparaît.**

Les bornes de `sunRelativeLabel()` — 15, 45, 110, 160 — n'ont pas bougé ce
jour-là : **seuls les mots ont changé**, « Soleil sur le côté droite » n'étant
pas du français. Ce sont des découpes de géométrie, pas des seuils de risque :
elles ne lisent pas `T` et ne produisent aucun `level`.

**La précision du GPS se dit toujours, et ne bloque jamais.** Même décision, même
relevé : le téléphone annonçait 2 km. Un relevé de terrain rapproche une
observation d'un point ; à 2 km près ce n'est plus le bon point, et le relevé ne
vaut rien. Au-delà de `PRECISION_TERRAIN_M` = 100 m, l'interface affiche
**« position trop imprécise pour un relevé terrain fiable »** — sans masquer le
chiffre et **sans empêcher le prototype de tourner**, puisque c'est justement en
marchant qu'on découvre que le GPS dérive. Ce seuil qualifie une **donnée**, pas
le ciel : il ne lit pas `T` et ne s'y mélange jamais.

**Le point fixe s'observe à l'heure qu'on choisit.** Décision du 16 septembre
2026 : le laboratoire de terrain ne peut pas attendre physiquement que l'heure
arrive. Date d'observation, heure de début et horizon — **Instant précis**,
30 min, 1 h, 2 h, 4 h, 6 h — sont saisis ; le calcul part de l'heure **saisie**,
jamais de `Date.now()`. « Maintenant » remplit les deux champs et **ne lance
rien** : c'est un raccourci de saisie, comme pour le retour planifié, jamais une
valeur imposée.

« Instant précis » est **un** instant, pas un horizon nul échantillonné deux
fois : deux lignes identiques laisseraient croire à une évolution. Il affiche
l'heure analysée, la géométrie solaire, la relation au téléphone si la boussole
tourne, puis température, nuages, pluie, visibilité, vent, rafales, direction du
vent, DNI, code WMO, heure de validité et provenance — **montrés, jamais
interprétés**. Au-delà de zéro, une timeline couvre début → fin.

**Une date que la prévision ne couvre pas n'est jamais envoyée.**
`api/journey-weather.js` interroge `forecast_days` plafonné à 7 en
`timezone=UTC` : la fenêtre réellement servable est
`[minuit UTC du jour, minuit UTC + 7 jours[`, et `fenetrePrevision()` la calcule.
Hors de là, l'échéance la plus proche qu'Open-Meteo renverrait serait celle d'un
**autre jour** — une prévision d'aujourd'hui présentée pour le 21 décembre
serait un relevé faux. RADIUS n'émet donc pas la requête et affiche
**« Prévision indisponible pour cette date »**, avec les bornes. Jamais de
substitution silencieuse par « maintenant ».

**La position du Soleil, elle, reste calculée à n'importe quelle date** : c'est
de l'astronomie, pas une prévision. Une date hors fenêtre météo garde donc sa
géométrie solaire complète.

**L'orientation est indépendante de l'heure choisie, le Soleil ne l'est pas.**
Correction du 16 septembre 2026, trouvée en regardant l'écran : une rose montrant
un Soleil couché au-dessus d'une phrase « Soleil à droite » se lit comme une
panne, pas comme deux horloges. La règle est donc :

- **l'orientation** est toujours celle du téléphone **maintenant** — c'est la
  seule chose qui ne se simule pas ; `state.heading` n'a qu'une seule affectation
  dans tout le fichier, celle du capteur ;
- **le Soleil**, lui, suit l'instant représenté : l'heure d'observation choisie
  si elle existe, l'heure courante sinon. La rose et la phrase qui la suit
  décrivent le même instant, et l'écran le dit ;
- le niveau 3 conserve **les deux** : le Soleil à l'instant représenté et le
  Soleil de maintenant, chacun horodaté.

La direction est toujours annoncée comme celle du **haut du téléphone**, jamais
celle d'un véhicule.

**La rose de direction est égocentrique par défaut.** Décision du 17 septembre
2026, sur la lecture de l'écran : Nord en haut obligeait à se représenter
mentalement une rotation — on lisait « à droite » pendant que le marqueur était
dessiné à gauche. Deux référentiels, une bascule :

- **Vue face à moi** (défaut) : le haut du radar est **toujours devant soi**, la
  flèche du téléphone est verticale et ne bouge plus, et ce sont le Soleil et les
  points cardinaux qui tournent autour du centre. L'en-tête dit **↑ DEVANT MOI** ;
- **Vue Nord** : l'ancienne représentation, Nord fixe en haut, flèche mobile.

**Une seule projection, `angleRose()`**, décide de tout : en vue face elle vaut
`signedDelta(cap, azimut)` — 0 devant, +90 à droite, ±180 derrière, −90 à gauche —
et en vue Nord l'azimut absolu. Cardinaux, graduations, secteur, flèche et Soleil
y passent tous ; plus aucun tracé n'est en azimut absolu. **Rien de scientifique
ne change** : même azimut solaire, même cap, seule la projection à l'écran
diffère, et le banc vérifie que changer de vue ne touche ni l'azimut, ni le cap,
ni le secteur annoncé.

**Sans cap mesuré, la vue face retombe au Nord** et le dit. Il n'y a pas de
« devant » sans boussole, et en inventer un serait un relevé faux.

Ce n'est pas une carte : aucune route, aucune distance. SVG natif, aucune
bibliothèque.

L'élévation n'a pas d'axe : une vue de dessus n'en a pas. Elle est écrite en
chiffres au-dessus du marqueur, et sous l'horizon le marqueur **change d'aspect**
— disque creux, tireté, barré d'une ligne d'horizon — plutôt que de descendre.
Le faire descendre inventerait une géométrie.

**Le mot est écrit au marqueur, pas seulement en légende.** La rose est orientée
Nord en haut : quand on regarde le Sud-Est, « à droite » tombe visuellement en bas
à gauche. Sans le mot au bon endroit, l'écran a l'air de se contredire.

`secteurRelatif()` et `sunRelativeLabel()` sortent de la **même** fonction : la
rose et le texte doivent désigner le même secteur, et deux tables d'angles
séparées finiraient par diverger — ce dépôt s'est déjà fait prendre à entretenir
deux soleils. Les bornes 15 / 45 / 110 / 160 sont inchangées.

**Une absence de mesure n'est pas zéro.** `Number(null)` vaut 0 et
`Number.isFinite(0)` vaut vrai : un téléphone sans magnétomètre émet un événement
d'orientation dont `alpha` est `null`, et il devenait un cap de 0° — plein Nord —
annoncé comme une mesure **absolue**. `compassHeadingFromEvent()` lit désormais
strictement. C'est le même piège que la latitude nulle devenue l'équateur.

**Ce piège est revenu le lendemain**, dans `vueEffectiveRose()` : `state.heading`
vaut `null` tant que la boussole n'a rien donné, et « pas de cap » redevenait un
cap de 0° — le radar aurait annoncé « ↑ DEVANT MOI » en montrant du Nord. Seul le
test l'a vu. **Toute lecture d'une donnée capteur passe par `nombreStrict()`**, et
le contrôle appartient au banc, pas à la vigilance.

**Les règles figées s'appliquent aussi à cette branche.** `journey.html` n'a
aucun `fetch()` nu : les trois appels passent par `fetchBorne()`. La météo y est
passive au sens fort — sa panne dégrade son propre statut, dit pourquoi, et
laisse le trajet, le séjour et la géométrie solaire s'afficher. Un fournisseur
autre que `google-routes` est refusé, sans repli.

Le cache du service worker traite désormais les `.mjs` comme les pages, en
réseau d'abord : `journey-core.mjs` porte la position solaire, et servi depuis
le cache sous une page fraîche il ferait relever le terrain avec un moteur qu'on
croit remplacé.

**La clé Google n'est pas dans l'environnement Preview.** Constaté le
16 septembre 2026 : `/api/journey-weather` répond 200 — Open-Meteo ne demande
aucune clé — tandis que `/api/route` répond **503**, statut qu'une seule branche
de `api/route.js` émet, celle où `process.env.GOOGLE_MAPS_API_KEY` est absent.
C'est une affaire de configuration Vercel, pas de code : la variable est portée
par l'environnement Production et n'a jamais été étendue à Preview. Ne jamais
créer une seconde clé ni écrire la clé dans le dépôt pour contourner cela.

Bancs : `test-journey-v02.mjs` (fonctions pures, accord solaire, échéances,
directions cardinales, qualité GPS, fenêtre de prévision, échantillonnage du
point fixe) et `test-journey-navigateur.mjs` (84 contrôles Playwright sur la
page réelle, dont le GPS à 2 km, le Soleil couché, l'instant précis champ par
champ, les dates passées ou trop lointaines qui ne partent jamais à l'API, les
deux référentiels de la rose, et le tout croisé contre le moteur importé côté
Node — `page.evaluate` ne voit pas la portée d'un module ES, un banc qui l'ignore
s'auto-approuve en silence).

**Une garde écrite trop large ne garde rien.** `/\bT\./i` — insensible à la
casse — attrapait le « t. » final de n'importe quel mot accentué français :
« connaît. » suffisait à la déclencher, et l'assertion ne mesurait donc rien.
Une garde qui cherche un nom de code se lit sans le drapeau `i`.

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
