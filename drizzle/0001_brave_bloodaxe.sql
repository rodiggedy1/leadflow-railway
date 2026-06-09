CREATE TABLE `team_day_override` (
	`id` int AUTO_INCREMENT NOT NULL,
	`teamId` int NOT NULL,
	`date` varchar(20) NOT NULL,
	`isAvailable` tinyint,
	`note` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `team_day_override_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_tdo_team_date` UNIQUE(`teamId`,`date`)
);
--> statement-breakpoint
CREATE TABLE `team_work_schedule` (
	`id` int AUTO_INCREMENT NOT NULL,
	`teamId` int NOT NULL,
	`mon` tinyint NOT NULL DEFAULT 1,
	`tue` tinyint NOT NULL DEFAULT 1,
	`wed` tinyint NOT NULL DEFAULT 1,
	`thu` tinyint NOT NULL DEFAULT 1,
	`fri` tinyint NOT NULL DEFAULT 1,
	`sat` tinyint NOT NULL DEFAULT 0,
	`sun` tinyint NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `team_work_schedule_id` PRIMARY KEY(`id`),
	CONSTRAINT `team_work_schedule_teamId_unique` UNIQUE(`teamId`)
);
