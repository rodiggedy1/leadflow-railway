CREATE TABLE `gmail_thread_meta` (
	`id` int AUTO_INCREMENT NOT NULL,
	`threadId` varchar(255) NOT NULL,
	`isIssue` int NOT NULL DEFAULT 0,
	`issueSummary` text,
	`flaggedBy` varchar(64),
	`flaggedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gmail_thread_meta_id` PRIMARY KEY(`id`),
	CONSTRAINT `gmail_thread_meta_threadId_unique` UNIQUE(`threadId`)
);
