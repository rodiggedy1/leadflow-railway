CREATE TABLE `step_locks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cleanerJobId` int NOT NULL,
	`step` varchar(100) NOT NULL,
	`claimedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `step_locks_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_step_locks_job_step` UNIQUE(`cleanerJobId`,`step`)
);
