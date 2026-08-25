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

**Aucune clé d'API, aucune facturation.** Nominatim pour les adresses, OSRM
public pour les itinéraires. C'est délibéré : ça supprime le compte Google
Cloud, la carte bancaire et le risque de dépassement. Ne pas proposer Google
Routes ou Mapbox à ce stade.

**Aucun build, aucune dépendance, aucun `package.json`.** Quatre fichiers
statiques. Le fondateur travaille depuis un téléphone : chaque outil ajouté
est une friction réelle. Ne pas introduire de bundler, de framework ou de
gestionnaire de paquets.

**Le relief n'est pas branché — c'est volontaire.** Le moteur sait masquer un
soleil caché par une montagne, mais il lui faut des données d'altitude côté
serveur. Hors périmètre du prototype. Un soleil masqué sera donc annoncé à
tort : c'est connu, ce n'est pas un bug.

**Le maintien en arrière-plan est un contournement assumé.** Un flux audio
inaudible empêche Android d'endormir la page pendant que Waze est au premier
plan. Ce n'est pas propre. Seule une application native le fera correctement.
Ne pas tenter de « réparer » ça, ne pas proposer de service worker périodique
ou de Web Push : ça ne résoudra pas le problème et ça ajoutera de la
complexité.

**Pas de trafic, pas de météo, pas d'itinéraires alternatifs.** Chacun est une
V2 identifiée. Les ajouter maintenant brouillerait la mesure.

**Jamais de radars, de trafic ou d'incidents.** Waze le fait mieux. Chaque
ajout dans ce registre dilue la raison d'exister du produit.

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

`T.faceDelta` fait exception : c'est la définition de « de face » dans les
phrases prononcées, pas un seuil de détection. Il ne se calibre pas.

## Piège de calibration

À La Réunion, le relief coupe le soleil trente à soixante minutes avant
l'horizon astronomique. Le relief n'est pas branché — c'est un choix assumé,
pas un oubli. Conséquence directe sur les relevés : **l'observation la plus
fréquente sera « annoncé mais rien vu », alors que l'annonce était
astronomiquement juste.**

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
