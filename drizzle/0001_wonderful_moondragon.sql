CREATE TABLE `team_day_config` (
	`id` int AUTO_INCREMENT NOT NULL,
	`teamId` int NOT NULL,
	`date` varchar(20) NOT NULL,
	`maxJobs` int,
	`earliestStartTime` varchar(5),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `team_day_config_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_team_day_config` UNIQUE(`teamId`,`date`)
);
