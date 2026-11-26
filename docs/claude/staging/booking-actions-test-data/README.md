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

**Steps**
1. Paste `01-create.sql` into the SQL editor and run it. The first result must show `leadflow_staging`. The last result
   should show `4 bookings, 5 visits, 4 tasks, 2 proposals`.
2. In Command Chat → Tasks, the four "(Staging Test)" tasks appear.
3. When finished, run `02-remove.sql`, which removes them along with any visits the tests created. Running
   `01-create.sql` again also starts afresh.

Tested on a local TiDB with the app's own code:
- the task list loads;
- Alice's proposal executes and verifies;
- Ben's set-up cancellation executes and verifies;
- Carla's later recurring visit is ready to execute;
- Dana keeps her window;
- on any other database name, nothing is written;
- the removal leaves nothing behind.
