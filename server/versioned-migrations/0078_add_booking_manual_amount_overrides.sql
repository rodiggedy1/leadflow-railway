ALTER TABLE `bookings`
  ADD COLUMN IF NOT EXISTS `manualAmountOverrides` json NULL;
