ALTER TABLE `cleaner_jobs` ADD `noEtaArrival` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `cleaner_jobs` ADD `customerComplaint` text;--> statement-breakpoint
ALTER TABLE `cleaner_jobs` ADD `complaintChargeApplied` int DEFAULT 0 NOT NULL;