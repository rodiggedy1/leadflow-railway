# Staging replica — column map (step A1)

> **Not used (owner decision 2026-11-25):** staging receives an unsanitized copy of production. These files are kept for reference only.

Status: **draft for owner review** (2026-11-25). Nothing has been exported, copied or changed.

This map decides, for every column in LeadFlow's database, what happens to it when a production snapshot is turned into
staging data. It was built from the table definitions in the code (`drizzle/schema.ts` + `server/versioned-migrations`),
not from production. Files:
- `column-map.tsv` — one line per column: table, column, type, rule, note (1,984 columns, 155 tables).
- `classify.cjs` — the rules that produce it (table rules → hand decisions → name patterns). Re-run it whenever the
  database structure changes; any column without a rule comes out as `REVIEW`, and the sanitizer will refuse to run
  while a `REVIEW` exists or while production has a column that is not in the map.

## Updated to production's real structure after B1 (2026-11-25)
The map now matches production exactly: **2,078 columns in 162 tables**. The structure B1 reported is in
`schema/production-b1-*.txt`, and `schema/apply-b1.py` applies it. The totals table below is from A1; `column-map.tsv`
holds the current numbers.
- **Production-only tables, emptied:** `webhook_events` (≈257k raw incoming messages with phone numbers), `cs_threads`,
  `sms_shadow_evaluations`, `sms_card_diag`, `gmail_thread_cache`.
- **`booking_apple_pay_payments`:** handled like the other payment tables. Card last 4 → 4242, Stripe id → fake,
  error text replaced, amounts and statuses kept.
- **`__drizzle_migrations`:** kept (only old database-update fingerprints). The structure check now skips only the
  sanitizer's own helper tables, by exact name.
- **New columns:**
  - `confirmation_calls.manual_override_by` (staff name) → fake name;
  - `manual_outcome_label` and `issue_ownership.resolutionNote` → replaced;
  - the rest are statuses, dates and labels and are kept.
- **Not in production, removed from the map:** `system_config`, and 6 columns of `chain_step_executions` (a table that
  is emptied anyway).
- **Also covered:** the database-update ledger (its error text is replaced).
- **Tests:** all re-run on a local database shaped exactly like production (`test/run-all.sh`). All pass.

## Totals (A1)

| Rule | Columns | What happens |
|---|---|---|
| KEEP | 1,052 | Unchanged: ids, links between tables, amounts, dates, statuses, service types, pricing settings, templates |
| TRUNCATE_TABLE | 443 (46 tables) | Table emptied entirely (see below) |
| FREE_TEXT | 137 | Replaced with neutral placeholder text (empty stays empty) |
| PERSON_NAME | 97 | Same real name → same invented name everywhere |
| EXTERNAL_ID | 43 | OpenPhone/Twilio/Vapi/Gmail ids → `SIM_…` ids (same input → same output, so links and unique keys hold) |
| PHONE | 40 | Same real number → same invented `+1 999 …` number (area code 999 does not exist) |
| NEUTRALIZE | 31 | "Will send / will run" state closed or cancelled (exact values decided in A2) |
| MEDIA_URL | 27 | Recording, photo, video, signature and PDF links removed |
| JSON_EMPTY | 24 | Structured data that can hide personal details emptied (`{}` / `[]`) |
| PAYMENT_REF | 22 | Stripe customer/payment/invoice ids and payment links → fake `…_STAGING_…` references |
| EMAIL | 16 | Same real email → same invented `…@example.invalid` (a domain that can never receive mail) |
| ADDRESS | 13 | Invented street; real city / state / ZIP kept so areas and routing stay realistic |
| JSON_KEEP | 9 | Pricing structure kept: extras, price snapshots, invoice line items, service selections, paused services |
| TEAM_NAME | 8 | Team names (often cleaners' names) → invented team names, consistently |
| CARD_LAST4 | 7 | Card last 4 digits → `4242` (brand kept) |
| SECRET | 6 | Password hashes, tracker/return/status tokens, payment-link token → removed |
| CONTACT | 4 | Email-or-phone fields → mapped with the same rules as EMAIL / PHONE |
| CONVERSATION | 2 | SMS history → synthetic scenario conversation (see below) |
| GEO_ROUND | 2 | Team home coordinates rounded to ~1 km |
| BLANK | 1 | Staff test phone list removed |

## Tables emptied entirely (46)
- **Logins & devices (11):** all portal/cleaner/customer login links and codes, card-on-file and Cash App payment links,
  login rate limits, push subscriptions (real staff phones/browsers), Manus OAuth users, Google Business and Gmail
  connection state.
- **Raw content & caches (14):** full email bodies cache, raw Stripe webhook payloads, applicant interview recordings,
  visitor analytics (IP addresses), AI/command-center/drive-time/geocode caches (rebuild themselves), AI alert text,
  job heartbeats, transient locks, sync and message-integrity logs, API usage counters.
- **AI test sets built from real conversations (3):** real SMS example pairs and the two "golden" review sets.
- **AI agent internal reasoning (18):** Madison's decisions, intents, extracted facts, missions, proposals, approvals,
  actions and chain runs — dense personal detail; staging has no AI keys to use them.

## Decisions worth your attention
1. **Conversations:** each lead's real SMS history is replaced by a **synthetic conversation** chosen to match the lead's
   stage (new booking, quote, rescheduling, cancellation, complaint, recurring booking, cleaner coordination…), with the
   same number of messages and timing pattern where possible. The scenario library is written in step A2.
2. **All other free text** (staff notes, transcripts, emails, AI summaries, complaint text, error messages that can
   quote customers) is replaced, not scrubbed.
3. **Kept for realism:** amounts, prices, price snapshots, extras, invoice line items, dates, frequencies, statuses,
   service types, team skills, settings, and all business templates/scripts/labels (no customer data in them;
   any phone- or email-like text inside them is still caught by the A2 leak check and mapped).
4. **Queues & pending actions:** campaigns, enrollments, nurture, deliveries, approvals, drafts, reminders, tasks,
   call bridges, confirmation calls, payment authorisations, invoice attempts/deliveries, follow-ups due to send,
   deferred AI replies and unprocessed inbound texts are all marked NEUTRALIZE. Exact closed/cancelled values per table
   are fixed in A2 and tested. (Already-sent flags on old jobs are kept as history.)
5. **Staff and cleaners** are pseudonymised like customers; every password is removed. Your staging admin login and
   the demo-account locks are re-applied after each import (unchanged from today).
6. **`app_settings`:** kept, except any setting whose key looks like a token/secret/key/password/webhook, which A2 blanks.

## Known limits (handled in later steps)
- The map comes from the code; production may have extra or older columns. Before each refresh the sanitizer compares
  production's real column list with this map and **refuses to run** if anything is unmapped (A2/B).
- NEUTRALIZE and the leak-check thresholds are specified and tested in A2, on fake data planted with fake personal details.
