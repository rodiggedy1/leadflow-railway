# LeadFlow Quote Form — TODO

- [x] Build quote form UI (warm coral design, Playfair Display + DM Sans)
- [x] Add form fields: Name, Email, Phone, Service Type, Bedrooms, Bathrooms
- [x] Add staggered entrance animations and success state
- [x] Upgrade project to full-stack (tRPC + DB)
- [x] Store OpenPhone API key as secret
- [x] Add quote_leads table to DB schema for storing submissions
- [x] Build tRPC mutation: submitQuote (saves lead + sends OpenPhone SMS)
- [x] Connect QuoteForm frontend to tRPC submitQuote mutation
- [x] Write vitest test for submitQuote procedure
- [x] Test end-to-end: form submit → SMS received on phone (11/11 tests pass)

## AI Conversation Flow (OpenPhone + ChatGPT)

- [x] Design conversation state machine (stages: QUOTE_SENT → AVAILABILITY → SLOT_CHOICE → ADDRESS → CONFIRMATION → DONE)
- [x] Add conversation_sessions table to DB schema (tracks stage, lead phone, collected data)
- [x] Build AI conversation engine (ChatGPT decides reply based on stage + lead reply)
- [x] Build OpenPhone webhook endpoint (POST /api/webhooks/openphone) to receive inbound SMS
- [x] Stage 1: Send quote + price on form submit
- [x] Stage 2: Immediately follow up with availability (Thu afternoon / Sat morning)
- [x] Stage 3: Guided slot choice (Thursday 1PM vs Saturday 9AM)
- [x] Stage 4: Address capture after slot selected
- [x] Stage 5: Confirmation message + call scheduling question
- [x] Stage 6: Handle "call now" vs "call in a few minutes" response
- [x] Write vitest tests for conversation engine (30/30 tests pass)

## ChatGPT Integration (Guardrailed AI)

- [x] Write Maids in Black brand system prompt with strict guardrails
- [x] Replace static price table with ChatGPT dynamic pricing message generator
- [x] Add off-script handler: ChatGPT answers FAQs then steers back to booking flow
- [x] Add OBJECTION stage: handles price pushback, reschedule requests, etc.
- [x] Update conversation engine to route off-script replies through ChatGPT
- [x] Write vitest tests for guardrailed AI responses (52/52 tests pass)

## Bug Fixes

- [x] Fix form submission hang: return instant response, run AI/SMS in background (fire-and-forget)

## Bug Fixes (Round 2)

- [x] Fix redundant SMS: merge quote + pricing into one message, keep availability as second
- [x] Fix webhook: inbound replies not routing through conversation engine (phone normalization to E.164)

## Bug Fixes (Round 3)

- [x] Debug: webhook not advancing conversation when lead replies "thursday" (fixed: text vs body field + phone normalization)

## Bug Fixes (Round 4)

- [x] Live conversation flow broken: fixed by registering OpenPhone webhook via API to published URL + text/body field fix

## Feature: Flexible Slot Scheduling

- [x] Accept any date/time request in SLOT_CHOICE stage (not just Thu/Sat) — AI says yes and confirms

## Real Pricing Integration

- [x] Replace placeholder prices with real Maids in Black pricing table (bedroom/bathroom matrix + service type surcharge)
- [x] Update form service type dropdown to include Standard, Deep Clean, Move In/Out, Post Construction

## Office Cleaning Feature

- [x] Add Office Cleaning service type back to form
- [x] Swap bedroom/bathroom dropdowns for square footage selector when Office Cleaning is selected
- [x] Add office cleaning pricing by square footage (industry-standard per-sqft rates)
- [x] Update tRPC schema and pricing engine to handle sqft-based quotes

## Agent Notification Feature (Call + SMS to Support)

- [x] Research OpenPhone outbound calls API (TTS message support — not available in standard tier)
- [x] Build agentNotification service: SMS summary + push notification to 202-888-5362
- [x] Wire notification into CONFIRMATION stage when lead requests a call
- [x] Write tests for agent notification service (72/72 tests pass)

## New Lead Submission Alert

- [x] Send immediate SMS to 202-888-5362 when a new quote form is submitted (77/77 tests pass)

## Dynamic Availability Slots

- [x] Replace hardcoded Thu/Sat with rolling next-2-days logic (skip Sundays, start tomorrow) — 88/88 tests pass

## Leads Dashboard (/admin)

- [x] Backend tRPC query: list all leads with session data (stage, price, slot, address, time)
- [x] Funnel stats bar: total leads, by stage breakdown
- [x] Lead table: name, phone, service, price, stage badge, slot, address, time elapsed
- [x] Stage badge colors: QUOTE_SENT=blue, AVAILABILITY=yellow, SLOT_CHOICE=orange, ADDRESS=purple, CONFIRMATION=teal, DONE=green, UNHANDLED=red
- [x] Wire /admin route in App.tsx
- [x] Write tests for the leads query (93/93 tests pass)

## Dashboard Fixes & Improvements

- [x] Fix funnel stats bar: clarified that 0 is correct (leads progressed to AVAILABILITY); improved visual clarity with dimmed zero-count cards
- [x] Add date range filter to the dashboard (Today / Yesterday / Last 7 / Last 30 / Custom range) — 97/97 tests pass

## Agent System

- [x] Extend DB schema: added assignedAgentId, assignedAgentName, lastCalledAt, lastCalledByAgentName, isBooked, bookedAt, bookedByAgentName to conversation_sessions; added leadCallLogs table
- [x] Backend: agents.claimLead, unclaimLead, logCall, markBooked, getCallLogs, myLeads procedures
- [x] Backend: leads.list updated to include agent fields
- [x] Agent workspace page (/agent) — claim/release leads, log calls, mark booked, view SMS + call history
- [x] Agent login gate — Manus OAuth required, redirects to login if unauthenticated
- [x] Admin dashboard — added Agent, Last Called, Booking columns + agent filter dropdown
- [x] 97/97 tests pass

## Agent Auth (No Manus Account Required) — COMPLETED

- [x] Add agents table: id, name, email, passwordHash, isActive, createdAt
- [x] Backend: agents.login (email+password → JWT cookie), agents.logout, agents.me
- [x] Backend: agents.create (admin only — create new agent accounts)
- [x] Backend: agents.list / agents.setActive / agents.resetPassword (admin only)
- [x] Replace Manus OAuth gate on /agent with email/password login form
- [x] Update all agent procedures to use agent JWT session instead of Manus user session
- [x] Admin dashboard: Agents tab (list agents, create new, deactivate/activate, reset password)
- [x] 97/97 tests pass

## Agent Performance Leaderboard — COMPLETED

- [x] Backend: agents.performance procedure — per-agent stats (callsThisWeek, bookingsThisWeek, totalAssigned, bookingsAllTime, conversionRate)
- [x] Leaderboard UI in Admin → Agents tab — ranked cards with gold/silver/bronze badges, color-coded conversion rate
- [x] Conversion rate: bookingsAllTime / totalAssigned (green ≥50%, amber ≥25%, grey <25%)
- [x] 102/102 tests pass

## Conversation Flow Bug Fixes — COMPLETED

- [x] Fix: first availability message now uses dynamic rolling slots via formatAvailabilityQuestion(getNextAvailableSlots(2))
- [x] Fix: SLOT_CHOICE handler now uses slot1/slot2 intents with actual offered slot labels; LLM prompt includes the real slot names
- [x] Fix: buildConfirmationMessage now uses the full slot label directly (e.g. "Friday, March 13") instead of hardcoded time
- [x] Fix: all hardcoded Thursday/Saturday references removed from aiService.ts fallbacks and prompts
- [x] 102/102 tests pass

## Conversation Flow Bug Fixes (Round 2) — COMPLETED

- [x] Fix AVAILABILITY stage: if lead names a specific day (e.g. "Friday"), skip SLOT_CHOICE and go straight to ADDRESS with that slot confirmed
- [x] Lock intro quote message to a consistent static template (no AI variation) — 102/102 tests pass

## Madison Intro SMS

- [x] Update quote message template: "Hi [Name]! Madison here, thanks for reaching out to Maids in Black..."
- [x] Add MMS photo support to OpenPhone send function (mediaUrl parameter)
- [x] Attach Madison's headshot to the first intro SMS (CDN URL hardcoded in routers.ts)
- [x] Updated tests for new template — 102/102 tests pass

## MMS Photo Fix

- [ ] Verify correct OpenPhone API field name for media attachments
- [ ] Verify Madison headshot CDN URL is publicly accessible
- [ ] Fix the media field and confirm photo sends correctly

## Admin & Conversation Fixes — COMPLETED

- [x] Fix: leads disappearing from admin dashboard — fixed timezone mismatch in buildDateConditions (UTC boundary now covers all local timezones)
- [x] Add morning/afternoon preference step after day selection — new TIME_PREF stage inserted between SLOT_CHOICE and ADDRESS; 102/102 tests pass

## Critical Regression Fix

- [x] Fix: AVAILABILITY stage jumps to DONE when lead says a day name (e.g. "Friday") — moved day-name check BEFORE LLM parse so "Friday" is never misclassified as "no"; 102/102 tests pass

## Smarter AVAILABILITY Stage — COMPLETED

- [x] AVAILABILITY: never assume "no" on ambiguous replies — defaults to re-engaging with slot options
- [x] AVAILABILITY: only send DONE on explicit hard opt-out with high confidence ("not interested", "remove me", "stop")
- [x] AVAILABILITY: detects any day of the week (Mon–Sat) via string check BEFORE LLM — routes to TIME_PREF
- [x] AVAILABILITY: on unclear/soft-no reply, re-offers the two slots and stays in AVAILABILITY
- [x] AVAILABILITY: LLM prompt updated with new intents: yes/specific_day/no/unclear with strict opt-out rules
- [x] 103/103 tests pass

## Missing Leads Bug (Critical)

- [x] Diagnose: conversation_sessions has unique constraint on leadPhone — repeat submissions from same phone update instead of insert
- [x] Fix: removed unique constraint on leadPhone, submit always inserts new row, webhook finds most recent active session by phone — 103/103 tests pass

## Thank You Page — Madison

- [x] Upload Madison headshot to CDN and add to thank you page with "expect a call from Madison shortly" message

## Extras Selection Step

- [x] Generate 20 flat-style icons for extras
- [x] Add extras step to quote form (tap-to-select grid, no pricing)
- [x] Store selected extras in DB with lead
- [x] Show selected extras in admin dashboard and agent workspace
- [x] Mention extras in intro SMS

## Extras Pricing & AI Awareness

- [x] Add per-extra pricing to EXTRAS_LIST (shared constant)
- [x] Update intro SMS to show base price + itemized extras + total
- [x] Pass extras context into AI conversation engine (system prompt + session data)
- [x] AI acknowledges specific extras when lead asks about them during SMS flow
- [x] Update tests to cover new pricing breakdown and extras-aware AI responses

## Extras Upsell in Availability Reply

- [x] Mention one selected add-on in the first availability SMS to reinforce value

## Admin Dashboard Quote Fix

- [x] Show total quote (base + extras) in admin leads list table
- [x] Show total quote (base + extras) in admin lead detail drawer

## AI Conversation Intelligence Fix

- [x] Route DONE/CALL_SCHEDULED replies through AI instead of hardcoded "Thanks again!" fallback
- [x] Audit and remove other robotic static fallbacks — let AI handle unexpected replies naturally
