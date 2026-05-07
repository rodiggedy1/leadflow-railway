CREATE TABLE `job_geo_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`addressKey` varchar(500) NOT NULL,
	`originalAddress` varchar(500) NOT NULL,
	`lat` double NOT NULL,
	`lng` double NOT NULL,
	`formattedAddress` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `job_geo_cache_id` PRIMARY KEY(`id`),
	CONSTRAINT `job_geo_cache_addressKey_unique` UNIQUE(`addressKey`)
);
--> statement-breakpoint
CREATE TABLE `schedule_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobDate` varchar(20) NOT NULL,
	`cleanerJobId` int NOT NULL,
	`teamId` int NOT NULL,
	`teamName` varchar(255),
	`routeOrder` int NOT NULL DEFAULT 0,
	`estimatedArrivalMs` bigint,
	`estimatedDepartureMs` bigint,
	`driveTimeSecs` int,
	`isManual` int NOT NULL DEFAULT 0,
	`totalDistanceMeters` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `schedule_assignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_schedule_job_date` UNIQUE(`cleanerJobId`,`jobDate`)
);
--> statement-breakpoint
CREATE TABLE `scheduling_teams` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`launch27TeamId` int,
	`homeAddress` varchar(500),
	`homeLat` double,
	`homeLng` double,
	`maxHoursPerDay` double DEFAULT 8,
	`skills` varchar(500),
	`isActive` int NOT NULL DEFAULT 1,
	`color` varchar(10) DEFAULT '#6366f1',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scheduling_teams_id` PRIMARY KEY(`id`)
);
