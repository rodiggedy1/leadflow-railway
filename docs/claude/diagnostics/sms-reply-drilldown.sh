#!/bin/bash
# READ-ONLY drill-down: every customer text with no reply attempt, or a failed attempt without a staff task, with
# what came after it in the conversation (follow-up text, staff reply, automatic reply), plus one message in detail.
#
#   bash sms-reply-drilldown.sh <phone, 10 digits> <message ID, e.g. AC7c77...> [days, default 7]
#
# It asks for a DATABASE_URL (hidden; never shown, saved or logged). Every query runs inside ONE read-only snapshot
# transaction (START TRANSACTION READ ONLY AS OF TIMESTAMP): the database itself rejects any write in it. The script
# also refuses to run if its own SQL contains a write statement. Nothing is changed, sent or charged.
# Output: (A) the full trail for one customer number, (B) counts and examples for all inbound texts in the last N days.
# Needs the mysql client (Homebrew: mysql-client@8.4).
set -euo pipefail

PHONE10="${1:-}"; MID="${2:-}"; DAYS="${3:-7}"
[[ "$PHONE10" =~ ^[0-9]{10}$ ]] && [[ "$MID" =~ ^[A-Za-z0-9_-]{6,80}$ ]] || { echo "Usage: bash $0 <phone, 10 digits> <message ID> [days]"; exit 2; }
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
# Texts to explain: customer texts with no reply attempt, and failed attempts without a staff task.
F="$X,
  focus AS (SELECT x.*, CASE WHEN outcome LIKE '7 %' THEN 'no attempt' ELSE CONCAT('failed, no task: ', COALESCE(failCode, errorCode, '?')) END AS kind
    FROM x WHERE sender = 'customer' AND (outcome LIKE '7 %' OR (outcome LIKE '3 %' AND taskId IS NULL))),
  sess AS (SELECT f.mid, s.id AS sid, s.leadSource, s.smsOptOut, s.messageHistory AS h,
      CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(JSON_UNQUOTE(JSON_SEARCH(s.messageHistory, 'one', f.mid)), ']', 1), '[', -1) AS UNSIGNED) AS idx,
      JSON_LENGTH(JSON_SEARCH(s.messageHistory, 'all', f.mid)) AS copies
    FROM focus f JOIN conversation_sessions s ON s.leadPhone = CONCAT('+1', f.p10) AND LOCATE(f.mid, s.messageHistory) > 0),
  turns AS (SELECT se.mid, se.sid, n.i AS off,
      JSON_UNQUOTE(JSON_EXTRACT(se.h, CONCAT('\$[', se.idx + n.i, '].role'))) AS role,
      JSON_EXTRACT(se.h, CONCAT('\$[', se.idx + n.i, '].ts')) - JSON_EXTRACT(se.h, CONCAT('\$[', se.idx, '].ts')) AS after_ms,
      JSON_UNQUOTE(JSON_EXTRACT(se.h, CONCAT('\$[', se.idx + n.i, '].senderName'))) AS who,
      JSON_UNQUOTE(JSON_EXTRACT(se.h, CONCAT('\$[', se.idx + n.i, '].opMsgId'))) AS tmid,
      LEFT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(se.h, CONCAT('\$[', se.idx + n.i, '].content'))), '[\r\n]+', ' '), 110) AS txt
    FROM sess se JOIN $NUMS n ON n.i BETWEEN 1 AND 49 AND se.idx + n.i < JSON_LENGTH(se.h)),
  firsts AS (SELECT mid, sid,
      MIN(CASE WHEN role IN ('assistant', 'agent', 'office') THEN off END) AS replyOff,
      MIN(CASE WHEN role IN ('user', 'customer') AND after_ms <= 180000 THEN off END) AS burstOff,
      MIN(CASE WHEN role IN ('user', 'customer') THEN off END) AS nextInOff
    FROM turns GROUP BY mid, sid),
  detail AS (SELECT f.mid, f.kind, f.receivedAt, f.p10, f.msg, f.failCode, f.failName, se.sid, se.leadSource, se.smsOptOut, se.copies,
      nt.role AS next_role, ROUND(nt.after_ms / 1000) AS next_after_s, nt.who AS next_who,
      bt.tmid AS burst_mid, ROUND(bt.after_ms / 1000) AS burst_after_s,
      rt.who AS reply_who, ROUND(rt.after_ms / 60000) AS reply_after_min, rt.txt AS reply_text
    FROM focus f LEFT JOIN sess se ON se.mid = f.mid
    LEFT JOIN firsts fi ON fi.mid = f.mid AND fi.sid = se.sid
    LEFT JOIN turns nt ON nt.mid = f.mid AND nt.sid = se.sid AND nt.off = 1
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
START TRANSACTION READ ONLY AS OF TIMESTAMP NOW() - INTERVAL 5 SECOND;
SELECT DATABASE() AS database_checked, NOW() AS checked_at_eastern, $DAYS AS days_checked;

SELECT 'T1. The message: texts from this number within 30 minutes of it' AS section;
SELECT s.id, FROM_UNIXTIME(s.receivedAt / 1000) AS received_eastern, s.openPhoneMessageId AS message_id,
  ROUND((s.receivedAt - m.receivedAt) / 1000) AS seconds_from_message, LEFT(REGEXP_REPLACE(s.message, '[\r\n]+', ' '), 90) AS text_start
FROM inbound_sms s JOIN (SELECT MIN(receivedAt) AS receivedAt FROM inbound_sms WHERE openPhoneMessageId = $MIDQ) m
WHERE RIGHT(REGEXP_REPLACE(s.fromPhone, '[^0-9]', ''), 10) = $P10 AND ABS(s.receivedAt - m.receivedAt) <= 1800000 ORDER BY s.receivedAt;

SELECT 'T2. Reply-attempt records for the message (any system)' AS section;
SELECT id, createdAt AS created_server_time, COALESCE(capability, '(Madison)') AS handled_by, status, errorStage, errorCode,
  LEFT(errorMessage, 300) AS failure_detail, approvedBy, dismissedBy, outboundOpenPhoneId IS NOT NULL AS has_sent_id
FROM madison_sms_drafts WHERE inboundOpenPhoneId = $MIDQ;

SELECT 'T3. Conversations holding the message, and where it sits' AS section;
SELECT id, leadSource, csQueue, smsOptOut, lastInboundPhoneNumberId, JSON_LENGTH(messageHistory) AS turns,
  JSON_UNQUOTE(JSON_SEARCH(messageHistory, 'all', $MIDQ)) AS found_at
FROM conversation_sessions WHERE RIGHT(REGEXP_REPLACE(leadPhone, '[^0-9]', ''), 10) = $P10 AND LOCATE($MIDQ, messageHistory) > 0;

SELECT 'T4. Turns around the message (offset 0 = the message; seconds relative to it)' AS section;
SELECT s.id AS conversation, n.i - 4 AS offset,
  JSON_UNQUOTE(JSON_EXTRACT(s.messageHistory, CONCAT('\$[', p.idx + n.i - 4, '].role'))) AS role,
  ROUND((JSON_EXTRACT(s.messageHistory, CONCAT('\$[', p.idx + n.i - 4, '].ts')) - JSON_EXTRACT(s.messageHistory, CONCAT('\$[', p.idx, '].ts'))) / 1000) AS seconds,
  FROM_UNIXTIME(JSON_EXTRACT(s.messageHistory, CONCAT('\$[', p.idx + n.i - 4, '].ts')) / 1000) AS at_eastern,
  JSON_UNQUOTE(JSON_EXTRACT(s.messageHistory, CONCAT('\$[', p.idx + n.i - 4, '].senderName'))) AS sender_name,
  JSON_UNQUOTE(JSON_EXTRACT(s.messageHistory, CONCAT('\$[', p.idx + n.i - 4, '].opMsgId'))) AS message_id,
  JSON_KEYS(JSON_EXTRACT(s.messageHistory, CONCAT('\$[', p.idx + n.i - 4, ']'))) AS fields,
  LEFT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(s.messageHistory, CONCAT('\$[', p.idx + n.i - 4, '].content'))), '[\r\n]+', ' '), 90) AS text_start
FROM conversation_sessions s
JOIN (SELECT id, CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(JSON_UNQUOTE(JSON_SEARCH(messageHistory, 'one', $MIDQ)), ']', 1), '[', -1) AS UNSIGNED) AS idx
      FROM conversation_sessions WHERE RIGHT(REGEXP_REPLACE(leadPhone, '[^0-9]', ''), 10) = $P10 AND LOCATE($MIDQ, messageHistory) > 0) p ON p.id = s.id
JOIN $NUMS n ON n.i <= 16 AND p.idx + n.i >= 4 AND p.idx + n.i - 4 < JSON_LENGTH(s.messageHistory)
ORDER BY s.id, n.i;

SELECT 'T5. Exclusion rules checked against the message (as the conversation is now; turns timestamped up to 3 min after it existed at decision time)' AS section;
SELECT s.id AS conversation, s.smsOptOut AS rule_opted_out, (SELECT COUNT(*) FROM sms_opt_outs o WHERE RIGHT(REGEXP_REPLACE(o.phone, '[^0-9]', ''), 10) = $P10) AS rule_opt_out_list,
  JSON_LENGTH(JSON_SEARCH(s.messageHistory, 'all', $MIDQ)) AS rule_id_copies_must_be_1,
  JSON_UNQUOTE(JSON_EXTRACT(s.messageHistory, CONCAT('\$[', p.idx, '].content'))) = (SELECT MIN(message) FROM inbound_sms WHERE openPhoneMessageId = $MIDQ) AS rule_text_matches_log,
  (SELECT COUNT(*) FROM $NUMS n WHERE n.i < JSON_LENGTH(s.messageHistory) AND n.i <> p.idx
     AND JSON_UNQUOTE(JSON_EXTRACT(s.messageHistory, CONCAT('\$[', n.i, '].role'))) IN ('user', 'customer', 'assistant', 'agent', 'office')
     AND JSON_EXTRACT(s.messageHistory, CONCAT('\$[', n.i, '].ts')) > JSON_EXTRACT(s.messageHistory, CONCAT('\$[', p.idx, '].ts'))
     AND JSON_EXTRACT(s.messageHistory, CONCAT('\$[', n.i, '].ts')) <= JSON_EXTRACT(s.messageHistory, CONCAT('\$[', p.idx, '].ts')) + 180000) AS rule_turns_within_3_min_after,
  (SELECT COUNT(*) FROM $NUMS n WHERE n.i < JSON_LENGTH(s.messageHistory) AND n.i > p.idx
     AND JSON_EXTRACT(s.messageHistory, CONCAT('\$[', n.i, '].ts')) < JSON_EXTRACT(s.messageHistory, CONCAT('\$[', p.idx, '].ts'))) AS later_position_earlier_time,
  s.lastInboundPhoneNumberId AS line_now
FROM conversation_sessions s
JOIN (SELECT id, CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(JSON_UNQUOTE(JSON_SEARCH(messageHistory, 'one', $MIDQ)), ']', 1), '[', -1) AS UNSIGNED) AS idx
      FROM conversation_sessions WHERE RIGHT(REGEXP_REPLACE(leadPhone, '[^0-9]', ''), 10) = $P10 AND LOCATE($MIDQ, messageHistory) > 0) p ON p.id = s.id;

SELECT CONCAT('U1. Customer texts in the last ', $DAYS, ' days with no reply attempt, or a failed attempt without a staff task: by category') AS section;
$F SELECT kind, category, COUNT(*) AS texts FROM cat GROUP BY kind, category ORDER BY kind, category;

SELECT 'U2. Failure codes of failed attempts without a staff task' AS section;
$F SELECT failCode, failName, COUNT(*) AS texts, SUM(burst_mid IS NOT NULL) AS customer_texted_again_within_3_min,
  SUM(next_role IN ('assistant', 'agent', 'office')) AS next_was_a_reply FROM cat WHERE kind LIKE 'failed%' GROUP BY failCode, failName ORDER BY texts DESC;

SELECT 'U3. Every one of those texts (newest first)' AS section;
$F SELECT category, kind, FROM_UNIXTIME(receivedAt / 1000) AS received_eastern, RIGHT(p10, 4) AS phone4, msg AS customer_text,
  sid AS conversation, copies, next_role, next_after_s, next_who, burst_after_s, burst_outcome,
  reply_who, reply_after_min, reply_text
FROM cat ORDER BY category, receivedAt DESC;
COMMIT;"
# Refuse to run anything but reads (the read-only snapshot transaction also enforces this in the database).
if printf '%s' "$SQL" | grep -Eiq '\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE|RENAME|LOAD|CALL|LOCK)\b[^_]'; then
  die "Internal check failed: the query text contains a write statement. Nothing was run."
fi

echo "Checking database \"$DB_NAME\" (read-only snapshot)..."
printf '%s\n' "$SQL" | "$MYSQL" --defaults-extra-file="$TMP/my.cnf" --table --connect-timeout=20 "$DB_NAME" \
  || die "The query did not complete (see the message above). Nothing was changed."
echo; echo "Done. Nothing was changed. Copy everything above and send it back."
