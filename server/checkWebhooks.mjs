import { createRequire } from 'module';
import { readFileSync } from 'fs';

// Load env
const envPath = '/opt/.manus/webdev.sh.env';
let apiKey = '';
try {
  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const m = line.match(/^export OPENPHONE_API_KEY="?([^"]+)"?/);
    if (m) { apiKey = m[1].trim(); break; }
  }
} catch {}

if (!apiKey) {
  // Try process.env
  apiKey = process.env.OPENPHONE_API_KEY || '';
}

console.log('API key present:', !!apiKey, apiKey ? `(${apiKey.slice(0,8)}...)` : '');

const resp = await fetch('https://api.openphone.com/v1/webhooks', {
  headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' }
});
const data = await resp.json();
console.log('Status:', resp.status);
console.log(JSON.stringify(data, null, 2));
