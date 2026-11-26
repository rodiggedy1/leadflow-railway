-- STEP 4 (schema, approved for STAGING only). Adds a lookup index on voice_calls.sessionId, used by the inbox for
-- "does this conversation have calls" and "latest call per conversation". Online in TiDB (no table lock). Safe to run twice.
CREATE INDEX IF NOT EXISTS `idx_voice_calls_sessionId` ON `voice_calls` (`sessionId`);
-- Undo: DROP INDEX `idx_voice_calls_sessionId` ON `voice_calls`;
