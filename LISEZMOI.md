# Prototype personnel — mode d'emploi

Une page web autonome. Aucune clé d'API, aucun compte, aucune facturation.
Adresses par Nominatim (OpenStreetMap), itinéraires par OSRM public.

## Mise en ligne depuis le téléphone — environ 15 minutes

1. **GitHub** → *New repository* → nom au choix, **Public**.
2. *Add file → Upload files* → déposer les quatre fichiers :
   `index.html`, `sw.js`, `manifest.json`, `icon.svg`. → *Commit*.
3. **Vercel** → *Add New Project* → *Import Git Repository* → choisir le dépôt.
   Framework : **Other**. Aucun réglage à changer. → *Deploy*.
4. Ouvrir l'adresse `.vercel.app` dans **Chrome sur Android**.
5. Menu ⋮ → **Ajouter à l'écran d'accueil**. Lancer depuis l'icône, pas depuis
   l'onglet : en mode autonome, Android garde la page vivante plus longtemps.

HTTPS est indispensable pour les notifications et la position — Vercel le fournit.

## Réglage Samsung, à faire une seule fois

Paramètres → Applications → Chrome → Batterie → **Sans restriction**.
Sans cela, One UI endort la page dès que Waze passe devant et vous ne recevrez rien.

## Premier essai, sans conduire

Analyser un trajet, puis **Simuler le trajet**. Le parcours défile en accéléré,
les annonces se déclenchent. Cela vérifie la voix et les notifications en trente secondes.

## Essai réel

1. Analyser le trajet.
2. **Démarrer le suivi** → autoriser la position, puis les notifications.
3. **Ouvrir Waze**. Naviguer normalement.
4. À l'approche d'une zone : notification + annonce vocale par-dessus le GPS.

Le meilleur créneau est une fin d'après-midi dégagée, sur une route orientée
vers le soleil couchant.

## Ce que ce prototype ne fait pas encore

- **Le relief.** Un soleil masqué par un morne sera quand même annoncé.
  Le module existe côté moteur mais il lui faut des données d'altitude serveur.
- **Le maintien en arrière-plan est un contournement** — un flux audio inaudible
  empêche Android d'endormir la page. Ça fonctionne, ce n'est pas propre.
  Seule une application native le fera correctement.
- **Pas d'itinéraires alternatifs.** OSRM public n'a aucune garantie de service :
  parfait pour essayer, à ne pas mettre entre les mains de clients.
- **Pas de trafic.** Les horaires sont ceux d'une route fluide ; un embouteillage
  décale tout. C'est justement une chose à mesurer.

## À noter pendant vos essais

Pour chaque trajet : heure, itinéraire, ce que l'appli a annoncé, ce que vous
avez réellement vu. Les trois questions qui comptent :

1. La zone annoncée correspond-elle à une gêne réelle ?
2. Le moment de l'annonce est-il utile — assez tôt, pas trop tôt ?
3. Une gêne réelle a-t-elle été manquée ?

Les seuils sont en haut du fichier `index.html`, dans l'objet `T`. Ce sont eux
que vos relevés serviront à corriger.
