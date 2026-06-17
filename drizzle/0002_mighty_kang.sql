CREATE TABLE `ai_call_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scenario` varchar(64) NOT NULL,
	`audience` varchar(16) NOT NULL,
	`title` varchar(128) NOT NULL,
	`body` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_call_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_act_scenario_audience` UNIQUE(`scenario`,`audience`)
);
