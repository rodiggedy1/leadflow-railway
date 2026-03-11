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
