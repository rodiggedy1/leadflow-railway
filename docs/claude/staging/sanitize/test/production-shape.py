# TEST ONLY. Prints the SQL that turns a local copy of the staging structure into production's structure as reported
# by B1 (schema/production-b1-*.txt), so a local test database is shaped exactly like production.
# Usage: python3 production-shape.py <file with the local database's "table.column" lines>
import os, sys, collections
here = os.path.dirname(os.path.abspath(__file__))
S = lambda f: os.path.join(here, "..", "schema", f)
local = collections.defaultdict(set)
for l in open(sys.argv[1]):
    if l.strip():
        t, c = l.strip().split(".", 1); local[t].add(c)
missing = collections.defaultdict(set)
for l in open(S("production-b1-missing.txt")):
    if l.strip():
        t, c = l.strip().split(".", 1); missing[t].add(c)
extra = collections.OrderedDict()
for l in open(S("production-b1-extra.txt")):
    if l.strip():
        tc, ctype, dtype, nul, key, ext = l.rstrip("\n").split("|"); t, c = tc.split(".", 1)
        extra.setdefault(t, []).append((c, ctype, nul, key, ext))

def coldef(c, ctype, nul, key, ext):
    d = f"`{c}` {ctype}" + (" NULL" if nul == "YES" else " NOT NULL")
    if "auto_increment" in ext: d += " AUTO_INCREMENT"
    if "on update CURRENT_TIMESTAMP" in ext: d += " DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
    return d

out = []
for t, cols in missing.items():
    if t not in local: continue
    if cols >= local[t] and t not in extra: out.append(f"DROP TABLE `{t}`")
    else: out.append(f"ALTER TABLE `{t}` " + ", ".join(f"DROP COLUMN `{c}`" for c in sorted(cols & local[t])))
for t, cols in extra.items():
    new = [x for x in cols if x[0] not in local.get(t, set())]
    if not new: continue
    if t in local:
        out.append(f"ALTER TABLE `{t}` " + ", ".join("ADD COLUMN " + coldef(*x) for x in new))
    else:
        pk = [x[0] for x in new if x[3] == "PRI"]
        out.append(f"CREATE TABLE `{t}` (" + ", ".join(coldef(*x) for x in new) + (f", PRIMARY KEY ({', '.join('`' + p + '`' for p in pk)})" if pk else "") + ")")
print(";\n".join(out) + ";")
