#!/bin/bash
# LeadFlow: complete, consistent, READ-ONLY backup of the production database to the owner's Mac, with TiDB's own
# export tool Dumpling. Same proven approach as the staging refresh export (docs/claude/staging/refresh/b3-...), but
# with EVERY table's structure AND contents (nothing skipped), plus verification.
#
# - Consistent: one Dumpling run reads every table "as of" one moment (TiDB snapshot read). No locks, no writes, no
#   settings changed in production. The row counts used for verification are read at that same moment.
# - Asks for the production DATABASE_URL with hidden typing; it is never written to the screen, history, logs or files
#   (credentials live only in a private temporary file that is deleted at the end).
# - Refuses the staging database. Shows what it will read and starts only when you type BACKUP.
# - Verifies: every table's structure is present, every table's exported row count equals its row count at the
#   snapshot, and writes a SHA-256 checksum list so the files can be checked later.
# - Files go to ~/leadflow-backups/production-<date-time>/ (only you can open it). They contain ALL real customer
#   data: keep them private, never share, upload or email them.
#
# Needs Dumpling (tiup install dumpling:v8.5.3) and the MySQL client 8.4 (brew install mysql-client@8.4).
set -u
umask 077

DUMPLING="${BACKUP_DUMPLING:-}"
if [ -z "$DUMPLING" ]; then
  for d in "$HOME"/.tiup/components/dumpling/v8.5.*/dumpling; do [ -x "$d" ] && DUMPLING="$d"; done
fi
[ -n "$DUMPLING" ] || { echo "Dumpling is not installed (tiup install dumpling:v8.5.3). Nothing was read."; exit 1; }
MYSQL=""
for d in "${BACKUP_MYSQL_BIN_DIR:-}" /opt/homebrew/opt/mysql-client@8.4/bin /usr/local/opt/mysql-client@8.4/bin \
         /opt/homebrew/opt/mysql-client/bin /usr/local/opt/mysql-client/bin; do
  [ -n "$d" ] && [ -x "$d/mysql" ] && { MYSQL="$d/mysql"; break; }
done
[ -n "$MYSQL" ] || MYSQL="$(command -v mysql || true)"
[ -n "$MYSQL" ] || { echo "The MySQL client is not installed (brew install mysql-client@8.4). Nothing was read."; exit 1; }
if command -v shasum > /dev/null; then SHA=(shasum -a 256); else SHA=(sha256sum); fi

printf "Paste the PRODUCTION DATABASE_URL (nothing will show while you paste), then press Enter: "
IFS= read -rs URL
echo
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
URL="$URL" python3 - "$TMP" "${BACKUP_LOCAL_TEST:-}" <<'PY' || exit 1
import os, sys, urllib.parse as u
tmp, local = sys.argv[1], sys.argv[2] == "1"
p = u.urlparse(os.environ["URL"].strip().strip('"').removeprefix("DATABASE_URL="))
if p.scheme not in ("mysql", "mysql2") or not p.hostname:
    sys.exit("That does not look like a mysql://... database address. Nothing was read.")
user, pw, port = u.unquote(p.username or ""), u.unquote(p.password or ""), str(p.port or 4000)
q = lambda v: '"' + str(v).replace("\\", "\\\\").replace('"', '\\"') + '"'
lines = ["[client]", "user=" + q(user), "password=" + q(pw), "host=" + q(p.hostname), "port=" + port]
if not local:
    lines += ["ssl-mode=VERIFY_IDENTITY", "ssl-ca=/etc/ssl/cert.pem"]
def w(name, text):
    fd = os.open(os.path.join(tmp, name), os.O_WRONLY | os.O_CREAT, 0o600)
    os.write(fd, text.encode()); os.close(fd)
w("my.cnf", "\n".join(lines) + "\n")
w("db", u.unquote(p.path.lstrip("/").split("?")[0]))
w("host", p.hostname); w("port", port); w("user", user); w("pw", pw)
PY
unset URL
DB="$(cat "$TMP/db")"
[ -n "$DB" ] || { echo "The address names no database. Nothing was read."; exit 1; }
case "$DB" in *staging*) echo "STOP: \"$DB\" is the staging database. Use the PRODUCTION DATABASE_URL. Nothing was read."; exit 1;; esac
q() { "$MYSQL" --defaults-extra-file="$TMP/my.cnf" --connect-timeout=15 --batch --skip-column-names --database="$DB" -e "$1"; }
q "SELECT 1" > /dev/null || { echo "Could not connect (see the message above). Nothing was read."; exit 1; }
# The staging sanitizer's marker table never exists in production. If it does, this is not production: stop.
if [ -n "$(q "SHOW TABLES LIKE '\_\_staging\_sanitize\_marker'")" ]; then
  echo "STOP: this database contains the staging sanitizer's marker table, so it is not production. Nothing was read."
  exit 1
fi

q "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'" | LC_ALL=C sort > "$TMP/tables.txt"
q "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE <> 'BASE TABLE'" | LC_ALL=C sort > "$TMP/views.txt"
NTABLES=$(wc -l < "$TMP/tables.txt" | tr -d ' ')
OUT="$HOME/leadflow-backups/production-$(date +%Y%m%d-%H%M%S)"

echo "===== About to back up (read-only) ====="
echo "Export tool:   Dumpling $("$DUMPLING" --version 2>&1 | grep -m1 -i 'release version' | awk '{print $NF}')"
echo "Server:        $(q "SELECT VERSION()")"
echo "Database:      $DB"
q "SELECT CONCAT('Size:          about ', ROUND(SUM(data_length + index_length) / 1048576), ' MB in ', COUNT(*), ' tables') FROM information_schema.tables WHERE table_schema = DATABASE()"
echo "Contents:      ALL $NTABLES tables, structure and every row (nothing skipped)$([ -s "$TMP/views.txt" ] && echo "; plus $(wc -l < "$TMP/views.txt" | tr -d ' ') view definition(s)")"
echo "Consistency:   one snapshot for all tables (no locks, no writes)"
echo "Destination:   $OUT"
printf "Type BACKUP to start (anything else cancels): "
read -r ANSWER
[ "$ANSWER" = "BACKUP" ] || { echo "Cancelled. Nothing was read."; exit 0; }

ARGS=(-h "$(cat "$TMP/host")" -P "$(cat "$TMP/port")" -u "$(cat "$TMP/user")" -p "$(cat "$TMP/pw")"
      --filetype sql --consistency snapshot -t 4 --status-addr 127.0.0.1:8282 --loglevel info
      -f "$DB.*" --complete-insert -o "$OUT/dump" -L "$OUT/dumpling.log")
[ "${BACKUP_LOCAL_TEST:-}" = "1" ] || ARGS+=(--ca /etc/ssl/cert.pem)
mkdir -p "$OUT" && chmod 700 "$OUT"
fail() { echo; echo "BACKUP FAILED: $1"; echo "Production was only read and is unchanged. The incomplete files were deleted."; echo "Send Claude the lines above (they contain no data or password)."; rm -rf "$OUT"; exit 1; }
START=$(date +%s)
echo "Exporting (one snapshot; this can take several minutes)..."
"$DUMPLING" "${ARGS[@]}" > "$TMP/dump.out" 2>&1 && grep -q "dump data successfully" "$OUT/dumpling.log" \
  || { grep -m1 "dump failed" "$TMP/dump.out"; fail "Dumpling stopped"; }
SNAP="$(awk '/Pos:/ {print $2; exit}' "$OUT/dump/metadata" 2>/dev/null)"
[ -n "$SNAP" ] || fail "no snapshot position was recorded"

echo "Verifying..."
# Row counts AS OF the same snapshot, in a READ ONLY transaction (TiDB refuses any write inside it).
{ echo "START TRANSACTION READ ONLY AS OF TIMESTAMP TIDB_PARSE_TSO($SNAP);"
  while IFS= read -r t; do printf "SELECT '%s', COUNT(*) FROM \`%s\`;\n" "$t" "$t"; done < "$TMP/tables.txt"
  echo "COMMIT;"; } > "$TMP/count.sql"
"$MYSQL" --defaults-extra-file="$TMP/my.cnf" --batch --skip-column-names --database="$DB" < "$TMP/count.sql" > "$TMP/expected.tsv" 2>"$TMP/count.err" \
  || { cat "$TMP/count.err" | grep -v "Using a password"; fail "the snapshot row counts could not be read"; }
# Rows actually written: Dumpling writes one row per line, starting with "(", in <db>.<table>.<n>.sql files.
: > "$TMP/got.tsv"
while IFS= read -r t; do
  n=0
  for f in "$OUT/dump/$DB.$t".*.sql; do
    [ -e "$f" ] || continue
    case "$f" in *-schema.sql|*-schema-view.sql|*-schema-trigger.sql) continue;; esac
    c=$(LC_ALL=C grep -c '^(' "$f"); n=$((n + c))
  done
  printf '%s\t%s\n' "$t" "$n" >> "$TMP/got.tsv"
done < "$TMP/tables.txt"
MISMATCH=$(paste "$TMP/expected.tsv" "$TMP/got.tsv" | awk -F'\t' '$1 != $3 || $2 != $4 {print $1 " (snapshot " $2 ", exported " $4 ")"}')
SCHEMAS=0
while IFS= read -r t; do [ -f "$OUT/dump/$DB.$t-schema.sql" ] && SCHEMAS=$((SCHEMAS + 1)); done < "$TMP/tables.txt"
ROWS=$(awk -F'\t' '{s += $2} END {print s + 0}' "$TMP/expected.tsv")
{ printf 'table\trows_at_snapshot\n'; cat "$TMP/expected.tsv"; } > "$OUT/row-counts.tsv"
(cd "$OUT" && find dump -type f | LC_ALL=C sort | while IFS= read -r f; do "${SHA[@]}" "$f"; done > SHA256SUMS && "${SHA[@]}" row-counts.tsv >> SHA256SUMS)
END=$(date +%s)
{ echo "LeadFlow production backup"; echo "Database: $DB"; echo "Snapshot position (TiDB TSO): $SNAP"
  echo "Started: $(date -r "$START" 2>/dev/null || date -d "@$START")"; echo "Tables: $NTABLES; rows: $ROWS"
  echo "Check the files later with:  cd \"$OUT\" && ${SHA[*]} -c SHA256SUMS"; } > "$OUT/README.txt"

echo "===== Backup finished in $((END - START)) seconds. Production was only read. ====="
echo "Snapshot position:          $SNAP"
echo "Table structures:           $SCHEMAS of $NTABLES $([ "$SCHEMAS" = "$NTABLES" ] && echo '(complete)' || echo '(MISSING: tell Claude)')"
echo "Rows exported:              $ROWS, every table matching its count at the snapshot$([ -n "$MISMATCH" ] && echo ' — NO, see below')"
echo "Checksums:                  $OUT/SHA256SUMS"
echo "Size on disk:               $(du -sh "$OUT" | cut -f1 | tr -d ' ')"
if [ "$SCHEMAS" != "$NTABLES" ] || [ -n "$MISMATCH" ]; then
  echo; echo "VERIFICATION FAILED for:"; printf '%s\n' "$MISMATCH" | head -20
  echo "The files are kept in $OUT for inspection, but do NOT rely on this backup. Send Claude these lines (no data)."
  exit 1
fi
echo
echo "BACKUP VERIFIED: $OUT"
echo "It contains ALL real customer data. Keep it private; do not share, upload or email it."
