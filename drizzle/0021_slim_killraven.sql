CREATE TABLE `message_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`flowType` enum('reactivation','review') NOT NULL,
	`stepKey` varchar(100) NOT NULL,
	`label` varchar(200) NOT NULL,
	`triggerLabel` varchar(200) NOT NULL,
	`body` text NOT NULL,
	`variables` text,
	`isEditable` int NOT NULL DEFAULT 1,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `message_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `message_templates_stepKey_unique` UNIQUE(`stepKey`)
);
