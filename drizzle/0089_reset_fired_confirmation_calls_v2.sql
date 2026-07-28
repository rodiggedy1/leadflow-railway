-- Reset all confirmation_calls rows stuck in 'fired' status back to 'pending'.
-- v2: re-run because 0088 may have already been tracked before rows existed.
UPDATE `confirmation_calls` SET `status` = 'pending' WHERE `status` = 'fired';
