#!/bin/bash
# READ-ONLY: every customer text whose automatic reply attempt failed and got NO staff review task, with the exact
# failure, which review-task skip rule applied, the customer's next text and its outcome, and the replies that followed.
#
#   bash sms-failure-check.sh [days, default 9]
# The output is also saved to a file in your home folder (name printed at the end).
#
# It asks for a DATABASE_URL (hidden; never shown, saved or logged). Every query runs inside ONE read-only snapshot
# transaction (START TRANSACTION READ ONLY AS OF TIMESTAMP): the database itself rejects any write in it. The script
# also refuses to run if its own SQL contains a write statement. Nothing is changed, sent or charged.
# Output: (A) the full trail for one customer number, (B) counts and examples for all inbound texts in the last N days.
# Needs the mysql client (Homebrew: mysql-client@8.4).
set -euo pipefail

DAYS="${1:-9}"
[[ "$DAYS" =~ ^[0-9]{1,2}$ ]] && [ "$DAYS" -ge 1 ] || { echo "days must be 1-99"; exit 2; }

die() { printf '\n\033[31mSTOPPED:\033[0m %s\n' "$*" >&2; exit 1; }

MYSQL=""
for c in /opt/homebrew/opt/mysql-client@8.4/bin/mysql /usr/local/opt/mysql-client@8.4/bin/mysql "$(command -v mysql || true)" \
         /opt/homebrew/opt/mysql-client/bin/mysql /usr/local/opt/mysql-client/bin/mysql; do
  if [ -n "$c" ] && [ -x "$c" ]; then MYSQL="$c"; break; fi
done
[ -n "$MYSQL" ] || die "mysql client not found. Install it with:  brew install mysql-client@8.4"

echo "Paste the DATABASE_URL to check (Railway > environment > service > Variables > DATABASE_URL)."
printf 'It stays hidden. Then press Enter: '
read -r -s URL; echo
URL="${URL#\"}"; URL="${URL%\"}"; URL="${URL#DATABASE_URL=}"
re='^mysql://([^:/@]+):(.*)@([^@:/?]+)(:([0-9]+))?/([^?/]+)'
[[ "$URL" =~ $re ]] || die "That doesn't look like a mysql://user:password@host:port/database connection string."
urldecode() { local s="${1//\\/\\\\}"; printf '%b' "${s//%/\\x}"; }
DB_USER="$(urldecode "${BASH_REMATCH[1]}")"
DB_PASS="$(urldecode "${BASH_REMATCH[2]}")"
DB_HOST="${BASH_REMATCH[3]}"
DB_PORT="${BASH_REMATCH[5]:-4000}"
DB_NAME="${BASH_REMATCH[6]}"
unset URL
[[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]] || die "Unexpected database name."

TMP="$(mktemp -d)"; chmod 700 "$TMP"; trap 'rm -rf "$TMP"' EXIT
q() { local s="${1//\\/\\\\}"; printf '"%s"' "${s//\"/\\\"}"; }
{
  echo "[client]"
  echo "host=$DB_HOST"
  echo "port=$DB_PORT"
  echo "user=$(q "$DB_USER")"
  echo "password=$(q "$DB_PASS")"
  echo "ssl-mode=${CHECK_SSL_MODE:-VERIFY_IDENTITY}"
  if [ "${CHECK_SSL_MODE:-VERIFY_IDENTITY}" != DISABLED ]; then echo "ssl-ca=${CHECK_SSL_CA:-/etc/ssl/cert.pem}"; fi
} > "$TMP/my.cnf"
chmod 600 "$TMP/my.cnf"; unset DB_PASS

SINCE="(UNIX_TIMESTAMP(NOW() - INTERVAL $DAYS DAY) * 1000)"
# All inbound texts in the window (one row per provider message), with their single reply-attempt record, task and sender type.
X="WITH inb AS (
    SELECT CONVERT(openPhoneMessageId USING utf8mb4) COLLATE utf8mb4_bin AS mid, MIN(receivedAt) AS receivedAt,
      MIN(RIGHT(REGEXP_REPLACE(fromPhone, '[^0-9]', ''), 10)) AS p10, MIN(LEFT(REGEXP_REPLACE(message, '[\r\n]+', ' '), 55)) AS msg
    FROM inbound_sms WHERE receivedAt >= $SINCE AND openPhoneMessageId IS NOT NULL AND openPhoneMessageId <> ''
    GROUP BY openPhoneMessageId),
  team AS (SELECT DISTINCT RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10) AS p10 FROM cleaner_profiles WHERE phone IS NOT NULL AND phone <> ''),
  tasks AS (SELECT CONVERT(JSON_UNQUOTE(JSON_EXTRACT(metadata, '\$.task.sourceMessageId')) USING utf8mb4) COLLATE utf8mb4_bin AS mid,
      MIN(id) AS taskId, MIN(body) AS title
    FROM ops_chat_messages WHERE quickAction = 'claude_customer_task' AND id >= (SELECT COALESCE(MIN(id), 0) FROM ops_chat_messages
      WHERE createdAt >= NOW() - INTERVAL $DAYS DAY - INTERVAL 2 DAY) GROUP BY 1),
  x AS (
    SELECT inb.*, d.id AS draftId, d.capability, d.status, d.errorStage, d.errorCode,
      JSON_UNQUOTE(JSON_EXTRACT(d.errorMessage, '\$.failures[0].code')) AS failCode,
      JSON_UNQUOTE(JSON_EXTRACT(d.errorMessage, '\$.failures[0].name')) AS failName,
      JSON_UNQUOTE(JSON_EXTRACT(d.errorMessage, '\$.failures[0].phase')) AS failPhase,
      t.taskId, t.title AS taskTitle,
      CASE WHEN inb.p10 IN ('6505164957', '6506469270', '7259009272') THEN 'system number'
           WHEN team.p10 IS NOT NULL THEN 'team member' ELSE 'customer' END AS sender,
      CASE WHEN d.id IS NULL THEN '7 no reply attempt recorded'
           WHEN d.capability IS NULL OR d.capability <> 'claude_customer_reply_v1' THEN CONCAT('6 Claude did not take it; Madison draft ', d.status)
           WHEN d.status IN ('SENT', 'DELIVERED') THEN '1 automatic reply sent'
           WHEN d.errorCode = 'SUBMISSION_UNCERTAIN' THEN '2 send uncertain'
           WHEN d.status = 'DISMISSED' THEN CONCAT('3 stopped: ', COALESCE(d.errorCode, '?'))
           WHEN d.status IN ('TOOLS_RUNNING', 'SENDING') THEN CONCAT('4 never finished (', d.status, ')')
           ELSE CONCAT('5 other: ', d.status) END AS outcome
    FROM inb
    LEFT JOIN madison_sms_drafts d ON CONVERT(d.inboundOpenPhoneId USING utf8mb4) COLLATE utf8mb4_bin = inb.mid
    LEFT JOIN tasks t ON t.mid = inb.mid
    LEFT JOIN team ON team.p10 = inb.p10)"

DIG="(SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)"
NUMS="(SELECT a.d + 10 * b.d AS i FROM $DIG a CROSS JOIN $DIG b)"
ET="'America/New_York'"
# Failed attempts without a staff task; times: attempt records are stored as UTC clock times (session is UTC here),
# conversation turns carry exact epoch milliseconds. claim_delay_s shows the conversion is sane (expect 0..300 s).
F="$X,
  focus AS (SELECT x.mid, x.p10, x.msg, x.receivedAt, x.outcome, x.errorCode, x.failCode, x.failName, x.failPhase, x.draftId
    FROM x WHERE sender = 'customer' AND outcome LIKE '3 %' AND taskId IS NULL),
  att AS (SELECT f.*, d.createdAt AS dCreated, d.updatedAt AS dUpdated, d.errorMessage, d.capabilityResult, d.dismissedAt, d.dismissedBy,
      JSON_UNQUOTE(JSON_EXTRACT(d.resolvedContext, '\$.receivingPhoneNumberId')) AS lineAtAttempt
    FROM focus f JOIN madison_sms_drafts d ON d.id = f.draftId),
  sess AS (SELECT a.mid, s.id AS sid, s.smsOptOut, s.lastInboundPhoneNumberId AS lineNow, s.messageHistory AS h,
      CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(JSON_UNQUOTE(JSON_SEARCH(s.messageHistory, 'one', a.mid)), ']', 1), '[', -1) AS UNSIGNED) AS idx,
      JSON_LENGTH(JSON_SEARCH(s.messageHistory, 'all', a.mid)) AS copies
    FROM att a JOIN conversation_sessions s ON s.leadPhone = CONCAT('+1', a.p10) AND LOCATE(a.mid, s.messageHistory) > 0),
  anchor AS (SELECT se.*, JSON_EXTRACT(se.h, CONCAT('\$[', se.idx, '].ts')) AS ats FROM sess se),
  turns AS (SELECT an.mid, an.sid, n.i AS off,
      JSON_UNQUOTE(JSON_EXTRACT(an.h, CONCAT('\$[', an.idx + n.i, '].role'))) AS role,
      JSON_EXTRACT(an.h, CONCAT('\$[', an.idx + n.i, '].ts')) - an.ats AS after_ms,
      JSON_UNQUOTE(JSON_EXTRACT(an.h, CONCAT('\$[', an.idx + n.i, '].senderName'))) AS who,
      JSON_UNQUOTE(JSON_EXTRACT(an.h, CONCAT('\$[', an.idx + n.i, '].opMsgId'))) AS tmid,
      LEFT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(an.h, CONCAT('\$[', an.idx + n.i, '].content'))), '[\r\n]+', ' '), 500) AS txt
    FROM anchor an JOIN $NUMS n ON n.i BETWEEN 1 AND 60 AND an.idx + n.i < JSON_LENGTH(an.h)),
  timing AS (SELECT a.mid, an.sid, an.smsOptOut, an.lineNow, an.copies, an.ats,
      ROUND((UNIX_TIMESTAMP(a.dCreated) * 1000 - an.ats) / 1000) AS claim_delay_s,
      UNIX_TIMESTAMP(a.dUpdated) * 1000 - an.ats + 5000 AS handled_ms
    FROM att a LEFT JOIN anchor an ON an.mid = a.mid),
  firsts AS (SELECT t.mid, t.sid,
      MIN(CASE WHEN t.role IN ('user', 'customer') AND t.after_ms > 0 AND t.after_ms <= tm.handled_ms THEN t.off END) AS inBeforeOff,
      MIN(CASE WHEN t.role IN ('assistant', 'agent', 'office') AND t.after_ms > 0 AND t.after_ms <= tm.handled_ms THEN t.off END) AS replyBeforeOff,
      MIN(CASE WHEN t.role IN ('user', 'customer') THEN t.off END) AS nextInOff,
      MIN(CASE WHEN t.role IN ('assistant', 'agent', 'office') THEN t.off END) AS replyOff
    FROM turns t JOIN timing tm ON tm.mid = t.mid AND tm.sid = t.sid GROUP BY t.mid, t.sid),
  rec AS (SELECT a.*, tm.sid, tm.smsOptOut, tm.lineNow, tm.copies, tm.claim_delay_s, ROUND(tm.handled_ms / 1000) AS handled_s,
      fi.inBeforeOff, fi.replyBeforeOff, nt.tmid AS next_mid, ROUND(nt.after_ms / 1000) AS next_after_s, nx.outcome AS next_outcome,
      COALESCE(nx.failCode, nx.errorCode) AS next_code, rt.who AS reply_who, ROUND(rt.after_ms / 60000) AS reply_after_min,
      CASE WHEN a.dismissedAt IS NOT NULL OR a.dismissedBy IS NOT NULL THEN 'staff dismissed the attempt'
           WHEN JSON_UNQUOTE(JSON_EXTRACT(a.capabilityResult, '\$.failureReviewRecorded')) = 'true' THEN 'review recorded but task missing'
           WHEN tm.sid IS NULL THEN 'conversation not found'
           WHEN tm.smsOptOut = 1 THEN 'opted out'
           WHEN tm.copies <> 1 THEN 'message ID repeated in conversation'
           WHEN fi.inBeforeOff IS NOT NULL THEN 'customer texted again before the failure was handled'
           WHEN fi.replyBeforeOff IS NOT NULL THEN 'a reply went out before the failure was handled'
           WHEN a.lineAtAttempt <> tm.lineNow THEN 'receiving line changed (as of now)'
           ELSE 'no visible skip rule: task creation failed, or a message-record rule applied' END AS why_no_task
    FROM att a LEFT JOIN timing tm ON tm.mid = a.mid
    LEFT JOIN firsts fi ON fi.mid = a.mid AND fi.sid = tm.sid
    LEFT JOIN turns nt ON nt.mid = a.mid AND nt.sid = tm.sid AND nt.off = fi.nextInOff
    LEFT JOIN x nx ON nx.mid = CONVERT(nt.tmid USING utf8mb4) COLLATE utf8mb4_bin
    LEFT JOIN turns rt ON rt.mid = a.mid AND rt.sid = tm.sid AND rt.off = fi.replyOff),
  cat AS (SELECT r.*,
      CASE WHEN r.smsOptOut = 1 OR r.msg REGEXP '^(Liked|Loved|Laughed at|Emphasized|Disliked|Questioned|Reacted) ' THEN 'A legitimate (opt-out / reaction)'
           WHEN r.reply_who IS NOT NULL AND r.reply_who <> 'Instinct' THEN 'B answered by staff (check content)'
           WHEN r.reply_who = 'Instinct' THEN 'B answered automatically (check content)'
           WHEN r.next_mid IS NOT NULL THEN 'C unanswered: newer text also not answered'
           WHEN r.sid IS NULL THEN 'D unknown'
           ELSE 'C unanswered: no reply after it' END AS category
    FROM rec r)"

SQL="SET SESSION time_zone = '+00:00';
SET SESSION group_concat_max_len = 200000;
START TRANSACTION READ ONLY AS OF TIMESTAMP NOW() - INTERVAL 5 SECOND;
SELECT DATABASE() AS database_checked, CONVERT_TZ(NOW(), '+00:00', $ET) AS checked_at_eastern, $DAYS AS days_checked;

SELECT 'F1. Failed attempts without a staff task: counts by failure, why no task, and category' AS section;
$F SELECT errorCode, failPhase, failCode, failName, why_no_task, category, COUNT(*) AS texts FROM cat
GROUP BY errorCode, failPhase, failCode, failName, why_no_task, category ORDER BY texts DESC;

SELECT 'F2. Each record (newest first). claim_delay_s should be 0-300; if not, tell me (time-zone check)' AS section;
$F SELECT CONVERT_TZ(FROM_UNIXTIME(receivedAt / 1000), '+00:00', $ET) AS received_eastern, RIGHT(p10, 4) AS phone4, mid AS message_id,
  failPhase, failCode, failName, JSON_EXTRACT(errorMessage, '\$.failures[0].issues') AS schema_issues,
  TIMESTAMPDIFF(SECOND, dCreated, dUpdated) AS attempt_s, claim_delay_s, handled_s, LEFT(capabilityResult, 100) AS attempt_state,
  sid AS conversation, why_no_task, next_after_s, next_outcome, next_code, reply_who, reply_after_min, category
FROM cat ORDER BY receivedAt DESC;

SELECT 'F3. Newer customer text also failed, excluded or unanswered (the original failure was hidden by it)' AS section;
$F SELECT CONVERT_TZ(FROM_UNIXTIME(receivedAt / 1000), '+00:00', $ET) AS received_eastern, RIGHT(p10, 4) AS phone4, mid AS message_id,
  next_mid AS newer_message_id, next_after_s, next_outcome, next_code, reply_who, reply_after_min
FROM cat WHERE why_no_task LIKE 'customer texted again%' AND (next_outcome IS NULL OR next_outcome NOT LIKE '1 %') ORDER BY receivedAt DESC;

SELECT 'F4. Conversation evidence: the customer text, follow-ups until the first reply, and the first two replies' AS section;
$F SELECT category, mid AS message_id, CONVERT_TZ(FROM_UNIXTIME(receivedAt / 1000), '+00:00', $ET) AS received_eastern,
  (SELECT LEFT(REGEXP_REPLACE(MIN(message), '[\r\n]+', ' '), 600) FROM inbound_sms WHERE openPhoneMessageId = c.mid) AS customer_text,
  (SELECT GROUP_CONCAT(CONCAT('+', ROUND(t.after_ms / 1000), 's: ', LEFT(t.txt, 300)) ORDER BY t.off SEPARATOR ' || ')
     FROM turns t JOIN firsts fi ON fi.mid = t.mid AND fi.sid = t.sid
     WHERE t.mid = c.mid AND t.sid = c.sid AND t.role IN ('user', 'customer') AND t.off < COALESCE(fi.replyOff, 61) AND t.off <= 6) AS follow_ups,
  SUBSTRING_INDEX((SELECT GROUP_CONCAT(CONCAT('+', ROUND(t.after_ms / 60000), 'min ', COALESCE(t.who, t.role), ': ', t.txt) ORDER BY t.off SEPARATOR ' || ')
     FROM turns t WHERE t.mid = c.mid AND t.sid = c.sid AND t.role IN ('assistant', 'agent', 'office')), ' || ', 2) AS first_replies
FROM cat c ORDER BY category, receivedAt DESC;
COMMIT;"
# Refuse to run anything but reads (the read-only snapshot transaction also enforces this in the database).
if printf '%s' "$SQL" | grep -Eiq '\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE|RENAME|LOAD|CALL|LOCK)\b[^_]'; then
  die "Internal check failed: the query text contains a write statement. Nothing was run."
fi

echo "Checking database \"$DB_NAME\" (read-only snapshot)..."
OUT="$HOME/sms-failure-check-$(date +%Y%m%d-%H%M%S).txt"
printf '%s\n' "$SQL" | "$MYSQL" --defaults-extra-file="$TMP/my.cnf" --table --connect-timeout=20 "$DB_NAME" | tee "$OUT" \
  || die "The query did not complete (see the message above). Nothing was changed."
echo; echo "Done. Nothing was changed. The full output is saved in: $OUT  (send me that file)"
