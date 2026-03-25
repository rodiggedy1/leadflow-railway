CREATE TABLE `openphone_call_recordings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`openphoneCallId` varchar(255) NOT NULL,
	`callerPhone` varchar(20) NOT NULL,
	`direction` enum('incoming','outgoing') NOT NULL DEFAULT 'incoming',
	`durationSeconds` int,
	`recordingUrl` text NOT NULL,
	`status` varchar(50) NOT NULL DEFAULT 'completed',
	`callStartedAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `openphone_call_recordings_id` PRIMARY KEY(`id`),
	CONSTRAINT `openphone_call_recordings_openphoneCallId_unique` UNIQUE(`openphoneCallId`)
);
--> statement-breakpoint
CREATE INDEX `idx_ocr_session` ON `openphone_call_recordings` (`sessionId`);--> statement-breakpoint
CREATE INDEX `idx_ocr_call_id` ON `openphone_call_recordings` (`openphoneCallId`);