CREATE TABLE `message_integrity_checks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`leadName` varchar(255),
	`leadPhone` varchar(50),
	`dbCount` int NOT NULL DEFAULT 0,
	`openphoneCount` int NOT NULL DEFAULT 0,
	`delta` int NOT NULL DEFAULT 0,
	`reconciled` tinyint NOT NULL DEFAULT 0,
	`checkedAt` bigint NOT NULL,
	`firstDetectedAt` bigint,
	CONSTRAINT `message_integrity_checks_id` PRIMARY KEY(`id`)
);
