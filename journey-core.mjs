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

/** Où est le Soleil par rapport à la direction regardée. Les bornes — 15, 45,
    110, 160 — découpent une GÉOMÉTRIE ; ce ne sont pas des seuils de risque,
    elles ne lisent pas `T` et ne produisent aucun `level`. Seuls les mots ont
    changé le 16 septembre 2026 : « Soleil sur le côté droite » n'est pas du
    français, et le conducteur dit « à droite ». Les angles, eux, sont intacts. */
export function sunRelativeLabel(heading, sun) {
  if (!sun || !Number.isFinite(sun.elevation) || !Number.isFinite(sun.azimuth)) return 'Soleil indisponible';
  if (sun.elevation <= -0.833) return 'Soleil sous l’horizon';
  if (!Number.isFinite(Number(heading))) return `Soleil azimut ${Math.round(sun.azimuth)}°`;
  const delta = signedDelta(Number(heading), sun.azimuth);
  const side = delta >= 0 ? 'droite' : 'gauche';
  const a = Math.abs(delta);
  if (a <= 15) return 'Soleil droit devant';
  if (a <= 45) return `Soleil devant à ${side}`;
  if (a <= 110) return `Soleil à ${side}`;
  if (a <= 160) return `Soleil derrière à ${side}`;
  return 'Soleil droit derrière';
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

export function compassHeadingFromEvent(event) {
  if (Number.isFinite(Number(event?.webkitCompassHeading))) {
    return { heading: mod360(Number(event.webkitCompassHeading)), absolute: true, source: 'webkitCompassHeading' };
  }
  if (Number.isFinite(Number(event?.alpha))) {
    return {
      heading: mod360(360 - Number(event.alpha)),
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
