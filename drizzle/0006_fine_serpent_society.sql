CREATE TABLE `nurture_enrollments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`leadPhone` varchar(30) NOT NULL,
	`leadFirstName` varchar(100),
	`serviceType` varchar(100),
	`enrolledAt` timestamp NOT NULL DEFAULT (now()),
	`leadCreatedAt` timestamp NOT NULL,
	`nextStep` int NOT NULL DEFAULT 3,
	`nextSendAt` timestamp NOT NULL,
	`status` enum('active','paused','done') NOT NULL DEFAULT 'active',
	`endReason` varchar(32),
	`endedAt` timestamp,
	`lastStepSent` int,
	`lastSentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `nurture_enrollments_id` PRIMARY KEY(`id`)
);
