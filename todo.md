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
