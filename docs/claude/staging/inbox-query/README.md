# Text-inbox query: data correction and index (run in the TiDB Cloud SQL editor)

Pairs with branch `claude/inbox-query`, which makes the Command Chat text inbox read `lastCustomerMessageTs` instead of
searching every conversation's full message history, and makes six save paths keep that column current.

All scripts were tested on a local throwaway TiDB 8.5 with invented conversations: the computed values matched the
app's own `computeSessionSummary` on all 70 test conversations (including untimed, string/null times, 2,500-message
histories); re-running changes nothing; the undo statement restores exactly the corrected rows.

**Order (staging first; production only after a separate approval):**
1. `04-index.sql`: adds `idx_voice_calls_sessionId` (online, safe to repeat). Undo is in the file.
2. `01-diagnose.sql` (read-only): send the numbers back. `not_fixable_and_would_leave_inbox` must be 0 before the code
   change goes anywhere. `would_newly_qualify_for_unanswered_alarm` matters for production only (alarms are off on staging).
3. `01b-undo-statement.sql` (read-only): save the single `UPDATE ... SET lastCustomerMessageTs = NULL ...` it returns.
   That is the exact database rollback for step 4 (use it only right after step 4).
4. `02-correct.sql`: fills only missing `lastCustomerMessageTs` values from the latest timed customer message already
   stored in each conversation. Never overwrites, never invents a time. Safe to run twice.
5. `03-verify.sql` (read-only): `would_disappear` = 0, `would_wrongly_appear` = 0, `inbox_old_rule` = `inbox_new_rule`.

**Production (later):** index → diagnose → save undo → correct → release the code → run `02-correct.sql` once more
(catches anything saved by the old code in between) → verify.
