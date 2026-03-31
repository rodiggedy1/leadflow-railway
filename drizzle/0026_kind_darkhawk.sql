ALTER TABLE `candidates` ADD `interviewCallId` varchar(128);--> statement-breakpoint
ALTER TABLE `candidates` ADD `interviewTranscript` longtext;--> statement-breakpoint
ALTER TABLE `candidates` ADD `interviewScore` int;--> statement-breakpoint
ALTER TABLE `candidates` ADD `interviewSummary` text;