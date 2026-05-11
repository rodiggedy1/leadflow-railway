CREATE TABLE `team_availability_checkins` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerProfileId` int NOT NULL,
	`submittedForDate` varchar(20) NOT NULL,
	`availabilityDate` varchar(20) NOT NULL,
	`isAvailable` tinyint NOT NULL,
	`maxJobs` int,
	`note` text,
	`submittedAt` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `team_availability_checkins_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_tac_cleaner_date` ON `team_availability_checkins` (`cleanerProfileId`,`availabilityDate`);--> statement-breakpoint
CREATE INDEX `idx_tac_avail_date` ON `team_availability_checkins` (`availabilityDate`);