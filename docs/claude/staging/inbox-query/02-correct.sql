-- STEP 2 (writes). Fills ONLY missing lastCustomerMessageTs values, using the latest timed customer message
-- already stored in each conversation. Never overwrites a value; never invents a time. Safe to run twice.
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
UPDATE conversation_sessions cs JOIN customer_ts t ON cs.id = t.id
SET cs.lastCustomerMessageTs = t.ts
WHERE cs.lastCustomerMessageTs IS NULL AND t.ts IS NOT NULL;
