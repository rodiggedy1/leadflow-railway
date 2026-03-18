CREATE TABLE `voice_calls` (
	`id` int AUTO_INCREMENT NOT NULL,
	`vapiCallId` varchar(128) NOT NULL,
	`sessionId` int,
	`callerPhone` varchar(30) NOT NULL,
	`durationSeconds` int NOT NULL DEFAULT 0,
	`transcript` text,
	`summary` text,
	`recordingUrl` varchar(512),
	`outcome` varchar(50) NOT NULL DEFAULT 'no_action',
	`structuredData` text,
	`endedReason` varchar(100),
	`successEvaluation` varchar(10),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `voice_calls_id` PRIMARY KEY(`id`),
	CONSTRAINT `voice_calls_vapiCallId_unique` UNIQUE(`vapiCallId`)
);
