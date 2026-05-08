CREATE TABLE `team_day_lock` (
	`id` int AUTO_INCREMENT NOT NULL,
	`teamId` int NOT NULL,
	`date` varchar(20) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `team_day_lock_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_team_day_lock` UNIQUE(`teamId`,`date`)
);
