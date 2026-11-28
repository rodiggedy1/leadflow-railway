#!/bin/bash
# STAGING ONLY: loads (or removes) the fictional Phase 2 quality-record test data in leadflow_staging.
#
#   bash quality-test-data.sh                    load / re-load the fictional teams, visits and quality records
#   bash quality-test-data.sh --add-late-visit   add the visit that lets the unmatched complaint be matched (the retry test)
#   bash quality-test-data.sh --remove           delete all of it again
#
# It asks you to paste the STAGING DATABASE_URL (hidden; never shown, saved or logged) and refuses anything whose
# database is not leadflow_staging. All writes run as ONE transaction: if any step fails, nothing is saved.
# Only rows carrying the test markers are touched (team IDs 990001-990002, job IDs 99000001-99000016, quality
# records "stgq-..."); it checks that no real row uses those IDs and that real row counts are unchanged afterwards.
# Nothing is sent or charged and no AI is called. Generated from quality-test-data.sql (same statements).
# Needs the mysql client 8.4 (Homebrew: brew install mysql-client@8.4).
set -euo pipefail

DB=leadflow_staging
MODE=create
case "${1:-}" in
  "") ;;
  --add-late-visit) MODE=late ;;
  --remove) MODE=remove ;;
  *) echo "Usage: bash $0 [--add-late-visit | --remove]"; exit 2 ;;
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
[[ "$URL" =~ $re ]] || die "That does not look like a mysql:// connection string."
urldecode() { local s="${1//+/ }"; printf '%b' "${s//%/\\x}"; }
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

# --- Read-only checks before any write --------------------------------------------------------------------------
TABLE="$(query "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'team_quality_incidents'")"
[ "$TABLE" = "1" ] || die "The quality-records table is not on staging yet. Wait for the Phase 2 staging deploy to finish (its migration creates it), then run this again."
ok "quality-records table present (Phase 2 deploy finished)"
CLASH="$(query "SELECT CONCAT((SELECT COUNT(*) FROM scheduling_teams WHERE id IN (990001, 990002) AND name NOT LIKE 'Fictional Team % (quality test)'), ' ',
  (SELECT COUNT(*) FROM leadflow_jobs WHERE id BETWEEN 99000001 AND 99000016 AND (customerName IS NULL OR customerName NOT LIKE 'Fict Customer %')))")"
[ "$CLASH" = "0 0" ] || die "Some real rows use the test IDs (teams, jobs): $CLASH. Nothing was changed. Send this message to Claude."
ok "no real team or job uses the test IDs"

TEST_ROWS="sourceKey LIKE '%stgq-%' OR sourceKey IN ('signoff:job:99000013', 'rating:job:99000003')"
OTHER_ROWS_SQL="SELECT CONCAT_WS(' / ', (SELECT COUNT(*) FROM scheduling_teams WHERE id NOT IN (990001, 990002)),
  (SELECT COUNT(*) FROM leadflow_jobs WHERE id NOT BETWEEN 99000001 AND 99000016),
  (SELECT COUNT(*) FROM team_quality_incidents WHERE NOT ($TEST_ROWS)))"
OTHER_BEFORE="$(query "$OTHER_ROWS_SQL")"

echo
case "$MODE" in
  create) echo "Ready to load the fictional quality test data into $DB on $DB_HOST (earlier test rows are replaced).";;
  late) echo "Ready to add the late visit for 'Fict Customer 65' in $DB on $DB_HOST.";;
  remove) echo "Ready to DELETE the fictional quality test data from $DB on $DB_HOST.";;
esac
echo "(Real customer, job and team records are not touched.)"
printf 'Press Enter to continue, or Ctrl-C to cancel: '; read -r _

GUARD="SELECT JSON_UNQUOTE(CAST(IF(DATABASE() = 'leadflow_staging', '\"OK\"', 'STOP_WRONG_DATABASE') AS JSON));"
REMOVE_SQL="DELETE FROM team_quality_incidents WHERE DATABASE() = 'leadflow_staging' AND ($TEST_ROWS);
DELETE FROM leadflow_jobs WHERE DATABASE() = 'leadflow_staging' AND id BETWEEN 99000001 AND 99000016 AND customerName LIKE 'Fict Customer %';
DELETE FROM scheduling_teams WHERE DATABASE() = 'leadflow_staging' AND id IN (990001, 990002) AND name LIKE 'Fictional Team % (quality test)';"
{
  echo "SET time_zone = '+00:00';"
  echo "START TRANSACTION;"
  echo "$GUARD"
  case "$MODE" in
    create) echo "$REMOVE_SQL"; cat <<'SQL'
SET @today = DATE(NOW() - INTERVAL 5 HOUR);                          -- today in US Eastern (winter time)
SET @nowMs = UNIX_TIMESTAMP(NOW()) * 1000;
SET @ws = DATE_FORMAT(DATE_SUB(@today, INTERVAL DAYOFWEEK(@today) - 1 DAY), '%Y-%m-%d');   -- this week's Sunday
SET @d1 = DATE_FORMAT(@today - INTERVAL 1 DAY, '%Y-%m-%d'), @d2 = DATE_FORMAT(@today - INTERVAL 2 DAY, '%Y-%m-%d'),
    @d3 = DATE_FORMAT(@today - INTERVAL 3 DAY, '%Y-%m-%d'), @d4 = DATE_FORMAT(@today - INTERVAL 4 DAY, '%Y-%m-%d'),
    @old = DATE_FORMAT(@today - INTERVAL 25 DAY, '%Y-%m-%d');
INSERT INTO scheduling_teams (id, name, launch27TeamId, isActive) VALUES
  (990001, 'Fictional Team Alba (quality test)', 990101, 1),
  (990002, 'Fictional Team Bravo (quality test)', NULL, 1);
INSERT INTO leadflow_jobs (id, origin, bookingId, launch27BookingId, jobDate, bookingStatus, teamId, customerName, customerPhone, customerEmail, serviceName, jobTotalCents, customerRating) VALUES
  (99000001, 'launch27_import', NULL, 99100001, @d4, 'completed', 990101, 'Fict Customer 51', '+12025550151', NULL, 'Standard Cleaning', 16000, 5),
  (99000002, 'launch27_import', NULL, 99100002, @d3, 'completed', 990101, 'Fict Customer 52', '+12025550152', 'fict.customer52@example.com', 'Standard Cleaning', 16000, NULL),
  (99000003, 'launch27_import', NULL, 99100003, @d2, 'completed', 990101, 'Fict Customer 53', '+12025550153', NULL, 'Standard Cleaning', 16000, 2),
  (99000004, 'launch27_import', NULL, 99100004, @old, 'completed', 990101, 'Fict Customer 54', '+12025550154', NULL, 'Deep Cleaning', 30000, NULL),
  (99000005, 'launch27_import', NULL, 99100005, @d2, 'completed', 990101, 'Fict Customer 55', '+12025550155', NULL, 'Standard Cleaning', 16000, 5),
  (99000006, 'launch27_import', NULL, 99100006, @d1, 'completed', 990101, 'Fict Customer 56', '+12025550156', NULL, 'Standard Cleaning', 16000, NULL),
  (99000011, 'native_booking', NULL, NULL, @d3, 'assigned', 990002, 'Fict Customer 61', '+12025550161', NULL, 'Standard Cleaning', 16000, 4),
  (99000012, 'native_booking', NULL, NULL, @d3, 'assigned', 990002, 'Fict Customer 62', '+12025550162', NULL, 'Standard Cleaning', 16000, NULL),
  (99000013, 'native_booking', NULL, NULL, @d2, 'assigned', 990002, 'Fict Customer 63', '+12025550163', 'fict.customer63@example.com', 'Standard Cleaning', 16000, NULL),
  (99000015, 'native_booking', NULL, NULL, @d1, 'assigned', 990002, 'Fict Customer 66', '+12025550166', NULL, 'Standard Cleaning', 16000, 5);
INSERT INTO team_quality_incidents (primaryId, sourceKey, channel, detector, reportedAtMs, weekStart, customerPhone, customerEmail, customerName,
  evidenceQuote, evidenceText, category, severity, leadflowJobId, attribution, status, recleanStatus, refundStatus, processingStatus, processingError, processingAttempts, createdAtMs, updatedAtMs) VALUES
  (NULL, 'sms:stgq-1', 'sms', 'claude_sms', @nowMs - 7200000, @ws, '+12025550151', NULL, 'Fict Customer 51', 'the bathroom was not cleaned', 'Hi, the bathroom was not cleaned at all.', 'cleaning_quality', 'medium', NULL, 'unattributed', 'open', 'requested', 'none', 'pending', NULL, 0, @nowMs, @nowMs),
  (NULL, 'email:msg:stgq-2', 'email', 'claude_email', @nowMs - 7000000, @ws, NULL, 'fict.customer52@example.com', 'Fict Customer 52', 'the cleaner was rude', 'The cleaner was rude to my mother.', 'team_service', 'medium', NULL, 'unattributed', 'open', 'none', 'none', 'pending', NULL, 0, @nowMs, @nowMs),
  (NULL, 'sms:stgq-3', 'sms', 'claude_sms', @nowMs - 6800000, @ws, '+12025550152', NULL, 'Fict Customer 52', 'nobody called me back', 'Also nobody called me back from the office.', 'office_service', 'low', NULL, 'unattributed', 'open', 'none', 'none', 'pending', NULL, 0, @nowMs, @nowMs),
  (NULL, 'call:vapi:stgq-4', 'call', 'claude_call', @nowMs - 6600000, @ws, '+12025550161', NULL, 'Fict Customer 61', 'the kitchen floor is still sticky', 'Caller: the kitchen floor is still sticky and they missed the stove.', 'cleaning_quality', 'medium', NULL, 'unattributed', 'open', 'none', 'none', 'pending', NULL, 0, @nowMs, @nowMs),
  (NULL, 'call:callback:stgq-5', 'call', 'vapi_complaint_tool', @nowMs - 6590000, @ws, '+12025550161', NULL, 'Fict Customer 61', NULL, 'Issue: kitchen floor sticky, stove missed', 'cleaning_quality', 'medium', NULL, 'unattributed', 'open', 'none', 'none', 'pending', NULL, 0, @nowMs, @nowMs),
  (NULL, 'call:openphone:stgq-6', 'call', 'claude_staff_call', @nowMs - 6400000, @ws, '+12025550162', NULL, 'Fict Customer 62', 'I was charged twice', 'Caller: I was charged twice for this week.', 'pricing_billing', 'medium', NULL, 'unattributed', 'open', 'none', 'requested', 'pending', NULL, 0, @nowMs, @nowMs),
  (NULL, 'email:thread:stgq-7', 'email', 'gmail_glance', @nowMs - 6200000, @ws, NULL, 'fict.customer63@example.com', 'Fict Customer 63', NULL, 'Customer asks for a refund', 'unclassified', 'medium', NULL, 'unattributed', 'open', 'none', 'requested', 'pending', NULL, 0, @nowMs, @nowMs),
  (NULL, 'signoff:job:99000013', 'signoff', 'cleaner_signoff', @nowMs - 6000000, @ws, NULL, NULL, NULL, NULL, 'Sign-off customer response: issue', 'cleaning_quality', 'medium', 99000013, 'unattributed', 'open', 'none', 'none', 'pending', NULL, 0, @nowMs, @nowMs),
  (NULL, 'rating:job:99000003', 'rating', 'portal_rating', @nowMs - 5800000, @ws, NULL, NULL, NULL, NULL, 'Customer rated the visit 2 of 5.', 'unclassified', 'medium', 99000003, 'unattributed', 'open', 'none', 'none', 'pending', NULL, 0, @nowMs, @nowMs),
  (NULL, 'sms:stgq-8', 'sms', 'claude_sms', @nowMs - 5600000, @ws, '+12025550153', NULL, 'Fict Customer 53', 'dust everywhere', 'There is dust everywhere, very disappointed.', 'cleaning_quality', 'high', NULL, 'unattributed', 'open', 'none', 'none', 'failed', 'QUALITY_PROCESSING_FAILED', 1, @nowMs, @nowMs),
  (NULL, 'sms:stgq-9', 'sms', 'claude_sms', @nowMs - 5400000, @ws, '+12025550154', NULL, 'Fict Customer 54', 'the oven was never cleaned', 'From my deep clean last month, the oven was never cleaned.', 'cleaning_quality', 'medium', NULL, 'unattributed', 'open', 'none', 'none', 'pending', NULL, 0, @nowMs, @nowMs),
  (NULL, 'sms:stgq-10', 'sms', 'claude_sms', @nowMs - 5200000, @ws, '+12025550165', NULL, 'Fict Customer 65', 'they skipped the bedroom', 'They skipped the bedroom completely.', 'cleaning_quality', 'medium', NULL, 'unattributed', 'open', 'none', 'none', 'pending', NULL, 0, @nowMs, @nowMs);
SQL
    ;;
    late) cat <<'SQL'
DELETE FROM leadflow_jobs WHERE DATABASE() = 'leadflow_staging' AND id = 99000016 AND customerName = 'Fict Customer 65';
INSERT INTO leadflow_jobs (id, origin, bookingId, launch27BookingId, jobDate, bookingStatus, teamId, customerName, customerPhone, serviceName, jobTotalCents)
  VALUES (99000016, 'native_booking', NULL, NULL, DATE_FORMAT(DATE(NOW() - INTERVAL 5 HOUR) - INTERVAL 1 DAY, '%Y-%m-%d'), 'assigned', 990002, 'Fict Customer 65', '+12025550165', 'Standard Cleaning', 16000);
SQL
    ;;
    remove) echo "$REMOVE_SQL";;
  esac
  echo "COMMIT;"
} > "$TMP/run.sql"

echo; echo "Running (one transaction; any error undoes everything):"
if ! sql -N -B < "$TMP/run.sql" > "$TMP/out" 2>"$TMP/err"; then
  grep -q 2059 "$TMP/err" && die "Your mysql client can't use TiDB's login method. Run:  brew install mysql-client@8.4   then run this again."
  die "$(grep -v 'Using a password' "$TMP/err")
Nothing was saved: the whole run was undone. Send this message to Claude."
fi

# --- Verification (fresh connection, after the commit) ------------------------------------------------------------
echo; echo "Verification:"
OTHER_AFTER="$(query "$OTHER_ROWS_SQL")"
[ "$OTHER_AFTER" = "$OTHER_BEFORE" ] || die "Non-test row counts changed: before $OTHER_BEFORE, after $OTHER_AFTER"
ok "real records unchanged: teams / jobs / quality records = $OTHER_AFTER"
COUNTS="$(query "SELECT CONCAT((SELECT COUNT(*) FROM scheduling_teams WHERE id IN (990001, 990002)), ' ', (SELECT COUNT(*) FROM leadflow_jobs WHERE id BETWEEN 99000001 AND 99000016), ' ', (SELECT COUNT(*) FROM team_quality_incidents WHERE $TEST_ROWS))")"
case "$MODE" in
  create) [ "$COUNTS" = "2 10 12" ] || die "Expected 2 teams, 10 visits, 12 quality records; found $COUNTS"
    ok "loaded 2 fictional teams, 10 visits and 12 quality records (all 'pending', as each channel saves them)"
    printf '\n\033[32mDONE.\033[0m Open /admin/team-leaderboard on staging (current week). The page matches, merges and scores\n'
    printf 'the records automatically. Expected:\n'
    printf '  Fictional Team Alba (quality test):  5 jobs, 4 counted complaints (text, email, older visit, retried one + rating)\n'
    printf '  Fictional Team Bravo (quality test): 4 jobs, 2 counted complaints (call counted once, cleaner sign-off)\n'
    printf '  Show records: office text and billing call under "Not the team'"'"'s responsibility"; one "Not matched to a visit".\n'
    printf '\nThen the retry test:  bash %s --add-late-visit   and reload: Bravo becomes 5 jobs, 3 complaints.\n' "$0"
    printf 'To delete everything:  bash %s --remove\n' "$0";;
  late) [ "${COUNTS#* }" != "${COUNTS}" ] && [ "$(echo "$COUNTS" | cut -d' ' -f2)" = "11" ] || die "Expected 11 visits after adding the late visit; found $COUNTS (run the load first)"
    ok "late visit added for Fict Customer 65"
    printf '\n\033[32mDONE.\033[0m Reload /admin/team-leaderboard: the unmatched complaint is matched automatically; Bravo shows 5 jobs, 3 complaints.\n';;
  remove) [ "$COUNTS" = "0 0 0" ] || die "Test rows still present (teams, jobs, quality records): $COUNTS"
    ok "all fictional quality test data removed"
    printf '\n\033[32mDONE: staging quality test data removed.\033[0m\n';;
esac
