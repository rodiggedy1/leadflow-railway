#!/bin/bash
# LeadFlow staging refresh — STEP B1: READ-ONLY check of the production database, run by the owner on their Mac.
#
# - Runs only SELECT / SHOW queries about the database's structure and size. It reads no customer data.
# - Exports nothing, changes nothing, creates nothing.
# - Asks for the production DATABASE_URL with hidden typing. The address is kept in a private temporary file that is
#   deleted when the script ends. Nothing it prints contains credentials or customer data, so the output is safe to
#   paste back to Claude.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
MAP="$HERE/../sanitize/column-map.tsv"

MYSQL="$(command -v mysql || true)"
for p in /opt/homebrew/opt/mysql-client/bin/mysql /usr/local/opt/mysql-client/bin/mysql; do
  [ -z "$MYSQL" ] && [ -x "$p" ] && MYSQL="$p"
done
if [ -z "$MYSQL" ]; then
  echo "The MySQL client is not installed. In Terminal run:  brew install mysql-client"
  echo "then run this check again."
  exit 1
fi
DUMP="$(dirname "$MYSQL")/mysqldump"
[ -f "$MAP" ] || { echo "Cannot find $MAP. Run this from the LeadFlow folder after the git steps."; exit 1; }

printf "Paste the production DATABASE_URL (nothing will show while you paste), then press Enter: "
IFS= read -rs URL
echo
TMP="$(mktemp -d)"
chmod 700 "$TMP"
trap 'rm -rf "$TMP"' EXIT
URL="$URL" python3 - "$TMP" "${B1_LOCAL_TEST:-}" <<'PY' || exit 1
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
PY
unset URL
DB="$(cat "$TMP/db")"
q() { "$MYSQL" --defaults-extra-file="$TMP/my.cnf" --connect-timeout=15 --batch --skip-column-names --database="$DB" -e "$1"; }

if ! q "SELECT 1" > /dev/null; then
  echo "Could not connect (see the message above). Nothing was read or changed."
  exit 1
fi

echo "===== LeadFlow production check (read-only) ====="
echo "Server version:       $(q "SELECT VERSION()")"
echo "Encrypted connection: $(q "SHOW SESSION STATUS LIKE 'Ssl_cipher'" | cut -f2)"
echo "Database name:        $DB"
q "SELECT CONCAT('Tables: ', COUNT(*), ' | approx. size: ', ROUND(SUM(data_length + index_length) / 1048576), ' MB') FROM information_schema.tables WHERE table_schema = DATABASE()"
echo "--- 10 largest tables (approx. MB / approx. rows, from statistics; no table is scanned)"
q "SELECT CONCAT('  ', table_name, ': ', ROUND((data_length + index_length) / 1048576), ' MB / ', table_rows, ' rows') FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY data_length + index_length DESC LIMIT 10"
echo "--- Database updates (ledger)"
if LEDGER="$(q "SELECT CONCAT('  ', state, ': ', COUNT(*)) FROM app_versioned_migration_ledger GROUP BY state" 2>/dev/null)"; then
  echo "$LEDGER"
  q "SELECT CONCAT('  latest applied: ', MAX(migration_id)) FROM app_versioned_migration_ledger WHERE state = 'applied'"
else
  echo "  (ledger table not found)"
fi
echo "--- Permissions of this login (names only)"
q "SHOW GRANTS" | sed -E 's/ TO .*//; s/^/  /'
echo "--- Structure compared with the sanitizer's column map"
q "SELECT CONCAT(table_name, '.', column_name) FROM information_schema.columns WHERE table_schema = DATABASE()" | LC_ALL=C sort -u > "$TMP/prod.txt"
tail -n +2 "$MAP" | awk -F'\t' '{print $1 "." $2}' | LC_ALL=C sort -u > "$TMP/map.txt"
LC_ALL=C comm -23 "$TMP/prod.txt" "$TMP/map.txt" > "$TMP/extra.txt"
LC_ALL=C comm -13 "$TMP/prod.txt" "$TMP/map.txt" > "$TMP/missing.txt"
echo "  production columns: $(wc -l < "$TMP/prod.txt" | tr -d ' ') | in map: $(wc -l < "$TMP/map.txt" | tr -d ' ')"
echo "  in production but NOT in the map: $(wc -l < "$TMP/extra.txt" | tr -d ' ')"
if [ -s "$TMP/extra.txt" ]; then
  # structure only (table, column, type, nullable, key, extra), so the sanitizer can be given a rule for each one
  q "SELECT CONCAT(table_name, '.', column_name, '|', column_type, '|', data_type, '|', is_nullable, '|', column_key, '|', extra) FROM information_schema.columns WHERE table_schema = DATABASE()" | LC_ALL=C sort > "$TMP/types.txt"
  awk -F'|' 'NR == FNR { want[$0] = 1; next } ($1 in want)' "$TMP/extra.txt" "$TMP/types.txt" | head -n 300 | sed 's/^/    + /'
  echo "  tables in production that the map does not know at all:"
  cut -d. -f1 "$TMP/prod.txt" | LC_ALL=C sort -u > "$TMP/prod-t.txt"
  cut -d. -f1 "$TMP/map.txt" | LC_ALL=C sort -u > "$TMP/map-t.txt"
  LC_ALL=C comm -23 "$TMP/prod-t.txt" "$TMP/map-t.txt" | while IFS= read -r t; do
    echo "    $t ($(q "SELECT table_rows FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '$t'") rows approx.)"
  done
fi
echo "  in the map but NOT in production: $(wc -l < "$TMP/missing.txt" | tr -d ' ')"
head -n 150 "$TMP/missing.txt" | sed 's/^/    - /'
echo "--- Export tool on this Mac"
if [ -x "$DUMP" ]; then echo "  $("$DUMP" --version)"; else echo "  mysqldump not found next to $MYSQL"; fi
echo "===== End of check. Nothing was exported or changed. ====="
