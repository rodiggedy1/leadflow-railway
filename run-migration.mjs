import { config } from 'dotenv';
config();

import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const sql = `ALTER TABLE \`conversation_sessions\` MODIFY COLUMN \`stage\` enum('WIDGET_SIZING','REACTIVATION','REACTIVATION_TIME','QUOTE_SENT','AVAILABILITY','SLOT_CHOICE','TIME_PREF','ADDRESS','CONFIRMATION','CALL_SCHEDULED','DONE','UNHANDLED','BOOKED','NOT_INTERESTED','REVIEW_REQUESTED','REVIEW_DONE','FUTURE_BOOKING','FOLLOW_UP_SCHEDULED','LANGUAGE_CONFIRM','QUALITY_RATING_REQUESTED','QUALITY_MISSED_FOLLOWUP','QUALITY_RATING_DONE','REVIEW_REBOOKING_REQUESTED','REVIEW_REBOOKING_DONE','COLD','LOST','VOICEMAIL','YELP_CONTACTED','INTERVIEW_LINK_SENT','INTERVIEW_NUDGE_1','INTERVIEW_NUDGE_2','INTERVIEW_LINK_DONE','OPEN') NOT NULL DEFAULT 'QUOTE_SENT'`;

try {
  await conn.execute(sql);
  console.log('✅ Migration applied successfully! OPEN stage added to conversation_sessions.stage enum');
} catch (err) {
  console.error('❌ Migration failed:', err.message);
} finally {
  await conn.end();
}
