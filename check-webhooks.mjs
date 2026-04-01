import { config } from 'dotenv';
config();

const key = process.env.OPENPHONE_API_KEY;
const csId = process.env.OPENPHONE_CS_PHONE_NUMBER_ID;
console.log('OPENPHONE_API_KEY present:', !!key);
console.log('OPENPHONE_CS_PHONE_NUMBER_ID:', csId);

const res = await fetch('https://api.openphone.com/v1/webhooks', {
  headers: { Authorization: key }
});
const data = await res.json();
console.log('\n=== Registered Webhooks ===');
console.log(JSON.stringify(data, null, 2));
