CREATE TABLE `system_config` (
	`id` int AUTO_INCREMENT NOT NULL,
	`pausedServices` json NOT NULL DEFAULT ('[]'),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `system_config_id` PRIMARY KEY(`id`)
);
