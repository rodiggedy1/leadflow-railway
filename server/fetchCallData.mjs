import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env manually
const envPath = resolve('/home/ubuntu/leadflow-quote-form/.env');
let key = '';
try {
  const env = readFileSync(envPath, 'utf8');
  for (const line of env.split('\n')) {
    if (line.startsWith('OPENPHONE_API_KEY=')) {
      key = line.slice('OPENPHONE_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
    }
  }
} catch {}

if (!key) {
  // Try from process env
  key = process.env.OPENPHONE_API_KEY || '';
}

console.log('Key found:', !!key);

// Fetch the real call from the log
const r = await fetch('https://api.openphone.com/v1/calls/AC6a619e1e39ac4f17a838c2c04fa05aef', {
  headers: { Authorization: key }
});
const data = await r.json();
console.log(JSON.stringify(data, null, 2));
