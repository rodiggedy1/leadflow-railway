# Brings schema/inventory.tsv in line with production as reported by B1 (structure only, no data):
# removes the columns production does not have, adds the ones it has. Safe to re-run.
import os
here = os.path.dirname(os.path.abspath(__file__))
P = lambda f: os.path.join(here, f)
missing = {l.strip() for l in open(P("production-b1-missing.txt")) if l.strip()}
extra = [l.rstrip("\n").split("|") for l in open(P("production-b1-extra.txt")) if l.strip()]
inv = [l.rstrip("\n").split("\t") for l in open(P("inventory.tsv")) if l.strip()]
have = {f"{r[0]}.{r[1]}" for r in inv}
inv = [r for r in inv if f"{r[0]}.{r[1]}" not in missing]
for tc, ctype, dtype, nul, key, ext in extra:
    if tc in have:
        continue
    t, c = tc.split(".", 1)
    inv.append([t, c, ctype, dtype, nul, key, ext])
inv.sort(key=lambda r: r[0])  # stable: keeps column order inside each table
open(P("inventory.tsv"), "w").write("".join("\t".join(r) + "\n" for r in inv))
print(f"inventory: {len(inv)} columns in {len({r[0] for r in inv})} tables")
