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

WEEK="${1:-current}"
[[ "$WEEK" == current || "$WEEK" =~ ^20[0-9]{2}-[01][0-9]-[0-3][0-9]$ ]] || { echo "Usage: bash $0 [YYYY-MM-DD Sunday]"; exit 2; }
DAYS=7
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
NUMS="(SELECT a.d + 10 * b.d + 100 * c.d AS i FROM $DIG a CROSS JOIN $DIG b CROSS JOIN $DIG c)"
# Week window (Sunday-start, America/New_York), like the leaderboard. Comparisons use DATE/number values only, never text
# variables, so they work whatever collation a table column or the client connection uses.
WK="SET @today = DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York'));
SET @ws = IF('$WEEK' = 'current', DATE_SUB(@today, INTERVAL DAYOFWEEK(@today) - 1 DAY), DATE('$WEEK'));
SET @we = DATE_ADD(@ws, INTERVAL 6 DAY), @through = LEAST(DATE_ADD(@ws, INTERVAL 6 DAY), @today);
SET @wsS = DATE_FORMAT(@ws, '%Y-%m-%d'), @throughS = DATE_FORMAT(@through, '%Y-%m-%d'), @todayS = DATE_FORMAT(@today, '%Y-%m-%d');
SET @startUtc = CONVERT_TZ(CONCAT(@wsS, ' 00:00:00'), 'America/New_York', '+00:00');
SET @endUtc = LEAST(CONVERT_TZ(CONCAT(DATE_FORMAT(DATE_ADD(@ws, INTERVAL 7 DAY), '%Y-%m-%d'), ' 00:00:00'), 'America/New_York', '+00:00'), NOW());
SET @startMs = UNIX_TIMESTAMP(FROM_UNIXTIME(@startMs / 1000)) * 1000, @endMs = UNIX_TIMESTAMP(FROM_UNIXTIME(@endMs / 1000)) * 1000;"
# The leaderboard's job cohort and team mapping (same rules as teamLeaderboardHistoryMetrics.ts).
J="WITH jobs AS (
    SELECT j.id, j.jobDate, j.bookingStatus, j.teamId, j.customerRating,
      (j.launch27BookingId IS NOT NULL OR j.origin = 'launch27_import' OR (j.bookingId IS NULL AND j.origin = 'leadflow_recurrence')) AS imported
    FROM leadflow_jobs j WHERE STR_TO_DATE(j.jobDate, '%Y-%m-%d') BETWEEN DATE(@wsS) AND DATE(@throughS)
      AND LOWER(TRIM(COALESCE(j.bookingStatus, ''))) NOT IN ('canceled', 'cancelled', 'missing_from_launch27', 'rescheduled')),
  mapped AS (SELECT jobs.*,
      (SELECT COUNT(*) FROM scheduling_teams t WHERE (jobs.imported AND t.launch27TeamId = jobs.teamId) OR (NOT jobs.imported AND t.id = jobs.teamId)) AS matches,
      (SELECT MIN(t.id) FROM scheduling_teams t WHERE (jobs.imported AND t.launch27TeamId = jobs.teamId) OR (NOT jobs.imported AND t.id = jobs.teamId)) AS sid
    FROM jobs),
  prog AS (SELECT p.leadflowJobId AS jid, COUNT(*) AS n, MAX(p.etaTimestamp IS NOT NULL) AS hasEta
    FROM cleaner_portal_job_progress p JOIN jobs ON jobs.id = p.leadflowJobId GROUP BY p.leadflowJobId),
  pho AS (SELECT p.leadflowJobId AS jid, MAX(TRIM(p.photoUrl) <> '') AS hasPhoto
    FROM cleaner_portal_job_photos p JOIN jobs ON jobs.id = p.leadflowJobId GROUP BY p.leadflowJobId)"

SQL="SET SESSION time_zone = '+00:00';
SET SESSION group_concat_max_len = 100000;
$WK
START TRANSACTION READ ONLY AS OF TIMESTAMP NOW() - INTERVAL 5 SECOND;
SELECT DATABASE() AS database_checked, @wsS AS week_start_sunday, @throughS AS through_date, @todayS AS today_eastern,
  CONVERT_TZ(@startUtc, '+00:00', 'America/New_York') AS window_start_et, CONVERT_TZ(@endUtc, '+00:00', 'America/New_York') AS window_end_et;

SELECT 'L1. Per team (jobs already done = jobDate before today; a job with no portal record counts as a missed ETA)' AS section;
$J SELECT t.id AS team_id, t.name AS team, t.isActive AS active,
  COUNT(m.id) AS jobs_in_week, SUM(STR_TO_DATE(m.jobDate, '%Y-%m-%d') < DATE(@todayS)) AS jobs_done, SUM(STR_TO_DATE(m.jobDate, '%Y-%m-%d') >= DATE(@todayS)) AS jobs_today_or_later,
  SUM(m.customerRating BETWEEN 1 AND 5) AS ratings, SUM(m.customerRating = 5) AS five_star,
  SUM(p.jid IS NOT NULL) AS with_portal_record, SUM(p.jid IS NULL) AS no_portal_record, SUM(COALESCE(p.hasEta, 0)) AS with_eta,
  SUM(COALESCE(ph.hasPhoto, 0)) AS with_photo, GROUP_CONCAT(DISTINCT m.bookingStatus ORDER BY m.bookingStatus) AS statuses
FROM scheduling_teams t LEFT JOIN mapped m ON m.matches = 1 AND m.sid = t.id
LEFT JOIN prog p ON p.jid = m.id LEFT JOIN pho ph ON ph.jid = m.id
GROUP BY t.id, t.name, t.isActive ORDER BY jobs_in_week DESC, t.name;

SELECT 'L2. What blocks a complete week today' AS section;
$J SELECT 'jobs not mapped to exactly one team' AS blocker, COUNT(*) AS jobs FROM mapped WHERE matches <> 1
UNION ALL SELECT 'jobs with no portal progress record (blocks today; will count as missed ETA)', COUNT(*) FROM mapped m LEFT JOIN prog p ON p.jid = m.id WHERE m.matches = 1 AND p.jid IS NULL
UNION ALL SELECT 'jobs with duplicate portal progress records (blocks today)', COUNT(*) FROM prog WHERE n > 1
UNION ALL SELECT 'jobs dated today or later (counted today although not done)', COUNT(*) FROM mapped WHERE STR_TO_DATE(jobDate, '%Y-%m-%d') >= DATE(@todayS);

SELECT 'L3. Up to 15 unmapped jobs' AS section;
$J SELECT id AS job_id, jobDate, bookingStatus, teamId, imported, matches FROM mapped WHERE matches <> 1 ORDER BY jobDate, id LIMIT 15;

SELECT 'L4. Team accounts for weekly texts (needs exactly one active cleaner account with a phone)' AS section;
SELECT t.id AS team_id, t.name AS team, t.launch27TeamId,
  (SELECT COUNT(*) FROM cleaner_profiles c WHERE c.isActive = 1 AND c.launch27TeamId = t.launch27TeamId) AS active_accounts,
  (SELECT RIGHT(REGEXP_REPLACE(MIN(c.phone), '[^0-9]', ''), 4) FROM cleaner_profiles c WHERE c.isActive = 1 AND c.launch27TeamId = t.launch27TeamId) AS phone_last4,
  (SELECT GROUP_CONCAT(DISTINCT c.language) FROM cleaner_profiles c WHERE c.isActive = 1 AND c.launch27TeamId = t.launch27TeamId) AS language
FROM scheduling_teams t ORDER BY t.name;

SELECT 'L5. Past Run review attempts (status, size of the saved read; TiDB rejects a row over 6 MB by default)' AS section;
SELECT id AS run_id, weekStart, status, CONVERT_TZ(FROM_UNIXTIME(createdAtMs / 1000), '+00:00', 'America/New_York') AS started_et,
  ROUND((updatedAtMs - createdAtMs) / 1000) AS seconds, ROUND(LENGTH(payload) / 1048576, 2) AS payload_mb, ROUND(LENGTH(progress) / 1024) AS progress_kb,
  publishedAtMs IS NOT NULL AS published, JSON_UNQUOTE(JSON_EXTRACT(progress, '\$.status')) AS progress_status
FROM team_review_runs ORDER BY createdAtMs DESC LIMIT 12;
SELECT weekStart, latestPublicationId FROM team_review_weeks ORDER BY weekStart DESC LIMIT 6;

SELECT 'L6. This week''s text the AI review would read (characters; about 4 characters per token)' AS section;
SELECT 'SMS conversation turns in the week' AS source, COUNT(*) AS items, SUM(LENGTH(c)) AS characters FROM (
  SELECT JSON_UNQUOTE(JSON_EXTRACT(s.messageHistory, CONCAT('\$[', n.i, '].content'))) AS c
  FROM (SELECT id, messageHistory FROM conversation_sessions WHERE createdAt < FROM_UNIXTIME(@endMs / 1000) AND updatedAt >= FROM_UNIXTIME(@startMs / 1000)) s
  JOIN $NUMS n ON n.i < JSON_LENGTH(s.messageHistory)
  WHERE JSON_EXTRACT(s.messageHistory, CONCAT('\$[', n.i, '].ts')) >= @startMs AND JSON_EXTRACT(s.messageHistory, CONCAT('\$[', n.i, '].ts')) < @endMs) t
UNION ALL SELECT 'conversations touched this week (read whole)', COUNT(*), SUM(LENGTH(messageHistory)) FROM conversation_sessions WHERE createdAt < FROM_UNIXTIME(@endMs / 1000) AND updatedAt >= FROM_UNIXTIME(@startMs / 1000)
UNION ALL SELECT 'inbound SMS log in the week', COUNT(*), SUM(LENGTH(message)) FROM inbound_sms WHERE receivedAt >= @startMs AND receivedAt < @endMs
UNION ALL SELECT 'Quo calls (transcripts) in the week', COUNT(*), SUM(LENGTH(transcript)) FROM openphone_call_recordings WHERE callStartedAt >= FROM_UNIXTIME(@startMs / 1000) AND callStartedAt < FROM_UNIXTIME(@endMs / 1000)
UNION ALL SELECT 'AI calls (transcripts) in the week', COUNT(*), SUM(LENGTH(transcript)) FROM voice_calls WHERE createdAt >= FROM_UNIXTIME(@startMs / 1000) AND createdAt < FROM_UNIXTIME(@endMs / 1000)
UNION ALL SELECT 'call_log table transcripts in the week', COUNT(*), SUM(LENGTH(transcript)) FROM call_log WHERE firedAt >= @startMs AND firedAt < @endMs
UNION ALL SELECT 'field-management calls (transcripts) in the week', COUNT(*), SUM(LENGTH(transcript)) FROM field_mgmt_calls WHERE completedAt >= FROM_UNIXTIME(@startMs / 1000) AND completedAt < FROM_UNIXTIME(@endMs / 1000)
UNION ALL SELECT 'confirmation calls (transcripts) in the week', COUNT(*), SUM(LENGTH(transcript)) FROM confirmation_calls WHERE firedAt >= @startMs AND firedAt < @endMs;

SELECT 'L7. Undated reads: what every run reads regardless of week (makes the saved read large)' AS section;
SELECT 'AI calls (all time)' AS source, COUNT(*) AS rows_read, ROUND(SUM(LENGTH(transcript)) / 1048576, 2) AS transcript_mb FROM voice_calls WHERE createdAt < FROM_UNIXTIME(@endMs / 1000)
UNION ALL SELECT 'field-management calls (all time)', COUNT(*), ROUND(SUM(LENGTH(transcript)) / 1048576, 2) FROM field_mgmt_calls WHERE createdAt < FROM_UNIXTIME(@endMs / 1000)
UNION ALL SELECT 'call_log rows without a fired time (all time)', COUNT(*), ROUND(SUM(LENGTH(transcript)) / 1048576, 2) FROM call_log WHERE (firedAt IS NULL OR firedAt <= @startMs) AND createdAt < FROM_UNIXTIME(@endMs / 1000)
UNION ALL SELECT 'confirmation_calls rows without a fired time (all time)', COUNT(*), ROUND(SUM(LENGTH(transcript)) / 1048576, 2) FROM confirmation_calls WHERE firedAt IS NULL OR firedAt <= @startMs
UNION ALL SELECT 'Gmail thread snippets (all time)', COUNT(*), ROUND(SUM(LENGTH(snippet)) / 1048576, 2) FROM gmail_thread_meta WHERE createdAt < FROM_UNIXTIME(@endMs / 1000);
COMMIT;"
# Refuse to run anything but reads (the read-only snapshot transaction also enforces this in the database).
if printf '%s' "$SQL" | grep -Eiq '\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE|RENAME|LOAD|CALL|LOCK)\b[^_]'; then
  die "Internal check failed: the query text contains a write statement. Nothing was run."
fi

echo "Checking database \"$DB_NAME\" (read-only snapshot)..."
OUT="$HOME/leaderboard-week-check-$(date +%Y%m%d-%H%M%S).txt"
printf '%s\n' "$SQL" | "$MYSQL" --defaults-extra-file="$TMP/my.cnf" --table --connect-timeout=20 "$DB_NAME" | tee "$OUT" \
  || die "The query did not complete (see the message above). Nothing was changed."
echo; echo "Done. Nothing was changed. The full output is saved in: $OUT  (send me that file)"
