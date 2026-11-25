# Staging refresh from production (Part B): overview

**Goal:** give staging a realistic, **sanitized** copy of production data.
- Raw production data never goes to staging or to Claude.
- Production is only read, never changed.
- Each step waits for the owner's approval.

| Step | Who / where | What happens | Touches production? |
|---|---|---|---|
| **B1** | Owner's Mac | `b1-check-production.sh`: read-only check of size, permissions, database updates, and structure vs the sanitizer's column map. Exports nothing | Reads table **information** only (milliseconds) |
| B2 | Owner's TiDB account | Prepare a temporary, private "cleaning" database (exact choice after B1, based on size) | No |
| B3 | Owner's Mac | Export production with TiDB's own tool **Dumpling** (`b3-export-production.sh`): all table structures, contents of all tables except the 51 the sanitizer empties, one TiDB snapshot for everything, no locks, no writes. (mysqldump was dropped: its savepoint use fails on TiDB Cloud.) | Reads (one pass) |
| B4 | Cleaning database | `prepare.sql` → `verify.sql` → `sanitize.sql` → `verify.sql` (must show **no** failing rows; counts only are shared with Claude) | No |
| B5 | Cleaning → staging | Export the cleaned copy without the sanitizer's helper tables, and load it into `leadflow_staging`, replacing it, so staging gets **production's exact structure** (B1 showed production has 6 tables and 95 columns that are not in the code). Re-apply the owner's staging login and the locked demo accounts | No |
| B6 | Railway staging | Redeploy staging; check `[staging-sim] ACTIVE`, sign-in and pages | No |
| B7 | Owner | Delete the raw export file and the cleaning database | No |

**Safety:**
- **Lock.** The sanitizer only runs where `prepare.sql` created its marker table, which happens only in the cleaning database. Run against anything else, every statement is refused.
- **Structure check.** It refuses to run if a column isn't in the map.
- **Simulator.** Staging's simulator and firewall stay on throughout.

**Rollback:**
- **Code:** none. No application code changes in B.
- **Database:** staging can be rebuilt with invented data (STAGING_SETUP.md). Production is never written to.

Tested locally on a TiDB 8.5 server built from source (`test/tidb-roundtrip.sh`):
- **Read-only:** the statement log shows 0 writes during the export.
- **Export:** all 162 structures, skipped contents excluded, and an identical round trip.
- **Cleaning on TiDB:** 658 leak-check failures before, 0 after, with links and totals unchanged.
