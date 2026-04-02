CREATE TABLE `follow_ups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`nextStep` varchar(255) NOT NULL,
	`dueAt` bigint NOT NULL,
	`owner` varchar(100) NOT NULL,
	`type` enum('Lead callback','Customer issue','Reschedule','Voicemail') NOT NULL,
	`priority` enum('High','Normal','Low') NOT NULL DEFAULT 'Normal',
	`internalNote` text,
	`customerFacingMove` text,
	`history` text NOT NULL DEFAULT ('[]'),
	`reminderSentAt` bigint,
	`completedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `follow_ups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_fu_due_at` ON `follow_ups` (`dueAt`);--> statement-breakpoint
CREATE INDEX `idx_fu_completed_at` ON `follow_ups` (`completedAt`);