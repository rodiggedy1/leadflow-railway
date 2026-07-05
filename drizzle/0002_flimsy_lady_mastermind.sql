CREATE TABLE `issue_engine` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`issueType` enum('late_team','refund_request','angry_customer','no_show','access_problem','payment_problem','reschedule_needed','broken_item','manager_review','internal_task','other') NOT NULL DEFAULT 'other',
	`severity` enum('critical','high','medium','low') NOT NULL DEFAULT 'medium',
	`status` enum('open','waiting','resolved') NOT NULL DEFAULT 'open',
	`ownerName` varchar(128),
	`waitingOn` varchar(128),
	`notes` text,
	`relatedSessionId` int,
	`relatedJobId` int,
	`createdByName` varchar(128) NOT NULL,
	`lastActivityAt` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`resolvedAt` bigint,
	CONSTRAINT `issue_engine_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `issue_engine_timeline` (
	`id` int AUTO_INCREMENT NOT NULL,
	`issueId` int NOT NULL,
	`event` varchar(512) NOT NULL,
	`actor` varchar(128) NOT NULL DEFAULT 'system',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `issue_engine_timeline_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_ie_status` ON `issue_engine` (`status`);--> statement-breakpoint
CREATE INDEX `idx_ie_session` ON `issue_engine` (`relatedSessionId`);--> statement-breakpoint
CREATE INDEX `idx_iet_issue` ON `issue_engine_timeline` (`issueId`);