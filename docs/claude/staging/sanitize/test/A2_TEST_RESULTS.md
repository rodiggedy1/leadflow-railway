# A2 sanitizer — local test results (2026-11-25)

Local throwaway MariaDB 10.11 on 127.0.0.1 only, with no production access. The test database had the full staging
structure (155 tables, 1,984 columns) plus planted fake personal data in every sensitive column (480 of 480), created
by `test/plant.cjs`.

| Test | What it proves | Result |
|---|---|---|
| 1. Lock | `sanitize.sql` run, even with `--force`, against a database that has no marker table | PASS: 1007 of 1007 statements refused, all 155 tables byte-for-byte unchanged (CHECKSUM), 0 helper tables created |
| 2. Clean + leak check | `prepare` → `verify` → `sanitize` → `verify` | PASS: 694 failing checks before, **0 after** (1,225 checks) |
| 2b. Links kept | `test/relationships.sql` before and after | PASS: phone, email, name and team links across tables, row counts and money totals identical |
| 2c. Independent search | full dump of the sanitized database searched for every planted value (names, phones, emails, street, gate code, tokens, payment ids, recording URLs) | PASS: 0 found (the only "gmail" hits are table names) |
| 2d. Conversations | synthetic histories | PASS: valid JSON on every row, marked `"synthetic":true`, timestamps end at the real last-message time |
| 3. Structure drift | an extra unmapped column added before running | PASS: structure check = 0, the column is named in the output and in `verify.sql`, every table byte-for-byte unchanged |
| Static | every statement in `prepare.sql` and `sanitize.sql` references the marker or a helper table | PASS: 30 of 30 and 1007 of 1007 |

Fixed during testing:
- Helper tables now use one explicit text-comparison rule (`utf8mb4_bin`) because the app's tables mix collations.
- A "clear it" rule is skipped for a column that must hold a value (`nurture_enrollments.nextSendAt`). The enrollment is
  already set to `paused`, and the sender only picks `active` ones (server/nurtureCron.ts).

Still to confirm on the temporary TiDB copy in step B: MariaDB and TiDB differ in places, so the same checks are
re-run there before anything is loaded into staging.

Re-run:
```
node docs/claude/staging/sanitize/build-sql.cjs
node docs/claude/staging/sanitize/test/plant.cjs mysql://USER:PASS@127.0.0.1:3306/testdb
```
Then, against the local test database, run `test/relationships.sql`, `prepare.sql`, `verify.sql`, `sanitize.sql`,
`verify.sql` and `test/relationships.sql`.
