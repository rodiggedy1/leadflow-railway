-- STAGING ONLY: remove the fictional booking-change test data (and anything the tests changed on it).
-- Choose the leadflow_staging database, then run the steps ONE AT A TIME. Every step changes 0 rows unless the current
-- database is leadflow_staging, and only touches rows carrying the test markers.

-- ===== Step 1: Check. Expected: current_database = leadflow_staging.
SELECT DATABASE() AS current_database;

-- ===== Step 2: Remove test proposals.
DELETE FROM ops_chat_messages WHERE DATABASE() = 'leadflow_staging' AND activeDedupKey IN (SELECT k FROM (SELECT CONCAT('claude-booking-action:v1:', id) AS k FROM ops_chat_messages WHERE activeDedupKey LIKE 'staging-test-task:%') AS t);

-- ===== Step 3: Remove test tasks.
DELETE FROM ops_chat_messages WHERE DATABASE() = 'leadflow_staging' AND activeDedupKey LIKE 'staging-test-task:%';

-- ===== Step 4: Remove test visits.
DELETE FROM leadflow_jobs WHERE DATABASE() = 'leadflow_staging' AND bookingId IN (SELECT id FROM (SELECT id FROM bookings WHERE publicBookingNumber LIKE 'STG-TEST-%') AS t);

-- ===== Step 5: Remove test series.
DELETE FROM booking_series WHERE DATABASE() = 'leadflow_staging' AND bookingId IN (SELECT id FROM (SELECT id FROM bookings WHERE publicBookingNumber LIKE 'STG-TEST-%') AS t);

-- ===== Step 6: Remove test bookings.
DELETE FROM bookings WHERE DATABASE() = 'leadflow_staging' AND publicBookingNumber LIKE 'STG-TEST-%';

-- ===== Step 7: Remove test conversations.
DELETE FROM conversation_sessions WHERE DATABASE() = 'leadflow_staging' AND leadName LIKE '% (Staging Test)' AND leadPhone IN ('+12025550101', '+12025550102', '+12025550103', '+12025550104');

-- ===== Step 8: Check. Expected: 0 and 0.
SELECT (SELECT COUNT(*) FROM bookings WHERE publicBookingNumber LIKE 'STG-TEST-%') AS test_bookings_left,
  (SELECT COUNT(*) FROM ops_chat_messages WHERE activeDedupKey LIKE 'staging-test-task:%') AS test_tasks_left;
