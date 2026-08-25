process.env.GOOGLE_MAPS_API_KEY = 'test';
const mock = {
  routes: [{
    distanceMeters: 1000,
    duration: '120s',
    staticDuration: '100s',
    polyline: { geoJsonLinestring: { type: 'LineString', coordinates: [[55.45,-20.89],[55.46,-20.88]] } },
    legs: [{ steps: [{
      distanceMeters: 1000,
      staticDuration: '100s',
      polyline: { geoJsonLinestring: { type: 'LineString', coordinates: [[55.45,-20.89],[55.46,-20.88]] } },
    }] }],
  }],
};
globalThis.fetch = async () => new Response(JSON.stringify(mock), { status: 200, headers: { 'content-type': 'application/json' } });
const mod = await import('./api/route.js');
const request = new Request('https://radius.test/api/route', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ origin: {lat:-20.89,lng:55.45}, destination:{lat:-20.88,lng:55.46}, departureMs: Date.now()+3600000 }),
});
const response = await mod.default.fetch(request);
const out = await response.json();
if (response.status !== 200) throw new Error(JSON.stringify(out));
if (out.provider !== 'google-routes') throw new Error('provider');
if (Math.abs(out.trafficFactor - 1.2) > 1e-9) throw new Error('trafficFactor');
if (out.geometry.length !== 2 || out.steps.length !== 1) throw new Error('geometry');
console.log('PASS mock /api/route', out.trafficFactor, out.trafficBasis);
