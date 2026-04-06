import { readFileSync } from 'fs';

// Load .env manually
try {
  const env = readFileSync('/home/ubuntu/leadflow-quote-form/.env', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
} catch {}

const token = process.env.LAUNCH27_BEARER_TOKEN;
const tenant = process.env.LAUNCH27_TENANT;
const baseUrl = tenant ? `https://${tenant}.launch27.com` : 'https://app.launch27.com';

console.log('Using tenant:', tenant || '(none, using app.launch27.com)');
console.log('Token present:', !!token);

const params = new URLSearchParams({ from: '2026-04-06', to: '2026-04-06', limit: '50', offset: '0', sort: 'asc' });
const url = `${baseUrl}/v1/staff/bookings?${params}`;
console.log('Fetching:', url, '\n');

const res = await fetch(url, {
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' }
});

console.log('HTTP status:', res.status);
const data = await res.json();
console.log('Total bookings:', Array.isArray(data) ? data.length : 'not array');

if (Array.isArray(data)) {
  for (const b of data) {
    const name = b.user?.name || `${b.user?.first_name || ''} ${b.user?.last_name || ''}`.trim();
    const teams = (b.teams || []).map(t => t.title).join(', ') || 'Unassigned';
    const tags = (b.tags || []).map(t => t.name || t).join(', ') || '';
    console.log(`  ID:${b.id} | ${name} | ${b.service_date} | status:${b.booking_status} | ${b.address?.full_address} | Teams:[${teams}] | Tags:[${tags}]`);
  }
} else {
  console.log('Response:', JSON.stringify(data).slice(0, 500));
}
