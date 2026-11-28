#!/bin/bash
# STAGING ONLY: loads (or removes) the fictional Phase 3 team-report test data in leadflow_staging.
#
#   bash team-reports-test-data.sh            load / re-load the four fictional teams, their visits and quality records
#   bash team-reports-test-data.sh --remove   delete all of it again (including the test teams' report send records)
#
# It asks you to paste the STAGING DATABASE_URL (hidden; never shown, saved or logged) and refuses anything whose
# database is not leadflow_staging. All writes run as ONE transaction: if any step fails, nothing is saved.
# Only rows carrying the test markers are touched (teams and team accounts 990011-990014, visits 99000101-99000134,
# quality records "stgr-..."); it checks that no real row uses those IDs and that real row counts are unchanged.
# Nothing is sent or charged and no AI is called. Generated from team-reports-test-data.sql (same statements).
# Needs the mysql client 8.4 (Homebrew: brew install mysql-client@8.4).
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
TABLE="$(query "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('team_quality_incidents', 'team_weekly_reports')")"
[ "$TABLE" = "2" ] || die "The team-reports table is not on staging yet. Wait for the team-reports staging deploy to finish (its migration creates it), then run this again."
ok "team-reports and quality-records tables present (staging deploy finished)"
CLASH="$(query "SELECT CONCAT((SELECT COUNT(*) FROM scheduling_teams WHERE id BETWEEN 990011 AND 990014 AND name NOT LIKE 'Fictional Team % (report test)'), ' ',
  (SELECT COUNT(*) FROM cleaner_profiles WHERE (id BETWEEN 990011 AND 990014 OR launch27TeamId BETWEEN 990111 AND 990114) AND name NOT LIKE 'Fictional % account (report test)'), ' ',
  (SELECT COUNT(*) FROM leadflow_jobs WHERE id BETWEEN 99000101 AND 99000134 AND (customerName IS NULL OR customerName NOT LIKE 'Fict Report Customer %')))")"
[ "$CLASH" = "0 0 0" ] || die "Some real rows use the test IDs (teams, team accounts, visits): $CLASH. Nothing was changed. Send this message to Claude."
ok "no real team, team account or visit uses the test IDs"

TEST_INCIDENTS="sourceKey LIKE '%stgr-%'"
OTHER_ROWS_SQL="SELECT CONCAT_WS(' / ', (SELECT COUNT(*) FROM scheduling_teams WHERE id NOT BETWEEN 990011 AND 990014),
  (SELECT COUNT(*) FROM cleaner_profiles WHERE id NOT BETWEEN 990011 AND 990014),
  (SELECT COUNT(*) FROM leadflow_jobs WHERE id NOT BETWEEN 99000101 AND 99000134),
  (SELECT COUNT(*) FROM team_quality_incidents WHERE NOT ($TEST_INCIDENTS)),
  (SELECT COUNT(*) FROM team_weekly_reports WHERE teamId NOT BETWEEN 990011 AND 990014))"
OTHER_BEFORE="$(query "$OTHER_ROWS_SQL")"

echo
case "$MODE" in
  create) echo "Ready to load the fictional team-report test data into $DB on $DB_HOST (earlier test rows are replaced).";;
  remove) echo "Ready to DELETE the fictional team-report test data from $DB on $DB_HOST.";;
esac
echo "(Real customer, job, team and team-account records are not touched.)"
printf 'Press Enter to continue, or Ctrl-C to cancel: '; read -r _

GUARD="SELECT JSON_UNQUOTE(CAST(IF(DATABASE() = 'leadflow_staging', '\"OK\"', 'STOP_WRONG_DATABASE') AS JSON));"
REMOVE_SQL="DELETE FROM team_weekly_reports WHERE DATABASE() = 'leadflow_staging' AND teamId BETWEEN 990011 AND 990014 AND teamName LIKE 'Fictional Team % (report test)';
DELETE FROM team_quality_incidents WHERE DATABASE() = 'leadflow_staging' AND ($TEST_INCIDENTS);
DELETE FROM cleaner_portal_job_photos WHERE DATABASE() = 'leadflow_staging' AND leadflowJobId BETWEEN 99000101 AND 99000134 AND photoKey LIKE 'stgr-%';
DELETE FROM cleaner_portal_job_progress WHERE DATABASE() = 'leadflow_staging' AND leadflowJobId BETWEEN 99000101 AND 99000134 AND cleanerProfileId BETWEEN 990011 AND 990014;
DELETE FROM leadflow_jobs WHERE DATABASE() = 'leadflow_staging' AND id BETWEEN 99000101 AND 99000134 AND customerName LIKE 'Fict Report Customer %';
DELETE FROM cleaner_profiles WHERE DATABASE() = 'leadflow_staging' AND id BETWEEN 990011 AND 990014 AND name LIKE 'Fictional % account (report test)';
DELETE FROM scheduling_teams WHERE DATABASE() = 'leadflow_staging' AND id BETWEEN 990011 AND 990014 AND name LIKE 'Fictional Team % (report test)';"
{
  echo "SET time_zone = '+00:00';"
  echo "START TRANSACTION;"
  echo "$GUARD"
  echo "$REMOVE_SQL"
  if [ "$MODE" = create ]; then cat <<'SQL'
SET @today = DATE(NOW() - INTERVAL 5 HOUR);                          -- today in US Eastern (winter time)
SET @nowMs = UNIX_TIMESTAMP(NOW()) * 1000;
SET @ws = DATE_FORMAT(DATE_SUB(@today, INTERVAL DAYOFWEEK(@today) - 1 DAY), '%Y-%m-%d');   -- this week's Sunday
SET @d1 = DATE_FORMAT(@today - INTERVAL 1 DAY, '%Y-%m-%d'), @d2 = DATE_FORMAT(@today - INTERVAL 2 DAY, '%Y-%m-%d'),
    @d3 = DATE_FORMAT(@today - INTERVAL 3 DAY, '%Y-%m-%d'), @d4 = DATE_FORMAT(@today - INTERVAL 4 DAY, '%Y-%m-%d');
INSERT INTO scheduling_teams (id, name, launch27TeamId, isActive) VALUES
  (990011, 'Fictional Team Alba (report test)', 990111, 1), (990012, 'Fictional Team Brisa (report test)', 990112, 1),
  (990013, 'Fictional Team Cielo (report test)', 990113, 1), (990014, 'Fictional Team Duna (report test)', 990114, 1);
INSERT INTO cleaner_profiles (id, name, phone, language, launch27TeamId, isActive) VALUES
  (990011, 'Fictional Alba account (report test)', '+12025550171', 'en', 990111, 1),
  (990012, 'Fictional Brisa account (report test)', '+12025550172', 'es', 990112, 1),
  (990013, 'Fictional Cielo account (report test)', NULL, 'en', 990113, 1),
  (990014, 'Fictional Duna account (report test)', '+12025550199', 'en', 990114, 1);
INSERT INTO leadflow_jobs (id, origin, bookingId, launch27BookingId, jobDate, bookingStatus, teamId, customerName, customerPhone, serviceName, jobTotalCents, customerRating) VALUES
  (99000101, 'launch27_import', NULL, 99200101, @d4, 'completed', 990111, 'Fict Report Customer 81', '+12025550181', 'Standard Cleaning', 16000, 5),
  (99000102, 'launch27_import', NULL, 99200102, @d3, 'completed', 990111, 'Fict Report Customer 82', '+12025550182', 'Standard Cleaning', 16000, 5),
  (99000103, 'launch27_import', NULL, 99200103, @d2, 'completed', 990111, 'Fict Report Customer 83', '+12025550183', 'Standard Cleaning', 16000, 4),
  (99000104, 'launch27_import', NULL, 99200104, @d1, 'completed', 990111, 'Fict Report Customer 84', '+12025550184', 'Standard Cleaning', 16000, NULL),
  (99000111, 'launch27_import', NULL, 99200111, @d4, 'completed', 990112, 'Fict Report Customer 85', '+12025550185', 'Standard Cleaning', 16000, 5),
  (99000112, 'launch27_import', NULL, 99200112, @d3, 'completed', 990112, 'Fict Report Customer 86', '+12025550186', 'Standard Cleaning', 16000, 5),
  (99000113, 'launch27_import', NULL, 99200113, @d2, 'completed', 990112, 'Fict Report Customer 87', '+12025550187', 'Standard Cleaning', 16000, 5),
  (99000114, 'launch27_import', NULL, 99200114, @d1, 'completed', 990112, 'Fict Report Customer 88', '+12025550188', 'Standard Cleaning', 16000, NULL),
  (99000121, 'launch27_import', NULL, 99200121, @d3, 'completed', 990113, 'Fict Report Customer 89', '+12025550189', 'Standard Cleaning', 16000, 5),
  (99000122, 'launch27_import', NULL, 99200122, @d2, 'completed', 990113, 'Fict Report Customer 90', '+12025550190', 'Standard Cleaning', 16000, NULL),
  (99000123, 'launch27_import', NULL, 99200123, @d1, 'completed', 990113, 'Fict Report Customer 91', '+12025550191', 'Standard Cleaning', 16000, NULL),
  (99000131, 'launch27_import', NULL, 99200131, @d3, 'completed', 990114, 'Fict Report Customer 92', '+12025550192', 'Standard Cleaning', 16000, 5),
  (99000132, 'launch27_import', NULL, 99200132, @d2, 'completed', 990114, 'Fict Report Customer 93', '+12025550193', 'Standard Cleaning', 16000, 5),
  (99000133, 'launch27_import', NULL, 99200133, @d1, 'completed', 990114, 'Fict Report Customer 94', '+12025550194', 'Standard Cleaning', 16000, NULL);
INSERT INTO cleaner_portal_job_progress (leadflowJobId, cleanerProfileId, teamId, etaTimestamp, createdAt, updatedAt) VALUES
  (99000101, 990011, 990011, @nowMs, NOW(), NOW()), (99000102, 990011, 990011, @nowMs, NOW(), NOW()), (99000103, 990011, 990011, @nowMs, NOW(), NOW()),
  (99000111, 990012, 990012, @nowMs, NOW(), NOW()), (99000112, 990012, 990012, @nowMs, NOW(), NOW()), (99000113, 990012, 990012, @nowMs, NOW(), NOW()), (99000114, 990012, 990012, @nowMs, NOW(), NOW()),
  (99000121, 990013, 990013, @nowMs, NOW(), NOW()), (99000122, 990013, 990013, @nowMs, NOW(), NOW()), (99000123, 990013, 990013, @nowMs, NOW(), NOW()),
  (99000131, 990014, 990014, @nowMs, NOW(), NOW()), (99000132, 990014, 990014, @nowMs, NOW(), NOW());
INSERT INTO cleaner_portal_job_photos (leadflowJobId, cleanerProfileId, photoUrl, photoKey, createdAt) VALUES
  (99000101, 990011, 'https://example.invalid/stgr-1.jpg', 'stgr-1', NOW()), (99000102, 990011, 'https://example.invalid/stgr-2.jpg', 'stgr-2', NOW()),
  (99000103, 990011, 'https://example.invalid/stgr-3.jpg', 'stgr-3', NOW()), (99000104, 990011, 'https://example.invalid/stgr-4.jpg', 'stgr-4', NOW()),
  (99000111, 990012, 'https://example.invalid/stgr-5.jpg', 'stgr-5', NOW()), (99000112, 990012, 'https://example.invalid/stgr-6.jpg', 'stgr-6', NOW()),
  (99000113, 990012, 'https://example.invalid/stgr-7.jpg', 'stgr-7', NOW()),
  (99000121, 990013, 'https://example.invalid/stgr-8.jpg', 'stgr-8', NOW()), (99000122, 990013, 'https://example.invalid/stgr-9.jpg', 'stgr-9', NOW()),
  (99000123, 990013, 'https://example.invalid/stgr-10.jpg', 'stgr-10', NOW()),
  (99000131, 990014, 'https://example.invalid/stgr-11.jpg', 'stgr-11', NOW()), (99000132, 990014, 'https://example.invalid/stgr-12.jpg', 'stgr-12', NOW()),
  (99000133, 990014, 'https://example.invalid/stgr-13.jpg', 'stgr-13', NOW());
INSERT INTO team_quality_incidents (primaryId, sourceKey, channel, detector, reportedAtMs, weekStart, customerPhone, customerEmail, customerName,
  evidenceQuote, evidenceText, category, severity, leadflowJobId, attribution, status, recleanStatus, refundStatus, processingStatus, processingError, processingAttempts, createdAtMs, updatedAtMs) VALUES
  (NULL, 'sms:stgr-1', 'sms', 'claude_sms', @nowMs - 7200000, @ws, '+12025550183', NULL, 'Fict Report Customer 83', 'the kitchen floor is still sticky', 'Hi, the kitchen floor is still sticky after the cleaning.', 'cleaning_quality', 'medium', NULL, 'unattributed', 'open', 'none', 'none', 'pending', NULL, 0, @nowMs, @nowMs),
  (NULL, 'sms:stgr-2', 'sms', 'claude_sms', @nowMs - 7000000, @ws, '+12025550181', NULL, 'Fict Report Customer 81', 'The cleaners arrived two hours late', 'The cleaners arrived two hours late.', 'cleaning_quality', 'medium', NULL, 'unattributed', 'open', 'none', 'none', 'pending', NULL, 0, @nowMs, @nowMs),
  (NULL, 'sms:stgr-3', 'sms', 'claude_sms', @nowMs - 6800000, @ws, '+12025550186', NULL, 'Fict Report Customer 86', 'they missed the upstairs bathroom', 'They missed the upstairs bathroom completely.', 'cleaning_quality', 'medium', NULL, 'unattributed', 'open', 'none', 'none', 'pending', NULL, 0, @nowMs, @nowMs),
  (NULL, 'sms:stgr-4', 'sms', 'claude_sms', @nowMs - 6600000, @ws, '+12025550192', NULL, 'Fict Report Customer 92', 'Is anyone coming today?', 'Is anyone coming today? Nobody is here yet.', 'team_service', 'medium', NULL, 'unattributed', 'open', 'none', 'none', 'pending', NULL, 0, @nowMs, @nowMs);
SQL
  fi
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
ok "real records unchanged: teams / team accounts / jobs / quality records / report sends = $OTHER_AFTER"
COUNTS="$(query "SELECT CONCAT((SELECT COUNT(*) FROM scheduling_teams WHERE id BETWEEN 990011 AND 990014), ' ', (SELECT COUNT(*) FROM cleaner_profiles WHERE id BETWEEN 990011 AND 990014), ' ', (SELECT COUNT(*) FROM leadflow_jobs WHERE id BETWEEN 99000101 AND 99000134), ' ', (SELECT COUNT(*) FROM team_quality_incidents WHERE $TEST_INCIDENTS))")"
case "$MODE" in
  create) [ "$COUNTS" = "4 4 14 4" ] || die "Expected 4 teams, 4 team accounts, 14 visits, 4 quality records; found $COUNTS"
    ok "loaded 4 fictional teams with team accounts, 14 visits and 4 quality records"
    printf '\n\033[32mDONE.\033[0m Open /admin/team-leaderboard on staging (current week), then "Send team reports":\n'
    printf '  Fictional Team Alba (report test)   English; 1 cleaning complaint (kitchen); its late-arrival complaint does not count\n'
    printf '  Fictional Team Brisa (report test)  Spanish; 1 cleaning complaint (bathroom)\n'
    printf '  Fictional Team Cielo (report test)  no phone: "Will be skipped"\n'
    printf '  Fictional Team Duna (report test)   failure test: its FIRST text is refused (Failed), the next one is sent\n'
    printf 'Texts are simulated on staging: nothing reaches a phone. To delete everything:  bash %s --remove\n' "$0";;
  remove) [ "$COUNTS" = "0 0 0 0" ] || die "Test rows still present (teams, team accounts, visits, quality records): $COUNTS"
    ok "all fictional team-report test data removed"
    printf '\n\033[32mDONE: staging team-report test data removed.\033[0m\n';;
esac
