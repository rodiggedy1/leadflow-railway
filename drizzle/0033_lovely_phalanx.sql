CREATE TABLE `callback_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`voiceCallId` int,
	`sessionId` int,
	`callerPhone` varchar(30) NOT NULL,
	`callerName` varchar(128),
	`preferredCallbackTime` varchar(255),
	`notes` text,
	`completed` int NOT NULL DEFAULT 0,
	`completedByAgentName` varchar(128),
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `callback_tasks_id` PRIMARY KEY(`id`)
);
