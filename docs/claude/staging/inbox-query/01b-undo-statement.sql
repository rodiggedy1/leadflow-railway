-- STEP 1b (read-only). Run right before step 2 and SAVE the result: it is the exact undo statement for step 2.
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
SELECT /*+ SET_VAR(group_concat_max_len=10000000) */ CONCAT(
  'UPDATE conversation_sessions SET lastCustomerMessageTs = NULL WHERE id IN (',
  COALESCE(GROUP_CONCAT(id ORDER BY id), '0'), ');') AS undo_statement_for_step_2
FROM customer_ts WHERE ts IS NOT NULL;
