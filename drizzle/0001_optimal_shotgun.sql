CREATE TABLE `nurture_step_scripts` (
	`step` int NOT NULL,
	`body` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `nurture_step_scripts_step` PRIMARY KEY(`step`)
);
