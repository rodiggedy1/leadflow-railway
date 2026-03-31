CREATE TABLE `candidates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`firstName` varchar(128) NOT NULL,
	`lastName` varchar(128) NOT NULL,
	`email` varchar(320),
	`phone` varchar(30) NOT NULL,
	`streetAddress` varchar(255),
	`apt` varchar(64),
	`city` varchar(128),
	`state` varchar(8),
	`zip` varchar(16),
	`hasCleaning` tinyint,
	`hasBankAccount` tinyint,
	`isAuthorized` tinyint,
	`consentBackground` tinyint,
	`experience` text,
	`specialties` text,
	`stage` varchar(64) NOT NULL DEFAULT 'Application Submitted',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `candidates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_cand_phone` ON `candidates` (`phone`);--> statement-breakpoint
CREATE INDEX `idx_cand_stage` ON `candidates` (`stage`);--> statement-breakpoint
CREATE INDEX `idx_cand_created` ON `candidates` (`createdAt`);