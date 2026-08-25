const GOOGLE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

const FIELD_MASK = [
  'routes.distanceMeters',
  'routes.duration',
  'routes.staticDuration',
  'routes.polyline.geoJsonLinestring',
  'routes.legs.steps.distanceMeters',
  'routes.legs.steps.staticDuration',
  'routes.legs.steps.polyline.geoJsonLinestring',
].join(',');

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
  return p
    && nombreValide(Number(p.lat), -90, 90)
    && nombreValide(Number(p.lng), -180, 180);
}

function secondes(duree) {
  if (typeof duree !== 'string' || !duree.endsWith('s')) return 0;
  const n = Number(duree.slice(0, -1));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function coordonnees(polyline) {
  const c = polyline?.geoJsonLinestring?.coordinates;
  if (!Array.isArray(c)) return [];
  return c
    .filter((p) => Array.isArray(p) && p.length >= 2
      && nombreValide(Number(p[1]), -90, 90)
      && nombreValide(Number(p[0]), -180, 180))
    .map(([lng, lat]) => [Number(lat), Number(lng)]);
}

function dateGoogle(departureMs) {
  const n = Number(departureMs);
  if (!Number.isFinite(n)) return { value: null, basis: 'NOW' };

  // Google n'accepte pas une heure de départ passée pour DRIVE. Une saisie
  // à la minute près peut déjà être légèrement derrière l'horloge serveur :
  // dans ce cas on laisse Google utiliser « maintenant » au lieu d'échouer.
  if (n <= Date.now() + 30_000) return { value: null, basis: 'NOW' };
  return { value: new Date(n).toISOString(), basis: 'REQUESTED_DEPARTURE' };
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') {
      return json({ error: 'Méthode non autorisée.' }, 405);
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return json({
        error: 'Google Routes n’est pas configuré sur le serveur.',
        code: 'GOOGLE_KEY_MISSING',
      }, 503);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Corps JSON invalide.' }, 400);
    }

    const origin = body?.origin;
    const destination = body?.destination;
    if (!pointValide(origin) || !pointValide(destination)) {
      return json({ error: 'Coordonnées de départ ou d’arrivée invalides.' }, 400);
    }

    const depart = dateGoogle(body?.departureMs);
    const payload = {
      origin: {
        location: {
          latLng: {
            latitude: Number(origin.lat),
            longitude: Number(origin.lng),
          },
        },
      },
      destination: {
        location: {
          latLng: {
            latitude: Number(destination.lat),
            longitude: Number(destination.lng),
          },
        },
      },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
      trafficModel: 'BEST_GUESS',
      polylineQuality: 'HIGH_QUALITY',
      polylineEncoding: 'GEO_JSON_LINESTRING',
      languageCode: 'fr-FR',
      units: 'METRIC',
    };
    if (depart.value) payload.departureTime = depart.value;

    let response;
    try {
      response = await fetch(GOOGLE_ROUTES_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify(payload),
      });
    } catch {
      return json({
        error: 'Impossible de joindre Google Routes.',
        code: 'GOOGLE_NETWORK_ERROR',
      }, 502);
    }

    let google;
    try {
      google = await response.json();
    } catch {
      return json({
        error: 'Réponse Google Routes illisible.',
        code: 'GOOGLE_BAD_RESPONSE',
      }, 502);
    }

    if (!response.ok) {
      return json({
        error: google?.error?.message || 'Google Routes a refusé la requête.',
        code: google?.error?.status || 'GOOGLE_ROUTES_ERROR',
      }, response.status >= 400 && response.status < 600 ? response.status : 502);
    }

    const route = google?.routes?.[0];
    if (!route) {
      return json({ error: 'Aucun itinéraire routier trouvé par Google.', code: 'NO_ROUTE' }, 404);
    }

    const geometry = coordonnees(route.polyline);
    const steps = (route.legs || []).flatMap((leg) => (leg.steps || []).map((step) => ({
      distanceMeters: Number(step.distanceMeters) || 0,
      staticDurationSeconds: secondes(step.staticDuration),
      coordinates: coordonnees(step.polyline),
    }))).filter((step) => step.coordinates.length >= 2);

    const durationSeconds = secondes(route.duration);
    const staticDurationSeconds = secondes(route.staticDuration);
    const trafficFactor = staticDurationSeconds > 0
      ? durationSeconds / staticDurationSeconds
      : 1;

    if (geometry.length < 2 && !steps.length) {
      return json({
        error: 'Google a retourné un trajet sans géométrie exploitable.',
        code: 'NO_GEOMETRY',
      }, 502);
    }

    return json({
      provider: 'google-routes',
      routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
      trafficModel: 'BEST_GUESS',
      trafficBasis: depart.basis,
      requestedDepartureMs: Number.isFinite(Number(body?.departureMs))
        ? Number(body.departureMs) : null,
      googleDepartureTime: depart.value,
      distanceMeters: Number(route.distanceMeters) || 0,
      durationSeconds,
      staticDurationSeconds,
      trafficFactor: Number.isFinite(trafficFactor) && trafficFactor > 0 ? trafficFactor : 1,
      geometry,
      steps,
    });
  },
};
