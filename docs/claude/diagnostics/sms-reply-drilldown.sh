#!/bin/bash
# READ-ONLY drill-down: every customer text with no reply attempt, or a failed attempt without a staff task, with
# what came after it in the conversation (follow-up text, staff reply, automatic reply), plus one message in detail.
#
#   bash sms-reply-drilldown.sh <phone, 10 digits> [days, default 7] [message ID to locate, optional]
# The output is also saved to a file in your home folder (name printed at the end).
#
# It asks for a DATABASE_URL (hidden; never shown, saved or logged). Every query runs inside ONE read-only snapshot
# transaction (START TRANSACTION READ ONLY AS OF TIMESTAMP): the database itself rejects any write in it. The script
# also refuses to run if its own SQL contains a write statement. Nothing is changed, sent or charged.
# Output: (A) the full trail for one customer number, (B) counts and examples for all inbound texts in the last N days.
# Needs the mysql client (Homebrew: mysql-client@8.4).
set -euo pipefail

PHONE10="${1:-}"; DAYS="${2:-7}"; MID="${3:-none}"
[[ "$PHONE10" =~ ^[0-9]{10}$ ]] && [[ "$MID" =~ ^[A-Za-z0-9_-]{4,80}$ ]] || { echo "Usage: bash $0 <phone, 10 digits> [days] [message ID]"; exit 2; }
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
P10="'$PHONE10'"
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

MIDQ="'$MID'"
DIG="(SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)"
# 0..999: positions inside one conversation history.
NUMS="(SELECT a.d + 10 * b.d + 100 * c.d AS i FROM $DIG a CROSS JOIN $DIG b CROSS JOIN $DIG c)"
# Position of a message ID inside a history (first match), and one field of the turn at a position.
POS="CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(JSON_UNQUOTE(JSON_SEARCH(s.messageHistory, 'one', m.mid)), ']', 1), '[', -1) AS UNSIGNED)"
# Texts to explain: customer texts with no reply attempt, and failed attempts without a staff task.
F="$X,
  focus AS (SELECT x.*, CASE WHEN outcome LIKE '7 %' THEN 'no attempt' ELSE CONCAT('failed, no task: ', COALESCE(failCode, errorCode, '?')) END AS kind
    FROM x WHERE sender = 'customer' AND (outcome LIKE '7 %' OR (outcome LIKE '3 %' AND taskId IS NULL))),
  sess AS (SELECT f.mid, s.id AS sid, s.smsOptOut, s.lastInboundPhoneNumberId AS lineNow, s.messageHistory AS h,
      CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(JSON_UNQUOTE(JSON_SEARCH(s.messageHistory, 'one', f.mid)), ']', 1), '[', -1) AS UNSIGNED) AS idx,
      JSON_LENGTH(JSON_SEARCH(s.messageHistory, 'all', f.mid)) AS copies
    FROM focus f JOIN conversation_sessions s ON s.leadPhone = CONCAT('+1', f.p10) AND LOCATE(f.mid, s.messageHistory) > 0),
  turns AS (SELECT se.mid, se.sid, n.i AS off,
      JSON_UNQUOTE(JSON_EXTRACT(se.h, CONCAT('\$[', se.idx + n.i, '].role'))) AS role,
      JSON_EXTRACT(se.h, CONCAT('\$[', se.idx + n.i, '].ts')) - JSON_EXTRACT(se.h, CONCAT('\$[', se.idx, '].ts')) AS after_ms,
      JSON_UNQUOTE(JSON_EXTRACT(se.h, CONCAT('\$[', se.idx + n.i, '].senderName'))) AS who,
      JSON_UNQUOTE(JSON_EXTRACT(se.h, CONCAT('\$[', se.idx + n.i, '].opMsgId'))) AS tmid,
      LEFT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(se.h, CONCAT('\$[', se.idx + n.i, '].content'))), '[\r\n]+', ' '), 320) AS txt
    FROM sess se JOIN $NUMS n ON n.i BETWEEN 1 AND 60 AND se.idx + n.i < JSON_LENGTH(se.h)),
  firsts AS (SELECT mid, sid,
      MIN(CASE WHEN role IN ('assistant', 'agent', 'office') THEN off END) AS replyOff,
      MIN(CASE WHEN role IN ('user', 'customer') AND after_ms <= 180000 THEN off END) AS burstOff
    FROM turns GROUP BY mid, sid),
  detail AS (SELECT f.mid, f.kind, f.receivedAt, f.p10, f.msg, f.failCode, f.draftId, se.sid, se.smsOptOut, se.lineNow, se.copies,
      fi.replyOff, bt.tmid AS burst_mid, rt.who AS reply_who
    FROM focus f LEFT JOIN sess se ON se.mid = f.mid
    LEFT JOIN firsts fi ON fi.mid = f.mid AND fi.sid = se.sid
    LEFT JOIN turns bt ON bt.mid = f.mid AND bt.sid = se.sid AND bt.off = fi.burstOff
    LEFT JOIN turns rt ON rt.mid = f.mid AND rt.sid = se.sid AND rt.off = fi.replyOff),
  cat AS (SELECT d.*, bx.outcome AS burst_outcome,
      CASE WHEN d.sid IS NULL THEN 'D unknown: not found in a conversation'
           WHEN d.smsOptOut = 1 THEN 'A legitimate: opted out'
           WHEN d.msg REGEXP '^[[:space:]]*(stop|unsubscribe|quit|end|cancel)[[:space:]]*$' THEN 'A legitimate: stop word'
           WHEN d.msg REGEXP '^(Liked|Loved|Laughed at|Emphasized|Disliked|Questioned|Reacted) ' THEN 'A legitimate: reaction'
           WHEN d.burst_mid IS NOT NULL THEN 'B superseded: customer texted again within 3 min'
           WHEN d.reply_who IS NOT NULL AND d.reply_who = 'Instinct' THEN 'B answered: automatic reply later'
           WHEN d.reply_who IS NOT NULL THEN 'B answered: staff reply'
           ELSE 'C unanswered: no reply after it' END AS category
    FROM detail d LEFT JOIN x bx ON bx.mid = CONVERT(d.burst_mid USING utf8mb4) COLLATE utf8mb4_bin)"

SQL="SET SESSION time_zone = 'America/New_York';
SET SESSION group_concat_max_len = 200000;
START TRANSACTION READ ONLY AS OF TIMESTAMP NOW() - INTERVAL 5 SECOND;
SELECT DATABASE() AS database_checked, NOW() AS checked_at_eastern, $DAYS AS days_checked;

SELECT 'T0. Where the given message ID belongs (if one was given)' AS section;
SELECT 'inbound_sms' AS found_in, RIGHT(REGEXP_REPLACE(fromPhone, '[^0-9]', ''), 4) AS phone_last4,
  RIGHT(REGEXP_REPLACE(fromPhone, '[^0-9]', ''), 10) = $P10 AS is_this_number, FROM_UNIXTIME(receivedAt / 1000) AS at_eastern, NULL AS conversation
FROM inbound_sms WHERE openPhoneMessageId = $MIDQ
UNION ALL SELECT 'reply attempt', RIGHT(REGEXP_REPLACE(fromPhone, '[^0-9]', ''), 4), RIGHT(REGEXP_REPLACE(fromPhone, '[^0-9]', ''), 10) = $P10, createdAt, sessionId
FROM madison_sms_drafts WHERE inboundOpenPhoneId = $MIDQ
UNION ALL SELECT 'conversation', RIGHT(REGEXP_REPLACE(leadPhone, '[^0-9]', ''), 4), RIGHT(REGEXP_REPLACE(leadPhone, '[^0-9]', ''), 10) = $P10, updatedAt, id
FROM conversation_sessions WHERE updatedAt >= NOW() - INTERVAL 60 DAY AND LOCATE($MIDQ, messageHistory) > 0
UNION ALL SELECT 'not found anywhere', NULL, NULL, NULL, NULL FROM DUAL WHERE $MIDQ <> 'none'
  AND NOT EXISTS (SELECT 1 FROM inbound_sms WHERE openPhoneMessageId = $MIDQ) AND NOT EXISTS (SELECT 1 FROM madison_sms_drafts WHERE inboundOpenPhoneId = $MIDQ);

SELECT 'T1. Every text from this number in the last 30 days, with what happened to it' AS section;
SELECT FROM_UNIXTIME(m.receivedAt / 1000) AS received_eastern, m.mid AS message_id, LEFT(REGEXP_REPLACE(m.message, '[\r\n]+', ' '), 120) AS text_start,
  COALESCE(d.capability, IF(d.id IS NULL, '(none)', '(Madison)')) AS handled_by, d.status, d.errorCode,
  JSON_UNQUOTE(JSON_EXTRACT(d.errorMessage, '\$.failures[0].code')) AS fail_code,
  (SELECT MIN(o.id) FROM ops_chat_messages o WHERE o.quickAction = 'claude_customer_task' AND o.sessionId = d.sessionId
     AND JSON_UNQUOTE(JSON_EXTRACT(o.metadata, '\$.task.sourceMessageId')) = m.mid) AS staff_task
FROM (SELECT openPhoneMessageId AS mid, MIN(receivedAt) AS receivedAt, MIN(message) AS message FROM inbound_sms
      WHERE RIGHT(REGEXP_REPLACE(fromPhone, '[^0-9]', ''), 10) = $P10 AND receivedAt >= (UNIX_TIMESTAMP(NOW() - INTERVAL 30 DAY) * 1000)
      GROUP BY openPhoneMessageId) m
LEFT JOIN madison_sms_drafts d ON d.inboundOpenPhoneId = m.mid ORDER BY m.receivedAt DESC LIMIT 20;

SELECT 'T2. Exclusion rules for each of those texts (rules read the conversation as it is now; a turn up to 3 min after a text existed when it was decided)' AS section;
SELECT FROM_UNIXTIME(m.receivedAt / 1000) AS received_eastern, m.mid AS message_id, s.id AS conversation, s.leadSource,
  s.smsOptOut AS opted_out, JSON_LENGTH(JSON_SEARCH(s.messageHistory, 'all', m.mid)) AS id_copies_must_be_1,
  JSON_UNQUOTE(JSON_EXTRACT(s.messageHistory, CONCAT('\$[', $POS, '].content'))) = m.message AS text_matches,
  (SELECT COUNT(*) FROM $NUMS n WHERE n.i < JSON_LENGTH(s.messageHistory) AND n.i <> $POS
     AND JSON_UNQUOTE(JSON_EXTRACT(s.messageHistory, CONCAT('\$[', n.i, '].role'))) IN ('user', 'customer', 'assistant', 'agent', 'office')
     AND JSON_EXTRACT(s.messageHistory, CONCAT('\$[', n.i, '].ts')) > JSON_EXTRACT(s.messageHistory, CONCAT('\$[', $POS, '].ts'))
     AND JSON_EXTRACT(s.messageHistory, CONCAT('\$[', n.i, '].ts')) <= JSON_EXTRACT(s.messageHistory, CONCAT('\$[', $POS, '].ts')) + 180000) AS turns_within_3_min_after,
  JSON_KEYS(JSON_EXTRACT(s.messageHistory, CONCAT('\$[', $POS, ']'))) AS stored_fields
FROM (SELECT openPhoneMessageId AS mid, MIN(receivedAt) AS receivedAt, MIN(message) AS message FROM inbound_sms
      WHERE RIGHT(REGEXP_REPLACE(fromPhone, '[^0-9]', ''), 10) = $P10 AND receivedAt >= (UNIX_TIMESTAMP(NOW() - INTERVAL 30 DAY) * 1000)
      GROUP BY openPhoneMessageId) m
JOIN conversation_sessions s ON RIGHT(REGEXP_REPLACE(s.leadPhone, '[^0-9]', ''), 10) = $P10 AND LOCATE(m.mid, s.messageHistory) > 0
ORDER BY m.receivedAt DESC LIMIT 20;

SELECT 'T3. Turns around each of the 6 most recent texts (offset 0 = the text; seconds relative to it)' AS section;
SELECT m.mid AS around_message, s.id AS conversation, n.i - 3 AS offset,
  JSON_UNQUOTE(JSON_EXTRACT(s.messageHistory, CONCAT('\$[', $POS + n.i - 3, '].role'))) AS role,
  ROUND((JSON_EXTRACT(s.messageHistory, CONCAT('\$[', $POS + n.i - 3, '].ts')) - JSON_EXTRACT(s.messageHistory, CONCAT('\$[', $POS, '].ts'))) / 1000) AS seconds,
  JSON_UNQUOTE(JSON_EXTRACT(s.messageHistory, CONCAT('\$[', $POS + n.i - 3, '].senderName'))) AS sender_name,
  JSON_UNQUOTE(JSON_EXTRACT(s.messageHistory, CONCAT('\$[', $POS + n.i - 3, '].opMsgId'))) AS message_id,
  LEFT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(s.messageHistory, CONCAT('\$[', $POS + n.i - 3, '].content'))), '[\r\n]+', ' '), 120) AS text_start
FROM (SELECT openPhoneMessageId AS mid, MIN(receivedAt) AS receivedAt FROM inbound_sms
      WHERE RIGHT(REGEXP_REPLACE(fromPhone, '[^0-9]', ''), 10) = $P10 AND receivedAt >= (UNIX_TIMESTAMP(NOW() - INTERVAL 30 DAY) * 1000)
      GROUP BY openPhoneMessageId ORDER BY MIN(receivedAt) DESC LIMIT 6) m
JOIN conversation_sessions s ON RIGHT(REGEXP_REPLACE(s.leadPhone, '[^0-9]', ''), 10) = $P10 AND LOCATE(m.mid, s.messageHistory) > 0
JOIN $NUMS n ON n.i <= 8 AND $POS + n.i >= 3 AND $POS + n.i - 3 < JSON_LENGTH(s.messageHistory)
ORDER BY m.receivedAt DESC, n.i;

SELECT CONCAT('U1. Customer texts in the last ', $DAYS, ' days with no reply attempt, or a failed attempt without a staff task: by category') AS section;
$F SELECT kind, category, COUNT(*) AS texts FROM cat GROUP BY kind, category ORDER BY kind, category;

SELECT 'U2. Unanswered texts (category C): full failure record and why no staff task was created' AS section;
$F SELECT c.kind, FROM_UNIXTIME(c.receivedAt / 1000) AS received_eastern, RIGHT(c.p10, 4) AS phone4, c.mid AS message_id,
  LEFT(c.msg, 55) AS text_start, c.sid AS conversation, c.smsOptOut AS opted_out_now, c.copies,
  dr.status, dr.errorStage, dr.errorCode, dr.errorMessage AS failure_record,
  TIMESTAMPDIFF(SECOND, dr.createdAt, dr.updatedAt) AS attempt_seconds,
  LEFT(dr.capabilityResult, 160) AS attempt_state,
  JSON_UNQUOTE(JSON_EXTRACT(dr.resolvedContext, '\$.receivingPhoneNumberId')) AS line_at_attempt, c.lineNow AS line_now,
  (SELECT GROUP_CONCAT(CONCAT(t.off, ':', COALESCE(t.role, '?'), '@', ROUND(t.after_ms / 1000), 's', IF(t.who IS NULL, '', CONCAT('/', t.who))) ORDER BY t.off SEPARATOR ' | ')
     FROM turns t WHERE t.mid = c.mid AND t.sid = c.sid AND t.off <= 6) AS turns_after,
  CONCAT('@inboundMessageId:', c.mid) AS railway_log_search
FROM cat c LEFT JOIN madison_sms_drafts dr ON dr.id = c.draftId
WHERE c.category LIKE 'C %' ORDER BY c.receivedAt DESC;

SELECT 'U3. Full text of each unanswered customer text (category C)' AS section;
$F SELECT FROM_UNIXTIME(receivedAt / 1000) AS received_eastern, mid AS message_id, (SELECT LEFT(REGEXP_REPLACE(MIN(message), '[\r\n]+', ' '), 600)
  FROM inbound_sms WHERE openPhoneMessageId = cat.mid) AS customer_text FROM cat WHERE category LIKE 'C %' ORDER BY receivedAt DESC;

SELECT 'R1. Did the later reply address the request? (categories B; customer text, follow-ups within 10 min, the first two replies after)' AS section;
$F SELECT c.category, c.kind, FROM_UNIXTIME(c.receivedAt / 1000) AS received_eastern, RIGHT(c.p10, 4) AS phone4, c.mid AS message_id,
  (SELECT LEFT(REGEXP_REPLACE(MIN(message), '[\r\n]+', ' '), 300) FROM inbound_sms WHERE openPhoneMessageId = c.mid) AS customer_text,
  c.burst_outcome AS follow_up_outcome,
  (SELECT GROUP_CONCAT(CONCAT('+', ROUND(t.after_ms / 1000), 's: ', LEFT(t.txt, 200)) ORDER BY t.off SEPARATOR ' || ')
     FROM turns t WHERE t.mid = c.mid AND t.sid = c.sid AND t.role IN ('user', 'customer') AND t.after_ms <= 600000
       AND (c.replyOff IS NULL OR t.off < c.replyOff)) AS follow_ups,
  SUBSTRING_INDEX((SELECT GROUP_CONCAT(CONCAT('+', ROUND(t.after_ms / 60000), 'min ', COALESCE(t.who, t.role), ': ', t.txt) ORDER BY t.off SEPARATOR ' || ')
     FROM turns t WHERE t.mid = c.mid AND t.sid = c.sid AND t.role IN ('assistant', 'agent', 'office')), ' || ', 2) AS first_replies
FROM cat c WHERE c.category LIKE 'B %' ORDER BY c.category, c.receivedAt DESC;
COMMIT;"
# Refuse to run anything but reads (the read-only snapshot transaction also enforces this in the database).
if printf '%s' "$SQL" | grep -Eiq '\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE|RENAME|LOAD|CALL|LOCK)\b[^_]'; then
  die "Internal check failed: the query text contains a write statement. Nothing was run."
fi

echo "Checking database \"$DB_NAME\" (read-only snapshot)..."
OUT="$HOME/sms-drilldown-$(date +%Y%m%d-%H%M%S).txt"
printf '%s\n' "$SQL" | "$MYSQL" --defaults-extra-file="$TMP/my.cnf" --table --connect-timeout=20 "$DB_NAME" | tee "$OUT" \
  || die "The query did not complete (see the message above). Nothing was changed."
echo; echo "Done. Nothing was changed. The full output is saved in: $OUT  (send me that file)"
