ALTER TABLE `reactivation_campaigns` ADD `sourceType` varchar(20) DEFAULT 'csv' NOT NULL;--> statement-breakpoint
ALTER TABLE `reactivation_contacts` ADD `completedJobId` int;