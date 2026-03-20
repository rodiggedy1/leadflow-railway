CREATE TABLE `cleaner_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`completedJobId` int NOT NULL,
	`cleanerProfileId` int NOT NULL,
	`cleanerName` varchar(255) NOT NULL,
	`jobDate` varchar(20) NOT NULL,
	`jobRevenue` varchar(20),
	`payPercent` varchar(10),
	`basePay` varchar(20),
	`customerRating` int,
	`missedSomething` int,
	`photoSubmitted` int NOT NULL DEFAULT 0,
	`ratingAdjustment` varchar(20),
	`streakBonus` varchar(20),
	`finalPay` varchar(20),
	`flagged` int NOT NULL DEFAULT 0,
	`adminNotes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cleaner_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cleaner_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`phone` varchar(20),
	`email` varchar(320),
	`payPercent` varchar(10),
	`isActive` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cleaner_profiles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cleaner_streaks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerProfileId` int NOT NULL,
	`currentStreak` int NOT NULL DEFAULT 0,
	`bestStreak` int NOT NULL DEFAULT 0,
	`streakBonusCount` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cleaner_streaks_id` PRIMARY KEY(`id`),
	CONSTRAINT `cleaner_streaks_cleanerProfileId_unique` UNIQUE(`cleanerProfileId`)
);
--> statement-breakpoint
CREATE TABLE `job_photos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerJobId` int NOT NULL,
	`completedJobId` int NOT NULL,
	`cleanerProfileId` int NOT NULL,
	`photoUrl` varchar(1024) NOT NULL,
	`photoKey` varchar(512) NOT NULL,
	`filename` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `job_photos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rating_sms_pending` (
	`id` int AUTO_INCREMENT NOT NULL,
	`completedJobId` int NOT NULL,
	`cleanerJobId` int,
	`customerPhone` varchar(20) NOT NULL,
	`customerFirstName` varchar(100),
	`cleanerName` varchar(255),
	`jobDate` varchar(20) NOT NULL,
	`smsText` text NOT NULL,
	`status` enum('pending','approved','sent','skipped') NOT NULL DEFAULT 'pending',
	`approvedAt` timestamp,
	`sentAt` timestamp,
	`approvedBy` varchar(255),
	`skipReason` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rating_sms_pending_id` PRIMARY KEY(`id`)
);
