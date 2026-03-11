CREATE TABLE `quote_leads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(320) NOT NULL,
	`phone` varchar(30) NOT NULL,
	`serviceType` varchar(100) NOT NULL,
	`bedrooms` varchar(50) NOT NULL,
	`bathrooms` varchar(50) NOT NULL,
	`smsSent` int NOT NULL DEFAULT 0,
	`smsMessageId` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `quote_leads_id` PRIMARY KEY(`id`)
);
