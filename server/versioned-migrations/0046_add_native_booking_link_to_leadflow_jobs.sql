ALTER TABLE `leadflow_jobs`
  ADD COLUMN IF NOT EXISTS `bookingId` int NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_leadflow_jobs_booking_date`
  ON `leadflow_jobs` (`bookingId`, `jobDate`);
