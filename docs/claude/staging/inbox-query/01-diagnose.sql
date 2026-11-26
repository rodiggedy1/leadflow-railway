-- STEP 1 (read-only). Run on the STAGING database first.
-- Latest timestamped customer message per conversation, computed from the stored history exactly like
-- server/sessionSummary.ts: role "user" or "customer", ts a JSON number; messages without a ts are ignored
-- (no timestamp is ever invented). Only conversations whose lastCustomerMessageTs is missing are examined.
-- Positions 0-99,999 are checked (the longest history is reported in step 1).
WITH digits AS (
  SELECT 0 AS d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
  UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9
), candidates AS (
  SELECT cs.id, cs.messageHistory AS h, JSON_LENGTH(cs.messageHistory) AS len
  FROM conversation_sessions cs
  WHERE cs.lastCustomerMessageTs IS NULL AND JSON_VALID(cs.messageHistory)
    AND (JSON_SEARCH(cs.messageHistory, 'one', 'user', NULL, '$[*].role') IS NOT NULL
      OR JSON_SEARCH(cs.messageHistory, 'one', 'customer', NULL, '$[*].role') IS NOT NULL)
), nums AS (
  SELECT a.d + 10 * b.d + 100 * c.d + 1000 * e.d + 10000 * f.d AS n
  FROM digits a, digits b, digits c, digits e, digits f
), customer_ts AS (
  SELECT c.id, c.len, MAX(CASE
      WHEN JSON_UNQUOTE(JSON_EXTRACT(c.h, CONCAT('$[', nums.n, '].role'))) IN ('user', 'customer')
       AND JSON_TYPE(JSON_EXTRACT(c.h, CONCAT('$[', nums.n, '].ts'))) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE')
      THEN CAST(JSON_EXTRACT(c.h, CONCAT('$[', nums.n, '].ts')) AS SIGNED) END) AS ts
  FROM candidates c JOIN nums ON nums.n < c.len
  GROUP BY c.id, c.len
)
SELECT
  COUNT(*) AS missing_with_customer_messages,
  SUM(t.ts IS NOT NULL) AS fixable_from_stored_times,
  SUM(t.ts IS NULL) AS not_fixable_no_times,
  SUM(t.ts IS NULL AND cs.csResolvedAt IS NULL AND COALESCE(cs.csQueue, '') <> 'CS' AND cs.lastCalledAt IS NULL
      AND NOT EXISTS (SELECT 1 FROM voice_calls vc WHERE vc.sessionId = cs.id)) AS not_fixable_and_would_leave_inbox,
  SUM(t.ts IS NOT NULL AND cs.lastMessageRole = 'user' AND cs.csResolvedAt IS NULL
      AND t.ts BETWEEN UNIX_TIMESTAMP(NOW()) * 1000 - 30 * 86400000 AND UNIX_TIMESTAMP(NOW()) * 1000 - 30 * 60000) AS would_newly_qualify_for_unanswered_alarm,
  MAX(t.len) AS longest_history_checked
FROM customer_ts t JOIN conversation_sessions cs ON cs.id = t.id;
