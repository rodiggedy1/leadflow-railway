#!/bin/bash
# TEST ONLY — local throwaway MariaDB (root over the local socket). Runs the sanitizer tests against a planted snapshot.
# Usage: bash run-all.sh <planted snapshot .sql>
# Tests: 1 lock (no marker -> nothing changes) | 2 clean + leak check + links + phone rule + independent search | 3 drift
set -u
SNAP="$1"
cd "$(dirname "$0")/.."
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
fresh() { mariadb -uroot -e "DROP DATABASE IF EXISTS $1; CREATE DATABASE $1" && mariadb -uroot "$1" < "$SNAP"; }
app_tables() { mariadb -uroot -N "$1" -e "SHOW TABLES" | grep -vxE "$(sed -n 's/^DROP TABLE IF EXISTS \(.*\);$/\1/p' cleanup.sql | paste -sd'|' -)" | paste -sd, - | sed 's/,/`,`/g; s/^/`/; s/$/`/'; }
checksum() { mariadb -uroot -N "$1" -e "CHECKSUM TABLE $(app_tables "$1")"; }
FAIL=0
result() { echo "RESULT $([ "$1" = 0 ] && echo PASS || echo FAIL) | $2"; [ "$1" = 0 ] || FAIL=1; }

# --- Test 1: lock
fresh st_lock; checksum st_lock > "$T/a"
mariadb -uroot --force st_lock < sanitize.sql > /dev/null 2> "$T/e"
checksum st_lock > "$T/b"
N=$(grep -c . sanitize.sql | tr -d ' '); R=$(grep -c '^ERROR' "$T/e")
H=$(mariadb -uroot -N st_lock -e "SHOW TABLES LIKE '\_\_%'" | grep -vc '__drizzle_migrations')
cmp -s "$T/a" "$T/b" && [ "$H" = 0 ]; result $? "Test 1 lock: $R statements refused, all $(wc -l < "$T/a") tables unchanged, helper tables created: $H"

# --- Test 2: clean + leak check
fresh st_clean
mariadb -uroot -N st_clean < test/relationships.sql > "$T/rel1"
mariadb -uroot -N st_clean < prepare.sql > /dev/null
BEFORE=$(mariadb -uroot -N st_clean < verify.sql | grep -vc 'LEAK CHECK SUMMARY')
mariadb -uroot st_clean < sanitize.sql > "$T/out" 2> "$T/err"; SX=$?
AFTER=$(mariadb -uroot -N st_clean < verify.sql | grep -v 'LEAK CHECK SUMMARY')
[ "$SX" = 0 ] && [ -z "$AFTER" ] && [ "$BEFORE" -gt 0 ]; result $? "Test 2 leak check: $BEFORE failing checks before, $(echo -n "$AFTER" | grep -c .) after (sanitize exit $SX $(head -c 200 "$T/err"))"
[ -n "$AFTER" ] && echo "$AFTER" | head -20
mariadb -uroot -N st_clean < test/relationships.sql > "$T/rel2"
cmp -s "$T/rel1" "$T/rel2"; result $? "Test 2 links, row counts, money totals identical"
node -e '
const cols=require("fs").readFileSync("column-map.tsv","utf8").trim().split("\n").slice(1).map(l=>l.split("\t")).filter(r=>r[3]==="PHONE"||r[3]==="CONTACT").map(r=>`SELECT \`${r[1]}\` v FROM \`${r[0]}\``);
console.log("SELECT COUNT(*), SUM(d REGEXP \x27^1?[2-9][0-9]{2}[2-9][0-9]{6}$\x27) FROM (SELECT REGEXP_REPLACE(v,\x27[^0-9]\x27,\x27\x27) d FROM ("+cols.join(" UNION ALL ")+") u WHERE v IS NOT NULL AND v <> \x27\x27 AND v NOT LIKE \x27%@%\x27 AND v NOT LIKE \x27SIM%\x27) x")' > "$T/ph.sql"
read -r PT PV < <(mariadb -uroot -N st_clean < "$T/ph.sql")
[ "$PT" = "$PV" ]; result $? "Test 2 fake phones valid for the app's US-number rule: $PV of $PT"
mariadb -uroot st_clean < cleanup.sql
mariadb-dump -uroot --skip-comments st_clean > "$T/dump.sql"
HITS=0
for p in Sarah Johnson 'Michael Brown' Jennifer Rodriguez 555-01 '555 01' 5550 '@gmail' yahoo company.org outlook 'Oak St' 'Gate code' "Maria's Team" 'Team Carlos' 'Rosa & Linda' tok_live realLookingHash cus_Real py_RealPayment r2.dev AC9f8e7d claim-abc; do
  n=$(grep -c -- "$p" "$T/dump.sql"); [ "$n" != 0 ] && { echo "  found '$p' $n times"; HITS=1; }
done
[ "$HITS" = 0 ]; result $? "Test 2 independent search of the cleaned export for every planted value: none found"
LEFT=$(mariadb -uroot -N st_clean -e "SHOW TABLES" | grep -cE '^__(column_map|map_|src_|name_|streets|team_words|synthetic|staging_sanitize)')
[ "$LEFT" = 0 ]; result $? "Test 2 cleanup removes every helper table (left: $LEFT); production's own tables kept"

# --- Test 3: drift
fresh st_drift
mariadb -uroot st_drift -e "ALTER TABLE leadflow_jobs ADD COLUMN customerNickname VARCHAR(64) NULL; UPDATE leadflow_jobs SET customerNickname = 'Sarah J'"
mariadb -uroot -N st_drift < prepare.sql > /dev/null
checksum st_drift > "$T/a"
mariadb -uroot --force st_drift < sanitize.sql > "$T/out" 2> /dev/null
checksum st_drift > "$T/b"
OK=$(grep -A1 'ok_1_means' "$T/out" | tail -1 | awk '{print $NF}')
SHOWN=$(mariadb -uroot -N st_drift < verify.sql | grep -c 'STRUCTURE.*customerNickname')
cmp -s "$T/a" "$T/b" && [ "$OK" = 0 ] && [ "$SHOWN" = 1 ]; result $? "Test 3 drift: structure check $OK, unknown column reported, all tables unchanged"

for d in st_lock st_clean st_drift; do mariadb -uroot -e "DROP DATABASE $d"; done
echo; [ "$FAIL" = 0 ] && echo "ALL SANITIZER TESTS PASSED" || echo "SOME TESTS FAILED"
exit $FAIL
