CREATE TABLE `conversation_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`leadPhone` varchar(30) NOT NULL,
	`leadName` varchar(255),
	`stage` enum('QUOTE_SENT','AVAILABILITY','SLOT_CHOICE','ADDRESS','CONFIRMATION','CALL_SCHEDULED','DONE','UNHANDLED') NOT NULL DEFAULT 'QUOTE_SENT',
	`quotedPrice` varchar(20),
	`serviceType` varchar(100),
	`bedrooms` varchar(50),
	`bathrooms` varchar(50),
	`selectedSlot` varchar(100),
	`address` text,
	`callPreference` varchar(50),
	`messageHistory` varchar(5000) NOT NULL DEFAULT '[]',
	`quoteLeadId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `conversation_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `conversation_sessions_leadPhone_unique` UNIQUE(`leadPhone`)
);
