export const R = Math.PI / 180;
export const D = 180 / Math.PI;

export function mod360(v) {
  return ((Number(v) % 360) + 360) % 360;
}

export function signedDelta(fromDeg, toDeg) {
  let d = mod360(toDeg) - mod360(fromDeg);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export function haversine(aLat, aLng, bLat, bLng) {
  const p1 = Number(aLat) * R;
  const p2 = Number(bLat) * R;
  const dp = (Number(bLat) - Number(aLat)) * R;
  const dl = (Number(bLng) - Number(aLng)) * R;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function bearing(aLat, aLng, bLat, bLng) {
  const p1 = Number(aLat) * R;
  const p2 = Number(bLat) * R;
  const dl = (Number(bLng) - Number(aLng)) * R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return mod360(Math.atan2(y, x) * D);
}

export function solar(dateMs, lat, lng) {
  const jd = Number(dateMs) / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const L0 = mod360(280.46646 + t * (36000.76983 + t * 0.0003032));
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const Mr = M * R;
  const C = Math.sin(Mr) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * Mr) * (0.019993 - 0.000101 * t)
    + Math.sin(3 * Mr) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * R);
  const eps0 = 23 + (26 + ((21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60)) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * R);
  const decl = Math.asin(Math.sin(eps * R) * Math.sin(lambda * R));

  const y = Math.tan((eps * R) / 2) ** 2;
  const eqTime = 4 * D * (y * Math.sin(2 * L0 * R)
    - 2 * e * Math.sin(Mr)
    + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0 * R)
    - 0.5 * y * y * Math.sin(4 * L0 * R)
    - 1.25 * e * e * Math.sin(2 * Mr));

  const date = new Date(Number(dateMs));
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes()
    + date.getUTCSeconds() / 60 + date.getUTCMilliseconds() / 60000;
  let trueSolarMinutes = (utcMinutes + eqTime + 4 * Number(lng)) % 1440;
  if (trueSolarMinutes < 0) trueSolarMinutes += 1440;
  let hourAngle = trueSolarMinutes / 4 - 180;
  if (hourAngle < -180) hourAngle += 360;
  const ha = hourAngle * R;
  const phi = Number(lat) * R;
  const cosZen = Math.min(1, Math.max(-1,
    Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha)));
  const zen = Math.acos(cosZen);
  let elevation = 90 - zen * D;

  // Réfraction atmosphérique : le soleil paraît plus haut qu'il n'est.
  // Bloc repris À L'IDENTIQUE de `solar()` dans index.html. Sans lui, les deux
  // pages décrivaient deux soleils différents : jusqu'à 0,27° d'écart en
  // élévation à l'approche de l'horizon — exactement le régime où vit le
  // produit, et où T.high.maxElev vaut 8°. Un écart pareil rendrait un relevé
  // fait sur journey.html incomparable avec un relevé fait sur index.html.
  // test-journey-v02.mjs rejoue les deux implémentations l'une contre l'autre
  // pour qu'elles ne puissent plus diverger en silence.
  if (elevation > -1 && elevation < 85) {
    const te = Math.tan(elevation * R);
    const r = elevation > 5 ? 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5
      : elevation > -0.575 ? 1735 + elevation * (-518.2 + elevation * (103.4
          + elevation * (-12.79 + elevation * 0.711)))
      : -20.772 / te;
    elevation += r / 3600;
  }

  const azimuth = mod360(Math.atan2(
    Math.sin(ha),
    Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi),
  ) * D + 180);

  return { azimuth, elevation };
}

function pointAtDistance(coords, target) {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const seg = [];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = haversine(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
    seg.push(d);
    total += d;
  }
  if (!(total > 0)) return { lat: coords[0][0], lng: coords[0][1], heading: 0 };
  const wanted = Math.min(total, Math.max(0, target));
  let acc = 0;
  for (let i = 0; i < seg.length; i++) {
    if (acc + seg[i] >= wanted || i === seg.length - 1) {
      const f = seg[i] > 0 ? (wanted - acc) / seg[i] : 0;
      const a = coords[i], b = coords[i + 1];
      return {
        lat: a[0] + (b[0] - a[0]) * f,
        lng: a[1] + (b[1] - a[1]) * f,
        heading: bearing(a[0], a[1], b[0], b[1]),
      };
    }
    acc += seg[i];
  }
  return null;
}

function sampleFromGeometry(route, departureMs, count) {
  const coords = Array.isArray(route?.geometry) ? route.geometry : [];
  if (coords.length < 2) return [];
  const distances = [];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversine(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
    distances.push(total);
  }
  const duration = Math.max(0, Number(route?.durationSeconds) || 0);
  return Array.from({ length: count }, (_, i) => {
    const progress = count === 1 ? 0 : i / (count - 1);
    const p = pointAtDistance(coords, total * progress);
    return p ? {
      ...p,
      progress,
      passageTimeMs: Number(departureMs) + duration * 1000 * progress,
    } : null;
  }).filter(Boolean);
}

export function routeSamples(route, departureMs, count = 5) {
  const n = Math.max(2, Math.min(8, Math.round(Number(count) || 5)));
  const steps = Array.isArray(route?.steps) ? route.steps.filter((s) =>
    Array.isArray(s?.coordinates) && s.coordinates.length >= 2 && Number(s.staticDurationSeconds) >= 0) : [];
  const trafficFactor = Number(route?.trafficFactor) > 0 ? Number(route.trafficFactor) : 1;
  const timed = steps.map((s) => ({
    ...s,
    duration: Math.max(0, Number(s.staticDurationSeconds) || 0) * trafficFactor,
  }));
  const totalTimed = timed.reduce((sum, s) => sum + s.duration, 0);
  if (!(totalTimed > 0)) return sampleFromGeometry(route, departureMs, n);

  return Array.from({ length: n }, (_, i) => {
    const progress = i / (n - 1);
    const target = totalTimed * progress;
    let acc = 0;
    let step = timed[timed.length - 1];
    let within = step.duration;
    for (const s of timed) {
      if (acc + s.duration >= target) {
        step = s;
        within = target - acc;
        break;
      }
      acc += s.duration;
    }
    const f = step.duration > 0 ? within / step.duration : 0;
    let stepDistance = 0;
    for (let k = 1; k < step.coordinates.length; k++) {
      stepDistance += haversine(
        step.coordinates[k - 1][0], step.coordinates[k - 1][1],
        step.coordinates[k][0], step.coordinates[k][1],
      );
    }
    const p = pointAtDistance(step.coordinates, stepDistance * Math.min(1, Math.max(0, f)));
    return p ? {
      ...p,
      progress,
      passageTimeMs: Number(departureMs) + target * 1000,
    } : null;
  }).filter(Boolean);
}

export function stationarySamples(point, startMs, endMs, count = 5) {
  const n = Math.max(2, Math.min(8, Math.round(Number(count) || 5)));
  const start = Number(startMs);
  const end = Math.max(start, Number(endMs));
  return Array.from({ length: n }, (_, i) => {
    const progress = i / (n - 1);
    return {
      lat: Number(point.lat),
      lng: Number(point.lng),
      progress,
      passageTimeMs: start + (end - start) * progress,
    };
  });
}

/* ---- les huit secteurs relatifs ----
   Les bornes — 15, 45, 110, 160 — découpent une GÉOMÉTRIE. Ce ne sont pas des
   seuils de risque : elles ne lisent pas `T` et ne produisent aucun `level`.

   Le secteur et la phrase sortent de la MÊME fonction depuis le 16 septembre
   2026 : la rose de direction et le texte doivent désigner le même secteur, et
   deux tables d'angles séparées finiraient par diverger — ce dépôt s'est déjà
   fait prendre à entretenir deux soleils. */
export const SECTEURS_RELATIFS = ['devant', 'devant-droite', 'droite', 'derriere-droite',
  'derriere', 'derriere-gauche', 'gauche', 'devant-gauche'];

const MOT_SECTEUR = {
  'devant': 'droit devant',
  'devant-droite': 'devant à droite',
  'droite': 'à droite',
  'derriere-droite': 'derrière à droite',
  'derriere': 'droit derrière',
  'derriere-gauche': 'derrière à gauche',
  'gauche': 'à gauche',
  'devant-gauche': 'devant à gauche',
};

/** `deltaDeg` = écart cap → azimut. Positif vers la droite. */
export function secteurRelatif(deltaDeg) {
  if (!Number.isFinite(Number(deltaDeg))) return null;
  const d = signedDelta(0, Number(deltaDeg));
  const cote = d >= 0 ? 'droite' : 'gauche';
  const a = Math.abs(d);
  if (a <= 15) return 'devant';
  if (a <= 45) return `devant-${cote}`;
  if (a <= 110) return cote;
  if (a <= 160) return `derriere-${cote}`;
  return 'derriere';
}

export function libelleSecteur(secteur) {
  return MOT_SECTEUR[secteur] || null;
}

/** Où est le Soleil par rapport à la direction regardée. */
export function sunRelativeLabel(heading, sun) {
  if (!sun || !Number.isFinite(sun.elevation) || !Number.isFinite(sun.azimuth)) return 'Soleil indisponible';
  if (sun.elevation <= -0.833) return 'Soleil sous l’horizon';
  if (!Number.isFinite(Number(heading))) return `Soleil azimut ${Math.round(sun.azimuth)}°`;
  return `Soleil ${libelleSecteur(secteurRelatif(signedDelta(Number(heading), sun.azimuth)))}`;
}

/* ---- projection sur la rose ----
   Vue de dessus, Nord EN HAUT. Un azimut se lit dans le sens horaire depuis le
   haut : 0° = haut, 90° = droite. En SVG l'axe y descend, d'où le signe moins.
   C'est une projection d'écran, pas une grandeur physique. */
export const ROSE_CENTRE = 100;

export function pointRose(deg, rayon) {
  const d = Number(deg), r = Number(rayon);
  if (!Number.isFinite(d) || !Number.isFinite(r)) return null;
  const a = mod360(d) * R;
  return {
    x: ROSE_CENTRE + r * Math.sin(a),
    y: ROSE_CENTRE - r * Math.cos(a),
  };
}

/* ---- dire une direction en mots ----
   « 150° » ne se lit pas au volant ni sur une terrasse. Huit points suffisent :
   au-delà, on prétendrait une finesse que ni la boussole du téléphone ni sa
   calibration ne garantissent. Le chiffre reste affiché à côté du mot, et
   l'azimut brut descend dans les détails techniques — rien ne disparaît. */
const CARDINAUX = ['Nord', 'Nord-Est', 'Est', 'Sud-Est',
                   'Sud', 'Sud-Ouest', 'Ouest', 'Nord-Ouest'];

export function cardinal(deg) {
  const d = Number(deg);
  if (!Number.isFinite(d)) return null;
  return CARDINAUX[Math.round(mod360(d) / 45) % 8];
}

/** « Sud-Est · 150° » — le mot d'abord, le chiffre ensuite. */
export function directionLisible(deg) {
  const mot = cardinal(deg);
  if (!mot) return 'Direction inconnue';
  return `${mot} · ${Math.round(mod360(Number(deg)))}°`;
}

/* ---- qualité de la position ----
   Un relevé de terrain rapproche une observation d'un point. À 2 km près, le
   point n'est plus celui qu'on croit et le relevé ne vaut rien — mais le
   prototype doit continuer de tourner : c'est justement en marchant qu'on
   découvre que le GPS dérive. On le dit donc, sans rien bloquer et sans
   masquer le chiffre.
   PRECISION_TERRAIN_M qualifie une DONNÉE, pas le ciel : ce n'est pas un seuil
   scientifique, il ne lit pas `T` et ne s'y mélange jamais. */
export const PRECISION_TERRAIN_M = 100;

export function qualitePosition(accuracyM) {
  const a = Number(accuracyM);
  if (!Number.isFinite(a) || a < 0) {
    return { metres: null, fiable: false,
      texte: 'Précision GPS inconnue — relevé terrain non fiable.' };
  }
  const m = Math.round(a);
  if (a > PRECISION_TERRAIN_M) {
    return { metres: m, fiable: false,
      texte: `Précision GPS ≈ ${m} m — position trop imprécise pour un relevé `
        + 'terrain fiable.' };
  }
  return { metres: m, fiable: true, texte: `Précision GPS ≈ ${m} m.` };
}

/** `Number(null)` vaut 0, et `Number.isFinite(0)` vaut vrai. Un téléphone sans
    magnétomètre émet un événement d'orientation dont `alpha` est `null` : lu
    sans précaution, il devenait un cap de 0° — plein Nord — annoncé comme une
    mesure. Ce dépôt s'est déjà fait prendre par ce piège exact, avec une
    latitude nulle devenue l'équateur. Une absence de mesure n'est pas zéro. */
function nombreStrict(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

export function compassHeadingFromEvent(event) {
  const webkit = nombreStrict(event?.webkitCompassHeading);
  if (Number.isFinite(webkit)) {
    return { heading: mod360(webkit), absolute: true, source: 'webkitCompassHeading' };
  }
  const alpha = nombreStrict(event?.alpha);
  if (Number.isFinite(alpha)) {
    return {
      heading: mod360(360 - alpha),
      absolute: event?.absolute === true,
      source: event?.absolute === true ? 'deviceorientationabsolute' : 'deviceorientation',
    };
  }
  return null;
}

/* ---- l'échéance de tout appel réseau ----
   Décision figée le 5 septembre 2026 après un calcul resté figé en production :
   un `try/catch` attrape un rejet, pas une absence. Un corps de réponse qui
   n'arrive jamais au bout laisse `await r.json()` en attente sans fin, et
   l'interface grisée à vie. journey.html est soumis à la même règle
   qu'index.html : aucun `fetch()` nu.

   Ces durées bornent une attente, elles ne mesurent rien : ce ne sont pas des
   seuils scientifiques et elles ne se mêlent jamais à T. */
export const DELAI_ROUTE_MS = 20000;
export const DELAI_METEO_MS = 12000;
export const DELAI_GEOCODE_MS = 12000;

/** fetch borné dans le temps. Le corps est lu SOUS la même échéance que la
    connexion : c'est là que l'attente se perdait, pas à l'établissement. */
export async function fetchBorne(url, options, delaiMs, quoi, fetchImpl) {
  const f = fetchImpl || globalThis.fetch;
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), delaiMs);
  try {
    const r = await f(url, { ...options, signal: ctrl.signal });
    const texte = await r.text();
    let json = null;
    try { json = JSON.parse(texte); } catch {}
    return { ok: r.ok, status: r.status, json };
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new Error(`${quoi} n’a pas répondu en ${Math.round(delaiMs / 1000)} s.`);
    }
    throw new Error(`${quoi} injoignable : ${e && e.message ? e.message : 'erreur réseau'}.`);
  } finally {
    clearTimeout(minuteur);
  }
}

/* ---- ce qu'Open-Meteo peut réellement fournir ----
   `api/journey-weather.js` interroge `forecast_days=N` en `timezone=UTC`, avec
   N plafonné à 7. Open-Meteo renvoie alors les heures d'aujourd'hui 00:00 UTC
   à (aujourd'hui + N − 1) 23:00 UTC. La fenêtre réellement servable est donc
   [minuit UTC du jour, minuit UTC + 7 jours[.

   Hors de cette fenêtre, l'échéance la plus proche que renverrait Open-Meteo
   serait celle d'un AUTRE jour. Le garde des 90 minutes la marquerait
   « unknown », mais la requête serait partie pour rien — et surtout, une
   prévision d'aujourd'hui présentée pour le 21 décembre serait un relevé faux.
   On ne l'envoie donc pas, et on le dit.

   La position du Soleil, elle, reste calculable à n'importe quelle date : c'est
   de l'astronomie, pas une prévision. Elle continue de s'afficher. */
export const HORIZON_PREVISION_JOURS = 7;

export function fenetrePrevision(nowMs) {
  const n = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const d = new Date(n);
  const debutMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return { debutMs, finMs: debutMs + HORIZON_PREVISION_JOURS * 86400000 };
}

/** `raison` vaut 'avant', 'apres', 'invalide' — ou null quand c'est servable. */
export function previsionDisponible(instantMs, nowMs) {
  const fenetre = fenetrePrevision(nowMs);
  const t = Number(instantMs);
  if (!Number.isFinite(t)) return { disponible: false, raison: 'invalide', fenetre };
  if (t < fenetre.debutMs) return { disponible: false, raison: 'avant', fenetre };
  if (t >= fenetre.finMs) return { disponible: false, raison: 'apres', fenetre };
  return { disponible: true, raison: null, fenetre };
}

/* ---- échantillonnage d'un point fixe ----
   « Instant précis » n'est pas un horizon de zéro minute échantillonné deux
   fois : c'est UN instant, et deux lignes identiques laisseraient croire à une
   évolution. D'où un tableau d'un seul élément. */
export function nombreEchantillons(horizonMinutes) {
  const m = Math.max(0, Number(horizonMinutes) || 0);
  if (m === 0) return 1;
  return Math.max(3, Math.min(7, Math.ceil(m / 60) + 2));
}

export function echantillonsPointFixe(point, debutMs, horizonMinutes) {
  const debut = Number(debutMs);
  if (!point || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lng))
    || !Number.isFinite(debut)) return [];
  const m = Math.max(0, Number(horizonMinutes) || 0);
  if (m === 0) {
    return [{ lat: Number(point.lat), lng: Number(point.lng), progress: 0, passageTimeMs: debut }];
  }
  return stationarySamples(point, debut, debut + m * 60000, nombreEchantillons(m));
}

/* ---- les deux référentiels de la rose ----
   Nord en haut oblige à se représenter mentalement une rotation : on lit
   « à droite » pendant que le marqueur est dessiné à gauche de l'écran. La vue
   par défaut est donc ÉGOCENTRIQUE — le haut du radar est toujours devant soi,
   la flèche ne bouge plus, et ce sont le Soleil et les points cardinaux qui
   tournent autour du centre quand le téléphone tourne.

   Rien de scientifique ne change : c'est exactement le même azimut solaire et
   le même cap qu'avant, seule la projection à l'écran diffère.
     vue 'face' : angle écran = signedDelta(cap, azimut) — 0 devant, +90 à
                  droite, ±180 derrière, -90 à gauche ;
     vue 'nord' : angle écran = azimut absolu. */
export const VUES_ROSE = ['face', 'nord'];

/** Sans cap mesuré il n'y a pas de « devant » : la vue face retombe sur le
    Nord plutôt que d'inventer une référence.
    Lecture STRICTE : `state.heading` vaut `null` tant que la boussole n'a rien
    donné, et `Number(null)` vaut 0. Lu sans précaution, « pas de cap » devenait
    un cap de 0° : le radar aurait annoncé « ↑ DEVANT MOI » en montrant du Nord.
    C'est le même piège que l'alpha nul du capteur, et que la latitude nulle
    devenue l'équateur. */
export function vueEffectiveRose(vue, headingDeg) {
  return (vue === 'face' && Number.isFinite(nombreStrict(headingDeg))) ? 'face' : 'nord';
}

export function angleRose(azimutDeg, headingDeg, vue) {
  const az = nombreStrict(azimutDeg);
  if (!Number.isFinite(az)) return null;
  if (vueEffectiveRose(vue, headingDeg) === 'nord') return mod360(az);
  return signedDelta(nombreStrict(headingDeg), az);
}
