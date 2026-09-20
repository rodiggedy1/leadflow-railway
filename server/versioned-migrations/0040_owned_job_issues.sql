ALTER TABLE `job_issues`
  MODIFY COLUMN `cleanerJobId` int NULL;
--> statement-breakpoint
ALTER TABLE `job_issues`
  ADD COLUMN IF NOT EXISTS `leadflowJobId` int NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_job_issues_leadflow_job_date`
  ON `job_issues` (`leadflowJobId`, `jobDate`);
