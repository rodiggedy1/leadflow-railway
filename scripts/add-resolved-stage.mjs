import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const db = await mysql.createConnection(process.env.DATABASE_URL);

// 1. Alter the enum to add RESOLVED (MySQL requires listing ALL values)
const newEnum = [
  'WIDGET_SIZING','REACTIVATION','REACTIVATION_TIME','QUOTE_SENT','AVAILABILITY',
  'SLOT_CHOICE','TIME_PREF','ADDRESS','CONFIRMATION','CALL_SCHEDULED',
  'DONE','RESOLVED','UNHANDLED','BOOKED','NOT_INTERESTED',
  'REVIEW_REQUESTED','REVIEW_DONE','FUTURE_BOOKING','FOLLOW_UP_SCHEDULED',
  'LANGUAGE_CONFIRM','QUALITY_RATING_REQUESTED','QUALITY_MISSED_FOLLOWUP',
  'QUALITY_RATING_DONE','REVIEW_REBOOKING_REQUESTED','REVIEW_REBOOKING_DONE',
  'COLD','LOST','VOICEMAIL','YELP_CONTACTED',
  'INTERVIEW_LINK_SENT','INTERVIEW_NUDGE_1','INTERVIEW_NUDGE_2','INTERVIEW_LINK_DONE',
  'OPEN','HIRING_OUTBOUND',
  'FLOWC_ADDON','FLOWC_DATE','FLOWC_NOTES','FLOWC_QUOTE_SENT',
  'SCHEDULE_CONFIRM_SENT','SCHEDULE_CONFIRM_DONE',
  'CLIENT_STATUS_INQUIRY','CLIENT_STATUS_INQUIRY_DONE',
].map(v => `'${v}'`).join(',');

console.log('Altering stage enum to add RESOLVED...');
await db.execute(`ALTER TABLE conversation_sessions MODIFY COLUMN stage ENUM(${newEnum}) NOT NULL DEFAULT 'QUOTE_SENT'`);
console.log('Enum altered.');

// 2. Flip all existing DONE rows to RESOLVED
const [result] = await db.execute("UPDATE conversation_sessions SET stage = 'RESOLVED' WHERE stage = 'DONE'");
console.log(`Migrated ${result.affectedRows} DONE rows → RESOLVED.`);

await db.end();
console.log('Done.');
