ALTER TABLE `schedule_assignments`
  MODIFY COLUMN `cleanerJobId` int NULL;
--> statement-breakpoint
ALTER TABLE `schedule_assignments`
  MODIFY COLUMN `teamId` int NULL;
--> statement-breakpoint
ALTER TABLE `schedule_assignments`
  ADD COLUMN IF NOT EXISTS `leadflowJobId` int NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_schedule_assignments_leadflow_job_date`
  ON `schedule_assignments` (`leadflowJobId`, `jobDate`);
