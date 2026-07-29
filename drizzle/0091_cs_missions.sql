CREATE TABLE IF NOT EXISTS `cs_missions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `sessionId` int NOT NULL,
  `agentId` int NOT NULL,
  `agentName` varchar(128),
  `title` varchar(255) NOT NULL,
  `emoji` varchar(16),
  `status` enum('active','waiting','ready','completed','cancelled') NOT NULL DEFAULT 'active',
  `stages` json NOT NULL,
  `sortOrder` int NOT NULL DEFAULT 0,
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  `completedAt` datetime(3),
  CONSTRAINT `cs_missions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cs_missions_session` ON `cs_missions` (`sessionId`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cs_missions_session_status` ON `cs_missions` (`sessionId`, `status`);
