# Staging-only test data for Phase 1 booking changes

Fictional customers, native bookings, scheduled visits and SMS customer tasks, so booking changes can be tested on
staging. Run in the TiDB Cloud SQL editor on the **staging cluster**. Every write only happens when the current
database is `leadflow_staging`; anywhere else it changes 0 rows.

**What it creates**

Dates are relative to the day you run it.

| Customer (fictional) | Booking | Visits | Task |
|---|---|---|---|
| Alice (Staging Test), +1 202-555-0101 | `STG-TEST-A`, one-time, 10:00 AM | in 5 days | Claude proposal: move 3 days later at 2 PM |
| Ben (Staging Test), +1 202-555-0102 | `STG-TEST-B`, one-time, 11:00 AM | in 6 days | "Please cancel": use **Set up booking change → Cancel** |
| Carla (Staging Test), +1 202-555-0103 | `STG-TEST-C`, weekly, 9:00 AM | in 3 and 10 days | Claude proposal: move the second visit 2 days later |
| Dana (Staging Test), +1 202-555-0104 | `STG-TEST-D`, one-time, morning window 8:00 AM–12:00 PM | in 8 days | "Two days later": use **Set up booking change** (time stays locked to the window) |

Safety details:
- The 555-01xx phone numbers and `example.com` emails are reserved as fictional.
- Payment status is `not_started` and no payment records exist, so nothing can be charged.
- Staging's simulator blocks real SMS, so confirmations are recorded, not sent.

**Easiest: one command on your Mac** (`staging-test-data.sh`)
- Runs all the steps below automatically, as ONE transaction: if any step fails or changes an unexpected number
  of rows, nothing is saved. Then it verifies the result and prints the summary.
- It asks you to paste the STAGING `DATABASE_URL` (Railway → staging environment → leadflow-staging → Variables). The
  input is hidden, never saved, and never put on the command line. It refuses any connection string whose
  database is not `leadflow_staging`, re-checks the connected database, and requires TLS.
- It runs Step 1's checks before writing, waits for Enter, and confirms afterwards that the number of non-test
  records in every table it touches is unchanged.
- `bash staging-test-data.sh --remove` deletes the test data the same way.
- It needs the mysql client 8.4 (`brew install mysql-client@8.4`). The 9.x client cannot log in to TiDB Cloud.
- It is generated from `01-create.sql`, so the SQL is identical.

**Steps** (TiDB Cloud SQL Editor)
1. Choose the **`leadflow_staging`** database in the editor. The script has no `USE` statement.
2. Paste `01-create.sql`. Run the steps **one at a time, in order**: click inside a step, or select just that step, then
   click Run. After each step, compare the result with the step's **Expected** line.
   - **Step 1** is read-only. It must show `current_database = leadflow_staging`, `missing_columns = NULL`,
     `required_columns_not_filled = NULL` and `timezone_check = 2026-12-01 15:00:00`. If anything differs, stop and send
     that row: it names any column in staging's tables that the script doesn't match.
   - **Steps 2–7** remove earlier test rows. They change 0 rows the first time.
   - **Steps 8–14** create the data. Expected rows affected: 4, 4, 1, 5, 4, 4, 2.
   - **Step 15** shows one row per test customer, with its booking, visits, task and proposal counts.
3. In Command Chat → Tasks, the four "(Staging Test)" tasks appear.
4. When finished, run `02-remove.sql` the same way, one step at a time. Its last step should show 0 and 0.

Tested on a local TiDB, with each step run in its own session as the editor does, and then checked with the app's own code:
- the task list loads;
- Alice's proposal executes and verifies;
- Ben's set-up cancellation executes and verifies;
- Carla's later recurring visit is ready to execute;
- Dana keeps her window;
- on any other database name, nothing is written;
- the removal leaves nothing behind.
