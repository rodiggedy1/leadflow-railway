# Setting up the isolated STAGING site

Goal: a private copy of LeadFlow you can open in your browser — like Manus's preview — where you can click
around and test changes **without any possibility of touching real customers, real data, real money or real messages**.

How staging stays isolated:

| Risk | How staging avoids it |
|---|---|
| Real customer data | Its own brand-new, empty database (TiDB Cloud, in **your** TiDB account), filled only with invented data |
| Real texts / calls / emails | No OpenPhone, Twilio, Vapi, Mailgun or Gmail keys are given to staging. Sending fails safely with "credentials not configured" |
| Real payments | No live Stripe key (test-mode keys may be added later, optionally) |
| Scheduled jobs | `CRON_DISABLED=true` and `PREVIEW_MODE=true` switch every scheduled job off |
| Live webhooks | No outside service is pointed at staging's address |
| Production releases | Staging deploys only from the `staging` branch. `main` and `preview` are untouched |

**Never** duplicate the Production or Preview environment to make staging — that would copy their database
connection and live keys. Staging is built from an **empty** environment.

What was verified before writing this guide (in Claude's sandbox, offline, against a throwaway local database):
- `staging/staging-base-schema.sql` loads cleanly (106 tables).
- All 79 database updates in `server/versioned-migrations` then apply cleanly and satisfy their own checks.
- `staging/fake-data.sql` loads cleanly.
- The app starts with only the staging variables below, switches its scheduled jobs off, and the one-click
  login opens the Leads CRM, Day Board and Command Chat showing the fake data.
- The normal `/api/health` check returns 503 during business hours when no scheduled jobs run, which would make
  Railway reject a staging deploy. That is why staging uses `staging/railway.staging.json` (same as `railway.json`
  but with Production's health check, which returns 200).

---

## Part A — Create the staging database (TiDB Cloud, about 10 minutes)
1. Go to **tidbcloud.com** and sign in (or create a free account in your own name).
2. Create a cluster: choose the free **Starter** (serverless) plan. Name it `leadflow-staging`. Pick a US East region.
3. Open the cluster → **SQL Editor**. Run:
   `CREATE DATABASE leadflow_staging;`
4. Still in the SQL Editor, run `USE leadflow_staging;`, then paste **the whole content** of
   `docs/claude/staging/staging-base-schema.sql` (open it on GitHub on the `claude/…` branch → **Raw** → select all → copy) and run it.
   Then run `SHOW TABLES;` — you should see **106** tables.
5. Click **Connect** on the cluster. Choose the connection string for **Node.js / mysql2** (or "General"), with
   database `leadflow_staging`. Keep it ready for Part B — **do not send it to anyone, including Claude**.

## Part B — Create the staging environment in Railway (about 15 minutes)
1. railway.com → the LeadFlow project → environment selector at the top → **New Environment**.
2. Name it `staging` and choose **Empty environment** (NOT "Duplicate").
3. In `staging`, add the web service from GitHub (repository `rodiggedy1/leadflow-railway`).
   If Railway offers to add the existing LeadFlow service to this environment, that is fine too — but then
   check step 5 very carefully, because variables must not be copied over.
4. Service → **Settings**:
   - **Source / Branch**: `staging`
   - **Config-as-code / Railway config file path**: `docs/claude/staging/railway.staging.json`
   - **Networking → Generate domain** (gives a `…up.railway.app` address)
5. Service → **Variables**. Make sure the list contains **only** these (delete anything else):

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the TiDB connection string from Part A step 5 |
   | `JWT_SECRET` | a new long random value (Railway's `${{secret(48)}}` generator, or a password manager). **Not** the production value |
   | `NODE_ENV` | `production` |
   | `PREVIEW_MODE` | `true` |
   | `CRON_DISABLED` | `true` |
   | `EMERGENCY_AGENT_EMAIL` | `staging-admin@example.com` (the invented staging admin — enables one-click login) |

   Must **not** be present: anything starting with `OPENPHONE_`, `TWILIO_`, `VAPI_`, `LAUNCH27_`, `GMAIL_`, `STRIPE_`,
   `R2_`, `MAILGUN_`, `ZAPIER_`, `QUOTE_APP_`, `BUILT_IN_FORGE_`, `OAUTH_`, `OWNER_`, `VAPID_`, `NTFY_`, `DEEPGRAM_`,
   `ANTHROPIC_`, `OPENAI_`, `EMERGENCY_AGENT_LOGIN_TOKEN`, `GOOGLE_MAPS_API_KEY`.
6. Deploy (only the staging service). Watch the **Deploy Logs** for:
   - `migration_applied` lines from the database-update runner (79 updates),
   - `[Preview] PREVIEW_MODE=true — all cron jobs and Vapi bootstrap disabled`,
   - `Server running on …`.

## Part C — Add the invented data (about 5 minutes)
After the first successful staging deploy (the deploy creates the remaining tables):
1. TiDB SQL Editor → `USE leadflow_staging;` → paste the whole content of `docs/claude/staging/fake-data.sql` → run.

## Part D — Open your preview
1. Open `https://<your-staging-domain>/api/preview-login` — it signs you in as "Staging Admin" and opens the Leads CRM.
2. You should see three invented leads (Alex Example, Bailey Sample, Casey Placeholder) and, on the Day Board, two jobs today.
3. Bookmark that link. This is your "Manus-style" preview.

Note: anyone who learns the staging address can use the one-click login, but staging holds only invented data and
has no keys that can reach real services.

---

## Day-to-day use
- Claude develops a change on a `claude/…` branch, tests it offline, then (with your approval) updates the
  `staging` branch. Railway redeploys staging automatically; you test in your browser.
- Production and Preview are untouched by anything that happens on staging.
- To reset staging data: in TiDB, drop and recreate `leadflow_staging`, then repeat Parts A4, B6 (redeploy) and C.

## Things that will look different on staging (expected)
- Sending SMS, placing calls, charging cards, Gmail and Launch27 sync: they fail or show "not configured". That is the point.
- AI-written drafts will not work (no AI keys on staging) unless you later approve adding separate, low-limit AI keys.
- Some images hosted on Manus's servers may still load (they are public files), but nothing on staging writes to Manus.
