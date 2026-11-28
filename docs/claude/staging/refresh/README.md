# Staging refresh from production

**Owner decision, 2026-11-25:** staging gets a straight copy of production. There is no sanitization.
- **Protection** is the outbound simulator and firewall (`../sim/`), staging's own database (`leadflow_staging` on a separate cluster), scheduled jobs off and no real keys.
- **Production** is only ever read.

| Step | Where | What | Touches production? |
|---|---|---|---|
| B1 | Owner's Mac | `b1-check-production.sh`: read-only size and structure check (only needed if something looks wrong) | Reads table information only |
| **B3** | Owner's Mac | `b3-export-production.sh`: Dumpling export. All table structures, plus the contents of all tables except 51 that hold only tokens, caches, logs and AI history. One TiDB snapshot, no locks, no writes. Files go to `~/leadflow-refresh` | Reads (one pass, about 3 minutes) |
| **B4** | Owner's Mac → staging | `b4-load-staging.sh`: replaces the contents of `leadflow_staging` with the export, then re-applies the demo-cleaner lock. It refuses any database not named `leadflow_staging` | No |
| **B5** | Railway staging | Redeploy staging. Check `[staging-sim] ACTIVE`, sign in with your production email and password, check pages | No |
| B6 (optional) | Owner | Delete `~/leadflow-refresh`. Delete the TiDB cluster `leadflow-cleaning` (no longer needed) | No |

First refresh:
- **B3** was done on 2026-11-25: snapshot `470714634006167577`, 162 structures, 102 tables with contents, 274 MB, 183 seconds.
- **B2 and B4 from the earlier plan** (a separate cleaning database and sanitizing) are dropped.

**Rollback:**
- **Code:** none.
- **Staging data:** re-run B4 with an older export, or rebuild staging with invented data (STAGING_SETUP.md).

**Tested locally on a TiDB 8.5 server** built from source (`test/tidb-roundtrip.sh`, plus a B4 run):
- **Export:** sends 0 write statements to the database; 162 structures; skipped contents excluded.
- **B4:** refuses a database with the wrong name; replaces old staging tables; every table matches the export; an
  active demo-cleaner account copied from production is switched off.
