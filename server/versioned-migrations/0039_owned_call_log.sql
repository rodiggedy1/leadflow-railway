ALTER TABLE `call_log`
  ADD COLUMN IF NOT EXISTS `leadflowJobId` int NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_call_log_leadflow_job`
  ON `call_log` (`leadflowJobId`);
