-- Reset all confirmation_calls rows stuck in 'fired' status back to 'pending'.
-- These were stuck because the status was never updated after SMS send (now fixed in server code).
UPDATE `confirmation_calls` SET `status` = 'pending' WHERE `status` = 'fired';
