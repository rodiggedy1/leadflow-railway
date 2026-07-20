-- Migration: 0084_madison_missions
-- Creates the madison_missions table for server-persisted AI Concierge audit trail.
-- Safe to run: CREATE TABLE IF NOT EXISTS means it's a no-op if the table already exists.
CREATE TABLE IF NOT EXISTS `madison_missions` (
`id` int AUTO_INCREMENT NOT NULL,
`missionId` varchar(64) NOT NULL,
`agentId` int NOT NULL,
`command` text NOT NULL,
`title` varchar(255) NOT NULL,
`status_mission` enum('completed','failed','blocked') NOT NULL,
`source_mission` enum('chat','scheduled','automatic','api') DEFAULT 'chat' NOT NULL,
`summary` text NOT NULL,
`steps` json NOT NULL,
`stats` json NOT NULL,
`startedAt` bigint NOT NULL,
`completedAt` bigint NOT NULL,
`archivedAt` timestamp,
`createdAt` timestamp NOT NULL DEFAULT (now()),
CONSTRAINT `madison_missions_id` PRIMARY KEY(`id`),
CONSTRAINT `madison_missions_missionId_unique` UNIQUE(`missionId`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_madison_missions_agent_archived_created` ON `madison_missions` (`agentId`,`archivedAt`,`createdAt`);
