const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

// V0.2 Journey + Stationary : couche descriptive uniquement.
// Aucune variable ci-dessous n'alimente un score de danger ni un seuil.
const VARIABLES = [
  'temperature_2m',
  'precipitation',
  'cloud_cover',
  'visibility',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'direct_normal_irradiance_instant',
  'weather_code',
];

const UNITES_ATTENDUES = {
  temperature_2m: ['°c', 'c'],
  precipitation: ['mm'],
  cloud_cover: ['%'],
  visibility: ['m'],
  wind_speed_10m: ['km/h', 'kmh'],
  wind_gusts_10m: ['km/h', 'kmh'],
  wind_direction_10m: ['°', 'deg'],
  direct_normal_irradiance_instant: ['w/m²', 'w/m2'],
  weather_code: ['wmo code', 'wmo'],
};

const MAX_OBSERVATIONS = 18;
const ECART_TEMPOREL_MAX_MIN = 90;
const TAILLE_MAX_CORPS = 32768;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function nombreStrict(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

const nombreValide = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;

function observationValide(o) {
  return !!o
    && nombreValide(nombreStrict(o.lat), -90, 90)
    && nombreValide(nombreStrict(o.lng), -180, 180)
    && Number.isFinite(nombreStrict(o.passageTimeMs));
}

function corpsTropGros(request) {
  const n = Number(request.headers.get('content-length'));
  return Number.isFinite(n) && n > TAILLE_MAX_CORPS;
}

function typeIncorrect(request) {
  const t = String(request.headers.get('content-type') || '').toLowerCase();
  return !t.includes('application/json');
}

function origineEtrangere(request) {
  const hote = request.headers.get('host') || (() => {
    try { return new URL(request.url).host; } catch { return ''; }
  })();
  if (!hote) return false;
  const source = request.headers.get('origin') || request.headers.get('referer');
  if (!source) return true;
  let venuDe;
  try { venuDe = new URL(source).host; } catch { return true; }
  if (venuDe === hote) return false;
  const permis = String(process.env.RADIUS_ORIGINES || '')
    .split(',').map((x) => x.trim()).filter(Boolean);
  return !permis.includes(venuDe);
}

function refusEntree(request) {
  // Mêmes codes que les trois autres endpoints : le client et le banc lisent
  // `code`, pas le texte. Un quatrième endpoint qui refuse autrement obligerait
  // à distinguer ses refus au message, donc à la langue.
  if (request.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);
  if (typeIncorrect(request)) {
    return json({ error: 'Content-Type attendu : application/json.', code: 'TYPE_INCORRECT' }, 415);
  }
  if (corpsTropGros(request)) {
    return json({ error: 'Corps de requête trop volumineux.', code: 'CORPS_TROP_GROS' }, 413);
  }
  if (origineEtrangere(request)) {
    return json({ error: 'Origine non autorisée.', code: 'ORIGINE_ETRANGERE' }, 403);
  }
  return null;
}

const normaliseUnite = (u) => String(u ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function lireVariable(nom, serie, index, unites, warnings) {
  const unite = unites?.[nom];
  if (unite === undefined) {
    warnings.push(`unité absente pour ${nom}`);
    return null;
  }
  const attendues = UNITES_ATTENDUES[nom] || [];
  if (attendues.length && !attendues.includes(normaliseUnite(unite))) {
    warnings.push(`unité inattendue pour ${nom} : ${unite}`);
    return null;
  }
  if (!Array.isArray(serie)) {
    warnings.push(`série absente pour ${nom}`);
    return null;
  }
  const v = serie[index];
  if (v === null || v === undefined || !Number.isFinite(Number(v))) {
    warnings.push(`valeur indisponible pour ${nom}`);
    return null;
  }
  return Number(v);
}

function echeanceLaPlusProche(temps, passageMs) {
  if (!Array.isArray(temps) || !temps.length) return null;
  let meilleur = null;
  for (let i = 0; i < temps.length; i++) {
    const brut = String(temps[i]);
    const t = Date.parse(/[Zz]|[+-]\d\d:?\d\d$/.test(brut) ? brut : brut + 'Z');
    if (!Number.isFinite(t)) continue;
    const delta = t - passageMs;
    if (meilleur === null
      || Math.abs(delta) < Math.abs(meilleur.delta)
      || (Math.abs(delta) === Math.abs(meilleur.delta) && t < meilleur.t)) {
      meilleur = { i, t, delta, iso: brut };
    }
  }
  return meilleur;
}

function forecastDays(obs) {
  const maxMs = Math.max(...obs.map((o) => nombreStrict(o.passageTimeMs)));
  const deltaDays = Math.ceil((maxMs - Date.now()) / 86400000) + 1;
  return Math.max(1, Math.min(7, deltaDays));
}

export default {
  async fetch(request) {
    const refus = refusEntree(request);
    if (refus) return refus;

    let body;
    try { body = await request.json(); }
    catch { return json({ error: 'Corps JSON invalide.' }, 400); }

    const obs = body?.observations;
    if (!Array.isArray(obs) || !obs.length) return json({ error: 'Aucune observation demandée.' }, 400);
    if (obs.length > MAX_OBSERVATIONS) {
      return json({ error: `Maximum ${MAX_OBSERVATIONS} points/instants par requête.` }, 400);
    }
    if (!obs.every(observationValide)) {
      return json({ error: 'Observation invalide : latitude, longitude ou heure.' }, 400);
    }

    const horizon = forecastDays(obs);
    const url = `${OPEN_METEO_URL}?latitude=${obs.map((o) => nombreStrict(o.lat).toFixed(4)).join(',')}`
      + `&longitude=${obs.map((o) => nombreStrict(o.lng).toFixed(4)).join(',')}`
      + `&hourly=${VARIABLES.join(',')}`
      + `&timezone=UTC&timeformat=iso8601&forecast_days=${horizon}`;

    let reponse;
    try { reponse = await fetch(url, { headers: { accept: 'application/json' } }); }
    catch { return json({ error: 'Impossible de joindre Open-Meteo.', code: 'METEO_NETWORK_ERROR' }, 502); }

    let brut;
    try { brut = await reponse.json(); }
    catch { return json({ error: 'Réponse Open-Meteo illisible.', code: 'METEO_BAD_RESPONSE' }, 502); }

    if (!reponse.ok || brut?.error) {
      return json({ error: brut?.reason || `Open-Meteo a répondu ${reponse.status}.`, code: 'METEO_ERROR' }, 502);
    }

    const lieux = Array.isArray(brut) ? brut : [brut];
    if (lieux.length !== obs.length) {
      return json({ error: `Open-Meteo a renvoyé ${lieux.length} lieu(x) pour ${obs.length} demandé(s).` }, 502);
    }

    const fetchedAt = new Date().toISOString();
    const resultats = obs.map((o, k) => {
      const warnings = [];
      const lieu = lieux[k];
      const h = lieu?.hourly;
      const unites = lieu?.hourly_units;
      if (!h || !unites) {
        return { status: 'unknown', provider: 'open-meteo', fetchedAt, warnings: ['données horaires absentes'] };
      }

      const ech = echeanceLaPlusProche(h.time, nombreStrict(o.passageTimeMs));
      if (!ech) {
        return { status: 'unknown', provider: 'open-meteo', fetchedAt, warnings: ['échéance horaire absente'] };
      }
      const deltaTimeMinutes = Math.round(ech.delta / 60000);
      if (Math.abs(deltaTimeMinutes) > ECART_TEMPOREL_MAX_MIN) {
        return {
          status: 'unknown', provider: 'open-meteo', fetchedAt,
          passageTime: new Date(nombreStrict(o.passageTimeMs)).toISOString(),
          instantValidTime: ech.iso, deltaTimeMinutes,
          warnings: [`échéance trop éloignée : ${deltaTimeMinutes} min`],
        };
      }

      const values = Object.fromEntries(VARIABLES.map((nom) => [
        nom, lireVariable(nom, h[nom], ech.i, unites, warnings),
      ]));
      const present = Object.values(values).filter((v) => v !== null).length;
      const status = present === VARIABLES.length ? 'ok' : present === 0 ? 'unknown' : 'partial';

      return {
        status,
        temperature: values.temperature_2m,
        precipitation: values.precipitation,
        cloudCover: values.cloud_cover,
        visibility: values.visibility,
        windSpeed: values.wind_speed_10m,
        windGusts: values.wind_gusts_10m,
        windDirection: values.wind_direction_10m,
        directNormalIrradiance: values.direct_normal_irradiance_instant,
        weatherCode: values.weather_code,
        passageTime: new Date(nombreStrict(o.passageTimeMs)).toISOString(),
        instantValidTime: ech.iso,
        precipitationPeriodEndTime: ech.iso,
        precipitationPeriodHours: 1,
        deltaTimeMinutes,
        provider: 'open-meteo',
        fetchedAt,
        warnings,
      };
    });

    return json({
      provider: 'open-meteo',
      attribution: 'Weather data by Open-Meteo.com (CC BY 4.0)',
      note: 'Prévisions descriptives. Aucun seuil de danger ni score météo.',
      forecastDays: horizon,
      localisations: obs.length,
      resultats,
    });
  },
};
