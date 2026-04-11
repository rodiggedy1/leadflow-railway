CREATE TABLE `issue_comments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`issue_key` varchar(255) NOT NULL,
	`author_name` varchar(255) NOT NULL,
	`body` text NOT NULL,
	`type` varchar(32) NOT NULL DEFAULT 'text',
	`created_at` bigint NOT NULL,
	CONSTRAINT `issue_comments_id` PRIMARY KEY(`id`)
);
