CREATE TABLE IF NOT EXISTS `bookings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`publicBookingNumber` varchar(40) NOT NULL,
	`idempotencyKey` varchar(36) NOT NULL,
	`commandHash` varchar(64) NOT NULL,
	`source` varchar(20) NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'needs_attention',
	`availabilityStatus` varchar(32) NOT NULL DEFAULT 'requested',
	`assignmentStatus` varchar(32) NOT NULL DEFAULT 'unassigned',
	`paymentStatus` varchar(32) NOT NULL DEFAULT 'not_started',
	`customerName` varchar(255) NOT NULL,
	`customerPhone` varchar(20) NOT NULL,
	`customerEmail` varchar(320) NOT NULL,
	`serviceId` varchar(32) NOT NULL,
	`serviceName` varchar(120) NOT NULL,
	`bedrooms` int NOT NULL,
	`bathrooms` int NOT NULL,
	`extras` json NOT NULL,
	`specialRequestNotes` json NOT NULL,
	`address` varchar(500) NOT NULL,
	`requestedLocalDate` varchar(10) NOT NULL,
	`requestedLocalTime` varchar(5) NOT NULL,
	`requestedTimeZone` varchar(64) NOT NULL,
	`requestedStartAt` bigint NOT NULL,
	`recurrence` varchar(32) NOT NULL DEFAULT 'one-time',
	`recurringIntentStatus` varchar(32),
	`pricingVersion` varchar(64) NOT NULL,
	`firstCleaningTotalCents` int NOT NULL,
	`futureVisitTotalCents` int,
	`priceSnapshot` json NOT NULL,
	`expiresAt` bigint,
	`createdAt` datetime(3) NOT NULL,
	`updatedAt` datetime(3) NOT NULL,
	CONSTRAINT `bookings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_bookings_public_number` ON `bookings` (`publicBookingNumber`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_bookings_idempotency_key` ON `bookings` (`idempotencyKey`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_bookings_requested_date` ON `bookings` (`requestedLocalDate`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_bookings_status_date` ON `bookings` (`status`, `requestedLocalDate`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_bookings_customer_phone` ON `bookings` (`customerPhone`);
--> statement-breakpoint
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
	CONSTRAINT `booking_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_booking_assignments_booking` ON `booking_assignments` (`bookingId`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_booking_assignments_team` ON `booking_assignments` (`teamId`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `booking_series` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'intent_pending',
	`frequency` varchar(32) NOT NULL,
	`anchorLocalDate` varchar(10) NOT NULL,
	`anchorLocalTime` varchar(5) NOT NULL,
	`timeZone` varchar(64) NOT NULL,
	`firstCleaningTotalCents` int NOT NULL,
	`futureVisitTotalCents` int NOT NULL,
	`createdAt` datetime(3) NOT NULL,
	`updatedAt` datetime(3) NOT NULL,
	CONSTRAINT `booking_series_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_booking_series_booking` ON `booking_series` (`bookingId`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_booking_series_status` ON `booking_series` (`status`);
