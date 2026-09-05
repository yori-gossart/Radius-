const GOOGLE_ELEVATION_URL = 'https://maps.googleapis.com/maps/api/elevation/json';

// L'API Elevation accepte plusieurs centaines de points par requête, mais la
// limite exacte n'a pas pu être relue dans la documentation depuis cet
// environnement. On reste volontairement bien en dessous : un lot de 200 points
// fait environ 4 500 caractères d'URL, très loin des limites usuelles, et une
// zone d'éblouissement ne coûte qu'une quinzaine de points.
const MAX_PAR_LOT = 200;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function nombreValide(v, min, max) {
  return Number.isFinite(v) && v >= min && v <= max;
}

function pointValide(p) {
  return Array.isArray(p) && p.length >= 2
    && nombreValide(nombreStrict(p[0]), -90, 90)
    && nombreValide(nombreStrict(p[1]), -180, 180);
}

// Cinq décimales suffisent — environ un mètre — et raccourcissent l'URL.
const enTexte = (p) => `${nombreStrict(p[0]).toFixed(5)},${nombreStrict(p[1]).toFixed(5)}`;

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

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return json({
        error: 'Google Elevation n’est pas configuré sur le serveur.',
        code: 'GOOGLE_KEY_MISSING',
      }, 503);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Corps JSON invalide.' }, 400);
    }

    const points = body?.points;
    if (!Array.isArray(points) || !points.length) {
      return json({ error: 'Aucun point à interroger.' }, 400);
    }
    if (points.length > MAX_PAR_LOT) {
      return json({
        error: `Trop de points en une requête : ${points.length} pour un maximum de ${MAX_PAR_LOT}.`,
        code: 'TROP_DE_POINTS',
      }, 400);
    }
    if (!points.every(pointValide)) {
      return json({ error: 'Coordonnées invalides dans la liste de points.' }, 400);
    }

    const url = `${GOOGLE_ELEVATION_URL}?locations=`
      + encodeURIComponent(points.map(enTexte).join('|'))
      + `&key=${encodeURIComponent(apiKey)}`;

    let response;
    try {
      response = await fetch(url);
    } catch {
      return json({
        error: 'Impossible de joindre Google Elevation.',
        code: 'GOOGLE_NETWORK_ERROR',
      }, 502);
    }

    let google;
    try {
      google = await response.json();
    } catch {
      return json({
        error: 'Réponse Google Elevation illisible.',
        code: 'GOOGLE_BAD_RESPONSE',
      }, 502);
    }

    // Elevation renvoie 200 avec un statut applicatif : un REQUEST_DENIED
    // arrive avec un code HTTP 200 et doit quand même être une erreur ici.
    if (google?.status !== 'OK' || !Array.isArray(google.results)) {
      return json({
        error: google?.error_message || `Google Elevation a répondu « ${google?.status || 'sans statut'} ».`,
        code: google?.status || 'GOOGLE_ELEVATION_ERROR',
      }, google?.status === 'REQUEST_DENIED' ? 403 : 502);
    }

    if (google.results.length !== points.length) {
      return json({
        error: `Google a renvoyé ${google.results.length} altitudes pour ${points.length} points.`,
        code: 'TAILLE_INATTENDUE',
      }, 502);
    }

    return json({
      provider: 'google-elevation',
      // resolution : distance en mètres entre les échantillons du modèle
      // d'altitude. Elle dit la finesse réelle du terrain sous le point, et
      // vaut d'être remontée : un relief mesuré à 600 m de résolution ne dit
      // pas la même chose qu'un relief mesuré à 10 m.
      elevations: google.results.map((r) => ({
        elevationM: Number(r.elevation),
        resolutionM: Number(r.resolution),
      })),
      pointsDemandes: points.length,
    });
  },
};
