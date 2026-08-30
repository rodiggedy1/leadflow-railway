CREATE TABLE IF NOT EXISTS `booking_assignments` (
  `id` int AUTO_INCREMENT NOT NULL,
  `bookingId` int NOT NULL,
  `teamId` int,
  `teamName` varchar(255),
  `status` varchar(32) NOT NULL DEFAULT 'assigned',
  `assignedByAgentId` int,
  `assignedAt` datetime(3) NOT NULL,
  `unassignedAt` datetime(3),
  `createdAt` datetime(3) NOT NULL,
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_booking_assignments_booking` (`bookingId`),
  KEY `idx_booking_assignments_team` (`teamId`)
);
