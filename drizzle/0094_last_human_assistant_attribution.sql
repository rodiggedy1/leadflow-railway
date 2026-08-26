ALTER TABLE `conversation_sessions`
  ADD COLUMN IF NOT EXISTS `lastHumanAssistantSenderName` varchar(255),
  ADD COLUMN IF NOT EXISTS `lastHumanAssistantSummaryVersion` int NOT NULL DEFAULT 0;
