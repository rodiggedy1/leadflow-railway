ALTER TABLE `agents` ADD `openPhoneUserId` varchar(128);--> statement-breakpoint
ALTER TABLE `agents` ADD `onCallSince` bigint;--> statement-breakpoint
ALTER TABLE `agents` ADD `onCallCallId` varchar(128);