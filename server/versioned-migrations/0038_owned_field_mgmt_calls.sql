ALTER TABLE `field_mgmt_calls`
  MODIFY COLUMN `cleanerJobId` int NULL;
--> statement-breakpoint
ALTER TABLE `field_mgmt_calls`
  ADD COLUMN IF NOT EXISTS `leadflowJobId` int NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_field_mgmt_calls_leadflow_job`
  ON `field_mgmt_calls` (`leadflowJobId`);
