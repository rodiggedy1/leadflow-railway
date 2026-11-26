#!/bin/bash
# STAGING ONLY: creates (or, with --remove, deletes) the fictional booking-change test data in leadflow_staging.
#
#   bash staging-test-data.sh            create / re-create the four "(Staging Test)" customers
#   bash staging-test-data.sh --remove   delete them again
#
# It asks you to paste the STAGING DATABASE_URL (hidden; never shown, saved or logged) and refuses anything whose
# database is not leadflow_staging. All writes run as ONE transaction: if any step fails or changes an unexpected
# number of rows, nothing is saved. Only rows carrying the test markers are touched. Nothing is sent or charged.
# The SQL is the same as in 01-create.sql (generated from it). Needs the mysql client (Homebrew: mysql-client@8.4).
set -euo pipefail

DB=leadflow_staging
MODE=create
case "${1:-}" in
  "") ;;
  --remove) MODE=remove ;;
  *) echo "Usage: bash $0 [--remove]"; exit 2 ;;
esac

die() { printf '\n\033[31mSTOPPED:\033[0m %s\n' "$*" >&2; exit 1; }
ok() { printf '  \033[32mPASS\033[0m %s\n' "$*"; }

# --- mysql client (8.4 first: the 9.x client cannot log in to TiDB Cloud with the usual password method) ---------
MYSQL=""
for c in /opt/homebrew/opt/mysql-client@8.4/bin/mysql /usr/local/opt/mysql-client@8.4/bin/mysql "$(command -v mysql || true)" \
         /opt/homebrew/opt/mysql-client/bin/mysql /usr/local/opt/mysql-client/bin/mysql; do
  if [ -n "$c" ] && [ -x "$c" ]; then MYSQL="$c"; break; fi
done
[ -n "$MYSQL" ] || die "mysql client not found. Install it with:  brew install mysql-client@8.4"

# --- staging connection string, typed hidden ------------------------------------------------------------------------
echo "Paste the STAGING DATABASE_URL (Railway > staging environment > leadflow-staging > Variables > DATABASE_URL)."
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
URL_DB="${BASH_REMATCH[6]}"
unset URL
[ "$URL_DB" = "$DB" ] || die "This connection string is for database \"$URL_DB\", not \"$DB\". Use the STAGING one only."

# Credentials go into a private temporary file (removed on exit), never onto the command line.
TMP="$(mktemp -d)"; chmod 700 "$TMP"; trap 'rm -rf "$TMP"' EXIT
q() { local s="${1//\\/\\\\}"; printf '"%s"' "${s//\"/\\\"}"; }
{
  echo "[client]"
  echo "host=$DB_HOST"
  echo "port=$DB_PORT"
  echo "user=$(q "$DB_USER")"
  echo "password=$(q "$DB_PASS")"
  echo "ssl-mode=${STAGING_SSL_MODE:-VERIFY_IDENTITY}"
  if [ "${STAGING_SSL_MODE:-VERIFY_IDENTITY}" != DISABLED ]; then echo "ssl-ca=${STAGING_SSL_CA:-/etc/ssl/cert.pem}"; fi
} > "$TMP/my.cnf"
chmod 600 "$TMP/my.cnf"; unset DB_PASS

sql() { "$MYSQL" --defaults-extra-file="$TMP/my.cnf" -D "$DB" "$@"; }
query() { # one query, plain output; stops with the server's message on any error
  local out
  if ! out="$(sql -N -B -e "$1" 2>"$TMP/err")"; then
    grep -q 2059 "$TMP/err" && die "Your mysql client can't use TiDB's login method. Run:  brew install mysql-client@8.4   then run this again."
    die "$(grep -v 'Using a password' "$TMP/err")"
  fi
  printf '%s' "$out"
}

echo; echo "Connecting to $DB_HOST as $DB_USER ..."
GOT_DB="$(query "SELECT DATABASE()")"
[ "$GOT_DB" = "$DB" ] || die "Connected database is \"$GOT_DB\", not \"$DB\"."
ok "connected; current database is $GOT_DB"

# --- Step 1 (read-only): same checks as 01-create.sql step 1 ------------------------------------------------------
DIAG="$(query "$(cat <<'SQL'
SELECT DATABASE() AS current_database,
  (SELECT COUNT(*) FROM bookings) AS existing_bookings,
  (SELECT GROUP_CONCAT(x.col) FROM (SELECT 'conversation_sessions.leadPhone' AS col UNION ALL SELECT 'conversation_sessions.leadName' AS col UNION ALL SELECT 'conversation_sessions.messageHistory' AS col UNION ALL SELECT 'bookings.publicBookingNumber' AS col UNION ALL SELECT 'bookings.idempotencyKey' AS col UNION ALL SELECT 'bookings.commandHash' AS col UNION ALL SELECT 'bookings.source' AS col UNION ALL SELECT 'bookings.status' AS col UNION ALL SELECT 'bookings.availabilityStatus' AS col UNION ALL SELECT 'bookings.assignmentStatus' AS col UNION ALL SELECT 'bookings.paymentStatus' AS col UNION ALL SELECT 'bookings.customerName' AS col UNION ALL SELECT 'bookings.customerPhone' AS col UNION ALL SELECT 'bookings.customerEmail' AS col UNION ALL SELECT 'bookings.serviceId' AS col UNION ALL SELECT 'bookings.serviceName' AS col UNION ALL SELECT 'bookings.bedrooms' AS col UNION ALL SELECT 'bookings.bathrooms' AS col UNION ALL SELECT 'bookings.homeType' AS col UNION ALL SELECT 'bookings.extras' AS col UNION ALL SELECT 'bookings.specialRequestNotes' AS col UNION ALL SELECT 'bookings.address' AS col UNION ALL SELECT 'bookings.requestedLocalDate' AS col UNION ALL SELECT 'bookings.requestedLocalTime' AS col UNION ALL SELECT 'bookings.requestedTimeZone' AS col UNION ALL SELECT 'bookings.requestedStartAt' AS col UNION ALL SELECT 'bookings.recurrence' AS col UNION ALL SELECT 'bookings.recurringIntentStatus' AS col UNION ALL SELECT 'bookings.pricingVersion' AS col UNION ALL SELECT 'bookings.firstCleaningTotalCents' AS col UNION ALL SELECT 'bookings.futureVisitTotalCents' AS col UNION ALL SELECT 'bookings.priceSnapshot' AS col UNION ALL SELECT 'bookings.createdAt' AS col UNION ALL SELECT 'bookings.updatedAt' AS col UNION ALL SELECT 'booking_series.bookingId' AS col UNION ALL SELECT 'booking_series.status' AS col UNION ALL SELECT 'booking_series.frequency' AS col UNION ALL SELECT 'booking_series.anchorLocalDate' AS col UNION ALL SELECT 'booking_series.anchorLocalTime' AS col UNION ALL SELECT 'booking_series.timeZone' AS col UNION ALL SELECT 'booking_series.firstCleaningTotalCents' AS col UNION ALL SELECT 'booking_series.futureVisitTotalCents' AS col UNION ALL SELECT 'booking_series.createdAt' AS col UNION ALL SELECT 'booking_series.updatedAt' AS col UNION ALL SELECT 'leadflow_jobs.origin' AS col UNION ALL SELECT 'leadflow_jobs.bookingId' AS col UNION ALL SELECT 'leadflow_jobs.jobDate' AS col UNION ALL SELECT 'leadflow_jobs.serviceDateTime' AS col UNION ALL SELECT 'leadflow_jobs.customerName' AS col UNION ALL SELECT 'leadflow_jobs.customerPhone' AS col UNION ALL SELECT 'leadflow_jobs.customerEmail' AS col UNION ALL SELECT 'leadflow_jobs.jobAddress' AS col UNION ALL SELECT 'leadflow_jobs.serviceName' AS col UNION ALL SELECT 'leadflow_jobs.bedrooms' AS col UNION ALL SELECT 'leadflow_jobs.bathrooms' AS col UNION ALL SELECT 'leadflow_jobs.extras' AS col UNION ALL SELECT 'leadflow_jobs.frequency' AS col UNION ALL SELECT 'leadflow_jobs.bookingStatus' AS col UNION ALL SELECT 'leadflow_jobs.teamName' AS col UNION ALL SELECT 'leadflow_jobs.jobTotalCents' AS col UNION ALL SELECT 'ops_chat_messages.channel' AS col UNION ALL SELECT 'ops_chat_messages.authorName' AS col UNION ALL SELECT 'ops_chat_messages.authorRole' AS col UNION ALL SELECT 'ops_chat_messages.body' AS col UNION ALL SELECT 'ops_chat_messages.quickAction' AS col UNION ALL SELECT 'ops_chat_messages.sessionId' AS col UNION ALL SELECT 'ops_chat_messages.cardStatus' AS col UNION ALL SELECT 'ops_chat_messages.activeDedupKey' AS col UNION ALL SELECT 'ops_chat_messages.lastActivityAt' AS col UNION ALL SELECT 'ops_chat_messages.metadata' AS col) AS x
     WHERE NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS c WHERE c.TABLE_SCHEMA = DATABASE() AND CONCAT(c.TABLE_NAME, '.', c.COLUMN_NAME) = x.col)) AS missing_columns,
  (SELECT GROUP_CONCAT(CONCAT(c.TABLE_NAME, '.', c.COLUMN_NAME)) FROM information_schema.COLUMNS c
     WHERE c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME IN ('conversation_sessions', 'bookings', 'booking_series', 'leadflow_jobs', 'ops_chat_messages') AND c.IS_NULLABLE = 'NO' AND c.COLUMN_DEFAULT IS NULL
       AND c.EXTRA NOT LIKE '%auto_increment%' AND CONCAT(c.TABLE_NAME, '.', c.COLUMN_NAME) NOT IN ('conversation_sessions.leadPhone', 'conversation_sessions.leadName', 'conversation_sessions.messageHistory', 'bookings.publicBookingNumber', 'bookings.idempotencyKey', 'bookings.commandHash', 'bookings.source', 'bookings.status', 'bookings.availabilityStatus', 'bookings.assignmentStatus', 'bookings.paymentStatus', 'bookings.customerName', 'bookings.customerPhone', 'bookings.customerEmail', 'bookings.serviceId', 'bookings.serviceName', 'bookings.bedrooms', 'bookings.bathrooms', 'bookings.homeType', 'bookings.extras', 'bookings.specialRequestNotes', 'bookings.address', 'bookings.requestedLocalDate', 'bookings.requestedLocalTime', 'bookings.requestedTimeZone', 'bookings.requestedStartAt', 'bookings.recurrence', 'bookings.recurringIntentStatus', 'bookings.pricingVersion', 'bookings.firstCleaningTotalCents', 'bookings.futureVisitTotalCents', 'bookings.priceSnapshot', 'bookings.createdAt', 'bookings.updatedAt', 'booking_series.bookingId', 'booking_series.status', 'booking_series.frequency', 'booking_series.anchorLocalDate', 'booking_series.anchorLocalTime', 'booking_series.timeZone', 'booking_series.firstCleaningTotalCents', 'booking_series.futureVisitTotalCents', 'booking_series.createdAt', 'booking_series.updatedAt', 'leadflow_jobs.origin', 'leadflow_jobs.bookingId', 'leadflow_jobs.jobDate', 'leadflow_jobs.serviceDateTime', 'leadflow_jobs.customerName', 'leadflow_jobs.customerPhone', 'leadflow_jobs.customerEmail', 'leadflow_jobs.jobAddress', 'leadflow_jobs.serviceName', 'leadflow_jobs.bedrooms', 'leadflow_jobs.bathrooms', 'leadflow_jobs.extras', 'leadflow_jobs.frequency', 'leadflow_jobs.bookingStatus', 'leadflow_jobs.teamName', 'leadflow_jobs.jobTotalCents', 'ops_chat_messages.channel', 'ops_chat_messages.authorName', 'ops_chat_messages.authorRole', 'ops_chat_messages.body', 'ops_chat_messages.quickAction', 'ops_chat_messages.sessionId', 'ops_chat_messages.cardStatus', 'ops_chat_messages.activeDedupKey', 'ops_chat_messages.lastActivityAt', 'ops_chat_messages.metadata')) AS required_columns_not_filled,
  CONVERT_TZ('2026-12-01 10:00:00', 'America/New_York', '+00:00') AS timezone_check;
SQL
)")"
IFS=$'\t' read -r D_DB D_BOOKINGS D_MISSING D_REQUIRED D_TZ <<< "$DIAG"
[ "$D_DB" = "$DB" ] || die "Step 1: current_database = $D_DB"
[ "$D_MISSING" = "NULL" ] || die "Step 1: missing_columns = $D_MISSING (send this line to Claude)"
[ "$D_REQUIRED" = "NULL" ] || die "Step 1: required_columns_not_filled = $D_REQUIRED (send this line to Claude)"
[ "$D_TZ" = "2026-12-01 15:00:00" ] || die "Step 1: timezone_check = $D_TZ (expected 2026-12-01 15:00:00)"
ok "step 1 schema and time-zone check ($D_BOOKINGS bookings already in staging)"

# Rows that are NOT test data, per table. Must be identical before and after.
OTHER_ROWS_SQL="$(cat <<'SQL'
SELECT CONCAT_WS(' / ',
  (SELECT COUNT(*) FROM conversation_sessions WHERE NOT (leadName LIKE '% (Staging Test)' AND leadPhone IN ('+12025550101', '+12025550102', '+12025550103', '+12025550104'))),
  (SELECT COUNT(*) FROM bookings WHERE publicBookingNumber IS NULL OR publicBookingNumber NOT LIKE 'STG-TEST-%'),
  (SELECT COUNT(*) FROM booking_series WHERE bookingId NOT IN (SELECT id FROM bookings WHERE publicBookingNumber LIKE 'STG-TEST-%')),
  (SELECT COUNT(*) FROM leadflow_jobs WHERE bookingId IS NULL OR bookingId NOT IN (SELECT id FROM bookings WHERE publicBookingNumber LIKE 'STG-TEST-%')),
  (SELECT COUNT(*) FROM ops_chat_messages WHERE activeDedupKey IS NULL OR (activeDedupKey NOT LIKE 'staging-test-task:%'
     AND activeDedupKey NOT IN (SELECT CONCAT('claude-booking-action:v1:', id) FROM ops_chat_messages WHERE activeDedupKey LIKE 'staging-test-task:%'))))
SQL
)"
OTHER_BEFORE="$(query "$OTHER_ROWS_SQL")"

echo
if [ "$MODE" = create ]; then
  echo "Ready to create the 4 fictional \"(Staging Test)\" customers in $DB on $DB_HOST."
  echo "(Any earlier test rows are replaced. Real customer records are not touched.)"
else
  echo "Ready to DELETE the fictional \"(Staging Test)\" test data from $DB on $DB_HOST."
fi
printf 'Press Enter to continue, or Ctrl-C to cancel: '; read -r _

if [ "$MODE" = create ]; then
cat > "$TMP/run.sql" <<'SQL'
START TRANSACTION;
-- Step 0: hard stop unless this is leadflow_staging
SELECT CONCAT(RPAD('Database check: ', 62, '.'), ' ', DATABASE(), ' ', JSON_UNQUOTE(CAST(IF(DATABASE() = 'leadflow_staging', '"OK"', 'STOP_WRONG_DATABASE') AS JSON)));
-- Step 2: Remove earlier test proposals
DELETE FROM ops_chat_messages WHERE DATABASE() = 'leadflow_staging' AND activeDedupKey IN (SELECT k FROM (SELECT CONCAT('claude-booking-action:v1:', id) AS k FROM ops_chat_messages WHERE activeDedupKey LIKE 'staging-test-task:%') AS t);
SELECT CONCAT(RPAD('Step 2: Remove earlier test proposals', 62, '.'), ' ', ROW_COUNT(), ' rows removed');
-- Step 3: Remove earlier test tasks
DELETE FROM ops_chat_messages WHERE DATABASE() = 'leadflow_staging' AND activeDedupKey LIKE 'staging-test-task:%';
SELECT CONCAT(RPAD('Step 3: Remove earlier test tasks', 62, '.'), ' ', ROW_COUNT(), ' rows removed');
-- Step 4: Remove earlier test visits
DELETE FROM leadflow_jobs WHERE DATABASE() = 'leadflow_staging' AND bookingId IN (SELECT id FROM (SELECT id FROM bookings WHERE publicBookingNumber LIKE 'STG-TEST-%') AS t);
SELECT CONCAT(RPAD('Step 4: Remove earlier test visits', 62, '.'), ' ', ROW_COUNT(), ' rows removed');
-- Step 5: Remove earlier test series
DELETE FROM booking_series WHERE DATABASE() = 'leadflow_staging' AND bookingId IN (SELECT id FROM (SELECT id FROM bookings WHERE publicBookingNumber LIKE 'STG-TEST-%') AS t);
SELECT CONCAT(RPAD('Step 5: Remove earlier test series', 62, '.'), ' ', ROW_COUNT(), ' rows removed');
-- Step 6: Remove earlier test bookings
DELETE FROM bookings WHERE DATABASE() = 'leadflow_staging' AND publicBookingNumber LIKE 'STG-TEST-%';
SELECT CONCAT(RPAD('Step 6: Remove earlier test bookings', 62, '.'), ' ', ROW_COUNT(), ' rows removed');
-- Step 7: Remove earlier test conversations
DELETE FROM conversation_sessions WHERE DATABASE() = 'leadflow_staging' AND leadName LIKE '% (Staging Test)' AND leadPhone IN ('+12025550101', '+12025550102', '+12025550103', '+12025550104');
SELECT CONCAT(RPAD('Step 7: Remove earlier test conversations', 62, '.'), ' ', ROW_COUNT(), ' rows removed');
-- Step 8: Create 4 fictional conversations
INSERT INTO conversation_sessions (leadPhone, leadName, messageHistory)
SELECT leadPhone, leadName, messageHistory FROM (
  SELECT '+12025550101' AS leadPhone, 'Alice (Staging Test)' AS leadName, JSON_ARRAY(JSON_OBJECT('role', 'user', 'content', 'Hi! Something came up. Could we move my cleaning three days later, at 2pm?', 'ts', UNIX_TIMESTAMP() * 1000)) AS messageHistory UNION ALL
  SELECT '+12025550102' AS leadPhone, 'Ben (Staging Test)' AS leadName, JSON_ARRAY(JSON_OBJECT('role', 'user', 'content', 'Hi, please cancel my cleaning. Sorry for the trouble!', 'ts', UNIX_TIMESTAMP() * 1000)) AS messageHistory UNION ALL
  SELECT '+12025550103' AS leadPhone, 'Carla (Staging Test)' AS leadName, JSON_ARRAY(JSON_OBJECT('role', 'user', 'content', 'Hi, could you move next week''s cleaning (the second one) two days later? Same time is fine.', 'ts', UNIX_TIMESTAMP() * 1000)) AS messageHistory UNION ALL
  SELECT '+12025550104' AS leadPhone, 'Dana (Staging Test)' AS leadName, JSON_ARRAY(JSON_OBJECT('role', 'user', 'content', 'Hello! Could you come two days later instead? Same morning window is fine.', 'ts', UNIX_TIMESTAMP() * 1000)) AS messageHistory
) AS x WHERE DATABASE() = 'leadflow_staging';
SELECT CONCAT(RPAD('Step 8: Create 4 fictional conversations', 62, '.'), ' ', ROW_COUNT(), ' rows (expected 4) ', JSON_UNQUOTE(CAST(IF(ROW_COUNT() = 4, '"OK"', 'STOP_UNEXPECTED_ROW_COUNT') AS JSON)));
-- Step 9: Create 4 fictional native bookings (no payment)
INSERT INTO bookings (publicBookingNumber, idempotencyKey, commandHash, source, status, availabilityStatus, assignmentStatus, paymentStatus, customerName, customerPhone, customerEmail, serviceId, serviceName, bedrooms, bathrooms, homeType, extras, specialRequestNotes, address, requestedLocalDate, requestedLocalTime, requestedTimeZone, requestedStartAt, recurrence, recurringIntentStatus, pricingVersion, firstCleaningTotalCents, futureVisitTotalCents, priceSnapshot, createdAt, updatedAt)
SELECT b, UUID(), SHA2(UUID(), 256), 'public', 'needs_attention', 'requested', 'assigned', 'not_started', n, p, e, 'standard', 'Standard Cleaning', 2, 1, 'House', JSON_ARRAY(), JSON_ARRAY(), a, d, tm, 'America/New_York', ms, r, IF(r = 'one-time', NULL, 'intent_pending'), 'public-book-v2', f, fu, s, NOW(3), NOW(3) FROM (
  SELECT 'STG-TEST-A' AS b, 'Alice (Staging Test)' AS n, '+12025550101' AS p, 'staging-test-alice@example.com' AS e, '165 Test Street, Wilmington, DE' AS a, DATE_FORMAT(CURDATE() + INTERVAL 5 DAY, '%Y-%m-%d') AS d, '10:00' AS tm, TIMESTAMPDIFF(SECOND, '1970-01-01 00:00:00', CONVERT_TZ(CONCAT(DATE_FORMAT(CURDATE() + INTERVAL 5 DAY, '%Y-%m-%d'), ' 10:00:00'), 'America/New_York', '+00:00')) * 1000 AS ms, 'one-time' AS r, 23900 AS f, NULL AS fu, '{"version":"public-book-v2","input":{"pricingMode":"home","serviceId":"standard","bedrooms":2,"bathrooms":1,"homeType":"House","condition":5,"maidCount":1,"hourCount":1,"extras":[],"recurrence":"one-time"},"serviceName":"Standard Cleaning","breakdown":{"pricingMode":"home","homeServiceBaseTotalCents":23900,"conditionMultiplier":1,"conditionAdjustmentCents":0,"hourlyServiceTotalCents":7000,"serviceSubtotalCents":23900,"extrasTotalCents":0,"firstCleaningTotalCents":23900,"futureVisitBaseTotalCents":23900,"futureVisitTotalCents":null,"discountPercent":0,"extras":[]}}' AS s UNION ALL
  SELECT 'STG-TEST-B' AS b, 'Ben (Staging Test)' AS n, '+12025550102' AS p, 'staging-test-ben@example.com' AS e, '166 Test Street, Wilmington, DE' AS a, DATE_FORMAT(CURDATE() + INTERVAL 6 DAY, '%Y-%m-%d') AS d, '11:00' AS tm, TIMESTAMPDIFF(SECOND, '1970-01-01 00:00:00', CONVERT_TZ(CONCAT(DATE_FORMAT(CURDATE() + INTERVAL 6 DAY, '%Y-%m-%d'), ' 11:00:00'), 'America/New_York', '+00:00')) * 1000 AS ms, 'one-time' AS r, 23900 AS f, NULL AS fu, '{"version":"public-book-v2","input":{"pricingMode":"home","serviceId":"standard","bedrooms":2,"bathrooms":1,"homeType":"House","condition":5,"maidCount":1,"hourCount":1,"extras":[],"recurrence":"one-time"},"serviceName":"Standard Cleaning","breakdown":{"pricingMode":"home","homeServiceBaseTotalCents":23900,"conditionMultiplier":1,"conditionAdjustmentCents":0,"hourlyServiceTotalCents":7000,"serviceSubtotalCents":23900,"extrasTotalCents":0,"firstCleaningTotalCents":23900,"futureVisitBaseTotalCents":23900,"futureVisitTotalCents":null,"discountPercent":0,"extras":[]}}' AS s UNION ALL
  SELECT 'STG-TEST-C' AS b, 'Carla (Staging Test)' AS n, '+12025550103' AS p, 'staging-test-carla@example.com' AS e, '167 Test Street, Wilmington, DE' AS a, DATE_FORMAT(CURDATE() + INTERVAL 3 DAY, '%Y-%m-%d') AS d, '09:00' AS tm, TIMESTAMPDIFF(SECOND, '1970-01-01 00:00:00', CONVERT_TZ(CONCAT(DATE_FORMAT(CURDATE() + INTERVAL 3 DAY, '%Y-%m-%d'), ' 09:00:00'), 'America/New_York', '+00:00')) * 1000 AS ms, 'weekly' AS r, 23900 AS f, 19100 AS fu, '{"version":"public-book-v2","input":{"pricingMode":"home","serviceId":"standard","bedrooms":2,"bathrooms":1,"homeType":"House","condition":5,"maidCount":1,"hourCount":1,"extras":[],"recurrence":"weekly"},"serviceName":"Standard Cleaning","breakdown":{"pricingMode":"home","homeServiceBaseTotalCents":23900,"conditionMultiplier":1,"conditionAdjustmentCents":0,"hourlyServiceTotalCents":7000,"serviceSubtotalCents":23900,"extrasTotalCents":0,"firstCleaningTotalCents":23900,"futureVisitBaseTotalCents":23900,"futureVisitTotalCents":19100,"discountPercent":20,"extras":[]}}' AS s UNION ALL
  SELECT 'STG-TEST-D' AS b, 'Dana (Staging Test)' AS n, '+12025550104' AS p, 'staging-test-dana@example.com' AS e, '168 Test Street, Wilmington, DE' AS a, DATE_FORMAT(CURDATE() + INTERVAL 8 DAY, '%Y-%m-%d') AS d, '08:00' AS tm, TIMESTAMPDIFF(SECOND, '1970-01-01 00:00:00', CONVERT_TZ(CONCAT(DATE_FORMAT(CURDATE() + INTERVAL 8 DAY, '%Y-%m-%d'), ' 08:00:00'), 'America/New_York', '+00:00')) * 1000 AS ms, 'one-time' AS r, 22705 AS f, NULL AS fu, '{"version":"public-book-v2","input":{"pricingMode":"home","serviceId":"standard","bedrooms":2,"bathrooms":1,"homeType":"House","condition":5,"maidCount":1,"hourCount":1,"extras":[],"recurrence":"one-time","arrivalPreference":{"mode":"preferred","period":"morning","startLocalTime":"08:00","endLocalTime":"12:00"}},"serviceName":"Standard Cleaning","breakdown":{"pricingMode":"home","homeServiceBaseTotalCents":23900,"conditionMultiplier":1,"conditionAdjustmentCents":0,"hourlyServiceTotalCents":7000,"serviceSubtotalCents":23900,"extrasTotalCents":0,"firstCleaningTotalCents":22705,"futureVisitBaseTotalCents":23900,"futureVisitTotalCents":null,"discountPercent":0,"extras":[],"arrivalDiscountPercent":5,"arrivalDiscountCents":1195}}' AS s
) AS x WHERE DATABASE() = 'leadflow_staging';
SELECT CONCAT(RPAD('Step 9: Create 4 fictional native bookings (no payment)', 62, '.'), ' ', ROW_COUNT(), ' rows (expected 4) ', JSON_UNQUOTE(CAST(IF(ROW_COUNT() = 4, '"OK"', 'STOP_UNEXPECTED_ROW_COUNT') AS JSON)));
-- Step 10: Create the weekly series for Carla
INSERT INTO booking_series (bookingId, status, frequency, anchorLocalDate, anchorLocalTime, timeZone, firstCleaningTotalCents, futureVisitTotalCents, createdAt, updatedAt)
SELECT id, 'intent_pending', 'weekly', requestedLocalDate, requestedLocalTime, 'America/New_York', firstCleaningTotalCents, futureVisitTotalCents, NOW(3), NOW(3) FROM bookings WHERE DATABASE() = 'leadflow_staging' AND publicBookingNumber = 'STG-TEST-C';
SELECT CONCAT(RPAD('Step 10: Create the weekly series for Carla', 62, '.'), ' ', ROW_COUNT(), ' rows (expected 1) ', JSON_UNQUOTE(CAST(IF(ROW_COUNT() = 1, '"OK"', 'STOP_UNEXPECTED_ROW_COUNT') AS JSON)));
-- Step 11: Create their 5 scheduled visits
INSERT INTO leadflow_jobs (origin, bookingId, jobDate, serviceDateTime, customerName, customerPhone, customerEmail, jobAddress, serviceName, bedrooms, bathrooms, extras, frequency, bookingStatus, teamName, jobTotalCents)
SELECT 'native_booking', bk.id, x.d, x.dt, bk.customerName, bk.customerPhone, bk.customerEmail, bk.address, bk.serviceName, bk.bedrooms, bk.bathrooms, '[]', x.fr, 'assigned', 'Staging Test Team',
  IF(x.later = 1, COALESCE(bk.futureVisitTotalCents, bk.firstCleaningTotalCents), bk.firstCleaningTotalCents)
FROM (
  SELECT 'STG-TEST-A' AS b, DATE_FORMAT(CURDATE() + INTERVAL 5 DAY, '%Y-%m-%d') AS d, DATE_FORMAT(CONVERT_TZ(CONCAT(DATE_FORMAT(CURDATE() + INTERVAL 5 DAY, '%Y-%m-%d'), ' 10:00:00'), 'America/New_York', '+00:00'), '%Y-%m-%dT%H:%i:%s.000Z') AS dt, 'One time' AS fr, 0 AS later UNION ALL
  SELECT 'STG-TEST-B' AS b, DATE_FORMAT(CURDATE() + INTERVAL 6 DAY, '%Y-%m-%d') AS d, DATE_FORMAT(CONVERT_TZ(CONCAT(DATE_FORMAT(CURDATE() + INTERVAL 6 DAY, '%Y-%m-%d'), ' 11:00:00'), 'America/New_York', '+00:00'), '%Y-%m-%dT%H:%i:%s.000Z') AS dt, 'One time' AS fr, 0 AS later UNION ALL
  SELECT 'STG-TEST-C' AS b, DATE_FORMAT(CURDATE() + INTERVAL 3 DAY, '%Y-%m-%d') AS d, DATE_FORMAT(CONVERT_TZ(CONCAT(DATE_FORMAT(CURDATE() + INTERVAL 3 DAY, '%Y-%m-%d'), ' 09:00:00'), 'America/New_York', '+00:00'), '%Y-%m-%dT%H:%i:%s.000Z') AS dt, 'Weekly' AS fr, 0 AS later UNION ALL
  SELECT 'STG-TEST-C' AS b, DATE_FORMAT(CURDATE() + INTERVAL 10 DAY, '%Y-%m-%d') AS d, DATE_FORMAT(CONVERT_TZ(CONCAT(DATE_FORMAT(CURDATE() + INTERVAL 10 DAY, '%Y-%m-%d'), ' 09:00:00'), 'America/New_York', '+00:00'), '%Y-%m-%dT%H:%i:%s.000Z') AS dt, 'Weekly' AS fr, 1 AS later UNION ALL
  SELECT 'STG-TEST-D' AS b, DATE_FORMAT(CURDATE() + INTERVAL 8 DAY, '%Y-%m-%d') AS d, DATE_FORMAT(CONVERT_TZ(CONCAT(DATE_FORMAT(CURDATE() + INTERVAL 8 DAY, '%Y-%m-%d'), ' 08:00:00'), 'America/New_York', '+00:00'), '%Y-%m-%dT%H:%i:%s.000Z') AS dt, 'One time' AS fr, 0 AS later
) AS x JOIN bookings bk ON CAST(bk.publicBookingNumber AS BINARY) = CAST(x.b AS BINARY) WHERE DATABASE() = 'leadflow_staging';
SELECT CONCAT(RPAD('Step 11: Create their 5 scheduled visits', 62, '.'), ' ', ROW_COUNT(), ' rows (expected 5) ', JSON_UNQUOTE(CAST(IF(ROW_COUNT() = 5, '"OK"', 'STOP_UNEXPECTED_ROW_COUNT') AS JSON)));
-- Step 12: Create 4 task rows (hidden until the next step)
INSERT INTO ops_chat_messages (channel, authorName, authorRole, body, quickAction, sessionId, cardStatus, activeDedupKey, lastActivityAt)
SELECT NULL, 'Instinct', 'system', x.ti, NULL, cs.id, 'active', x.dk, UNIX_TIMESTAMP() * 1000 FROM (
  SELECT '+12025550101' AS p, 'Alice (Staging Test)' AS n, 'Reschedule cleaning' AS ti, 'staging-test-task:A' AS dk UNION ALL
  SELECT '+12025550102' AS p, 'Ben (Staging Test)' AS n, 'Cancel cleaning' AS ti, 'staging-test-task:B' AS dk UNION ALL
  SELECT '+12025550103' AS p, 'Carla (Staging Test)' AS n, 'Reschedule second recurring visit' AS ti, 'staging-test-task:C' AS dk UNION ALL
  SELECT '+12025550104' AS p, 'Dana (Staging Test)' AS n, 'Reschedule cleaning (arrival window)' AS ti, 'staging-test-task:D' AS dk
) AS x JOIN conversation_sessions cs ON CAST(cs.leadPhone AS BINARY) = CAST(x.p AS BINARY) AND CAST(cs.leadName AS BINARY) = CAST(x.n AS BINARY) WHERE DATABASE() = 'leadflow_staging';
SELECT CONCAT(RPAD('Step 12: Create 4 task rows (hidden until the next step)', 62, '.'), ' ', ROW_COUNT(), ' rows (expected 4) ', JSON_UNQUOTE(CAST(IF(ROW_COUNT() = 4, '"OK"', 'STOP_UNEXPECTED_ROW_COUNT') AS JSON)));
-- Step 13: Complete the 4 tasks and show them in Command Chat
UPDATE ops_chat_messages SET channel = 'command', quickAction = 'claude_customer_task', metadata = JSON_OBJECT('taskId', id, 'task', JSON_OBJECT(
  'id', id, 'version', 1, 'kind', 'claude_customer_task', 'sessionId', sessionId, 'customerName', CASE activeDedupKey WHEN 'staging-test-task:A' THEN 'Alice (Staging Test)' WHEN 'staging-test-task:B' THEN 'Ben (Staging Test)' WHEN 'staging-test-task:C' THEN 'Carla (Staging Test)' WHEN 'staging-test-task:D' THEN 'Dana (Staging Test)' END, 'customerPhone', CASE activeDedupKey WHEN 'staging-test-task:A' THEN '+12025550101' WHEN 'staging-test-task:B' THEN '+12025550102' WHEN 'staging-test-task:C' THEN '+12025550103' WHEN 'staging-test-task:D' THEN '+12025550104' END,
  'sourceMessageId', CONCAT('staging-test-message-', RIGHT(activeDedupKey, 1)), 'sourceText', CASE activeDedupKey WHEN 'staging-test-task:A' THEN 'Hi! Something came up. Could we move my cleaning three days later, at 2pm?' WHEN 'staging-test-task:B' THEN 'Hi, please cancel my cleaning. Sorry for the trouble!' WHEN 'staging-test-task:C' THEN 'Hi, could you move next week''s cleaning (the second one) two days later? Same time is fine.' WHEN 'staging-test-task:D' THEN 'Hello! Could you come two days later instead? Same morning window is fine.' END, 'receivedAt', UNIX_TIMESTAMP() * 1000,
  'receivingPhoneNumberId', 'PN-staging-test', 'receivingPhoneNumber', '+12025550100', 'title', body,
  'items', JSON_ARRAY(JSON_OBJECT('id', 'item-1', 'title', CASE activeDedupKey WHEN 'staging-test-task:A' THEN 'Move the cleaning three days later at 2pm' WHEN 'staging-test-task:B' THEN 'Cancel the cleaning' WHEN 'staging-test-task:C' THEN 'Move the second visit two days later' WHEN 'staging-test-task:D' THEN 'Move the cleaning two days later' END, 'evidenceQuote', CASE activeDedupKey WHEN 'staging-test-task:A' THEN 'move my cleaning three days later, at 2pm' WHEN 'staging-test-task:B' THEN 'please cancel my cleaning' WHEN 'staging-test-task:C' THEN 'move next week''s cleaning (the second one) two days later' WHEN 'staging-test-task:D' THEN 'come two days later instead' END, 'completedBy', NULL, 'completedAt', NULL)),
  'status', 'unclaimed', 'owner', NULL, 'claimedAt', NULL, 'completedAt', NULL, 'completedBy', NULL, 'completionNote', NULL,
  'reply', JSON_OBJECT('text', 'Thanks! We''ll take care of it and confirm once it''s done.', 'status', 'sent', 'providerMessageId', CONCAT('staging-test-reply-', RIGHT(activeDedupKey, 1))),
  'activity', JSON_ARRAY(JSON_OBJECT('action', 'created', 'actor', NULL, 'at', UNIX_TIMESTAMP() * 1000, 'note', NULL))))
WHERE DATABASE() = 'leadflow_staging' AND activeDedupKey IN ('staging-test-task:A', 'staging-test-task:B', 'staging-test-task:C', 'staging-test-task:D') AND sessionId IS NOT NULL;
SELECT CONCAT(RPAD('Step 13: Complete the 4 tasks and show them in Command Chat', 62, '.'), ' ', ROW_COUNT(), ' rows (expected 4) ', JSON_UNQUOTE(CAST(IF(ROW_COUNT() = 4, '"OK"', 'STOP_UNEXPECTED_ROW_COUNT') AS JSON)));
-- Step 14: Add Claude-style proposals for Alice and Carla
INSERT INTO ops_chat_messages (channel, authorName, authorRole, body, quickAction, cardStatus, activeDedupKey, lastActivityAt, metadata)
SELECT 'instinct_booking_action', 'Instinct', 'system', 'Booking change proposal', 'claude_booking_action', 'active', CONCAT('claude-booking-action:v1:', m.id), UNIX_TIMESTAMP() * 1000,
  JSON_OBJECT('version', 1, 'taskId', m.id, 'source', 'claude', 'itemId', 'item-1',
    'request', JSON_OBJECT('type', 'reschedule_visit', 'visitDate', x.vd, 'jobId', NULL, 'newDate', x.nd, 'newTime', x.nt, 'evidenceQuote', x.q),
    'revision', 1, 'status', 'proposed', 'execution', NULL, 'verification', NULL, 'confirmation', NULL,
    'history', JSON_ARRAY(JSON_OBJECT('action', 'proposed', 'actor', NULL, 'at', UNIX_TIMESTAMP() * 1000, 'note', 'Proposed by Claude (staging test data)')))
FROM (
  SELECT 'staging-test-task:A' AS dk, DATE_FORMAT(CURDATE() + INTERVAL 5 DAY, '%Y-%m-%d') AS vd, DATE_FORMAT(CURDATE() + INTERVAL 8 DAY, '%Y-%m-%d') AS nd, '14:00' AS nt, 'move my cleaning three days later, at 2pm' AS q UNION ALL
  SELECT 'staging-test-task:C', DATE_FORMAT(CURDATE() + INTERVAL 10 DAY, '%Y-%m-%d'), DATE_FORMAT(CURDATE() + INTERVAL 12 DAY, '%Y-%m-%d'), NULL, 'move next week''s cleaning (the second one) two days later'
) AS x JOIN ops_chat_messages m ON CAST(m.activeDedupKey AS BINARY) = CAST(x.dk AS BINARY) AND m.quickAction = 'claude_customer_task' WHERE DATABASE() = 'leadflow_staging';
SELECT CONCAT(RPAD('Step 14: Add Claude-style proposals for Alice and Carla', 62, '.'), ' ', ROW_COUNT(), ' rows (expected 2) ', JSON_UNQUOTE(CAST(IF(ROW_COUNT() = 2, '"OK"', 'STOP_UNEXPECTED_ROW_COUNT') AS JSON)));
COMMIT;
SQL
else
cat > "$TMP/run.sql" <<'SQL'
START TRANSACTION;
-- Step 0: hard stop unless this is leadflow_staging
SELECT CONCAT(RPAD('Database check: ', 62, '.'), ' ', DATABASE(), ' ', JSON_UNQUOTE(CAST(IF(DATABASE() = 'leadflow_staging', '"OK"', 'STOP_WRONG_DATABASE') AS JSON)));
-- Step 2: Remove earlier test proposals
DELETE FROM ops_chat_messages WHERE DATABASE() = 'leadflow_staging' AND activeDedupKey IN (SELECT k FROM (SELECT CONCAT('claude-booking-action:v1:', id) AS k FROM ops_chat_messages WHERE activeDedupKey LIKE 'staging-test-task:%') AS t);
SELECT CONCAT(RPAD('Step 2: Remove earlier test proposals', 62, '.'), ' ', ROW_COUNT(), ' rows removed');
-- Step 3: Remove earlier test tasks
DELETE FROM ops_chat_messages WHERE DATABASE() = 'leadflow_staging' AND activeDedupKey LIKE 'staging-test-task:%';
SELECT CONCAT(RPAD('Step 3: Remove earlier test tasks', 62, '.'), ' ', ROW_COUNT(), ' rows removed');
-- Step 4: Remove earlier test visits
DELETE FROM leadflow_jobs WHERE DATABASE() = 'leadflow_staging' AND bookingId IN (SELECT id FROM (SELECT id FROM bookings WHERE publicBookingNumber LIKE 'STG-TEST-%') AS t);
SELECT CONCAT(RPAD('Step 4: Remove earlier test visits', 62, '.'), ' ', ROW_COUNT(), ' rows removed');
-- Step 5: Remove earlier test series
DELETE FROM booking_series WHERE DATABASE() = 'leadflow_staging' AND bookingId IN (SELECT id FROM (SELECT id FROM bookings WHERE publicBookingNumber LIKE 'STG-TEST-%') AS t);
SELECT CONCAT(RPAD('Step 5: Remove earlier test series', 62, '.'), ' ', ROW_COUNT(), ' rows removed');
-- Step 6: Remove earlier test bookings
DELETE FROM bookings WHERE DATABASE() = 'leadflow_staging' AND publicBookingNumber LIKE 'STG-TEST-%';
SELECT CONCAT(RPAD('Step 6: Remove earlier test bookings', 62, '.'), ' ', ROW_COUNT(), ' rows removed');
-- Step 7: Remove earlier test conversations
DELETE FROM conversation_sessions WHERE DATABASE() = 'leadflow_staging' AND leadName LIKE '% (Staging Test)' AND leadPhone IN ('+12025550101', '+12025550102', '+12025550103', '+12025550104');
SELECT CONCAT(RPAD('Step 7: Remove earlier test conversations', 62, '.'), ' ', ROW_COUNT(), ' rows removed');
COMMIT;
SQL
fi

echo; echo "Running (one transaction; any error undoes everything):"
if ! sql -N -B < "$TMP/run.sql" 2>"$TMP/err"; then
  LINE="$(grep -oE 'at line [0-9]+' "$TMP/err" | grep -oE '[0-9]+' | head -1 || true)"
  STEP=""; [ -n "$LINE" ] && STEP="$(awk -v n="$LINE" 'NR <= n && /^-- Step /{s = substr($0, 4)} END{print s}' "$TMP/run.sql")"
  grep -q 2059 "$TMP/err" && die "Your mysql client can't use TiDB's login method. Run:  brew install mysql-client@8.4   then run this again."
  if grep -q -E '3140|Invalid JSON' "$TMP/err"; then MSG="the row count was not what was expected"; else MSG="$(grep -v 'Using a password' "$TMP/err")"; fi
  die "${STEP:-a step} failed: $MSG
Nothing was saved: the whole run was undone. Send this message to Claude."
fi

# --- Verification (fresh connection, after the commit) ------------------------------------------------------------
echo; echo "Verification:"
OTHER_AFTER="$(query "$OTHER_ROWS_SQL")"
[ "$OTHER_AFTER" = "$OTHER_BEFORE" ] || die "Non-test row counts changed: before $OTHER_BEFORE, after $OTHER_AFTER"
ok "existing (non-test) records unchanged: conversations / bookings / series / visits / messages = $OTHER_AFTER"

if [ "$MODE" = remove ]; then
  LEFT="$(query "SELECT CONCAT((SELECT COUNT(*) FROM bookings WHERE publicBookingNumber LIKE 'STG-TEST-%'), ' ', (SELECT COUNT(*) FROM ops_chat_messages WHERE activeDedupKey LIKE 'staging-test-task:%'))")"
  [ "$LEFT" = "0 0" ] || die "Test rows still present (bookings, tasks): $LEFT"
  ok "no test bookings or test tasks remain"
  printf '\n\033[32mDONE: staging test data removed.\033[0m\n'
  exit 0
fi

CHECK="$(query "$(cat <<'SQL'
SELECT CONCAT_WS('|', cs.leadName, IFNULL(bk.publicBookingNumber, 'no booking'), IFNULL(bk.recurrence, '-'),
  (SELECT COUNT(*) FROM leadflow_jobs j WHERE j.bookingId = bk.id AND j.origin = 'native_booking'),
  (SELECT COUNT(*) FROM ops_chat_messages m WHERE m.sessionId = cs.id AND m.quickAction = 'claude_customer_task' AND m.channel = 'command'),
  (SELECT COUNT(*) FROM ops_chat_messages p WHERE CAST(p.activeDedupKey AS BINARY) IN (SELECT CAST(CONCAT('claude-booking-action:v1:', m.id) AS BINARY) FROM ops_chat_messages m WHERE m.sessionId = cs.id AND m.quickAction = 'claude_customer_task')))
FROM conversation_sessions cs LEFT JOIN bookings bk ON CAST(bk.customerPhone AS BINARY) = CAST(cs.leadPhone AS BINARY) AND bk.publicBookingNumber LIKE 'STG-TEST-%'
WHERE cs.leadName LIKE '% (Staging Test)' AND cs.leadPhone IN ('+12025550101', '+12025550102', '+12025550103', '+12025550104') ORDER BY cs.leadName;
SELECT CONCAT('weekly series for Carla|', COUNT(*)) FROM booking_series s JOIN bookings b ON b.id = s.bookingId WHERE b.publicBookingNumber = 'STG-TEST-C';
SELECT CONCAT('arrival window for Dana|', JSON_UNQUOTE(JSON_EXTRACT(priceSnapshot, '$.input.arrivalPreference.startLocalTime')), '-', JSON_UNQUOTE(JSON_EXTRACT(priceSnapshot, '$.input.arrivalPreference.endLocalTime'))) FROM bookings WHERE publicBookingNumber = 'STG-TEST-D';
SELECT CONCAT('test bookings with any payment|', COUNT(*)) FROM bookings WHERE publicBookingNumber LIKE 'STG-TEST-%' AND paymentStatus <> 'not_started';
SQL
)")"
EXPECTED="Alice (Staging Test)|STG-TEST-A|one-time|1|1|1
Ben (Staging Test)|STG-TEST-B|one-time|1|1|0
Carla (Staging Test)|STG-TEST-C|weekly|2|1|1
Dana (Staging Test)|STG-TEST-D|one-time|1|1|0
weekly series for Carla|1
arrival window for Dana|08:00-12:00
test bookings with any payment|0"
if [ "$CHECK" != "$EXPECTED" ]; then
  printf 'Expected:\n%s\n\nFound:\n%s\n' "$EXPECTED" "$CHECK"
  die "The test data is not as expected (it was saved; run with --remove to delete it). Send this output to Claude."
fi
ok "4 test customers, each with a native booking, visits and a task (format: customer|booking|type|visits|task|proposal):"
printf '%s\n' "$CHECK" | sed -n 1,4p | sed 's/^/         /'
ok "Carla has her weekly series, Dana keeps the 8:00 AM-12:00 PM window, no payment on any test booking"

echo; echo "Summary (same as step 15):"
sql -t <<'SQL'
SELECT cs.leadName AS customer, bk.publicBookingNumber AS booking, bk.recurrence, bk.requestedLocalDate AS first_visit_date, bk.requestedLocalTime AS visit_time,
  (SELECT COUNT(*) FROM leadflow_jobs j WHERE j.bookingId = bk.id) AS visits,
  (SELECT COUNT(*) FROM ops_chat_messages m WHERE m.sessionId = cs.id AND m.quickAction = 'claude_customer_task') AS task,
  (SELECT COUNT(*) FROM ops_chat_messages p WHERE CAST(p.activeDedupKey AS BINARY) IN (SELECT CAST(CONCAT('claude-booking-action:v1:', m.id) AS BINARY) FROM ops_chat_messages m WHERE m.sessionId = cs.id AND m.quickAction = 'claude_customer_task')) AS proposal
FROM conversation_sessions cs LEFT JOIN bookings bk ON CAST(bk.customerPhone AS BINARY) = CAST(cs.leadPhone AS BINARY) AND bk.publicBookingNumber LIKE 'STG-TEST-%'
WHERE cs.leadName LIKE '% (Staging Test)' AND cs.leadPhone IN ('+12025550101', '+12025550102', '+12025550103', '+12025550104') ORDER BY cs.leadName;
SQL
printf '\n\033[32mDONE: staging test data created and verified.\033[0m Open Command Chat > Tasks on the staging site.\n'
printf 'To delete it later:  bash %s --remove\n' "$0"
