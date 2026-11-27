#!/bin/bash
# READ-ONLY diagnostic: what happened to inbound customer texts (automatic Claude reply, failure, or no attempt).
#
#   bash sms-reply-check.sh <customer phone, 10 digits> [days, default 7]
#
# It asks for a DATABASE_URL (hidden; never shown, saved or logged). Every query runs inside ONE read-only snapshot
# transaction (START TRANSACTION READ ONLY AS OF TIMESTAMP): the database itself rejects any write in it. The script
# also refuses to run if its own SQL contains a write statement. Nothing is changed, sent or charged.
# Output: (A) the full trail for one customer number, (B) counts and examples for all inbound texts in the last N days.
# Needs the mysql client (Homebrew: mysql-client@8.4).
set -euo pipefail

PHONE10="${1:-}"; DAYS="${2:-7}"
[[ "$PHONE10" =~ ^[0-9]{10}$ ]] || { echo "Usage: bash $0 <customer phone, 10 digits, e.g. 2025550101> [days]"; exit 2; }
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

SQL="SET SESSION time_zone = 'America/New_York';
START TRANSACTION READ ONLY AS OF TIMESTAMP NOW() - INTERVAL 5 SECOND;
SELECT DATABASE() AS database_checked, NOW() AS checked_at_eastern, $DAYS AS days_checked;

SELECT 'A1. Texts received from the customer number (last 30 days; inbound_sms)' AS section;
SELECT id, FROM_UNIXTIME(receivedAt / 1000) AS received_eastern, openPhoneMessageId AS message_id,
  LEFT(REGEXP_REPLACE(message, '[\r\n]+', ' '), 90) AS text_start, processingStatus
FROM inbound_sms WHERE RIGHT(REGEXP_REPLACE(fromPhone, '[^0-9]', ''), 10) = $P10
  AND receivedAt >= (UNIX_TIMESTAMP(NOW() - INTERVAL 30 DAY) * 1000) ORDER BY receivedAt DESC LIMIT 15;

SELECT 'A2. Reply attempts for this number (madison_sms_drafts; Claude = claude_customer_reply_v1)' AS section;
SELECT id, createdAt AS created_server_time, updatedAt AS updated_server_time, inboundOpenPhoneId AS message_id, COALESCE(capability, '(Madison)') AS handled_by, status,
  errorStage, errorCode, LEFT(errorMessage, 400) AS failure_detail, LEFT(REGEXP_REPLACE(generatedDraft, '[\r\n]+', ' '), 70) AS reply_start,
  outboundOpenPhoneId IS NOT NULL AS has_sent_id, dismissedBy, sessionId
FROM madison_sms_drafts WHERE RIGHT(REGEXP_REPLACE(fromPhone, '[^0-9]', ''), 10) = $P10
  AND createdAt >= NOW() - INTERVAL 31 DAY ORDER BY id DESC LIMIT 15;

SELECT 'A3. Conversations for this number' AS section;
SELECT id, leadSource, csQueue, smsOptOut, stage, lastInboundPhoneNumberId, updatedAt, JSON_LENGTH(messageHistory) AS turns
FROM conversation_sessions WHERE RIGHT(REGEXP_REPLACE(leadPhone, '[^0-9]', ''), 10) = $P10 ORDER BY updatedAt DESC LIMIT 5;

SELECT 'A4. Last 10 turns of the most recent conversation (newest first)' AS section;
SELECT n.i AS turns_from_end, JSON_UNQUOTE(JSON_EXTRACT(s.messageHistory, CONCAT('\$[', JSON_LENGTH(s.messageHistory) - 1 - n.i, '].role'))) AS role,
  FROM_UNIXTIME(JSON_EXTRACT(s.messageHistory, CONCAT('\$[', JSON_LENGTH(s.messageHistory) - 1 - n.i, '].ts')) / 1000) AS at_eastern,
  JSON_UNQUOTE(JSON_EXTRACT(s.messageHistory, CONCAT('\$[', JSON_LENGTH(s.messageHistory) - 1 - n.i, '].opMsgId'))) AS message_id,
  JSON_UNQUOTE(JSON_EXTRACT(s.messageHistory, CONCAT('\$[', JSON_LENGTH(s.messageHistory) - 1 - n.i, '].senderName'))) AS sender_name,
  LEFT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(s.messageHistory, CONCAT('\$[', JSON_LENGTH(s.messageHistory) - 1 - n.i, '].content'))), '[\r\n]+', ' '), 70) AS text_start
FROM (SELECT id, messageHistory FROM conversation_sessions WHERE RIGHT(REGEXP_REPLACE(leadPhone, '[^0-9]', ''), 10) = $P10
      ORDER BY updatedAt DESC LIMIT 1) s
JOIN (SELECT 0 i UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
      UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) n ON n.i < JSON_LENGTH(s.messageHistory)
ORDER BY n.i;

SELECT 'A5. Staff tasks for this number (last 30 days)' AS section;
SELECT id, createdAt, body AS title, cardStatus, JSON_UNQUOTE(JSON_EXTRACT(metadata, '\$.task.status')) AS task_status,
  JSON_UNQUOTE(JSON_EXTRACT(metadata, '\$.task.sourceMessageId')) AS for_message_id,
  JSON_UNQUOTE(JSON_EXTRACT(metadata, '\$.task.reply.status')) AS reply_status
FROM ops_chat_messages WHERE quickAction = 'claude_customer_task' AND createdAt >= NOW() - INTERVAL 31 DAY
  AND RIGHT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(metadata, '\$.task.customerPhone')), '[^0-9]', ''), 10) = $P10 ORDER BY id DESC LIMIT 10;

SELECT 'A6. Opted out of texts?' AS section;
SELECT COUNT(*) AS opt_out_rows FROM sms_opt_outs WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10) = $P10;

SELECT CONCAT('B1. All inbound texts in the last ', $DAYS, ' days, by outcome') AS section;
$X SELECT outcome, sender, COUNT(*) AS texts, SUM(taskId IS NOT NULL) AS with_staff_task FROM x GROUP BY outcome, sender ORDER BY sender, outcome;

SELECT 'B2. Why Claude stopped (customer texts only)' AS section;
$X SELECT errorStage, errorCode, failPhase, failCode, failName, COUNT(*) AS texts, SUM(taskId IS NOT NULL) AS with_staff_task
FROM x WHERE sender = 'customer' AND capability = 'claude_customer_reply_v1' AND status = 'DISMISSED'
GROUP BY errorStage, errorCode, failPhase, failCode, failName ORDER BY texts DESC;

SELECT 'B3. Examples: up to 6 most recent customer texts per outcome that got no automatic reply' AS section;
$X SELECT outcome, received_eastern, phone_last4, text_start, failCode, staff_task FROM (
  SELECT outcome, FROM_UNIXTIME(receivedAt / 1000) AS received_eastern, RIGHT(p10, 4) AS phone_last4, msg AS text_start,
    COALESCE(failCode, errorCode) AS failCode, IF(taskId IS NULL, 'no', CONCAT('yes: ', LEFT(taskTitle, 40))) AS staff_task,
    ROW_NUMBER() OVER (PARTITION BY outcome ORDER BY receivedAt DESC) AS rn
  FROM x WHERE sender = 'customer' AND outcome NOT LIKE '1 %') e
WHERE rn <= 6 ORDER BY outcome, received_eastern DESC;

SELECT 'B4. Customer texts per day and outcome group' AS section;
$X SELECT DATE(FROM_UNIXTIME(receivedAt / 1000)) AS day_eastern, COUNT(*) AS customer_texts,
  SUM(outcome LIKE '1 %') AS replied, SUM(outcome LIKE '2 %') AS uncertain, SUM(outcome LIKE '3 %') AS stopped, SUM(outcome LIKE '4 %') AS never_finished,
  SUM(outcome LIKE '6 %') AS madison_only, SUM(outcome LIKE '7 %') AS no_attempt
FROM x WHERE sender = 'customer' GROUP BY 1 ORDER BY 1;
COMMIT;"

# Refuse to run anything but reads (the read-only snapshot transaction also enforces this in the database).
if printf '%s' "$SQL" | grep -Eiq '\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE|RENAME|LOAD|CALL|LOCK)\b[^_]'; then
  die "Internal check failed: the query text contains a write statement. Nothing was run."
fi

echo "Checking database \"$DB_NAME\" (read-only snapshot)..."
printf '%s\n' "$SQL" | "$MYSQL" --defaults-extra-file="$TMP/my.cnf" --table --connect-timeout=20 "$DB_NAME" \
  || die "The query did not complete (see the message above). Nothing was changed."
echo; echo "Done. Nothing was changed. Copy everything above and send it back."
