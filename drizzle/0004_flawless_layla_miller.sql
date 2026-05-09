CREATE TABLE `call_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerJobId` int,
	`teamId` int,
	`teamName` varchar(255),
	`clientName` varchar(255),
	`calledPhone` varchar(30),
	`calledTarget` enum('team','client') NOT NULL,
	`templateId` int,
	`templateName` varchar(255),
	`resolvedScript` text NOT NULL,
	`status` enum('pending','fired','completed','failed','no_answer') NOT NULL DEFAULT 'pending',
	`vapiCallId` varchar(128),
	`recordingUrl` varchar(1024),
	`transcript` longtext,
	`jobDate` varchar(20),
	`firedBy` varchar(64),
	`firedAt` bigint,
	`completedAt` bigint,
	`durationSeconds` int,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `call_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `call_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`triggerType` enum('arrival_confirmation','late_team','no_access','parking','delay_update','checkin_reminder','lockout_warning','lockout_final','utility_issue','completion_walkthrough','manual') NOT NULL,
	`targetType` enum('team','client','both') NOT NULL,
	`scriptTemplate` text NOT NULL,
	`isActive` int NOT NULL DEFAULT 1,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `call_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `job_issues` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerJobId` int NOT NULL,
	`jobDate` varchar(20) NOT NULL,
	`issueType` enum('late_team','no_access','parking','delay','lockout','utility_issue','no_checkin','completion','manual') NOT NULL,
	`raisedBy` enum('manual','auto') NOT NULL DEFAULT 'manual',
	`raisedByName` varchar(128),
	`raisedAt` bigint NOT NULL,
	`resolvedAt` bigint,
	`callLogId` int,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `job_issues_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_cl_job_date` ON `call_log` (`jobDate`);--> statement-breakpoint
CREATE INDEX `idx_cl_job_id` ON `call_log` (`cleanerJobId`);--> statement-breakpoint
CREATE INDEX `idx_cl_vapi` ON `call_log` (`vapiCallId`);--> statement-breakpoint
CREATE INDEX `idx_ji_job_date` ON `job_issues` (`cleanerJobId`,`jobDate`);