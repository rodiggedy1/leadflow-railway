CREATE TABLE IF NOT EXISTS `cleaner_portal_job_photos` (
  `id` int AUTO_INCREMENT NOT NULL,
  `leadflowJobId` int NOT NULL,
  `cleanerProfileId` int NOT NULL,
  `photoUrl` varchar(1024) NOT NULL,
  `photoKey` varchar(512) NOT NULL,
  `thumbnailUrl` varchar(1024),
  `thumbnailKey` varchar(512),
  `filename` varchar(255),
  `photoType` varchar(20) NOT NULL DEFAULT 'general',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_cleaner_portal_job_photos_leadflow_job` (`leadflowJobId`),
  KEY `idx_cleaner_portal_job_photos_cleaner` (`cleanerProfileId`)
);
