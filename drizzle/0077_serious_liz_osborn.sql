CREATE TABLE `cleaner_job_custom_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerJobId` int NOT NULL,
	`customPayRuleId` int NOT NULL,
	`appliedAmount` decimal(8,2) NOT NULL,
	`appliedLabel` varchar(128) NOT NULL,
	`appliedType` varchar(16) NOT NULL,
	`appliedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cleaner_job_custom_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `custom_pay_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`label` varchar(128) NOT NULL,
	`type` varchar(16) NOT NULL DEFAULT 'bonus',
	`amount` decimal(8,2) NOT NULL,
	`description` varchar(256),
	`isActive` tinyint NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `custom_pay_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_cjcr_cleaner_job` ON `cleaner_job_custom_rules` (`cleanerJobId`);