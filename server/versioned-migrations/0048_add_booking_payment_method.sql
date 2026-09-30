ALTER TABLE `bookings`
  ADD COLUMN IF NOT EXISTS `paymentMethod` varchar(20) NOT NULL DEFAULT 'card';
