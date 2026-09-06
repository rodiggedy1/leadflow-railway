CREATE TABLE IF NOT EXISTS `cleaner_portal_job_signoffs` (
  `id` int AUTO_INCREMENT NOT NULL,
  `leadflowJobId` int NOT NULL,
  `cleanerProfileId` int NOT NULL,
  `teamId` int NOT NULL,
  `signatureUrl` varchar(1024),
  `customerResponse` varchar(16),
  `customerNotes` text,
  `customerNotHome` tinyint NOT NULL DEFAULT 0,
  `signedOffAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cleaner_portal_job_signoff_job` (`leadflowJobId`),
  KEY `idx_cleaner_portal_job_signoff_team` (`teamId`)
);
