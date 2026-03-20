ALTER TABLE `cleaner_jobs` ADD `bookingId` int;--> statement-breakpoint
ALTER TABLE `cleaner_jobs` ADD `teamName` varchar(255);--> statement-breakpoint
ALTER TABLE `cleaner_jobs` ADD `teamId` int;--> statement-breakpoint
ALTER TABLE `cleaner_jobs` ADD `serviceDateTime` varchar(50);--> statement-breakpoint
ALTER TABLE `cleaner_jobs` ADD `customerName` varchar(255);--> statement-breakpoint
ALTER TABLE `cleaner_jobs` ADD `customerPhone` varchar(30);--> statement-breakpoint
ALTER TABLE `cleaner_jobs` ADD `jobAddress` varchar(500);--> statement-breakpoint
ALTER TABLE `cleaner_jobs` ADD `serviceType` varchar(500);--> statement-breakpoint
ALTER TABLE `cleaner_jobs` ADD `bookingStatus` varchar(50);--> statement-breakpoint
ALTER TABLE `cleaner_jobs` ADD `customerNotes` text;--> statement-breakpoint
ALTER TABLE `cleaner_jobs` ADD `staffNotes` text;