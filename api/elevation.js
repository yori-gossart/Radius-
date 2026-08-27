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
    && nombreValide(Number(p[0]), -90, 90)
    && nombreValide(Number(p[1]), -180, 180);
}

// Cinq décimales suffisent — environ un mètre — et raccourcissent l'URL.
const enTexte = (p) => `${Number(p[0]).toFixed(5)},${Number(p[1]).toFixed(5)}`;

export default {
  async fetch(request) {
    if (request.method !== 'POST') {
      return json({ error: 'Méthode non autorisée.' }, 405);
    }

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
