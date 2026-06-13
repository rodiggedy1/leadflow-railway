/**
 * Directly calls Google Distance Matrix for Consuelo Alba's job pairs
 * to verify what Google actually returns for these coordinates.
 */
import dotenv from 'dotenv';
dotenv.config();

const MAPS_API_URL = process.env.BUILT_IN_FORGE_API_URL;
const MAPS_API_KEY = process.env.BUILT_IN_FORGE_API_KEY;

async function makeRequest(path, params) {
  const url = new URL(path, MAPS_API_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${MAPS_API_KEY}` }
  });
  return res.json();
}

// Consuelo Alba's jobs in UI order (by serviceDateTime):
// Perry Thurston:      (38.9232032, -76.9943223)  8:30 AM
// Stevie Hamilton:     (38.7336476, -77.0970688)  11:00 AM
// Andria Hayes-Birchler: (38.9668118, -77.0239818) 2:30 PM
// Denise JONES:        (38.938913,  -77.0337619)  4:00 PM

const pairs = [
  { name: 'Perry→Stevie', from: '38.9232032,-76.9943223', to: '38.7336476,-77.0970688' },
  { name: 'Stevie→Andria', from: '38.7336476,-77.0970688', to: '38.9668118,-77.0239818' },
  { name: 'Andria→Denise', from: '38.9668118,-77.0239818', to: '38.938913,-77.0337619' },
];

for (const p of pairs) {
  const result = await makeRequest('/maps/api/distancematrix/json', {
    origins: p.from,
    destinations: p.to,
    mode: 'driving',
    units: 'metric',
  });
  const el = result?.rows?.[0]?.elements?.[0];
  const secs = el?.duration?.value ?? 0;
  const mins = Math.round(secs / 60);
  const dist = el?.distance?.text ?? '?';
  console.log(`${p.name}: ${mins}m (${dist}) status=${el?.status}`);
}
