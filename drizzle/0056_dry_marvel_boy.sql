CREATE TABLE `ai_insights_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`rangeKey` varchar(10) NOT NULL,
	`payload` text NOT NULL,
	`generatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_insights_cache_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_insights_cache_rangeKey_unique` UNIQUE(`rangeKey`)
);
