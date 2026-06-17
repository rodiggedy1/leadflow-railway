ALTER TABLE `cleaner_jobs` ADD `requestedTeam` varchar(255);--> statement-breakpoint
ALTER TABLE `confirmation_calls` ADD `manualOutcome` varchar(32);--> statement-breakpoint
ALTER TABLE `confirmation_calls` ADD `manualOutcomeLabel` varchar(128);--> statement-breakpoint
ALTER TABLE `confirmation_calls` ADD `manualOverrideBy` varchar(64);--> statement-breakpoint
ALTER TABLE `confirmation_calls` ADD `manualOverrideAt` bigint;