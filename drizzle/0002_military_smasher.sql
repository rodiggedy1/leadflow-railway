CREATE TABLE `schedule_job_locks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobId` int NOT NULL,
	`date` varchar(10) NOT NULL,
	`cleanerId` int NOT NULL,
	`lockedPosition` int NOT NULL,
	`lockedAt` bigint NOT NULL,
	CONSTRAINT `schedule_job_locks_id` PRIMARY KEY(`id`)
);
