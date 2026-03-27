CREATE TABLE `ops_chat_reads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`callerId` varchar(128) NOT NULL,
	`callerName` varchar(128) NOT NULL,
	`channel` varchar(64),
	`cleanerJobId` int,
	`lastReadMessageId` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ops_chat_reads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_ocr_caller` ON `ops_chat_reads` (`callerId`);--> statement-breakpoint
CREATE INDEX `idx_ocr_channel` ON `ops_chat_reads` (`channel`);--> statement-breakpoint
CREATE INDEX `idx_ocr_job` ON `ops_chat_reads` (`cleanerJobId`);