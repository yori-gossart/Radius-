# Prototype personnel — mode d'emploi

Une page web statique, plus une seule fonction serveur. Itinéraire et ETA avec
trafic par **Google Routes**, adresses par Nominatim (OpenStreetMap).

Depuis la v0.2, le prototype consomme une API facturée. La clé vit dans la
variable Vercel `GOOGLE_MAPS_API_KEY` et ne descend jamais dans le navigateur —
voir `GOOGLE_SETUP_V02.md`. Prévoir un budget et des quotas bas côté Google Cloud.

## Mise en ligne depuis le téléphone — environ 15 minutes

1. **GitHub** → *New repository* → nom au choix, **Public**.
2. *Add file → Upload files* → déposer `index.html`, `sw.js`, `manifest.json`,
   `icon.svg` et le dossier `api/`. → *Commit*.
3. **Vercel** → *Add New Project* → *Import Git Repository* → choisir le dépôt.
   Framework : **Other**. Aucun réglage à changer. → *Deploy*.
4. **Vercel → Settings → Environment Variables** : ajouter `GOOGLE_MAPS_API_KEY`
   en Production, puis redéployer. Sans elle, l'analyse échoue avec un message
   explicite — il n'y a aucun repli silencieux.
5. Ouvrir l'adresse `.vercel.app` dans **Chrome sur Android**.
6. Menu ⋮ → **Ajouter à l'écran d'accueil**. Lancer depuis l'icône, pas depuis
   l'onglet : en mode autonome, Android garde la page vivante plus longtemps.

HTTPS est indispensable pour les notifications et la position — Vercel le fournit.

## Réglage Samsung, à faire une seule fois

Paramètres → Applications → Chrome → Batterie → **Sans restriction**.
Sans cela, One UI endort la page dès que Waze passe devant et vous ne recevrez rien.

## Premier essai, sans conduire

Analyser un trajet, puis **Tester sans GPS**. Le parcours défile en accéléré,
les annonces se déclenchent. Cela vérifie la voix et les notifications en trente secondes.

## Essai réel

1. Analyser le trajet.
2. **Démarrer le suivi** → autoriser la position, puis les notifications.
3. **Ouvrir Maps** de préférence : Waze peut choisir un autre itinéraire que
   celui analysé par Google Routes, et le suivi décrocherait.
4. À l'approche d'une zone : notification + annonce vocale par-dessus le GPS.

Le meilleur créneau est une fin d'après-midi dégagée, sur une route orientée
vers le soleil couchant.

## Ce que ce prototype ne fait pas encore

- **Le relief ignore les bâtiments et la végétation.** Il est branché depuis la
  V0.3 — Google Elevation, au point représentatif de chaque zone — mais il ne
  voit que le terrain naturel. Un soleil caché par un immeuble ou un rideau
  d'arbres sera encore annoncé.
- **La météo mesure, elle ne conclut pas.** Open-Meteo est interrogé depuis la
  V0.4 et enregistre DNI, nuages, visibilité et pluie au point et à l'heure de
  chaque zone. Aucun seuil météo n'existe : ces valeurs ne modifient ni le
  niveau, ni les annonces.
- **Le maintien en arrière-plan est un contournement** — un flux audio inaudible
  empêche Android d'endormir la page. Ça fonctionne, ce n'est pas propre.
  Seule une application native le fera correctement.
- **Pas d'itinéraires alternatifs.** Un seul trajet est analysé, celui que
  Google renvoie en premier.
- **Le trafic n'entre que comme horloge.** L'ETA Google tient compte du trafic
  au départ, mais le facteur est appliqué globalement : un bouchon concentré sur
  un tronçon est lissé sur tout le trajet. Et la route n'est pas recalculée en
  roulant. C'est justement une chose à mesurer.
- **Pas de conseil d'heure de départ.** La fonction existe, son affichage est
  désactivé en v0.2 : elle rejouerait le soleil sans redemander une route à
  Google pour chaque heure candidate.

## À noter pendant vos essais

Pour chaque trajet : heure, itinéraire, ce que l'appli a annoncé, ce que vous
avez réellement vu. Les trois questions qui comptent :

1. La zone annoncée correspond-elle à une gêne réelle ?
2. Le moment de l'annonce est-il utile — assez tôt, pas trop tôt ?
3. Une gêne réelle a-t-elle été manquée ?

Les seuils sont en haut du fichier `index.html`, dans l'objet `T`. Ce sont eux
que vos relevés serviront à corriger.
