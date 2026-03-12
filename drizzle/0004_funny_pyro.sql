CREATE TABLE `lead_call_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`agentId` int NOT NULL,
	`agentName` varchar(255) NOT NULL,
	`outcome` enum('ANSWERED','NO_ANSWER','VOICEMAIL','BUSY','BOOKED','CALLBACK') NOT NULL,
	`notes` text,
	`calledAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lead_call_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `assignedAgentId` int;--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `assignedAgentName` varchar(255);--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `lastCalledAt` timestamp;--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `lastCalledByAgentId` int;--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `lastCalledByAgentName` varchar(255);--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `isBooked` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `bookedAt` timestamp;--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `bookedByAgentId` int;--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `bookedByAgentName` varchar(255);