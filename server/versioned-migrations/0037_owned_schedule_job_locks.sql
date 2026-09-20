ALTER TABLE `schedule_job_locks`
  MODIFY COLUMN `jobId` int NULL;
--> statement-breakpoint
ALTER TABLE `schedule_job_locks`
  ADD COLUMN IF NOT EXISTS `leadflowJobId` int NULL;
--> statement-breakpoint
ALTER TABLE `schedule_job_locks`
  ADD COLUMN IF NOT EXISTS `teamId` int NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_schedule_job_locks_leadflow_job_date`
  ON `schedule_job_locks` (`leadflowJobId`, `date`);
