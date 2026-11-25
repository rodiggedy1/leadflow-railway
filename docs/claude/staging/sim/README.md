# Staging: simulated integrations and outbound firewall (Part C)

This makes staging **behave like production** (texts, calls, emails, owner notifications and review replies all
"succeed") while **nothing ever reaches a real customer or service**. It applies to **staging only**. Production,
Preview, Manus and the application code are not changed.

## How it works
`outbound-sim.cjs` is loaded into the staging app by the staging start command:

```
node --require ./docs/claude/staging/sim/outbound-sim.cjs dist/index.js
```

Production and Preview keep their own start command (`node dist/index.js`), so they never load it. If it were ever
loaded outside the Railway environment named `staging`, it does nothing.

| Layer | What it does |
|---|---|
| **Firewall** | Every outgoing connection is checked before it opens, whatever library makes it (fetch, axios, Twilio SDK, Google SDK, Stripe SDK, websockets, email/SMTP, raw connections). Allowed: the staging database (exact host and port), the machine itself, and Stripe **only** with a test key. Everything else fails immediately and is logged as `[staging-sim] BLOCKED …`. |
| **Simulator** | OpenPhone/Quo (texts), Twilio (calls), Vapi (AI calls), Gmail (emails), Google Business (review replies) and ntfy (owner notifications) get a realistic success reply. Nothing leaves staging. Each one is logged, e.g. `[staging-sim] SIMULATED OpenPhone POST … \| SMS to +19992000123: "Hi Alex, …"` |
| **Refuses to start** | If staging ever holds a LIVE Stripe key (in any variable), points at a database other than `leadflow_staging`, or has scheduled jobs on (`CRON_DISABLED`/`PREVIEW_MODE` not `true`). |
| **Self-test** | At every start it proves outside connections are blocked and simulated services answer, then logs `[staging-sim] ACTIVE: self-test passed (6/6)`. If not, staging stops. |

**Protection that does not depend on this helper:**
- **No real keys.** Staging holds only dummy values below, which no real service accepts.
- **Unreachable contact details.** Customer phones are `+1 999 2xx xxxx` (area code 999 does not exist) and emails are `…@example.invalid`.
- **No background jobs.** Scheduled jobs are off.
- **Nothing calls in.** No outside service has webhooks pointing at staging.
- **Pending actions are closed** by the sanitizer.

**Kept blocked on purpose:**
- **AI drafting (OpenAI/Anthropic/Forge).** It needs spending-capped keys if wanted later.
- **Launch27 and Thumbtack.** These are read-only data sources; an empty simulated reply could make the app think bookings disappeared.
- **Maps.**
- **File storage.**
- **Push notifications.**

**Limits:**
- Replies do not come back by themselves (a customer answering, a call finishing). That would need a later "simulate an incoming event" helper.
- Google Business review replies also need a sim connection row in the database. It is added during the data refresh (Part B).

## Owner steps on Railway (staging environment only), in this order
1. **Start command.** Railway → environment **staging** → service `leadflow-staging` → Settings → Deploy → Custom Start Command:
   `node --require ./docs/claude/staging/sim/outbound-sim.cjs dist/index.js`
   Save and deploy. When it's live, open **Deploy Logs** and find `[staging-sim] ACTIVE: self-test passed (6/6)`.
   **Do not continue until you see it.**
2. **Dummy variables.** Same service → Variables → Raw Editor. Add these lines (all fake, none of them is a secret):
   ```
   OPENPHONE_API_KEY=SIM-not-a-real-key
   OPENPHONE_PHONE_NUMBER_ID=PNsim0000001
   OPENPHONE_CS_PHONE_NUMBER_ID=PNsim0000002
   OPENPHONE_FROM_NUMBER=+19992000001
   TWILIO_ACCOUNT_SID=AC00000000000000000000000000000000
   TWILIO_AUTH_TOKEN=SIM-not-a-real-token
   TWILIO_BRIDGE_FROM_NUMBER=+19992000002
   TWILIO_BRIDGE_OFFICE_NUMBER=+19992000003
   TWILIO_BRIDGE_CALLBACK_BASE_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
   VAPI_PRIVATE_KEY=SIM-not-a-real-key
   GMAIL_CLIENT_ID=sim.apps.googleusercontent.com
   GMAIL_CLIENT_SECRET=SIM-not-a-real-secret
   GMAIL_REFRESH_TOKEN=SIM-not-a-real-token
   NTFY_TOPIC=staging-sim
   ```
   Deploy, then check for the `ACTIVE` line again.
3. **Try it.** On staging, open a lead and send a text. Then open Deploy Logs and search `SIMULATED`: the line shows
   exactly what would have been sent and to whom.
4. *(Optional, later)* **Payments.** Put Stripe **test-mode** keys (`sk_test_…`, `pk_test_…`) in `STRIPE_SECRET_KEY` /
   `STRIPE_PUBLISHABLE_KEY`. Test mode cannot charge real cards. A live key makes staging refuse to start.

## Rollback (staging only, nothing else is affected)
- **Code:** set the Custom Start Command back to `node dist/index.js` and remove the variables added in step 2. The
  helper file in the `staging` branch then does nothing. If the branch update itself must be undone, revert it on
  `staging` with a forward commit (never a force-push).
- **Database:** none. This part does not change any database.

## Tests (local, no internet)
```
node docs/claude/staging/sim/test/sim-test.cjs <path to node_modules>
```
It runs 22 integration checks (simulated, blocked and allowed) plus 9 start-up safety checks. Results are in
`test/C_TEST_RESULTS.md`.
