import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({ path: '/home/ubuntu/leadflow-quote-form/.env' });

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const [fml] = await conn.execute(
  'SELECT id, step, smsSent, success, openPhoneMessageId, deliveryStatus, firedAt FROM field_mgmt_log WHERE cleanerJobId = 720012'
);
console.log('fieldMgmtLog rows:', fml.length);
for (const r of fml) {
  console.log(' step:', r.step, '| hasSms:', !!r.smsSent, '| msgId:', r.openPhoneMessageId, '| delivery:', r.deliveryStatus);
}

const [smsCols] = await conn.execute('DESCRIBE job_sms_replies');
console.log('\njob_sms_replies columns:', smsCols.map(c => c.Field).join(', '));

const [sms] = await conn.execute(
  'SELECT id, senderType, body, openPhoneMessageId, deliveryStatus, receivedAt FROM job_sms_replies WHERE cleanerJobId = 720012'
);
console.log('job_sms_replies rows:', sms.length);
for (const r of sms) {
  console.log(' senderType:', r.senderType, '| msgId:', r.openPhoneMessageId, '| delivery:', r.deliveryStatus, '| body:', r.body?.slice(0, 60));
}

await conn.end();
