CREATE TABLE IF NOT EXISTS `focus_points` (
  `id` int AUTO_INCREMENT NOT NULL,
  `agentName` varchar(128) NOT NULL,
  `points` int NOT NULL DEFAULT 0,
  `weekStart` varchar(10) NOT NULL,
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_focus_points_agent_week` (`agentName`, `weekStart`),
  KEY `idx_focus_points_week` (`weekStart`)
);
