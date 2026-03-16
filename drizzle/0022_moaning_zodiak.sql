ALTER TABLE `completed_jobs` ADD `email` varchar(320);--> statement-breakpoint
ALTER TABLE `completed_jobs` ADD `address` varchar(500);--> statement-breakpoint
ALTER TABLE `completed_jobs` ADD `frequency` varchar(100);--> statement-breakpoint
ALTER TABLE `completed_jobs` ADD `launch27BookingId` varchar(64);--> statement-breakpoint
ALTER TABLE `completed_jobs` ADD `lastBookingPrice` int;--> statement-breakpoint
ALTER TABLE `completed_jobs` ADD `reactivationEligible` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `completed_jobs` ADD `reactivationEligibleAt` timestamp;