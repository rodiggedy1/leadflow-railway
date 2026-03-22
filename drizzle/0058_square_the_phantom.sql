CREATE TABLE `command_center_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cacheKey` varchar(50) NOT NULL,
	`rangeKey` varchar(10) NOT NULL DEFAULT 'none',
	`payload` text NOT NULL,
	`generatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `command_center_cache_id` PRIMARY KEY(`id`)
);
