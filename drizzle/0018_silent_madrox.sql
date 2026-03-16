CREATE TABLE `reactivation_campaigns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`messageTemplate` text NOT NULL,
	`segment` varchar(20) NOT NULL,
	`status` enum('DRAFT','ACTIVE','PAUSED','COMPLETED') NOT NULL DEFAULT 'DRAFT',
	`batchSize` int NOT NULL DEFAULT 50,
	`totalContacts` int NOT NULL DEFAULT 0,
	`sentCount` int NOT NULL DEFAULT 0,
	`repliedCount` int NOT NULL DEFAULT 0,
	`bookedCount` int NOT NULL DEFAULT 0,
	`lastSentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reactivation_campaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reactivation_contacts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignId` int NOT NULL,
	`phone` varchar(20) NOT NULL,
	`phoneRaw` varchar(30),
	`name` varchar(255),
	`firstName` varchar(100),
	`email` varchar(320),
	`lastBookingDate` varchar(20),
	`daysSince` int,
	`bookingCount` int NOT NULL DEFAULT 0,
	`segment` varchar(20),
	`status` enum('PENDING','SENT','REPLIED','BOOKED','OPTED_OUT') NOT NULL DEFAULT 'PENDING',
	`sentAt` timestamp,
	`repliedAt` timestamp,
	`sessionId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reactivation_contacts_id` PRIMARY KEY(`id`)
);
