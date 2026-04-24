CREATE TABLE `metrics_ai_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`range` varchar(10) NOT NULL DEFAULT '12m',
	`alertsJson` text NOT NULL,
	`generatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `metrics_ai_alerts_id` PRIMARY KEY(`id`)
);
