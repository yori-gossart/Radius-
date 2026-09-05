const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

// Les seules variables demandées. Température, vent et humidité ne servent pas
// encore à la question posée : les demander coûterait de la bande passante et
// inviterait à s'en servir sans justification.
const VARIABLES = [
  'direct_normal_irradiance_instant',
  'cloud_cover',
  'visibility',
  'precipitation',
  'weather_code',
];

// Unités attendues, par variable. La règle est absolue : on ne prend jamais un
// nombre pour ensuite en supposer l'unité. Si l'unité manque ou surprend, la
// variable vaut null et un avertissement est émis.
const UNITES_ATTENDUES = {
  direct_normal_irradiance_instant: ['w/m²', 'w/m2'],
  cloud_cover: ['%'],
  visibility: ['m'],
  precipitation: ['mm'],
  weather_code: ['wmo code', 'wmo'],
};

// Borne de validité temporelle, PAS un seuil météorologique. Les données sont
// horaires : un appariement normal est à trente minutes au plus. Au-delà de
// cette borne, on refuse plutôt que d'utiliser une heure qui ne correspond pas.
const ECART_TEMPOREL_MAX_MIN = 90;

const MAX_ZONES = 6;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

const nombreValide = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;

function observationValide(o) {
  return !!o && nombreValide(nombreStrict(o.lat), -90, 90)
    && nombreValide(nombreStrict(o.lng), -180, 180)
    && Number.isFinite(nombreStrict(o.passageTimeMs));
}

const normaliseUnite = (u) => String(u ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Lit une variable en exigeant que son unité soit celle attendue. */
function lireVariable(nom, serie, index, unites, warnings) {
  const unite = unites?.[nom];
  if (unite === undefined) {
    warnings.push(`unité absente pour ${nom}`);
    return { valeur: null, unite: null };
  }
  if (!UNITES_ATTENDUES[nom].includes(normaliseUnite(unite))) {
    warnings.push(`unité inattendue pour ${nom} : « ${unite} » au lieu de ${UNITES_ATTENDUES[nom][0]}`);
    return { valeur: null, unite };
  }
  if (!Array.isArray(serie)) {
    warnings.push(`série absente pour ${nom}`);
    return { valeur: null, unite };
  }
  const v = serie[index];
  if (v === null || v === undefined) {
    warnings.push(`valeur nulle pour ${nom} à l'échéance retenue`);
    return { valeur: null, unite };
  }
  if (!Number.isFinite(Number(v))) {
    warnings.push(`valeur non numérique pour ${nom} : ${JSON.stringify(v)}`);
    return { valeur: null, unite };
  }
  return { valeur: Number(v), unite };
}

/** Échéance horaire la plus proche du passage.
    Règle déterministe en cas d'égalité parfaite — un passage à 17h30 entre une
    échéance 17h00 et une 18h00 : on retient l'ANTÉRIEURE. Le choix est
    arbitraire ; ce qui compte est qu'il soit fixe et écrit. */
function echeanceLaPlusProche(temps, passageMs) {
  if (!Array.isArray(temps) || !temps.length) return null;
  let meilleur = null;
  for (let i = 0; i < temps.length; i++) {
    // Open-Meteo renvoie des heures locales sans suffixe quand timezone n'est
    // pas UTC ; on demande UTC, donc on force l'interprétation en UTC.
    const t = Date.parse(/[Zz]|[+-]\d\d:?\d\d$/.test(temps[i]) ? temps[i] : temps[i] + 'Z');
    if (!Number.isFinite(t)) continue;
    const delta = t - passageMs;
    if (meilleur === null || Math.abs(delta) < Math.abs(meilleur.delta)
      || (Math.abs(delta) === Math.abs(meilleur.delta) && t < meilleur.t)) {
      meilleur = { i, t, delta, iso: temps[i] };
    }
  }
  return meilleur;
}

// ---- garde-fous d'entrée -------------------------------------------------
// Number(null), Number(''), Number(false) et Number([]) valent tous 0 : une
// coordonnée absente devenait donc l'équateur au lieu d'être refusée, et
// consommait un appel facturé. On n'accepte qu'un vrai nombre, ou une chaîne
// qui en est un.
function nombreStrict(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

// Corps borné : au-delà, on refuse sans lire. Un lot de 200 points d'altitude
// pèse environ 5 Ko ; 32 Ko laissent une marge confortable.
const TAILLE_MAX_CORPS = 32768;

function corpsTropGros(request) {
  const n = Number(request.headers.get('content-length'));
  return Number.isFinite(n) && n > TAILLE_MAX_CORPS;
}

function typeIncorrect(request) {
  const t = String(request.headers.get('content-type') || '').toLowerCase();
  return !t.includes('application/json');
}

// Friction, PAS une authentification. Origin et Referer sont posés par le
// navigateur et peuvent être forgés par n'importe quel client non navigateur :
// ce contrôle écarte les appels depuis une autre page web, il n'arrête pas un
// script. La vraie protection est le plafond de budget côté Google Cloud.
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
  // Soupape : si un jour l'application est servie sous un domaine dont l'hôte
  // ne coïncide plus avec l'origine, RADIUS_ORIGINES évite de redéployer le
  // code pour la remettre en marche. Vide par défaut.
  const permis = String(process.env.RADIUS_ORIGINES || '')
    .split(',').map((x) => x.trim()).filter(Boolean);
  return !permis.includes(venuDe);
}

function refusEntree(request) {
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

export default {
  async fetch(request) {
    const refus = refusEntree(request);
    if (refus) return refus;

    let body;
    try { body = await request.json(); }
    catch { return json({ error: 'Corps JSON invalide.' }, 400); }

    const obs = body?.observations;
    if (!Array.isArray(obs) || !obs.length) return json({ error: 'Aucune observation demandée.' }, 400);
    if (obs.length > MAX_ZONES) {
      return json({ error: `Trop d'observations : ${obs.length} pour un maximum de ${MAX_ZONES}.`,
        code: 'TROP_DE_ZONES' }, 400);
    }
    if (!obs.every(observationValide)) {
      return json({ error: 'Observation invalide : latitude, longitude ou heure de passage.' }, 400);
    }

    const url = `${OPEN_METEO_URL}?latitude=${obs.map((o) => nombreStrict(o.lat).toFixed(4)).join(',')}`
      + `&longitude=${obs.map((o) => nombreStrict(o.lng).toFixed(4)).join(',')}`
      + `&hourly=${VARIABLES.join(',')}`
      + '&timezone=UTC&timeformat=iso8601&forecast_days=3';

    let reponse;
    try { reponse = await fetch(url, { headers: { accept: 'application/json' } }); }
    catch { return json({ error: 'Impossible de joindre Open-Meteo.', code: 'METEO_NETWORK_ERROR' }, 502); }

    let brut;
    try { brut = await reponse.json(); }
    catch { return json({ error: 'Réponse Open-Meteo illisible.', code: 'METEO_BAD_RESPONSE' }, 502); }

    if (!reponse.ok || brut?.error) {
      return json({ error: brut?.reason || `Open-Meteo a répondu ${reponse.status}.`,
        code: 'METEO_ERROR' }, 502);
    }

    // Une requête multi-coordonnées renvoie un tableau ; une seule coordonnée
    // renvoie un objet. Les deux formes sont acceptées, mais jamais devinées :
    // si le compte ne correspond pas, on le dit au lieu d'aligner au hasard.
    const lieux = Array.isArray(brut) ? brut : [brut];
    if (lieux.length !== obs.length) {
      return json({
        error: `Open-Meteo a renvoyé ${lieux.length} lieu(x) pour ${obs.length} demandé(s).`,
        code: 'SHAPE_INATTENDUE',
        formeRecue: Array.isArray(brut) ? 'tableau' : 'objet',
      }, 502);
    }

    const fetchedAt = new Date().toISOString();
    const resultats = obs.map((o, k) => {
      const warnings = [];
      const lieu = lieux[k];
      const h = lieu?.hourly, unites = lieu?.hourly_units;
      if (!h || !unites) {
        return { status: 'unknown', provider: 'open-meteo', fetchedAt,
          warnings: ['bloc horaire ou unités absents pour ce lieu'] };
      }

      const ech = echeanceLaPlusProche(h.time, nombreStrict(o.passageTimeMs));
      if (!ech) {
        return { status: 'unknown', provider: 'open-meteo', fetchedAt,
          warnings: ['aucune échéance horaire exploitable'] };
      }
      const deltaMin = Math.round(ech.delta / 60000);
      if (Math.abs(deltaMin) > ECART_TEMPOREL_MAX_MIN) {
        return { status: 'unknown', provider: 'open-meteo', fetchedAt,
          deltaTimeMinutes: deltaMin, instantValidTime: ech.iso,
          warnings: [`échéance trop éloignée du passage : ${deltaMin} min`
            + ` (limite ${ECART_TEMPOREL_MAX_MIN} min)`] };
      }

      const lu = {};
      for (const nom of VARIABLES) lu[nom] = lireVariable(nom, h[nom], ech.i, unites, warnings);
      const valeurs = Object.values(lu).map((x) => x.valeur);
      const status = valeurs.every((v) => v !== null) ? 'ok'
        : valeurs.every((v) => v === null) ? 'unknown' : 'partial';

      return {
        status,
        directNormalIrradiance: lu.direct_normal_irradiance_instant.valeur,
        cloudCover: lu.cloud_cover.valeur,
        visibility: lu.visibility.valeur,
        precipitation: lu.precipitation.valeur,
        weatherCode: lu.weather_code.valeur,

        // Sémantique temporelle : ces quatre-là sont instantanées ; la
        // précipitation est un cumul sur l'heure qui PRÉCÈDE l'échéance. Les
        // ranger sous un même « validTime » serait faux.
        instantValidTime: ech.iso,
        precipitationPeriodEndTime: ech.iso,
        precipitationPeriodHours: 1,
        deltaTimeMinutes: deltaMin,
        // Heure de passage sur laquelle l'appariement a été fait. Le bandeau de
        // la zone affiche son DÉBUT ; relief et météo travaillent sur le point
        // représentatif. Sans ce champ, l'écart affiché est irréconciliable.
        passageTime: new Date(nombreStrict(o.passageTimeMs)).toISOString(),

        // Unités réellement reçues, remontées telles quelles : c'est ce qui
        // permet de constater un changement de contrat plutôt que de le subir.
        unitesRecues: Object.fromEntries(VARIABLES.map((n) => [n, unites[n] ?? null])),
        modele: lieu?.hourly?.model ?? null,
        provider: 'open-meteo',
        fetchedAt,
        warnings,
      };
    });

    return json({
      provider: 'open-meteo',
      attribution: 'Weather data by Open-Meteo.com (CC BY 4.0)',
      // Le DNI d'Open-Meteo est issu d'un modèle météorologique, pas d'une
      // mesure du disque solaire. Ce n'est pas une vérité terrain.
      note: 'Valeurs issues d’un modèle de prévision, non d’une observation directe.',
      requetes: 1,
      localisations: obs.length,
      resultats,
    });
  },
};
