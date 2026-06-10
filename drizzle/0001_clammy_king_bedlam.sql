CREATE TABLE `gmail_sent_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`threadId` varchar(255) NOT NULL,
	`messageId` varchar(255) NOT NULL,
	`agentOpenId` varchar(64) NOT NULL,
	`agentName` text NOT NULL,
	`agentPhotoUrl` text,
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gmail_sent_log_id` PRIMARY KEY(`id`),
	CONSTRAINT `gmail_sent_log_messageId_unique` UNIQUE(`messageId`)
);
