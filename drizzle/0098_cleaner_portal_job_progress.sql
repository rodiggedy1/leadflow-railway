CREATE TABLE IF NOT EXISTS `cleaner_portal_job_progress` (
  `id` int AUTO_INCREMENT NOT NULL,
  `leadflowJobId` int NOT NULL,
  `cleanerProfileId` int NOT NULL,
  `teamId` int NOT NULL,
  `jobStatus` varchar(32) NOT NULL DEFAULT 'assigned',
  `etaTimestamp` bigint,
  `etaTimeStr` varchar(32),
  `arrivedAt` datetime(3),
  `startedAt` datetime(3),
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  CONSTRAINT `cleaner_portal_job_progress_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_cleaner_portal_job_progress_job` UNIQUE(`leadflowJobId`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cleaner_portal_job_progress_team` ON `cleaner_portal_job_progress` (`teamId`);
