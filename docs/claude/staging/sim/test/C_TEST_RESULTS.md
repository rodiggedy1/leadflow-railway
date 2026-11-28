# Part C — simulated integrations + firewall: local test results (2026-11-25)

All tests ran in a sandbox with **no internet** (its own empty network). The local practice database was the only
database. Every network connection by any process was also recorded by the operating system (`strace`), as a check
that does not rely on the helper's own reporting.

| Test | Result |
|---|---|
| **Integration styles** (`sim-test.cjs` → `scenarios.cjs`): 7 simulated, 12 blocked, 3 allowed/limits | PASS 22/22 |
| Simulated: OpenPhone text (fetch and axios), Twilio call (Twilio SDK), Vapi AI call, Gmail email (Google SDK including its login step), Google review reply, ntfy owner notification | all "succeed", each logged `SIMULATED …` |
| Blocked: live LeadFlow site, OpenAI, Anthropic, Stripe without a test key, Launch27, Thumbtack, R2 file storage, websocket, HTTP/2, raw TLS, SMTP email server, UDP | all refused before any network activity |
| Allowed: staging database (exact host and port only; same host on another port blocked), this machine | PASS |
| **Start-up safety** | PASS 9/9: starts with correct staging settings; refuses a LIVE Stripe key in any variable (without printing it); refuses a database other than `leadflow_staging`; refuses scheduled jobs on; refuses `PREVIEW_MODE` not true; Stripe test key allowed; does nothing in "production" or with no environment name |
| **The app's own code** (`app-paths.ts`): `sendSms`, `notifyOwner`, `sendNewGmailEmail`, `bootstrapVapiAssistant`, `startTwilioLeadBridge` | PASS 5/5: each returned success; call-bridge row written to the local database |
| **Full app start-up** (built app, staging settings, local `leadflow_staging` copy) | PASS: self-test 6/6, health check OK, home page HTTP 200, scheduled jobs off |
| **Operating-system record** across all of the above | 0 connections to any outside address. Name lookups happened only for the two deliberately allowed cases (database host, Stripe test mode); blocked attempts made no network activity at all |

Found and fixed during testing (in A2's sanitizer): fake phones were `+1 999 0xx xxxx`. The app treats a US number whose
4th digit is 0 or 1 as invalid (server/utils/phone.ts), so texting, duplicate detection and opt-outs would have treated
every customer phone as invalid. Fakes are now `+1 999 2xx xxxx`: still unreachable, and valid for the app. The A2
tests were re-run (leak check 0, links identical, lock and drift tests unchanged), and all 168 fake phones in the test
database pass the app's rule.

## On the live staging site (owner, 2026-11-25): C COMPLETE
1. **Start command changed.** Deploy Logs showed `[staging-sim] ACTIVE: self-test passed (6/6)`.
2. **The 14 fake variables were added and deployed.** The self-test passed 6/6 again.
3. **A test text was sent from the staging site** ("testing staging sms"). The logs showed `SIMULATED OpenPhone POST …`;
   Google/Gmail requests were also simulated. Nothing was sent to anyone.

`staging` branch at `83bdcd1`.
