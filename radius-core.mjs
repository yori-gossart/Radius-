/* RADIUS — cœur scientifique commun.
   ------------------------------------------------------------------
   Ce module ne contient QUE des fonctions de géométrie et d'astronomie, et il
   est la seule copie de chacune. Avant le 17 septembre 2026, `index.html` et
   `journey-core.mjs` portaient chacun leur propre `solar()`, `bearing()` et
   `signedDelta()`. Le banc comparait les deux sur SIX cas choisis, où elles
   s'accordaient à 1e-11 — et ne voyait donc pas qu'elles divergeaient ailleurs :
   jusqu'à 0,27° d'azimut près du zénith, 0,004° dans le régime du produit, et
   0,2 m de distance parce que l'un prenait 6 371 008,8 m de rayon terrestre et
   l'autre 6 371 000.

   Les implémentations ci-dessous sont celles d'`index.html`, reprises MOT POUR
   MOT : c'est le moteur calibré contre le terrain, et rien de ce qu'il produit
   ne doit bouger. `journey-core.mjs` les réexporte, et converge donc dessus.

   Aucun seuil ici. Aucun `T`, aucun `level`, aucune règle d'épisode ou de
   parole : ce module dit où est le Soleil et comment tourne une route, jamais
   ce qu'il faut en conclure. */

export const R = Math.PI / 180, D = 180 / Math.PI;

/** Rayon terrestre moyen IUGG, en mètres. */
export const EARTH = 6371008.8;

export function mod360(v) {
  return ((Number(v) % 360) + 360) % 360;
}

export function solar(dateMs, lat, lng) {
  const jd = dateMs / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const C = Math.sin(M * R) * (1.914602 - t * (0.004817 + 0.000014 * t))
          + Math.sin(2 * M * R) * (0.019993 - 0.000101 * t)
          + Math.sin(3 * M * R) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * R);
  const seconds = 21.448 - t * (46.815 + t * (0.00059 - t * 0.001813));
  const e0 = 23 + (26 + seconds / 60) / 60;
  const eps = e0 + 0.00256 * Math.cos(omega * R);
  const decl = Math.asin(Math.sin(eps * R) * Math.sin(lambda * R)) * D;

  const y = Math.tan(eps / 2 * R) ** 2;
  const eqTime = 4 * D * (y * Math.sin(2 * L0 * R)
    - 2 * e * Math.sin(M * R)
    + 4 * e * y * Math.sin(M * R) * Math.cos(2 * L0 * R)
    - 0.5 * y * y * Math.sin(4 * L0 * R)
    - 1.25 * e * e * Math.sin(2 * M * R));

  const d = new Date(dateMs);
  const minutesUTC = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  let ha = (minutesUTC + eqTime + 4 * lng) / 4 - 180;
  while (ha < -180) ha += 360;
  while (ha > 180) ha -= 360;

  const latR = lat * R, decR = decl * R, haR = ha * R;
  const cosZ = Math.sin(latR) * Math.sin(decR) + Math.cos(latR) * Math.cos(decR) * Math.cos(haR);
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZ))) * D;
  let elev = 90 - zenith;

  // Réfraction atmosphérique : le soleil paraît plus haut qu'il n'est.
  if (elev > -1 && elev < 85) {
    const te = Math.tan(elev * R);
    let r = elev > 5 ? 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5
          : elev > -0.575 ? 1735 + elev * (-518.2 + elev * (103.4 + elev * (-12.79 + elev * 0.711)))
          : -20.772 / te;
    elev += r / 3600;
  }

  let az;
  const denom = Math.cos(latR) * Math.sin(zenith * R);
  if (Math.abs(denom) > 1e-9) {
    let c = (Math.sin(latR) * Math.cos(zenith * R) - Math.sin(decR)) / denom;
    az = 180 - Math.acos(Math.max(-1, Math.min(1, c))) * D;
    if (ha > 0) az = -az;
  } else az = lat > 0 ? 180 : 0;
  az = ((az % 360) + 360) % 360;

  return { azimuth: az, elevation: elev };
}

export function dist(aLat, aLng, bLat, bLng) {
  const dLat = (bLat - aLat) * R, dLng = (bLng - aLng) * R;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(aLat * R) * Math.cos(bLat * R) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearing(aLat, aLng, bLat, bLng) {
  const p1 = aLat * R, p2 = bLat * R, dl = (bLng - aLng) * R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * D) + 360) % 360;
}

/** Écart signé cap → azimut, dans (-180, 180]. Négatif = soleil à gauche. */
export function signedDelta(heading, target) {
  let d = ((target - heading) % 360 + 360) % 360;
  return d > 180 ? d - 360 : d;
}
