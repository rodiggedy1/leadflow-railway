-- Drop the unique constraint on vapiCallId in confirmation_calls.
-- This column is NULL for all SMS-only rows, and MySQL treats each NULL as unique,
-- causing every insert after the first to fail with a duplicate key error.
ALTER TABLE `confirmation_calls` DROP INDEX IF EXISTS `confirmation_calls_vapiCallId_unique`;
