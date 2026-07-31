-- Mission Engine: add new columns to cs_missions for typed, participant-aware missions
-- All ADDs use IF NOT EXISTS so this is safe to re-run

ALTER TABLE `cs_missions`
  ADD COLUMN IF NOT EXISTS `missionType` VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS `jobId` BIGINT NULL,
  ADD COLUMN IF NOT EXISTS `cleanerPhone` VARCHAR(32) NULL,
  ADD COLUMN IF NOT EXISTS `cleanerName` VARCHAR(160) NULL,
  ADD COLUMN IF NOT EXISTS `customerPhone` VARCHAR(32) NULL,
  ADD COLUMN IF NOT EXISTS `customerName` VARCHAR(160) NULL,
  ADD COLUMN IF NOT EXISTS `activeDedupKey` VARCHAR(128) NULL,
  ADD COLUMN IF NOT EXISTS `failureReason` VARCHAR(255) NULL;
--> statement-breakpoint

-- Add unique index on activeDedupKey (nullable — only one unresolved mission per key)
CREATE UNIQUE INDEX IF NOT EXISTS `uq_cs_mission_active_dedup` ON `cs_missions` (`activeDedupKey`);
--> statement-breakpoint

-- Extend status enum to include 'sending' and 'needs_attention'
-- MySQL requires listing ALL enum values when modifying
ALTER TABLE `cs_missions`
  MODIFY COLUMN `status` ENUM(
    'active',
    'waiting',
    'ready',
    'sending',
    'completed',
    'cancelled',
    'needs_attention'
  ) NOT NULL DEFAULT 'active';
