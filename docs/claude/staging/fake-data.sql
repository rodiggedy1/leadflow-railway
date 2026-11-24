-- LeadFlow STAGING fake data. EVERYTHING HERE IS INVENTED.
-- Phone numbers use the fictional 555-01xx range; emails use example.com.
-- Run ONLY against the empty staging database, AFTER staging-base-schema.sql and after the first
-- staging deploy has finished (the deploy's migration runner creates the remaining tables).
-- NEVER run this against production.

-- Invented staging admin, created SWITCHED OFF (isActive = 0). Its password hash belongs to a random value
-- that was thrown away, so nobody can sign in with it, and because it is inactive the one-click
-- /api/preview-login can never use it either. The owner signs in with their own account
-- (docs/claude/STAGING_SETUP.md, Part E).
INSERT INTO agents (name, email, passwordHash, isActive, isAdmin)
VALUES ('Staging Admin', 'staging-admin@example.com', '$2b$10$0r0wwvnpGZXVOQWq.mnBbuuaSWkX3wSg0x/We03UDWRhXhZXmalqW', 0, 1);

INSERT INTO agents (name, email, passwordHash, isActive, isAdmin)
VALUES ('Sam Sample (agent)', 'agent.sample@example.com', '$2b$10$0r0wwvnpGZXVOQWq.mnBbuuaSWkX3wSg0x/We03UDWRhXhZXmalqW', 1, 0);

-- Fake leads / conversations
INSERT INTO conversation_sessions (leadPhone, leadName, stage, serviceType, bedrooms, bathrooms, leadSource, messageHistory, lastMessageText, lastMessageTs, lastCustomerMessageTs, lastMessageRole, messageCount)
VALUES
('+12025550101', 'Alex Example', 'QUOTE_SENT', 'Standard Cleaning', 2, 1, 'Website',
 '[{"role":"user","content":"Hi, how much for a 2 bed 1 bath standard clean?","ts":1764000000000},{"role":"assistant","content":"Hi Alex! A standard clean for a 2 bed / 1 bath starts at $150. Would this Friday work?","ts":1764000060000}]',
 'Hi Alex! A standard clean for a 2 bed / 1 bath starts at $150. Would this Friday work?', 1764000060000, 1764000000000, 'assistant', 2),
('+12025550102', 'Bailey Sample', 'OPEN', 'Deep Cleaning', 3, 2, 'Thumbtack',
 '[{"role":"user","content":"Do you do deep cleans for move-out?","ts":1764003600000}]',
 'Do you do deep cleans for move-out?', 1764003600000, 1764003600000, 'user', 1),
('+12025550103', 'Casey Placeholder', 'BOOKED', 'Standard Cleaning', 1, 1, 'Google',
 '[{"role":"user","content":"Booked for next Tuesday, thanks!","ts":1764007200000},{"role":"assistant","content":"You are all set, Casey. See you Tuesday!","ts":1764007260000}]',
 'You are all set, Casey. See you Tuesday!', 1764007260000, 1764007200000, 'assistant', 2);

-- Fake teams and cleaners
INSERT INTO scheduling_teams (name, color, isActive) VALUES ('Team Demo A', '#2563eb', 1), ('Team Demo B', '#16a34a', 1);
INSERT INTO cleaner_profiles (name, phone, email, isActive) VALUES
('Dana Demo', '+12025550111', 'dana.demo@example.com', 1),
('Evan Example', '+12025550112', 'evan.example@example.com', 1);

-- Fake jobs for today and tomorrow (dates are computed when this file is run)
INSERT INTO leadflow_jobs (origin, jobDate, serviceDateTime, customerName, customerPhone, customerEmail, jobAddress, serviceName, bedrooms, bathrooms, frequency, bookingStatus, teamName, jobTotalCents)
VALUES
('leadflow', DATE_FORMAT(CURDATE(), '%Y-%m-%d'), CONCAT(DATE_FORMAT(CURDATE(), '%Y-%m-%d'), 'T14:00:00.000Z'), 'Alex Example', '+12025550101', 'alex@example.com', '100 Example St, Washington, DC 20001', 'Standard Cleaning', 2, 1, 'One-time', 'assigned', 'Team Demo A', 15000),
('leadflow', DATE_FORMAT(CURDATE(), '%Y-%m-%d'), CONCAT(DATE_FORMAT(CURDATE(), '%Y-%m-%d'), 'T17:00:00.000Z'), 'Casey Placeholder', '+12025550103', 'casey@example.com', '200 Sample Ave, Washington, DC 20002', 'Standard Cleaning', 1, 1, 'Every 2 weeks', 'assigned', 'Team Demo B', 12000),
('leadflow', DATE_FORMAT(CURDATE() + INTERVAL 1 DAY, '%Y-%m-%d'), CONCAT(DATE_FORMAT(CURDATE() + INTERVAL 1 DAY, '%Y-%m-%d'), 'T15:00:00.000Z'), 'Bailey Sample', '+12025550102', 'bailey@example.com', '300 Placeholder Rd, Arlington, VA 22201', 'Deep Cleaning', 3, 2, 'One-time', 'unassigned', NULL, 32000);
