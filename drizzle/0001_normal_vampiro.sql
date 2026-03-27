ALTER TABLE `cleaner_jobs` ADD `reviewChipsSelected` text;--> statement-breakpoint
ALTER TABLE `cleaner_jobs` ADD `reviewDraftPicked` int;--> statement-breakpoint
ALTER TABLE `cleaner_jobs` ADD `reviewCopied` int DEFAULT 0 NOT NULL;