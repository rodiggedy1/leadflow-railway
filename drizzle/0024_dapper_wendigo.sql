CREATE TABLE `always_on_enrollments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`completedJobId` int NOT NULL,
	`phone` varchar(20) NOT NULL,
	`firstName` varchar(100),
	`name` varchar(255),
	`frequency` varchar(100),
	`lastBookingPrice` int,
	`discountPct` int NOT NULL DEFAULT 10,
	`status` enum('PENDING','SENT','REPLIED','BOOKED','OPTED_OUT','SKIPPED') NOT NULL DEFAULT 'PENDING',
	`sentAt` timestamp,
	`repliedAt` timestamp,
	`sessionId` int,
	`jobDate` varchar(20),
	`enrolledAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `always_on_enrollments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `always_on_groups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupType` varchar(30) NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` text,
	`isActive` int NOT NULL DEFAULT 1,
	`messageTemplate` text NOT NULL,
	`batchSize` int NOT NULL DEFAULT 25,
	`totalEnrolled` int NOT NULL DEFAULT 0,
	`sentCount` int NOT NULL DEFAULT 0,
	`repliedCount` int NOT NULL DEFAULT 0,
	`bookedCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `always_on_groups_id` PRIMARY KEY(`id`),
	CONSTRAINT `always_on_groups_groupType_unique` UNIQUE(`groupType`)
);
