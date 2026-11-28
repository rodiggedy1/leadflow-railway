-- LeadFlow STAGING ONLY: fictional data for testing Phase 3 team reports. EVERYTHING HERE IS INVENTED.
-- Loaded by team-reports-test-data.sh (one transaction, staging database only). Never run against production.
-- Four fictional teams for the current week (run it Tuesday-Saturday: visits are 1-4 days before today):
--   Alba  English team account, +1 202-555-0171      1 cleaning complaint (counts) + 1 late-arrival complaint (does not)
--   Brisa Spanish team account, +1 202-555-0172      1 cleaning complaint (counts)
--   Cielo team account with NO phone number          skipped, with the reason shown
--   Duna  team account +1 202-555-0199               staging's failure test number: its FIRST text is refused
-- IDs: teams and team accounts 990011-990014, visits 99000101-99000134, quality records "stgr-...".
-- Customer phones use the fictional 202-555-0181..0194 range.

-- ============================== STEP 1: load ==============================
SET @today = DATE(NOW() - INTERVAL 5 HOUR);                          -- today in US Eastern (winter time)
SET @nowMs = UNIX_TIMESTAMP(NOW()) * 1000;
SET @ws = DATE_FORMAT(DATE_SUB(@today, INTERVAL DAYOFWEEK(@today) - 1 DAY), '%Y-%m-%d');   -- this week's Sunday
SET @d1 = DATE_FORMAT(@today - INTERVAL 1 DAY, '%Y-%m-%d'), @d2 = DATE_FORMAT(@today - INTERVAL 2 DAY, '%Y-%m-%d'),
    @d3 = DATE_FORMAT(@today - INTERVAL 3 DAY, '%Y-%m-%d'), @d4 = DATE_FORMAT(@today - INTERVAL 4 DAY, '%Y-%m-%d');
INSERT INTO scheduling_teams (id, name, launch27TeamId, isActive) VALUES
  (990011, 'Fictional Team Alba (report test)', 990111, 1), (990012, 'Fictional Team Brisa (report test)', 990112, 1),
  (990013, 'Fictional Team Cielo (report test)', 990113, 1), (990014, 'Fictional Team Duna (report test)', 990114, 1);
INSERT INTO cleaner_profiles (id, name, phone, language, launch27TeamId, isActive) VALUES
  (990011, 'Fictional Alba account (report test)', '+12025550171', 'en', 990111, 1),
  (990012, 'Fictional Brisa account (report test)', '+12025550172', 'es', 990112, 1),
  (990013, 'Fictional Cielo account (report test)', NULL, 'en', 990113, 1),
  (990014, 'Fictional Duna account (report test)', '+12025550199', 'en', 990114, 1);
INSERT INTO leadflow_jobs (id, origin, bookingId, launch27BookingId, jobDate, bookingStatus, teamId, customerName, customerPhone, serviceName, jobTotalCents, customerRating) VALUES
  (99000101, 'launch27_import', NULL, 99200101, @d4, 'completed', 990111, 'Fict Report Customer 81', '+12025550181', 'Standard Cleaning', 16000, 5),
  (99000102, 'launch27_import', NULL, 99200102, @d3, 'completed', 990111, 'Fict Report Customer 82', '+12025550182', 'Standard Cleaning', 16000, 5),
  (99000103, 'launch27_import', NULL, 99200103, @d2, 'completed', 990111, 'Fict Report Customer 83', '+12025550183', 'Standard Cleaning', 16000, 4),
  (99000104, 'launch27_import', NULL, 99200104, @d1, 'completed', 990111, 'Fict Report Customer 84', '+12025550184', 'Standard Cleaning', 16000, NULL),
  (99000111, 'launch27_import', NULL, 99200111, @d4, 'completed', 990112, 'Fict Report Customer 85', '+12025550185', 'Standard Cleaning', 16000, 5),
  (99000112, 'launch27_import', NULL, 99200112, @d3, 'completed', 990112, 'Fict Report Customer 86', '+12025550186', 'Standard Cleaning', 16000, 5),
  (99000113, 'launch27_import', NULL, 99200113, @d2, 'completed', 990112, 'Fict Report Customer 87', '+12025550187', 'Standard Cleaning', 16000, 5),
  (99000114, 'launch27_import', NULL, 99200114, @d1, 'completed', 990112, 'Fict Report Customer 88', '+12025550188', 'Standard Cleaning', 16000, NULL),
  (99000121, 'launch27_import', NULL, 99200121, @d3, 'completed', 990113, 'Fict Report Customer 89', '+12025550189', 'Standard Cleaning', 16000, 5),
  (99000122, 'launch27_import', NULL, 99200122, @d2, 'completed', 990113, 'Fict Report Customer 90', '+12025550190', 'Standard Cleaning', 16000, NULL),
  (99000123, 'launch27_import', NULL, 99200123, @d1, 'completed', 990113, 'Fict Report Customer 91', '+12025550191', 'Standard Cleaning', 16000, NULL),
  (99000131, 'launch27_import', NULL, 99200131, @d3, 'completed', 990114, 'Fict Report Customer 92', '+12025550192', 'Standard Cleaning', 16000, 5),
  (99000132, 'launch27_import', NULL, 99200132, @d2, 'completed', 990114, 'Fict Report Customer 93', '+12025550193', 'Standard Cleaning', 16000, 5),
  (99000133, 'launch27_import', NULL, 99200133, @d1, 'completed', 990114, 'Fict Report Customer 94', '+12025550194', 'Standard Cleaning', 16000, NULL);
-- ETA sent (portal progress): Alba 3 of 4, Brisa 4 of 4, Cielo 3 of 3, Duna 2 of 3.
INSERT INTO cleaner_portal_job_progress (leadflowJobId, cleanerProfileId, teamId, etaTimestamp, createdAt, updatedAt) VALUES
  (99000101, 990011, 990011, @nowMs, NOW(), NOW()), (99000102, 990011, 990011, @nowMs, NOW(), NOW()), (99000103, 990011, 990011, @nowMs, NOW(), NOW()),
  (99000111, 990012, 990012, @nowMs, NOW(), NOW()), (99000112, 990012, 990012, @nowMs, NOW(), NOW()), (99000113, 990012, 990012, @nowMs, NOW(), NOW()), (99000114, 990012, 990012, @nowMs, NOW(), NOW()),
  (99000121, 990013, 990013, @nowMs, NOW(), NOW()), (99000122, 990013, 990013, @nowMs, NOW(), NOW()), (99000123, 990013, 990013, @nowMs, NOW(), NOW()),
  (99000131, 990014, 990014, @nowMs, NOW(), NOW()), (99000132, 990014, 990014, @nowMs, NOW(), NOW());
-- Photos: Alba 4 of 4, Brisa 3 of 4, Cielo 3 of 3, Duna 3 of 3.
INSERT INTO cleaner_portal_job_photos (leadflowJobId, cleanerProfileId, photoUrl, photoKey, createdAt) VALUES
  (99000101, 990011, 'https://example.invalid/stgr-1.jpg', 'stgr-1', NOW()), (99000102, 990011, 'https://example.invalid/stgr-2.jpg', 'stgr-2', NOW()),
  (99000103, 990011, 'https://example.invalid/stgr-3.jpg', 'stgr-3', NOW()), (99000104, 990011, 'https://example.invalid/stgr-4.jpg', 'stgr-4', NOW()),
  (99000111, 990012, 'https://example.invalid/stgr-5.jpg', 'stgr-5', NOW()), (99000112, 990012, 'https://example.invalid/stgr-6.jpg', 'stgr-6', NOW()),
  (99000113, 990012, 'https://example.invalid/stgr-7.jpg', 'stgr-7', NOW()),
  (99000121, 990013, 'https://example.invalid/stgr-8.jpg', 'stgr-8', NOW()), (99000122, 990013, 'https://example.invalid/stgr-9.jpg', 'stgr-9', NOW()),
  (99000123, 990013, 'https://example.invalid/stgr-10.jpg', 'stgr-10', NOW()),
  (99000131, 990014, 'https://example.invalid/stgr-11.jpg', 'stgr-11', NOW()), (99000132, 990014, 'https://example.invalid/stgr-12.jpg', 'stgr-12', NOW()),
  (99000133, 990014, 'https://example.invalid/stgr-13.jpg', 'stgr-13', NOW());
-- Quality records as each channel saves them ("pending"); the leaderboard matches and scores them automatically.
INSERT INTO team_quality_incidents (primaryId, sourceKey, channel, detector, reportedAtMs, weekStart, customerPhone, customerEmail, customerName,
  evidenceQuote, evidenceText, category, severity, leadflowJobId, attribution, status, recleanStatus, refundStatus, processingStatus, processingError, processingAttempts, createdAtMs, updatedAtMs) VALUES
  -- Alba: cleaning complaint (counts)
  (NULL, 'sms:stgr-1', 'sms', 'claude_sms', @nowMs - 7200000, @ws, '+12025550183', NULL, 'Fict Report Customer 83', 'the kitchen floor is still sticky', 'Hi, the kitchen floor is still sticky after the cleaning.', 'cleaning_quality', 'medium', NULL, 'unattributed', 'open', 'none', 'none', 'pending', NULL, 0, @nowMs, @nowMs),
  -- Alba: late arrival labelled as a cleaning complaint (excluded by the quality rule: arrival/scheduling only)
  (NULL, 'sms:stgr-2', 'sms', 'claude_sms', @nowMs - 7000000, @ws, '+12025550181', NULL, 'Fict Report Customer 81', 'The cleaners arrived two hours late', 'The cleaners arrived two hours late.', 'cleaning_quality', 'medium', NULL, 'unattributed', 'open', 'none', 'none', 'pending', NULL, 0, @nowMs, @nowMs),
  -- Brisa: cleaning complaint (counts)
  (NULL, 'sms:stgr-3', 'sms', 'claude_sms', @nowMs - 6800000, @ws, '+12025550186', NULL, 'Fict Report Customer 86', 'they missed the upstairs bathroom', 'They missed the upstairs bathroom completely.', 'cleaning_quality', 'medium', NULL, 'unattributed', 'open', 'none', 'none', 'pending', NULL, 0, @nowMs, @nowMs),
  -- Duna: "is anyone coming" (team service / arrival: never counts)
  (NULL, 'sms:stgr-4', 'sms', 'claude_sms', @nowMs - 6600000, @ws, '+12025550192', NULL, 'Fict Report Customer 92', 'Is anyone coming today?', 'Is anyone coming today? Nobody is here yet.', 'team_service', 'medium', NULL, 'unattributed', 'open', 'none', 'none', 'pending', NULL, 0, @nowMs, @nowMs);
-- Expected on the Team performance page (current week): Alba 4 jobs, 1 complaint; Brisa 4 jobs, 1 complaint;
-- Cielo 3 jobs, 0; Duna 3 jobs, 0. In "Send team reports": Cielo "Will be skipped: The team account has no phone
-- number."; Brisa in Español; the first send to Duna fails, the next one succeeds.

-- ============================== STEP 2: cleanup ==============================
-- DELETE FROM team_weekly_reports WHERE teamId BETWEEN 990011 AND 990014;
-- DELETE FROM team_quality_incidents WHERE sourceKey LIKE '%stgr-%';
-- DELETE FROM cleaner_portal_job_photos WHERE leadflowJobId BETWEEN 99000101 AND 99000134;
-- DELETE FROM cleaner_portal_job_progress WHERE leadflowJobId BETWEEN 99000101 AND 99000134;
-- DELETE FROM leadflow_jobs WHERE id BETWEEN 99000101 AND 99000134;
-- DELETE FROM cleaner_profiles WHERE id BETWEEN 990011 AND 990014;
-- DELETE FROM scheduling_teams WHERE id BETWEEN 990011 AND 990014;
