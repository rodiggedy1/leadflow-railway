ALTER TABLE `conversation_sessions` MODIFY COLUMN `stage` enum('WIDGET_SIZING','REACTIVATION','QUOTE_SENT','AVAILABILITY','SLOT_CHOICE','TIME_PREF','ADDRESS','CONFIRMATION','CALL_SCHEDULED','DONE','UNHANDLED','BOOKED','NOT_INTERESTED') NOT NULL DEFAULT 'QUOTE_SENT';--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `reactivationLastPrice` int;--> statement-breakpoint
ALTER TABLE `conversation_sessions` ADD `reactivationDiscountPct` int;--> statement-breakpoint
ALTER TABLE `reactivation_contacts` ADD `lastPrice` int;--> statement-breakpoint
ALTER TABLE `reactivation_contacts` ADD `discountPct` int DEFAULT 10 NOT NULL;