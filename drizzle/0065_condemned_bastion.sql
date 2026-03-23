CREATE TABLE `field_mgmt_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerJobId` int NOT NULL,
	`step` enum('pre_job_reminder','client_on_the_way','arrived_checkin','mid_job_nudge','completion_flow','exception_sms','exception_call','noshow_alert') NOT NULL,
	`success` int NOT NULL DEFAULT 0,
	`errorDetail` text,
	`smsSent` text,
	`recipientPhone` varchar(30),
	`firedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `field_mgmt_log_id` PRIMARY KEY(`id`)
);
