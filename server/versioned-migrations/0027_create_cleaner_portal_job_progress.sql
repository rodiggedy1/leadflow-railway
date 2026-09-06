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
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cleaner_portal_job_progress_job` (`leadflowJobId`),
  KEY `idx_cleaner_portal_job_progress_team` (`teamId`)
);
