-- STEP 3 (read-only). After step 2: the first two numbers must be 0, and the last two must be equal.
SELECT
  (SELECT COUNT(*) FROM conversation_sessions cs
    WHERE (JSON_SEARCH(cs.messageHistory,'one','user',NULL,'$[*].role') IS NOT NULL OR JSON_SEARCH(cs.messageHistory,'one','customer',NULL,'$[*].role') IS NOT NULL)
      AND cs.lastCustomerMessageTs IS NULL AND cs.csResolvedAt IS NULL AND COALESCE(cs.csQueue,'') <> 'CS' AND cs.lastCalledAt IS NULL
      AND NOT EXISTS (SELECT 1 FROM voice_calls vc WHERE vc.sessionId = cs.id)) AS would_disappear,
  (SELECT COUNT(*) FROM conversation_sessions cs
    WHERE JSON_SEARCH(cs.messageHistory,'one','user',NULL,'$[*].role') IS NULL AND JSON_SEARCH(cs.messageHistory,'one','customer',NULL,'$[*].role') IS NULL
      AND cs.lastCustomerMessageTs IS NOT NULL AND cs.csResolvedAt IS NULL AND COALESCE(cs.csQueue,'') <> 'CS' AND cs.lastCalledAt IS NULL
      AND NOT EXISTS (SELECT 1 FROM voice_calls vc WHERE vc.sessionId = cs.id)) AS would_wrongly_appear,
  (SELECT COUNT(*) FROM conversation_sessions cs
    WHERE (((JSON_SEARCH(cs.messageHistory,'one','user',NULL,'$[*].role') IS NOT NULL OR JSON_SEARCH(cs.messageHistory,'one','customer',NULL,'$[*].role') IS NOT NULL) OR cs.csQueue = 'CS') AND cs.csResolvedAt IS NULL)
       OR EXISTS (SELECT 1 FROM voice_calls vc WHERE vc.sessionId = cs.id) OR cs.lastCalledAt IS NOT NULL) AS inbox_old_rule,
  (SELECT COUNT(*) FROM conversation_sessions cs
    WHERE ((cs.lastCustomerMessageTs IS NOT NULL OR cs.csQueue = 'CS') AND cs.csResolvedAt IS NULL)
       OR EXISTS (SELECT 1 FROM voice_calls vc WHERE vc.sessionId = cs.id) OR cs.lastCalledAt IS NOT NULL) AS inbox_new_rule;
