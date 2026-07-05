ALTER TABLE `cleaner_jobs` ADD `extras` text;--> statement-breakpoint
ALTER TABLE `cleaner_jobs` ADD `customerResponse` varchar(50);--> statement-breakpoint
ALTER TABLE `cleaner_jobs` ADD `customerNotHome` tinyint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `job_photos` ADD `photoType` varchar(20) DEFAULT 'general' NOT NULL;