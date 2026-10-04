ALTER TABLE `bookings`
  ADD COLUMN IF NOT EXISTS `bookedByAgentId` int NULL,
  ADD COLUMN IF NOT EXISTS `bookedByAgentName` varchar(255) NULL;
