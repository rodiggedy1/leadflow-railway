#!/bin/bash
# LeadFlow staging refresh — STEP B3: export production to the owner's Mac (READ-ONLY for production).
#
# - Uses mysqldump with one consistent read (--single-transaction, no table locks). It only reads: no writes, no locks,
#   no changes to production.
# - Exports the STRUCTURE of every table, and the CONTENTS of every table EXCEPT the ones the sanitizer empties anyway
#   (raw webhook payloads, login tokens, caches, AI logs...). Those contents never leave production.
# - Asks for the production DATABASE_URL with hidden typing; it is kept in a private temporary file deleted at the end.
# - Shows what it is about to read and starts only when you type EXPORT.
# - Files go to ~/leadflow-refresh (only you can open that folder). They contain REAL customer data until cleaned:
#   do not share, upload or email them. Step B7 deletes them.
set -u
umask 077
HERE="$(cd "$(dirname "$0")" && pwd)"
MAP="$HERE/../sanitize/column-map.tsv"
OUT="$HOME/leadflow-refresh"

MYSQL="$(command -v mysql || true)"
for p in /opt/homebrew/opt/mysql-client/bin/mysql /usr/local/opt/mysql-client/bin/mysql; do
  [ -z "$MYSQL" ] && [ -x "$p" ] && MYSQL="$p"
done
[ -n "$MYSQL" ] || { echo "The MySQL client is not installed (brew install mysql-client)."; exit 1; }
DUMP="$(dirname "$MYSQL")/mysqldump"
[ -x "$DUMP" ] || { echo "mysqldump not found next to $MYSQL."; exit 1; }
[ -f "$MAP" ] || { echo "Cannot find $MAP. Run this from the LeadFlow folder after the git steps."; exit 1; }

printf "Paste the PRODUCTION DATABASE_URL (nothing will show while you paste), then press Enter: "
IFS= read -rs URL
echo
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
URL="$URL" python3 - "$TMP" "${B3_LOCAL_TEST:-}" <<'PY' || exit 1
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
CNF="$TMP/my.cnf"
q() { "$MYSQL" --defaults-extra-file="$CNF" --connect-timeout=15 --batch --skip-column-names --database="$DB" -e "$1"; }
q "SELECT 1" > /dev/null || { echo "Could not connect (see the message above). Nothing was exported."; exit 1; }

# Safety: the sanitizer's marker table must never exist in production. If it does, something is wrong: stop.
if [ -n "$(q "SHOW TABLES LIKE '\_\_staging\_sanitize\_marker'")" ]; then
  echo "STOP: this database contains the sanitizer's marker table. That must never be the case for production."
  echo "Nothing was exported. Tell Claude."
  exit 1
fi

# Tables whose contents are not exported (the sanitizer empties them anyway).
tail -n +2 "$MAP" | awk -F'\t' '$4 == "TRUNCATE_TABLE" {print $1}' | LC_ALL=C sort -u > "$TMP/skip.txt"
q "SHOW TABLES" | LC_ALL=C sort > "$TMP/all.txt"
LC_ALL=C comm -12 "$TMP/all.txt" "$TMP/skip.txt" > "$TMP/skip-present.txt"
IGNORE=()
while IFS= read -r t; do IGNORE+=("--ignore-table=$DB.$t"); done < "$TMP/skip-present.txt"

echo "===== About to export (read-only) ====="
echo "Database:            $DB"
q "SELECT CONCAT('Tables:              ', COUNT(*), ' (approx. ', ROUND(SUM(data_length + index_length) / 1048576), ' MB)') FROM information_schema.tables WHERE table_schema = DATABASE()"
echo "Structure exported:  all tables"
echo "Contents NOT exported (emptied anyway): $(wc -l < "$TMP/skip-present.txt" | tr -d ' ') tables, e.g. $(head -n 6 "$TMP/skip-present.txt" | paste -sd, - | sed 's/,/, /g') ..."
echo "Destination:         $OUT"
printf "Type EXPORT to start (anything else cancels): "
read -r ANSWER
[ "$ANSWER" = "EXPORT" ] || { echo "Cancelled. Nothing was exported."; exit 0; }

# Options: one consistent snapshot, no locks, nothing that needs extra privileges or writes anything.
OPTS=(--defaults-extra-file="$CNF" --single-transaction --skip-lock-tables --no-tablespaces --hex-blob
      --default-character-set=utf8mb4 --skip-routines --skip-events)
"$DUMP" --help 2>/dev/null | grep -q -- '--column-statistics' && OPTS+=(--column-statistics=0)
"$DUMP" --help 2>/dev/null | grep -q -- '--set-gtid-purged' && OPTS+=(--set-gtid-purged=OFF)

mkdir -p "$OUT" && chmod 700 "$OUT"
rm -f "$OUT/production-structure.sql" "$OUT/production-data.sql"
START=$(date +%s)
echo "Exporting structure..."
"$DUMP" "${OPTS[@]}" --no-data "$DB" > "$OUT/production-structure.sql" || { echo "Structure export FAILED (nothing was changed in production)."; exit 1; }
echo "Exporting contents (this can take a few minutes)..."
"$DUMP" "${OPTS[@]}" --no-create-info "${IGNORE[@]}" "$DB" > "$OUT/production-data.sql" || { echo "Contents export FAILED (nothing was changed in production)."; exit 1; }
END=$(date +%s)

echo "===== Export finished in $((END - START)) seconds. Production was only read. ====="
for f in production-structure.sql production-data.sql; do
  SIZE=$(du -h "$OUT/$f" | cut -f1 | tr -d ' ')
  DONE=$(tail -n 3 "$OUT/$f" | grep -c 'Dump completed')
  echo "$f: $SIZE | complete: $([ "$DONE" = 1 ] && echo yes || echo NO)"
done
echo "Tables in structure file:        $(grep -c '^CREATE TABLE' "$OUT/production-structure.sql")"
echo "Tables with contents exported:   $(grep -o '^INSERT INTO `[^`]*`' "$OUT/production-data.sql" | LC_ALL=C sort -u | wc -l | tr -d ' ')"
echo "Skipped tables found in the contents file (must be 0): $(grep -o '^INSERT INTO `[^`]*`' "$OUT/production-data.sql" | tr -d '`' | awk '{print $3}' | LC_ALL=C sort -u | LC_ALL=C comm -12 - "$TMP/skip-present.txt" | wc -l | tr -d ' ')"
echo "These files contain REAL customer data. Do not share them. They are deleted in step B7."
