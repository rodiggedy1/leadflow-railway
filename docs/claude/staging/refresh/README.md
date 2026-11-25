# Staging refresh from production (Part B): overview

**Goal:** give staging a realistic, **sanitized** copy of production data.
- Raw production data never goes to staging or to Claude.
- Production is only read, never changed.
- Each step waits for the owner's approval.

| Step | Who / where | What happens | Touches production? |
|---|---|---|---|
| **B1** | Owner's Mac | `b1-check-production.sh`: read-only check of size, permissions, database updates, and structure vs the sanitizer's column map. Exports nothing | Reads table **information** only (milliseconds) |
| B2 | Owner's TiDB account | Prepare a temporary, private "cleaning" database (exact choice after B1, based on size) | No |
| B3 | Owner's Mac | Export production with `mysqldump --single-transaction`: one consistent read, no locks, no writes. Quiet evening hour | Reads (one pass) |
| B4 | Cleaning database | `prepare.sql` → `verify.sql` → `sanitize.sql` → `verify.sql` (must show **no** failing rows; counts only are shared with Claude) | No |
| B5 | Cleaning → staging | Export the cleaned data only and load it into `leadflow_staging`; re-apply the owner's staging login and the locked demo accounts | No |
| B6 | Railway staging | Redeploy staging; check `[staging-sim] ACTIVE`, sign-in and pages | No |
| B7 | Owner | Delete the raw export file and the cleaning database | No |

**Safety:**
- **Lock.** The sanitizer only runs where `prepare.sql` created its marker table, which happens only in the cleaning database. Run against anything else, every statement is refused.
- **Structure check.** It refuses to run if a column isn't in the map.
- **Simulator.** Staging's simulator and firewall stay on throughout.

**Rollback:**
- **Code:** none. No application code changes in B.
- **Database:** staging can be rebuilt with invented data (STAGING_SETUP.md). Production is never written to.
