#!/bin/bash
# LeadFlow staging refresh — STEP B3: export production to the owner's Mac with TiDB's own export tool, Dumpling
# (READ-ONLY for production).
#
# - Consistent snapshot: every table is read "as of" one moment (TiDB's built-in snapshot read). No locks, no
#   savepoints, no writes, no settings changed. Dumpling only reads.
# - Exports the STRUCTURE of every table, and the CONTENTS of every table EXCEPT the ones the sanitizer empties anyway
#   (raw webhook payloads, login tokens, caches, AI logs...). Those contents never leave production.
# - Asks for the production DATABASE_URL with hidden typing; it is never written to the screen, history or logs.
# - Shows what it is about to read and starts only when you type EXPORT.
# - Files go to ~/leadflow-refresh (only you can open that folder). They contain REAL customer data until cleaned:
#   do not share, upload or email them. Step B7 deletes them.
set -u
umask 077
HERE="$(cd "$(dirname "$0")" && pwd)"
MAP="$HERE/../sanitize/column-map.tsv"
OUT="$HOME/leadflow-refresh"

# Dumpling (installed with TiUP: tiup install dumpling:v8.5.3)
DUMPLING="${B3_DUMPLING:-}"
if [ -z "$DUMPLING" ]; then
  for d in "$HOME"/.tiup/components/dumpling/v8.5.*/dumpling; do [ -x "$d" ] && DUMPLING="$d"; done
fi
if [ -z "$DUMPLING" ]; then
  echo "Dumpling is not installed. Follow the install steps Claude gave you (tiup install dumpling:v8.5.3), then run"
  echo "this script again. Nothing was exported."
  exit 1
fi
# MySQL client, only for the read-only pre-checks
MYSQL=""
for d in "${B3_MYSQL_BIN_DIR:-}" /opt/homebrew/opt/mysql-client@8.4/bin /usr/local/opt/mysql-client@8.4/bin \
         /opt/homebrew/opt/mysql-client/bin /usr/local/opt/mysql-client/bin; do
  [ -n "$d" ] && [ -x "$d/mysql" ] && { MYSQL="$d/mysql"; break; }
done
[ -n "$MYSQL" ] || MYSQL="$(command -v mysql || true)"
[ -n "$MYSQL" ] || { echo "The MySQL client is not installed (brew install mysql-client@8.4). Nothing was exported."; exit 1; }
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
user, pw, port = u.unquote(p.username or ""), u.unquote(p.password or ""), str(p.port or 4000)
q = lambda v: '"' + str(v).replace("\\", "\\\\").replace('"', '\\"') + '"'
lines = ["[client]", "user=" + q(user), "password=" + q(pw), "host=" + q(p.hostname), "port=" + port]
if not local:
    lines += ["ssl-mode=VERIFY_IDENTITY", "ssl-ca=/etc/ssl/cert.pem"]
def w(name, text):
    fd = os.open(os.path.join(tmp, name), os.O_WRONLY | os.O_CREAT, 0o600)
    os.write(fd, text.encode()); os.close(fd)
w("my.cnf", "\n".join(lines) + "\n")
w("db", u.unquote(p.path.lstrip("/")))
w("host", p.hostname); w("port", port); w("user", user); w("pw", pw)
PY
unset URL
DB="$(cat "$TMP/db")"
q() { "$MYSQL" --defaults-extra-file="$TMP/my.cnf" --connect-timeout=15 --batch --skip-column-names --database="$DB" -e "$1"; }
q "SELECT 1" > /dev/null || { echo "Could not connect (see the message above). Nothing was exported."; exit 1; }

# Safety: the sanitizer's marker table must never exist in production. If it does, something is wrong: stop.
if [ -n "$(q "SHOW TABLES LIKE '\_\_staging\_sanitize\_marker'")" ]; then
  echo "STOP: this database contains the sanitizer's marker table. That must never be the case for production."
  echo "Nothing was exported. Tell Claude."
  exit 1
fi

# Tables whose contents are not exported (the sanitizer empties them anyway) -> Dumpling filter file.
tail -n +2 "$MAP" | awk -F'\t' '$4 == "TRUNCATE_TABLE" {print $1}' | LC_ALL=C sort -u > "$TMP/skip.txt"
q "SHOW TABLES" | LC_ALL=C sort > "$TMP/all.txt"
LC_ALL=C comm -12 "$TMP/all.txt" "$TMP/skip.txt" > "$TMP/skip-present.txt"
{ echo "$DB.*"; sed "s/^/!$DB./" "$TMP/skip-present.txt"; } > "$TMP/filter.txt"
NTABLES=$(wc -l < "$TMP/all.txt" | tr -d ' ')

echo "===== About to export (read-only) ====="
echo "Export tool:         Dumpling $("$DUMPLING" --version 2>&1 | grep -m1 -i 'release version' | awk '{print $NF}')"
echo "Server:              $(q "SELECT VERSION()")"
echo "Database:            $DB"
q "SELECT CONCAT('Tables:              ', COUNT(*), ' (approx. ', ROUND(SUM(data_length + index_length) / 1048576), ' MB)') FROM information_schema.tables WHERE table_schema = DATABASE()"
echo "Structure exported:  all $NTABLES tables"
echo "Contents NOT exported (emptied anyway): $(wc -l < "$TMP/skip-present.txt" | tr -d ' ') tables, e.g. $(head -n 6 "$TMP/skip-present.txt" | paste -sd, - | sed 's/,/, /g') ..."
echo "Consistency:         one snapshot for all tables (no locks)"
echo "Destination:         $OUT"
printf "Type EXPORT to start (anything else cancels): "
read -r ANSWER
[ "$ANSWER" = "EXPORT" ] || { echo "Cancelled. Nothing was exported."; exit 0; }

CONSISTENCY="${B3_CONSISTENCY:-snapshot}"   # always snapshot for production (TiDB); local tests on MariaDB use none
ARGS=(-h "$(cat "$TMP/host")" -P "$(cat "$TMP/port")" -u "$(cat "$TMP/user")" -p "$(cat "$TMP/pw")"
      --filetype sql --consistency "$CONSISTENCY" -t 4 --status-addr 127.0.0.1:8281 --loglevel info)
[ "${B3_LOCAL_TEST:-}" = "1" ] || ARGS+=(--ca /etc/ssl/cert.pem)

mkdir -p "$OUT" && chmod 700 "$OUT"
rm -rf "$OUT/structure" "$OUT/data" "$OUT"/*.log
fail() { rm -rf "$OUT/structure" "$OUT/data"; echo "$1 export FAILED (nothing was changed in production; partial files deleted)."; echo "Send Claude the 'dump failed' line above (it contains no data or password)."; exit 1; }
START=$(date +%s)
echo "Exporting structure..."
"$DUMPLING" "${ARGS[@]}" -f "$DB.*" --no-data -o "$OUT/structure" -L "$OUT/structure.log" > "$TMP/s.out" 2>&1 \
  && grep -q "dump data successfully" "$OUT/structure.log" || { grep -m1 "dump failed" "$TMP/s.out"; fail "Structure"; }
SNAP=""
if [ "$CONSISTENCY" = "snapshot" ]; then
  SNAP="$(awk '/Pos:/ {print $2; exit}' "$OUT/structure/metadata" 2>/dev/null)"
  [ -n "$SNAP" ] || fail "Structure (no snapshot position recorded)"
fi
echo "Exporting contents (same snapshot; this can take a few minutes)..."
DARGS=(-f "@$TMP/filter.txt" --no-schemas --complete-insert -o "$OUT/data" -L "$OUT/data.log")
[ -n "$SNAP" ] && DARGS+=(--snapshot "$SNAP")
"$DUMPLING" "${ARGS[@]}" "${DARGS[@]}" > "$TMP/d.out" 2>&1 \
  && grep -q "dump data successfully" "$OUT/data.log" || { grep -m1 "dump failed" "$TMP/d.out"; fail "Contents"; }
END=$(date +%s)

SCHEMAS=$(ls "$OUT/structure" | grep -- '-schema\.sql$' | grep -vc -- '-schema-create\.sql$')
ls "$OUT/data" | grep -E '\.[0-9]+\.sql$' | sed -E "s/^$DB\.(.*)\.[0-9]+\.sql$/\1/" | LC_ALL=C sort -u > "$TMP/with-data.txt"
LEAK=$(LC_ALL=C comm -12 "$TMP/with-data.txt" "$TMP/skip-present.txt" | wc -l | tr -d ' ')
echo "===== Export finished in $((END - START)) seconds. Production was only read. ====="
echo "Snapshot position:               ${SNAP:-n/a}"
echo "Table structures exported:       $SCHEMAS of $NTABLES $([ "$SCHEMAS" = "$NTABLES" ] && echo '(complete)' || echo '(MISMATCH: tell Claude)')"
echo "Tables with contents exported:   $(wc -l < "$TMP/with-data.txt" | tr -d ' ') (tables with no rows have no file)"
echo "Skipped tables found in the contents (must be 0): $LEAK"
echo "Size on disk:                    $(du -sh "$OUT" | cut -f1 | tr -d ' ')"
echo "These files contain REAL customer data. Do not share them. They are deleted in step B7."
