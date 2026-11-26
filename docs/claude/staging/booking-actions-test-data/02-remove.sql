-- STAGING ONLY: remove the fictional booking-change test data (and anything the tests changed on it).
-- Changes 0 rows unless the current database is leadflow_staging. Touches only rows carrying the test markers.
USE leadflow_staging;
SELECT DATABASE() AS must_be_leadflow_staging;
DELETE FROM ops_chat_messages WHERE DATABASE() = 'leadflow_staging' AND activeDedupKey IN (SELECT k FROM (SELECT CONCAT('claude-booking-action:v1:', id) AS k FROM ops_chat_messages WHERE activeDedupKey LIKE 'staging-test-task:%') AS t);
DELETE FROM ops_chat_messages WHERE DATABASE() = 'leadflow_staging' AND activeDedupKey LIKE 'staging-test-task:%';
DELETE FROM leadflow_jobs WHERE DATABASE() = 'leadflow_staging' AND bookingId IN (SELECT id FROM (SELECT id FROM bookings WHERE publicBookingNumber LIKE 'STG-TEST-%') AS t);
DELETE FROM booking_series WHERE DATABASE() = 'leadflow_staging' AND bookingId IN (SELECT id FROM (SELECT id FROM bookings WHERE publicBookingNumber LIKE 'STG-TEST-%') AS t);
DELETE FROM bookings WHERE DATABASE() = 'leadflow_staging' AND publicBookingNumber LIKE 'STG-TEST-%';
DELETE FROM conversation_sessions WHERE DATABASE() = 'leadflow_staging' AND leadName LIKE '% (Staging Test)' AND leadPhone IN ('+12025550101', '+12025550102', '+12025550103', '+12025550104');

SELECT (SELECT COUNT(*) FROM bookings WHERE publicBookingNumber LIKE 'STG-TEST-%') AS bookings_left,
  (SELECT COUNT(*) FROM ops_chat_messages WHERE activeDedupKey LIKE 'staging-test-task:%') AS tasks_left;
