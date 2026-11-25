#!/bin/bash
# LeadFlow staging refresh — STEP B4: load the production export (~/leadflow-refresh, made by step B3) into the
# STAGING database, replacing what is there. Run by the owner on their Mac.
#
# - Writes ONLY to the staging database. Refuses any database not named leadflow_staging (production is never touched).
# - Asks for the STAGING DATABASE_URL with hidden typing (Railway -> staging environment -> leadflow-staging ->
#   Variables -> DATABASE_URL). It is kept in a private temporary file deleted at the end.
# - Starts only when you type REPLACE STAGING. Safe to re-run: it starts from an empty staging database each time.
# - Afterwards re-applies the existing staging lock on the public demo-cleaner link (demo@preview.local switched off).
set -u
umask 077
OUT="$HOME/leadflow-refresh"
MYSQL=""
for d in "${B4_MYSQL_BIN_DIR:-}" /opt/homebrew/opt/mysql-client@8.4/bin /usr/local/opt/mysql-client@8.4/bin \
         /opt/homebrew/opt/mysql-client/bin /usr/local/opt/mysql-client/bin; do
  [ -n "$d" ] && [ -x "$d/mysql" ] && { MYSQL="$d/mysql"; break; }
done
[ -n "$MYSQL" ] || MYSQL="$(command -v mysql || true)"
[ -n "$MYSQL" ] || { echo "The MySQL client is not installed (brew install mysql-client@8.4)."; exit 1; }
[ -f "$OUT/structure/metadata" ] && [ -d "$OUT/data" ] || { echo "No export found in $OUT. Run step B3 first."; exit 1; }

printf "Paste the STAGING DATABASE_URL (nothing will show while you paste), then press Enter: "
IFS= read -rs URL
echo
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
URL="$URL" python3 - "$TMP" "${B4_LOCAL_TEST:-}" <<'PY' || exit 1
import os, sys, urllib.parse as u
tmp, local = sys.argv[1], sys.argv[2] == "1"
p = u.urlparse(os.environ["URL"].strip())
if p.scheme not in ("mysql", "mysql2") or not p.hostname:
    sys.exit("That does not look like a mysql://... database address. Nothing was done.")
q = lambda v: '"' + str(v).replace("\\", "\\\\").replace('"', '\\"') + '"'
lines = ["[client]", "user=" + q(u.unquote(p.username or "")), "password=" + q(u.unquote(p.password or "")),
         "host=" + q(p.hostname), "port=" + str(p.port or 4000)]
if not local:
    lines += ["ssl-mode=VERIFY_IDENTITY", "ssl-ca=/etc/ssl/cert.pem"]
fd = os.open(os.path.join(tmp, "my.cnf"), os.O_WRONLY | os.O_CREAT, 0o600)
os.write(fd, ("\n".join(lines) + "\n").encode()); os.close(fd)
open(os.path.join(tmp, "db"), "w").write(u.unquote(p.path.lstrip("/")))
open(os.path.join(tmp, "host"), "w").write(p.hostname)
PY
unset URL
DB="$(cat "$TMP/db")"
if [ "$DB" != "leadflow_staging" ]; then
  echo "STOP: this address points at database '$DB', not 'leadflow_staging'. Nothing was changed."
  echo "Make sure you copied DATABASE_URL from the STAGING environment in Railway."
  exit 1
fi
M() { "$MYSQL" --defaults-extra-file="$TMP/my.cnf" --connect-timeout=15 --batch --skip-column-names --database="$DB" "$@"; }
M -e "SELECT 1" > /dev/null || { echo "Could not connect (see the message above). Nothing was changed."; exit 1; }

SCHEMAS=$(ls "$OUT/structure" | grep -- '-schema\.sql$' | grep -v -- '-schema-create\.sql$' | wc -l | tr -d ' ')
echo "===== About to REPLACE the staging database ====="
echo "Target:              database leadflow_staging on $(cat "$TMP/host")"
echo "Staging tables now:  $(M -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()") (will be deleted)"
echo "From the export:     $SCHEMAS table structures + contents ($(du -sh "$OUT/data" | cut -f1 | tr -d ' '))"
printf "Type REPLACE STAGING to start (anything else cancels): "
read -r ANSWER
[ "$ANSWER" = "REPLACE STAGING" ] || { echo "Cancelled. Nothing was changed."; exit 0; }

START=$(date +%s)
echo "1/4 Emptying the staging database..."
TABLES=$(M -e "SELECT CONCAT('\`', table_name, '\`') FROM information_schema.tables WHERE table_schema = DATABASE()" | paste -sd, -)
[ -z "$TABLES" ] || M -e "SET FOREIGN_KEY_CHECKS = 0; DROP TABLE IF EXISTS $TABLES" || { echo "FAILED while emptying staging. Re-run this script."; exit 1; }
echo "2/4 Creating $SCHEMAS tables..."
for f in "$OUT"/structure/*-schema.sql; do
  case "$f" in *-schema-create.sql) continue ;; esac
  { echo "SET FOREIGN_KEY_CHECKS = 0;"; cat "$f"; } | M || { echo "FAILED on $(basename "$f"). Staging is incomplete: re-run this script."; exit 1; }
done
N=$(ls "$OUT"/data/*.sql 2>/dev/null | grep -vc -- '-schema' ; true)
echo "3/4 Loading contents ($N files; this can take 10-30 minutes)..."
i=0
for f in "$OUT"/data/*.sql; do
  case "$f" in *-schema*.sql) continue ;; esac
  i=$((i + 1))
  printf "\r    file %s of %s" "$i" "$N"
  { echo "SET FOREIGN_KEY_CHECKS = 0;"; cat "$f"; } | M || { echo; echo "FAILED on $(basename "$f"). Staging is incomplete: re-run this script."; exit 1; }
done
echo
echo "4/4 Re-applying the staging lock on the demo-cleaner link..."
HAD=$(M -e "SELECT COUNT(*) FROM cleaner_profiles WHERE email = 'demo@preview.local'")
if [ "$HAD" != "0" ]; then
  M -e "UPDATE cleaner_profiles SET isActive = 0, passwordHash = NULL WHERE email = 'demo@preview.local'"
else
  if [ -n "$(M -e "SHOW COLUMNS FROM cleaner_profiles LIKE 'profileSource'")" ]; then
    M -e "INSERT INTO cleaner_profiles (name, email, isActive, passwordHash, profileSource) VALUES ('Demo Cleaner (disabled)', 'demo@preview.local', 0, NULL, 'staging_lock')"
  else
    M -e "INSERT INTO cleaner_profiles (name, email, isActive, passwordHash) VALUES ('Demo Cleaner (disabled)', 'demo@preview.local', 0, NULL)"
  fi
fi
END=$(date +%s)
echo "===== Staging now holds the production copy ($((END - START)) seconds) ====="
echo "Tables:                 $(M -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()") (expected $SCHEMAS)"
for t in conversation_sessions leadflow_jobs bookings agents cleaner_profiles; do
  echo "Rows in $t: $(M -e "SELECT COUNT(*) FROM \`$t\`" 2>/dev/null)"
done
echo "Database updates recorded: $(M -e "SELECT COUNT(*) FROM app_versioned_migration_ledger WHERE state = 'applied'" 2>/dev/null) applied"
echo "Demo-cleaner link locked: $(M -e "SELECT IF(COUNT(*) = 1 AND MAX(isActive) = 0 AND MAX(passwordHash) IS NULL, 'yes', 'NO') FROM cleaner_profiles WHERE email = 'demo@preview.local'") (production copy already had that account: $([ "$HAD" = 0 ] && echo no || echo yes))"
