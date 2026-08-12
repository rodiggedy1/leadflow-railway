ALTER TABLE `conversation_sessions`
  ADD COLUMN IF NOT EXISTS `lastInboundPhoneNumberId` varchar(64) NULL;
