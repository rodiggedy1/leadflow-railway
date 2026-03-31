CREATE TABLE `interview_chunks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` varchar(128) NOT NULL,
	`chunkIndex` int NOT NULL,
	`s3Key` varchar(512) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `interview_chunks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_ichunk_session` ON `interview_chunks` (`sessionId`);