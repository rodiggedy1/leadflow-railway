ALTER TABLE `bookings`
  ADD COLUMN IF NOT EXISTS `companyNotes` text NULL;
