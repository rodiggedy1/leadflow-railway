ALTER TABLE `conversation_sessions`
  ADD COLUMN IF NOT EXISTS `madisonDeferredUntil` bigint NULL;
