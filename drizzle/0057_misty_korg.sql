CREATE TABLE `campaign_blasts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignType` varchar(50) NOT NULL,
	`campaignTitle` varchar(200) NOT NULL,
	`batchLabel` varchar(100),
	`recipientCount` int NOT NULL,
	`sentCount` int NOT NULL DEFAULT 0,
	`failedCount` int NOT NULL DEFAULT 0,
	`script` text,
	`firedAt` timestamp NOT NULL DEFAULT (now()),
	`firedBy` varchar(255) DEFAULT 'admin',
	CONSTRAINT `campaign_blasts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sms_opt_outs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`phone` varchar(20) NOT NULL,
	`optedOutAt` timestamp NOT NULL DEFAULT (now()),
	`source` varchar(50) NOT NULL DEFAULT 'reply_stop',
	`triggerMessage` varchar(255),
	CONSTRAINT `sms_opt_outs_id` PRIMARY KEY(`id`),
	CONSTRAINT `sms_opt_outs_phone_unique` UNIQUE(`phone`)
);
