ALTER TABLE `gmail_thread_meta` ADD `assignedToId` int;--> statement-breakpoint
ALTER TABLE `gmail_thread_meta` ADD `assignedToName` varchar(255);--> statement-breakpoint
ALTER TABLE `gmail_thread_meta` ADD `assignedToPhotoUrl` varchar(1024);--> statement-breakpoint
ALTER TABLE `gmail_thread_meta` ADD `assignedAt` timestamp;