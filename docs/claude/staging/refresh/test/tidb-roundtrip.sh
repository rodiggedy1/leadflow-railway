#!/bin/bash
# TEST ONLY — local TiDB 8.5 (unistore, in-memory) built from source; no network, no real data.
# Proves on real TiDB: b3 export with snapshot consistency -> load into a fresh database -> prepare -> verify (before)
# -> sanitize -> verify (after: must be empty) -> cleanup.
# Usage: bash tidb-roundtrip.sh <tidb-server> <dumpling> <mysql 8 bin dir> <production-shaped structure .sql (no data)> <node_modules>
set -u
TIDB="$1"; DUMPLING="$2"; MYBIN="$3"; SNAP="$4"; MODULES="$5"
HERE="$(cd "$(dirname "$0")" && pwd)"
SAN="$HERE/../../sanitize"
W="$(mktemp -d)"
PORT=4011
"$TIDB" -store unistore -path "" -P $PORT -status 10091 -host 127.0.0.1 -socket "" > "$W/tidb.log" 2>&1 &
TPID=$!
trap 'kill $TPID 2>/dev/null; wait $TPID 2>/dev/null; rm -rf "$W"' EXIT
M() { "$MYBIN/mysql" -h 127.0.0.1 -P $PORT -u root --batch --skip-column-names "$@"; }
for i in $(seq 1 60); do M -e "SELECT 1" >/dev/null 2>&1 && break; sleep 1; done
echo "TiDB: $(M -e 'SELECT VERSION()')"

# 1. production-shaped planted database on TiDB (MariaDB-only syntax removed)
sed -E -e '/^\/\*M!999999/d' -e 's/ CHECK \(json_valid\(`[^`]+`\)\)//g' "$SNAP" > "$W/plant.sql"
M -e "CREATE DATABASE prod_like"
M prod_like < "$W/plant.sql" 2> "$W/load.err" || { echo "LOAD FAILED"; head -5 "$W/load.err"; exit 1; }
NODE_PATH="$MODULES" node "$HERE/../../sanitize/test/plant.cjs" "mysql://root:@127.0.0.1:$PORT/prod_like" 2>&1 | tail -3 | sed 's/^/  plant: /'
M prod_like -e "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (REPEAT('c',64), 1700000000000); INSERT INTO app_versioned_migration_ledger VALUES ('0082_example', REPEAT('a',64), 'applied', NOW(3), NOW(3), 1, NOW(3), 'Duplicate entry ''+12025550101'' for key uq_phone')"
echo "planted tables on TiDB: $(M -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='prod_like'")"

# 2. B3 export (the real script), snapshot consistency, as the owner would run it
mkdir -p "$W/home"
printf "mysql://root:@127.0.0.1:$PORT/prod_like\nEXPORT\n" | HOME="$W/home" B3_LOCAL_TEST=1 B3_DUMPLING="$DUMPLING" B3_MYSQL_BIN_DIR="$MYBIN" \
  bash "$HERE/../b3-export-production.sh" 2>&1 | sed 's/^/  | /'
OUT="$W/home/leadflow-refresh"
[ -d "$OUT/data" ] || { echo "EXPORT FAILED"; exit 1; }

# 3. load into a fresh database (what B4 will do on the cleaning cluster)
M -e "CREATE DATABASE cleaning"
for f in "$OUT"/structure/*-schema.sql; do case "$f" in *-schema-create.sql) continue;; esac; M cleaning < "$f" || { echo "schema load failed: $f"; exit 1; }; done
for f in "$OUT"/data/*.sql; do case "$f" in *-schema*.sql) continue;; esac; M cleaning < "$f" || { echo "data load failed: $f"; exit 1; }; done
echo "loaded: $(M -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='cleaning'") tables"
BAD=0
for t in $(M -e "SELECT table_name FROM information_schema.tables WHERE table_schema='prod_like'"); do
  a=$(M prod_like -e "SELECT COUNT(*) FROM \`$t\`"); b=$(M cleaning -e "SELECT COUNT(*) FROM \`$t\`")
  if grep -qx "$t" <(tail -n +2 "$SAN/column-map.tsv" | awk -F'\t' '$4=="TRUNCATE_TABLE"{print $1}' | sort -u); then [ "$b" = 0 ] || { echo "  skipped table has rows: $t"; BAD=1; }
  else [ "$a" = "$b" ] || { echo "  row count differs: $t $a vs $b"; BAD=1; }; fi
done
echo "RESULT $([ $BAD = 0 ] && echo PASS || echo FAIL) | export round trip on TiDB: contents identical, skipped tables empty"

# 4. sanitizer on TiDB
M cleaning < "$HERE/../../sanitize/test/relationships.sql" > "$W/rel1"
M cleaning < "$SAN/prepare.sql" > /dev/null 2> "$W/p.err" || { echo "PREPARE FAILED on TiDB"; head -5 "$W/p.err"; exit 1; }
B=$(M cleaning < "$SAN/verify.sql" 2> "$W/v.err" | grep -vc 'LEAK CHECK SUMMARY'); [ -s "$W/v.err" ] && { echo "VERIFY ERROR"; head -3 "$W/v.err"; }
M cleaning < "$SAN/sanitize.sql" > "$W/s.out" 2> "$W/s.err"; SX=$?
[ $SX = 0 ] || { echo "SANITIZE FAILED on TiDB:"; head -5 "$W/s.err" | cut -c1-400; }
A=$(M cleaning < "$SAN/verify.sql" | grep -v 'LEAK CHECK SUMMARY')
echo "RESULT $([ $SX = 0 ] && [ -z "$A" ] && [ "$B" -gt 0 ] && echo PASS || echo FAIL) | sanitizer on TiDB: $B failing checks before, $(echo -n "$A" | grep -c .) after"
[ -n "$A" ] && echo "$A" | head -10
M cleaning < "$HERE/../../sanitize/test/relationships.sql" > "$W/rel2"
cmp -s "$W/rel1" "$W/rel2"; echo "RESULT $([ $? = 0 ] && echo PASS || echo FAIL) | links, row counts, money totals identical on TiDB"
cmp -s "$W/rel1" "$W/rel2" || paste "$W/rel1" "$W/rel2" | awk -F'\t' '$2 != $4 {print "  differs:", $1, $2, "->", $4}'
M cleaning < "$SAN/cleanup.sql"
echo "RESULT $([ "$(M -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='cleaning' AND table_name LIKE '\\_\\_%' AND table_name <> '__drizzle_migrations'")" = 0 ] && echo PASS || echo FAIL) | cleanup removed helper tables on TiDB"
