ALTER TABLE `confirmation_calls`
  MODIFY COLUMN `cleanerJobId` int NULL;
--> statement-breakpoint
ALTER TABLE `confirmation_calls`
  ADD COLUMN IF NOT EXISTS `leadflowJobId` int NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cc_leadflow_job_id`
  ON `confirmation_calls` (`leadflowJobId`);
