CREATE TABLE `cleaner_rating_sms_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerPhone` varchar(20) NOT NULL,
	`cleanerJobId` int NOT NULL,
	`cleanerName` varchar(255),
	`rating` int NOT NULL,
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cleaner_rating_sms_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_crsl_phone` ON `cleaner_rating_sms_log` (`cleanerPhone`);--> statement-breakpoint
CREATE INDEX `idx_crsl_job` ON `cleaner_rating_sms_log` (`cleanerJobId`);