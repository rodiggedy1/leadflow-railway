CREATE TABLE `cs_draft_examples` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`pairIndex` int NOT NULL,
	`userMsg` text NOT NULL,
	`agentReply` text NOT NULL,
	`msgTs` bigint NOT NULL,
	`primaryIntent` varchar(64),
	`secondaryIntents` json,
	`customerGoal` varchar(255),
	`customerType` varchar(32),
	`situation` varchar(255),
	`enrichedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cs_draft_examples_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_cs_draft_examples_session_pair` UNIQUE(`sessionId`,`pairIndex`)
);
--> statement-breakpoint
CREATE INDEX `idx_cs_draft_examples_intent` ON `cs_draft_examples` (`primaryIntent`);--> statement-breakpoint
CREATE INDEX `idx_cs_draft_examples_customer_type` ON `cs_draft_examples` (`customerType`);--> statement-breakpoint
CREATE INDEX `idx_cs_draft_examples_msg_ts` ON `cs_draft_examples` (`msgTs`);