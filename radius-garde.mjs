/* RADIUS — les refus partagés.
   ------------------------------------------------------------------
   `radius-core.mjs` ne porte aucun seuil : il dit où est le Soleil et comment
   tourne une route, jamais ce qu'il faut en conclure. Ce fichier-ci porte la
   seule chose qui ressemble à un seuil sans en être un — la limite au-delà de
   laquelle l'itinéraire rendu par Google ne décrit plus le trajet demandé.

   Ce n'est PAS un seuil scientifique : il ne lit pas `T`, ne produit aucun
   `level`, ne s'en approche jamais. Il qualifie une RÉPONSE, pas le ciel.

   Il vit à part parce que `index.html` le faisait seul depuis le début, et que
   `journey.html` ne le faisait pas du tout : un itinéraire raccroché à des
   kilomètres y passait en silence. Une deuxième copie aurait fini par diverger
   — ce dépôt s'est déjà fait prendre à entretenir deux soleils. */

import { dist } from './radius-core.mjs';

/** Au-delà, ce n'est plus du raccrochage au réseau routier : on refuse. */
export const SNAP_MAX_M = 2000;

/* Google raccroche les points demandés au réseau routier : quelques centaines
   de mètres sont normales, surtout hors agglomération. Des kilomètres veulent
   dire qu'on n'analyse pas le trajet saisi. */
export function ecartsRaccrochage(depart, arrivee, coords) {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const debut = coords[0], fin = coords[coords.length - 1];
  return {
    ecartDep: dist(depart.lat, depart.lng, debut[0], debut[1]),
    ecartArr: dist(arrivee.lat, arrivee.lng, fin[0], fin[1]),
  };
}

/** `null` — aucune géométrie à contrôler — n'est pas un dépassement : ce n'est
    pas au contrôle de raccrochage de signaler une réponse sans tracé. */
export function raccrochageHorsBornes(ecarts) {
  if (!ecarts) return false;
  return ecarts.ecartDep > SNAP_MAX_M || ecarts.ecartArr > SNAP_MAX_M;
}
