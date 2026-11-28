-- LeadFlow STAGING ONLY: fictional quality-record test data (Phase 2). EVERYTHING HERE IS INVENTED.
-- Run in the TiDB SQL Editor against `leadflow_staging` ONLY, after the Phase 2 staging deploy has finished
-- (its migration creates team_quality_incidents). NEVER run this against production.
-- Phone numbers use the fictional 202-555-01xx range; emails use example.com; IDs start at 990001 / 99000001 so
-- they cannot collide with the copied production rows. Remove everything with STEP 3 (cleanup) at the end.
--
-- The quality records below are inserted exactly as each channel's save step writes them ("pending", not yet
-- matched to a visit). Nothing else is done by hand: opening the admin leaderboard for the current week makes the
-- server match, merge and score them automatically. Two are deliberately left for the automatic retry (STEP 2).
-- Load it during the week you test (job dates are 1-5 days before today, so run it on a Tuesday-Saturday).

-- ============================== STEP 1: load ==============================
SET @today = DATE(NOW() - INTERVAL 5 HOUR);                          -- today in US Eastern (winter time)
SET @nowMs = UNIX_TIMESTAMP(NOW()) * 1000;
SET @ws = DATE_FORMAT(DATE_SUB(@today, INTERVAL DAYOFWEEK(@today) - 1 DAY), '%Y-%m-%d');   -- this week's Sunday
SET @d1 = DATE_FORMAT(@today - INTERVAL 1 DAY, '%Y-%m-%d'), @d2 = DATE_FORMAT(@today - INTERVAL 2 DAY, '%Y-%m-%d'),
    @d3 = DATE_FORMAT(@today - INTERVAL 3 DAY, '%Y-%m-%d'), @d4 = DATE_FORMAT(@today - INTERVAL 4 DAY, '%Y-%m-%d'),
    @old = DATE_FORMAT(@today - INTERVAL 25 DAY, '%Y-%m-%d');

-- Two fictional teams: one Launch27 (imported jobs carry its Launch27 team ID), one native (jobs carry its own ID).
INSERT INTO scheduling_teams (id, name, launch27TeamId, isActive) VALUES
  (990001, 'Fictional Team Alba (quality test)', 990101, 1),
  (990002, 'Fictional Team Bravo (quality test)', NULL, 1);

INSERT INTO leadflow_jobs (id, origin, bookingId, launch27BookingId, jobDate, bookingStatus, teamId, customerName, customerPhone, customerEmail, serviceName, jobTotalCents, customerRating) VALUES
  -- Alba (Launch27): five visits this week, plus an older visit 25 days ago.
  (99000001, 'launch27_import', NULL, 99100001, @d4, 'completed', 990101, 'Fict Customer 51', '+12025550151', NULL, 'Standard Cleaning', 16000, 5),
  (99000002, 'launch27_import', NULL, 99100002, @d3, 'completed', 990101, 'Fict Customer 52', '+12025550152', 'fict.customer52@example.com', 'Standard Cleaning', 16000, NULL),
  (99000003, 'launch27_import', NULL, 99100003, @d2, 'completed', 990101, 'Fict Customer 53', '+12025550153', NULL, 'Standard Cleaning', 16000, 2),
  (99000004, 'launch27_import', NULL, 99100004, @old, 'completed', 990101, 'Fict Customer 54', '+12025550154', NULL, 'Deep Cleaning', 30000, NULL),
  (99000005, 'launch27_import', NULL, 99100005, @d2, 'completed', 990101, 'Fict Customer 55', '+12025550155', NULL, 'Standard Cleaning', 16000, 5),
  (99000006, 'launch27_import', NULL, 99100006, @d1, 'completed', 990101, 'Fict Customer 56', '+12025550156', NULL, 'Standard Cleaning', 16000, NULL),
  -- Bravo (native): four visits this week.
  (99000011, 'native_booking', NULL, NULL, @d3, 'assigned', 990002, 'Fict Customer 61', '+12025550161', NULL, 'Standard Cleaning', 16000, 4),
  (99000012, 'native_booking', NULL, NULL, @d3, 'assigned', 990002, 'Fict Customer 62', '+12025550162', NULL, 'Standard Cleaning', 16000, NULL),
  (99000013, 'native_booking', NULL, NULL, @d2, 'assigned', 990002, 'Fict Customer 63', '+12025550163', 'fict.customer63@example.com', 'Standard Cleaning', 16000, NULL),
  (99000015, 'native_booking', NULL, NULL, @d1, 'assigned', 990002, 'Fict Customer 66', '+12025550166', NULL, 'Standard Cleaning', 16000, 5);

-- Quality records as saved by each channel (sourceKey prefix "stgq-" marks them for cleanup).
INSERT INTO team_quality_incidents (primaryId, sourceKey, channel, detector, reportedAtMs, weekStart, customerPhone, customerEmail, customerName,
  evidenceQuote, evidenceText, category, severity, leadflowJobId, attribution, status, recleanStatus, refundStatus, processingStatus, processingError, processingAttempts, createdAtMs, updatedAtMs) VALUES
  -- Text labelled by Claude: cleaning complaint → Alba (counts).
  (NULL, 'sms:stgq-1', 'sms', 'claude_sms', @nowMs - 7200000, @ws, '+12025550151', NULL, 'Fict Customer 51', 'the bathroom was not cleaned', 'Hi, the bathroom was not cleaned at all.', 'cleaning_quality', 'medium', NULL, 'unattributed', 'open', 'requested', 'none', 'pending', NULL, 0, @nowMs, @nowMs),
  -- Email labelled by Claude (matched by email address): team conduct → Alba (counts).
  (NULL, 'email:msg:stgq-2', 'email', 'claude_email', @nowMs - 7000000, @ws, NULL, 'fict.customer52@example.com', 'Fict Customer 52', 'the cleaner was rude', 'The cleaner was rude to my mother.', 'team_service', 'medium', NULL, 'unattributed', 'open', 'none', 'none', 'pending', NULL, 0, @nowMs, @nowMs),
  -- Text from the same customer about the office: separate incident, never counts.
  (NULL, 'sms:stgq-3', 'sms', 'claude_sms', @nowMs - 6800000, @ws, '+12025550152', NULL, 'Fict Customer 52', 'nobody called me back', 'Also nobody called me back from the office.', 'office_service', 'low', NULL, 'unattributed', 'open', 'none', 'none', 'pending', NULL, 0, @nowMs, @nowMs),
  -- Customer call labelled by Claude + the voice tool's own record of the same complaint: one incident → Bravo (counts once).
  (NULL, 'call:vapi:stgq-4', 'call', 'claude_call', @nowMs - 6600000, @ws, '+12025550161', NULL, 'Fict Customer 61', 'the kitchen floor is still sticky', 'Caller: the kitchen floor is still sticky and they missed the stove.', 'cleaning_quality', 'medium', NULL, 'unattributed', 'open', 'none', 'none', 'pending', NULL, 0, @nowMs, @nowMs),
  (NULL, 'call:callback:stgq-5', 'call', 'vapi_complaint_tool', @nowMs - 6590000, @ws, '+12025550161', NULL, 'Fict Customer 61', NULL, 'Issue: kitchen floor sticky, stove missed', 'cleaning_quality', 'medium', NULL, 'unattributed', 'open', 'none', 'none', 'pending', NULL, 0, @nowMs, @nowMs),
  -- Staff call labelled by Claude: a billing complaint → never counts against Bravo.
  (NULL, 'call:openphone:stgq-6', 'call', 'claude_staff_call', @nowMs - 6400000, @ws, '+12025550162', NULL, 'Fict Customer 62', 'I was charged twice', 'Caller: I was charged twice for this week.', 'pricing_billing', 'medium', NULL, 'unattributed', 'open', 'none', 'requested', 'pending', NULL, 0, @nowMs, @nowMs),
  -- Gmail glance "refund request" label with no stated cause: supporting signal only, never counts.
  (NULL, 'email:thread:stgq-7', 'email', 'gmail_glance', @nowMs - 6200000, @ws, NULL, 'fict.customer63@example.com', 'Fict Customer 63', NULL, 'Customer asks for a refund', 'unclassified', 'medium', NULL, 'unattributed', 'open', 'none', 'requested', 'pending', NULL, 0, @nowMs, @nowMs),
  -- Cleaner sign-off marked "issue": a cleaning complaint for that job → Bravo (counts).
  (NULL, 'signoff:job:99000013', 'signoff', 'cleaner_signoff', @nowMs - 6000000, @ws, NULL, NULL, NULL, NULL, 'Sign-off customer response: issue', 'cleaning_quality', 'medium', 99000013, 'unattributed', 'open', 'none', 'none', 'pending', NULL, 0, @nowMs, @nowMs),
  -- A 2-star portal rating (already scored in the ratings metric): a supporting signal that joins the complaint below.
  (NULL, 'rating:job:99000003', 'rating', 'portal_rating', @nowMs - 5800000, @ws, NULL, NULL, NULL, NULL, 'Customer rated the visit 2 of 5.', 'unclassified', 'medium', 99000003, 'unattributed', 'open', 'none', 'none', 'pending', NULL, 0, @nowMs, @nowMs),
  -- A record whose matching FAILED before a server restart: retried automatically by the new server → Alba (counts once, with the rating).
  (NULL, 'sms:stgq-8', 'sms', 'claude_sms', @nowMs - 5600000, @ws, '+12025550153', NULL, 'Fict Customer 53', 'dust everywhere', 'There is dust everywhere, very disappointed.', 'cleaning_quality', 'high', NULL, 'unattributed', 'open', 'none', 'none', 'failed', 'QUALITY_PROCESSING_FAILED', 1, @nowMs, @nowMs),
  -- A complaint about a visit 25 days ago (none in the last 7 days): still matched → Alba (counts).
  (NULL, 'sms:stgq-9', 'sms', 'claude_sms', @nowMs - 5400000, @ws, '+12025550154', NULL, 'Fict Customer 54', 'the oven was never cleaned', 'From my deep clean last month, the oven was never cleaned.', 'cleaning_quality', 'medium', NULL, 'unattributed', 'open', 'none', 'none', 'pending', NULL, 0, @nowMs, @nowMs),
  -- A complaint from a customer whose visit is not in the system yet: stays unmatched until STEP 2 adds the visit.
  (NULL, 'sms:stgq-10', 'sms', 'claude_sms', @nowMs - 5200000, @ws, '+12025550165', NULL, 'Fict Customer 65', 'they skipped the bedroom', 'They skipped the bedroom completely.', 'cleaning_quality', 'medium', NULL, 'unattributed', 'open', 'none', 'none', 'pending', NULL, 0, @nowMs, @nowMs);

-- Expected after opening /admin/team-leaderboard (current week, automatic scores):
--   Alba: 4 counted complaints (text, email, older visit, retried one + rating); Bravo: 2 (call counted once, sign-off).
--   Not counted: the office text and the billing call. The refund-only email label joins the sign-off complaint for the
--   same visit (no extra count); the 2-star rating joins the retried complaint for its visit.
--   One unmatched record (Fict Customer 65), retried automatically.

-- ============================== STEP 2: the retry ==============================
-- The visit for Fict Customer 65 is entered later. Run this, then reload the page: the complaint is matched to
-- Bravo automatically on the next recalculation (Bravo: 3 counted complaints, 5 jobs).
-- INSERT INTO leadflow_jobs (id, origin, bookingId, launch27BookingId, jobDate, bookingStatus, teamId, customerName, customerPhone, serviceName, jobTotalCents)
--   VALUES (99000016, 'native_booking', NULL, NULL, DATE_FORMAT(DATE(NOW() - INTERVAL 5 HOUR) - INTERVAL 1 DAY, '%Y-%m-%d'), 'assigned', 990002, 'Fict Customer 65', '+12025550165', 'Standard Cleaning', 16000);

-- ============================== CHECK (read only) ==============================
-- SELECT t.sourceKey, t.category, t.attribution, t.leadflowJobId, t.teamId, t.primaryId, t.processingStatus, t.attributionNote
--   FROM team_quality_incidents t WHERE t.sourceKey LIKE '%stgq-%' OR t.sourceKey IN ('signoff:job:99000013', 'rating:job:99000003') ORDER BY t.id;

-- ============================== STEP 3: cleanup ==============================
-- DELETE FROM team_quality_incidents WHERE sourceKey LIKE '%stgq-%' OR sourceKey IN ('signoff:job:99000013', 'rating:job:99000003');
-- DELETE FROM leadflow_jobs WHERE id BETWEEN 99000001 AND 99000016;
-- DELETE FROM scheduling_teams WHERE id IN (990001, 990002);
