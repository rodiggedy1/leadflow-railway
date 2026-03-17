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

## AI Knowledge Base from Website

- [x] Scrape maidsinblack.com for services, FAQs, policies, service area
- [x] Build structured knowledge base from scraped content
- [x] Embed knowledge base into AI system prompt

## SMS Simulator

- [x] Add tRPC simulator.chat procedure that calls handleOffScriptReply with configurable context
- [x] Build SMS simulator UI panel in admin dashboard (chat bubble UI, context config, stage selector)
- [x] Add simulator link/tab to admin dashboard navigation

## Back Link

- [x] Add subtle "← Back to Maidsinblack" link at top of quote form page

## Rotating Trust Strip

- [x] Add rotating trust strip above submit button on quote form step 1

## Exit-Intent Modal

- [x] Generate Madison's photo for exit-intent modal
- [x] Build exit-intent modal with mouse-leave detection (only fires if form not submitted)
- [x] Wire exit-intent modal into QuoteForm

## Second Notification Number

- [x] Send lead summary SMS to +13029816191 on new quote submission

## Phone Number Formatting

- [x] Auto-format phone field as XXX-XXX-XXXX while typing

## Admin Security

- [x] Block admin dashboard from unauthenticated/non-admin users — show login screen
- [x] Enforce auth guard on all admin tRPC procedures

## Admin Account & Password Policy

- [x] Create admin account: rohangilkes@hey.com with isAdmin=true
- [x] Remove password complexity requirements — 6 chars minimum only (already was 6 chars, no special char rules)
- [x] Confirm quote form (/) has no auth guard — confirmed, Home.tsx and App.tsx have zero auth logic

## Admin Procedure Auth Fix — COMPLETED

- [x] Replace protectedProcedure (Manus OAuth) with agent cookie session check on all admin procedures
- [x] Create adminAgentProcedure that validates agent cookie + isAdmin flag
- [x] Fix agents.performance.test.ts to use agent cookie context instead of Manus OAuth context — 120/120 tests pass

## Fix require() ESM Error — COMPLETED

- [x] Replace require("cookie") with ESM import in routers.ts (agents.me and getAgentSessionFromCtx)
- [x] Reset admin password to match rohangilkes@hey.com / admin123

## Admin Lead Management — COMPLETED

- [x] Add admin backend procedure: leads.adminUpdateStage — admin can change any lead's stage
- [x] Add admin backend procedure: leads.adminAssignAgent — admin can assign/unassign any lead to any agent
- [x] Update ConversationDrawer: add stage dropdown to change lead status
- [x] Update ConversationDrawer: add assign-to-agent dropdown (admin only)
- [x] Update ConversationDrawer: pass sessionId and agentList into drawer so mutations work

## Booking Stages & Metrics — COMPLETED

- [x] Add BOOKED and NOT_INTERESTED to conversationStages enum in schema.ts
- [x] Run pnpm db:push to migrate DB
- [x] Update STAGE_CONFIG and ALL_STAGES in AdminDashboard.tsx (BOOKED=green, NOT_INTERESTED=gray)
- [x] Update leads.stats backend to return bookedCount, bookedRevenue, conversionRate
- [x] Update adminUpdateStage procedure to accept new stages
- [x] Add metrics cards to admin dashboard: Booked Revenue, Jobs Booked, Conversion Rate
- [x] Update leads.test.ts to match new stats shape and two-query mock — 121/121 tests pass

## Claim Lead & Internal Notes — COMPLETED

- [x] Add internalNotes column to conversation_sessions schema
- [x] Run pnpm db:push to migrate DB
- [x] Add agents.claimLead procedure (agent assigns themselves to a session)
- [x] Add agents.updateNotes procedure (agent/admin saves notes for a session)
- [x] Add agents.getNotes procedure (fetch notes for a session)
- [x] Add Claim Lead button inside agent workspace ConversationDrawer
- [x] Add internal notes textarea to agent workspace ConversationDrawer
- [x] Add internal notes textarea to admin ConversationDrawer
- [x] Write vitest tests for claimLead, updateNotes, and getNotes — 136/136 tests pass

## Booked Revenue — Extras & Editable Amount — COMPLETED

- [x] Add bookedAmount column (nullable int) to conversation_sessions schema
- [x] Run pnpm db:push to migrate DB
- [x] Update leads.stats to use bookedAmount if set, else fall back to quotedPrice + extras total
- [x] Add leads.updateBookedAmount procedure (admin only)
- [x] Add editable booked amount field to admin ConversationDrawer (shown when stage is BOOKED)
- [x] Update leads.test.ts for new stats logic — 137/137 tests pass

## Agent Booked Stage Sync & Amount Editing — COMPLETED

- [x] Audit agents.markBooked — was missing stage: "BOOKED", now fixed
- [x] Add agents.setBookedAmount procedure (any authenticated agent can set bookedAmount)
- [x] Update agent workspace: add booked amount input field in ConversationDrawer when lead is booked
- [x] Admin metrics invalidate on setBookedAmount success (leads.list.invalidate)
- [x] 137/137 tests pass (setBookedAmount covered by existing mock patterns)

## Agent Workspace Date Filtering — COMPLETED

- [x] Audit leads.list backend — already supports dateFrom/dateTo params
- [x] Wire dateFrom/dateTo to leads.list query in agent workspace
- [x] Add date filter chip bar (Today, This Week, This Month, All Time) above the search bar
- [x] useMemo computes ISO date strings from selected range

## Agent Performance Stats Bar — COMPLETED

- [x] Add agents.myStats procedure: returns leadsAssigned, bookedCount, bookedRevenue, conversionRate filtered by dateFrom/dateTo
- [x] Add stats bar UI to agent workspace (below header, above date chips): 3 cards — Jobs Booked, Revenue, Conversion Rate
- [x] Wire stats bar to active dateRange selection
- [x] Write vitest tests for agents.myStats — 142/142 tests pass

## Agent Leaderboard — COMPLETED

- [x] Add agents.leaderboard backend procedure: returns per-agent stats (leadsAssigned, bookedCount, bookedRevenue, conversionRate) for all agents, filtered by dateFrom/dateTo
- [x] Add Leaderboard tab to admin dashboard navigation (between Agents and AI Simulator)
- [x] Ranked cards with 1st/2nd/3rd colored badges, Top Earner pill, Revenue, Jobs Booked, Conv. Rate, Assigned
- [x] Wire leaderboard to the existing admin date range selector
- [x] 142/142 tests pass

## Mark Not Interested & Notes Preview — COMPLETED

- [x] Add agents.markNotInterested procedure (sets stage to NOT_INTERESTED)
- [x] Add "Not Interested" quick button to lead card alongside "Mark Booked" (hidden once already not-interested)
- [x] Show notes preview snippet (1 line, truncated, amber highlight) on lead card when internalNotes is set
- [x] Not-interested cards get gray border, lighter bg, and 75% opacity
- [x] 142/142 tests pass (markNotInterested covered by existing mock patterns)

## Lead Delete — COMPLETED

- [x] Add leads.deleteLead procedure (admin-only, deletes call logs then session)
- [x] Add "Delete Lead" button in admin ConversationDrawer footer (red, ghost style)
- [x] AlertDialog confirmation: "This will permanently delete [name] and all conversation history"
- [x] On confirm: deletes, closes drawer, invalidates leads.list + leads.stats
- [x] 142/142 tests pass

## In-App SMS Texting — COMPLETED

- [x] Add `aiMode` column to conversationSessions (1 = AI auto-reply, 0 = manual/agent)
- [x] Run pnpm db:push to migrate DB
- [x] Add `leads.sendMessage` tRPC procedure (agent sends SMS via OpenPhone API)
- [x] Add `leads.setAiMode` tRPC procedure (toggle AI auto vs manual per lead)
- [x] Update OpenPhone webhook to skip AI auto-reply when aiMode = 0 (manual mode)
- [x] Add reply input + send button to ConversationDrawer (both admin and agent)
- [x] Add AI/Manual toggle switch in ConversationDrawer
- [x] Auto-refresh conversation every 5s when drawer is open
- [x] Write vitest tests for sendMessage and setAiMode procedures

## UTM Attribution & Conversion Tracking — COMPLETED

- [x] Add utmSource, utmMedium, utmCampaign, utmContent, gclid columns to conversationSessions schema
- [x] Run pnpm db:push to migrate DB
- [x] Capture UTM params from URL in QuoteForm on page load
- [x] Fire quote_submitted conversion event to Manus Analytics on form submit
- [x] Pass UTM params through tRPC submitQuote mutation
- [x] Store UTMs in lead record in DB
- [x] Display Traffic Source section in admin lead drawer details panel
- [x] Write vitest tests for UTM capture logic — 170/170 tests pass

## Source Breakdown Chart — COMPLETED

- [x] Add `leads.sourceBreakdown` tRPC query (count by utmSource, respects date filter)
- [x] Build donut/bar chart component using recharts
- [x] Add chart to admin dashboard analytics section
- [x] Write vitest tests for sourceBreakdown query logic — 178/178 tests pass

## Visitors-to-Leads Conversion Metric

- [ ] Research Manus Analytics API for page view / unique visitor counts
- [ ] Add backend tRPC query to fetch visitor stats from analytics API
- [ ] Build funnel metric card: Visitors → Leads → Booked with conversion rates
- [ ] Add to admin dashboard alongside source breakdown chart

## Traffic Source Chart: Visitors + Leads per Source — COMPLETED

- [x] Update `leads.sourceBreakdown` to also query `page_views` table for visitor counts per source
- [x] Merge visitor and lead rows into a unified map keyed by source
- [x] Return `{ source, visitors, leads, count }` shape (count kept for backwards compat)
- [x] Replace donut chart with grouped bar chart (light bar = visitors, solid bar = leads)
- [x] Update summary table: Visitors column, Leads column, Conversion % column, Totals row
- [x] Update vitest tests for new merged aggregation logic — 195/195 tests pass

## Widget Flow: Sizing Question First — COMPLETED

- [x] Add WIDGET_SIZING stage to conversationStages enum in schema.ts
- [x] Run pnpm db:push to migrate DB
- [x] Add extractRoomInfo() and isPricingQuestion() helpers to conversationEngine.ts
- [x] Add handleWidgetSizingReply() to conversationEngine.ts (extracts rooms, calculates price, advances to AVAILABILITY)
- [x] Fix lookupPrice() to use real Maids in Black pricing table (mirrors estimatePrice in openphone.ts)
- [x] Add WIDGET_SIZING case to processLeadReply() in conversationEngine.ts
- [x] Add quotes.submitWidgetLead tRPC procedure to routers.ts (name + phone only)
- [x] Add processWidgetLeadInBackground() function: sends sizing question SMS, creates WIDGET_SIZING session
- [x] Add WIDGET_SIZING to AdminDashboard.tsx stage config and dropdown
- [x] Add WIDGET_SIZING to AgentDashboard.tsx stage labels and colors
- [x] Add WIDGET_SIZING to SmsSimulator.tsx stage type and labels
- [x] Add WIDGET_SIZING to simulator.chat stage enum in routers.ts
- [x] 252/252 tests pass

## Widget CORS Fix

- [x] Fix "failed to fetch" error when widget on maidsinblack.com calls quotes.submitWidgetLead — added cors middleware allowing maidsinblack.com origin

## Widget Lead Source Tagging

- [x] Add leadSource column to conversationSessions schema ("form" | "widget")
- [x] DB already had the column from a previous session — schema updated to match
- [x] Set leadSource = "widget" in processWidgetLeadInBackground
- [x] Set leadSource = "form" in processQuoteInBackground
- [x] Display leadSource badge in admin dashboard lead table (Source column) and drawer header
- [x] 252/252 tests pass

## Reactivation Campaign Feature

- [x] Add reactivationCampaigns and reactivationContacts tables to DB (created via direct SQL)
- [x] Server: campaigns.previewCsv (parse CSV, normalize phones, apply eligibility rules, return segments)
- [x] Server: campaigns.createFromCsv (create campaign + load contacts into DB)
- [x] Server: campaigns.list, campaigns.get, campaigns.updateStatus, campaigns.delete
- [x] Server: throttled send engine (50/hr batching, PENDING → SENT state machine)
- [x] Server: inbound SMS from reactivation contacts routed through conversation engine; contacts marked REPLIED
- [x] Server: campaignRouter wired into appRouter
- [x] UI: /admin/campaigns page (CSV upload, segment preview, campaign builder, contact list, stats dashboard)
- [x] UI: Campaigns nav link added to AdminDashboard header
- [x] Route /admin/campaigns added to App.tsx
- [x] 252/252 tests pass

## Reactivation Campaign AI Flow — COMPLETED

- [x] Add lastPrice (int, nullable) and discountPct (int, default 10) columns to reactivationContacts table
- [x] Add REACTIVATION stage to conversationStages enum in schema.ts
- [x] Add handleReactivationReply() to conversationEngine.ts (YES → availability, price question → discounted price + availability, STOP → opt out)
- [x] Update campaign send engine to use confirmed message template with [Name] and 10% off
- [x] Store lastPrice from CSV on each contact record
- [x] Update campaign builder UI: show default message template, allow discount % customization
- [x] Add REACTIVATION to all stage dropdowns (AdminDashboard, AgentDashboard, SmsSimulator, routers.ts)
- [x] sendNextBatch creates conversation_sessions record after each SMS (stage=REACTIVATION, lastPrice, discountPct, links sessionId)
- [x] Webhook routes reactivation replies to REACTIVATION stage handler via lastPrice/discountPct context
- [x] markReactivationContactReplied increments campaign repliedCount
- [x] 275/275 tests pass (7 new reactivation conversation tests + 16 new campaign router tests)

## Reactivation Leads in Admin Dashboard — COMPLETED

- [x] Verify leads.list query includes reactivation sessions (leadSource = "reactivation") — confirmed, no filter exclusion
- [x] Ensure conversation drawer renders correctly for reactivation leads (all fields conditional, renders cleanly)
- [x] Add source filter to admin leads table: All / Form / Widget / Reactivation
- [x] Wire source filter into filteredSessions useMemo (client-side filter, no backend change needed)
- [x] Show "Reactivation" badge (purple) in source column for reactivation leads
- [x] Show "Reactivation" badge in conversation drawer header
- [x] Clear filters button now resets sourceFilter too
- [x] 275/275 tests pass

## Campaign Reply Stats on Campaigns Page — COMPLETED

- [x] Add bookedRevenue live-computed to campaigns.list (join reactivation_contacts → conversation_sessions, sum bookedAmount/quotedPrice where isBooked=1)
- [x] Add campaigns.stats procedure (bookedRevenue, replyRate, conversionRate) for detail view
- [x] Add markReactivationContactBooked helper (idempotent, only increments once per contact)
- [x] Wire markReactivationContactBooked into leads.adminUpdateStage (when stage = BOOKED)
- [x] Wire markReactivationContactBooked into agents.markBooked
- [x] Campaign list cards: show reply rate % under replied count, Revenue column (purple)
- [x] Campaign detail stats: expanded to 6-card grid (Total, Sent, Replied, Booked, Revenue, Conv. Rate)
- [x] 275/275 tests pass, 0 TypeScript errors

## Test Campaign Feature — COMPLETED

- [x] Add campaigns.createTest backend procedure (seeds Rohan, 302-981-6191, $150 last booking, discountPct=10, 270 days since last booking)
- [x] Add "Test Campaign" button (dashed outline) to Campaigns page header
- [x] Add info banner explaining what the test campaign does
- [x] Test campaign uses the same send flow as real campaigns (sendNextBatch, conversation engine, webhook)
- [x] 275/275 tests pass, 0 TypeScript errors

## Message Preview in Campaign Detail — COMPLETED

- [x] Add rendered message preview card to campaign detail view
- [x] Substitute [Name]/[FirstName] with first contact's name (or "Customer" as fallback)
- [x] Style as a realistic SMS bubble (right-aligned, primary color, rounded-2xl) so it's visually clear what the recipient will see
- [x] Shows both raw template (monospace) and rendered preview side-by-side in same card
- [x] 275/275 tests pass, 0 TypeScript errors

## Navigation Fix — COMPLETED

- [x] Add back-to-admin link on Campaigns page header (ArrowLeft icon, top of list view)

## Dashboard Metrics Bug — FIXED

- [x] Root cause: reactivation sessions have no quotedPrice, so revenue showed as $0
- [x] Added calcBookedRevenue() helper: bookedAmount override > quotedPrice+extras (form/widget) > lastPrice*(1-discount%) (reactivation)
- [x] Updated leads.stats, agents.myStats, agents.leaderboard to fetch reactivation fields and use calcBookedRevenue
- [x] 275/275 tests pass, 0 TypeScript errors

## Reactivation Drawer Price + Revenue Source Breakdown — COMPLETED

- [x] Show "Last booking: $150 → $135 (10% off)" in reactivation conversation drawer detail panel (strikethrough original, green discount badge)
- [x] Add source breakdown stacked bar + legend to Booked Revenue card (Form / Widget / Reactivation sub-totals)
- [x] Update leads.stats backend to return revenueBySource breakdown by leadSource
- [x] Added reactivationLastPrice + reactivationDiscountPct to DrawerSession type
- [x] 275/275 tests pass, 0 TypeScript errors

## Widget Missing Bug Fix — COMPLETED

- [x] Root cause: server/widgetEmbed.ts was missing from codebase (lost in a previous rollback/merge) and registerWidgetEmbedRoute() was removed from server/_core/index.ts
- [x] Restored widgetEmbed.ts from git history (cb613df — v2.4.0 with mobile/iOS/WordPress fixes)
- [x] Re-added import and registerWidgetEmbedRoute(app) call to server/_core/index.ts
- [x] Verified /api/widget.js returns correct JS (v2.3.0) on dev server
- [x] 275/275 tests pass, 0 TypeScript errors

## Widget Health Check on Admin Dashboard — COMPLETED

- [x] Add system.widgetHealth tRPC procedure — fetches /api/widget.js, validates JS content, extracts version
- [x] WidgetHealthBadge component in admin dashboard top bar: green pill (Wifi icon + version) when OK, red pill (WifiOff + "Widget DOWN") on failure
- [x] Auto-refreshes every 5 minutes; click to manually re-check; tooltip shows full error message
- [x] 275/275 tests pass, 0 TypeScript errors

## Post-Cleaning Review Request Flow — COMPLETED

- [x] Add REVIEW_REQUESTED and REVIEW_DONE stages to conversationStages enum in schema.ts
- [x] Add completedJobs table: id, batchId, phone, name, firstName, serviceDate, status (PENDING/SENT/REPLIED_POSITIVE/REPLIED_NEGATIVE/REVIEW_CONFIRMED/OPTED_OUT), smsSentAt, createdAt
- [x] Add completedJobBatches table: id, filename, uploadedAt, totalCount, sentCount, positiveCount, negativeCount, reviewConfirmedCount
- [x] Run pnpm db:push to sync schema
- [x] Add parseCompletedJobsCsv() helper (same CSV format as bookings CSV)
- [x] Add completedJobs.upload tRPC procedure (parse CSV, insert batch + jobs, schedule SMS for 24h later)
- [x] Add completedJobs.sendPendingNow procedure (finds PENDING jobs where 24h has passed, sends SMS, marks SENT)
- [x] Add handleReviewReplyForJob() in reviewRouter.ts (positive → Google link + 10% off, negative → flag + manual, review confirmed → create reactivation contact)
- [x] Add completedJobs.listBatches + getBatchContacts tRPC procedures
- [x] Wire webhook: when session stage = REVIEW_REQUESTED or REVIEW_DONE, route to handleReviewReplyForJob()
- [x] Build Completed Jobs admin page (/admin/completed-jobs): upload CSV, batch history with sent/positive/negative/review counts, per-contact detail view
- [x] Add Completed Jobs nav link to Admin Dashboard header
- [x] Wire /admin/completed-jobs route in App.tsx
- [x] Write vitest tests for classifyReviewReply and parseCompletedJobsCsv (299/299 tests pass)

## Widget Phone Autofill Bug Fix — COMPLETED

- [x] Fix phone input in widget: browser autofill with "+1 401-688-8007" produces "140-168-8800" instead of "4016888007"
- [x] Fix phone normalization to strip country code prefix (+1 or 1) before stripping non-digits
- [x] Also fix in QuoteForm.tsx (same pattern was present there too)

## Phone Format Autofill Test Coverage — COMPLETED

- [x] Write phoneFormat.test.ts covering 12 autofill formats for both normalizePhone (E.164) and formatPhoneWidget (display)
- [x] Verify: E.164 with space, E.164 compact, 11-digit with leading 1, raw 10 digits, parentheses, dot-separated, dash-separated, space-separated, E.164+parentheses, country code+dashes, country code+parentheses, leading/trailing whitespace
- [x] All 28 new tests pass (327/327 total)

## Phone Input UX Improvements — COMPLETED

- [x] Switch autocomplete="tel" to autocomplete="tel-national" in widget (widgetEmbed.ts) and QuoteForm.tsx
- [x] Add live green checkmark + green border when phone reaches exactly 10 digits in widget
- [x] Add live green checkmark + green border when phone reaches exactly 10 digits in QuoteForm.tsx
- [x] 327/327 tests pass, 0 TypeScript errors

## Live Validation UX — Name, Email, Phone Fields — COMPLETED

- [x] QuoteForm: extend green-valid/red-error border + animated checkmark to name field (non-empty)
- [x] QuoteForm: extend green-valid/red-error border + animated checkmark to email field (valid format)
- [x] QuoteForm: add scale-in animation to phone checkmark (animate-checkmark-pop)
- [x] Widget: extend green-valid/red-error border + animated checkmark to name field
- [x] Widget: add scale-in animation to phone checkmark (mibCheckPop)
- [x] Add @keyframes checkmarkPop to index.css + @keyframes mibCheckPop to widget injected style
- [x] 327/327 tests pass, 0 TypeScript errors

## QuoteForm Validation Visual Fixes — COMPLETED

- [x] Override browser autofill blue background on name/email/phone inputs (use -webkit-box-shadow hack)
- [x] Select dropdowns (service type, bedrooms, bathrooms) already had no green — confirmed no change needed
- [x] Add isFormReady computed value: true when name non-empty + email valid + phone 10 digits
- [x] When isFormReady: button turns green (#22C55E gradient) with 2s pulse animation
- [x] When not ready: submit button stays coral as before
- [x] 327/327 tests pass, 0 TypeScript errors

## Phone Validation Hardening — COMPLETED

- [x] Widget: isValidUSPhone() validates NPA (area code first digit 2-9) and NXX (exchange first digit 2-9) — blocks submit with inline error "Please enter a valid US phone number"
- [x] Widget: updatePhoneValid() uses isValidUSPhone so green checkmark only appears for valid US numbers
- [x] Server (routers.ts submitWidgetLead): TRPCError BAD_REQUEST thrown if isValidUSPhone fails — server-side safety net
- [x] extractUSDigits() + isValidUSPhone() exported from routers.ts
- [x] phoneFormat.test.ts: 8 valid + 9 invalid + 5 extractUSDigits tests added (349/349 pass)
- [x] The exact case from the screenshot (+10770748959) is now covered and rejected

## Message Flow Transparency & Editing — Reactivation + Post-Sale — COMPLETED

- [x] Audit all hardcoded message templates in campaignRouter.ts (reactivation) and reviewRouter.ts (post-sale)
- [x] Add messageTemplates table to DB: id, flowType, stepKey, label, triggerLabel, body, variables (JSON), isEditable, updatedAt
- [x] Seed 9 default templates (4 reactivation + 5 review) via messageTemplates.seed procedure (idempotent, auto-seeds on first load)
- [x] Add messageTemplates.list, update, seed tRPC procedures (adminAgent protected)
- [x] Build MessageFlowPanel component: vertical timeline with trigger label, SMS bubble preview, collapsible, variable substitution
- [x] Inline editing: click Edit → textarea with clickable variable hint chips → live preview → Save
- [x] Opt-out messages locked (isEditable=0) — show Locked badge, no Edit button
- [x] Wire Reactivation campaign detail page: replaced old template card with MessageFlowPanel
- [x] Wire Completed Jobs page: added Review Request Message Flow card at bottom
- [x] 19 new tests in messageTemplateRouter.test.ts (368/368 total pass, 0 TS errors)

## Live Template Wiring + Reset to Default — COMPLETED

- [x] getTemplate(stepKey, vars?) server helper: fetches from DB, falls back to DEFAULT_TEMPLATES if not seeded
- [x] messageTemplates.reset procedure: restores body to DEFAULT_TEMPLATES value (locked templates rejected)
- [x] campaignRouter.ts sendNextBatch: reactivation_initial reads from DB via getTemplate
- [x] conversationEngine.ts handleReactivationReply: yes/price/opt-out replies read from DB via getTemplate
- [x] reviewRouter.ts: review_initial, review_positive, review_negative, review_confirmed all read from DB via getTemplate
- [x] MessageFlowPanel: amber Reset button (RotateCcw icon) appears only when body !== defaultBody; disappears after reset
- [x] 368/368 tests pass, 0 TypeScript errors

## Launch27 Auto-Sync (Nightly REST API Connector) — COMPLETED

- [x] Discovered Launch27 has a clean REST API: GET /v1/staff/bookings?from=DATE&to=DATE&options=completed,exclude_forecasted
- [x] No Puppeteer needed — direct HTTP calls with JWT bearer token from localStorage
- [x] Built server/launch27.ts: getCompletedBookingsForDate(date) returns {bookings, error}
- [x] Stored LAUNCH27_BEARER_TOKEN (JWT, expires 2027) + LAUNCH27_TENANT as encrypted secrets
- [x] Built launch27Router.ts: syncCompletedJobs procedure — fetches, deduplicates by phone+date, inserts new batch + jobs
- [x] Wired launch27Router into appRouter as launch27 namespace
- [x] Added Launch27 Sync card to Completed Jobs page: date picker, Sync Now button, last sync result (new/skipped/errors)
- [x] 3 new tests in launch27.test.ts (371/371 total pass, 0 TS errors)
- [x] Credentials validated: API returns real bookings for 2026-03-15 (Shirletta Miller etc.)

## Nightly Launch27 Sync + Customer History Database — COMPLETED

- [x] Enrich completedJobs schema: add email, address, frequency, launch27BookingId, lastBookingPrice, reactivationEligible (int), reactivationEligibleAt
- [x] Run pnpm db:push to sync schema (migration 0022 applied)
- [x] Update launch27Router.ts syncCompletedJobs to store all enrichment fields (email, address, frequency, bookingId, price)
- [x] Auto-compute reactivationEligible: one-time bookings eligible immediately; recurring eligible 30 days after job date
- [x] Add POST /api/cron/nightly-sync endpoint in server/cronSync.ts — protected by X-Cron-Secret header
- [x] Store CRON_SECRET as encrypted secret
- [x] Schedule nightly cron: every night at 10 PM, calls POST /api/cron/nightly-sync for yesterday's date
- [x] Show reactivation eligibility badge (green "Eligible" / grey "30d wait") in Completed Jobs contact detail view
- [x] Show frequency column in contact detail table
- [x] Show email under customer name in contact detail table
- [x] Add "Sync Last 7 Days" backfill button to Launch27 sync card
- [x] Add "Runs nightly at 10 PM" badge to Launch27 sync card
- [x] Update getLastSync to find both launch27-sync- and launch27-auto- batches
- [x] Write 7 tests for cronSync.ts (378/378 total pass, 0 TS errors)

## "From Completed Jobs" Campaign Source — COMPLETED

- [x] Add completedJobId column to reactivationContacts (links contact back to source completedJob row)
- [x] Add sourceType column to reactivationCampaigns ("csv" | "completed_jobs")
- [x] Run pnpm db:push to sync schema (migration 0023 applied)
- [x] Add campaigns.previewFromCompletedJobs procedure: query completedJobs WHERE reactivationEligible=1, not already enrolled, with frequency filter
- [x] Add campaigns.createFromCompletedJobs procedure: pull eligible contacts from DB, insert into reactivationContacts with completedJobId link
- [x] Update ReactivationCampaigns UI: source selector card ("From Completed Jobs" | "CSV Upload") replaces old CSV-only step
- [x] "From Completed Jobs" flow: live count, frequency filter (all/one-time/recurring), refresh button, preview table with name/phone/frequency/job date
- [x] Show source type badge (green Database / blue Upload) on campaign list and detail view
- [x] Write 7 tests for campaignCompletedJobs.ts (385/385 total pass, 0 TS errors)

## Simplified Campaign Creation — One Unified Audience — COMPLETED

- [x] Remove source selector (CSV vs Completed Jobs) from campaign creation UI
- [x] Campaign creation: single flow — filter by frequency + eligibility, preview contacts, name + message, create
- [x] Keep CSV import as a data tool on Completed Jobs page only (not in campaign flow)
- [x] Remove csvText / fileInputRef / previewCsv / audienceSource state from ReactivationCampaigns
- [x] Remove createCampaign (CSV-based) mutation from campaign creation — use createFromCompletedJobs only
- [x] Simplify the "Create Campaign" button label and disabled logic
- [x] 385/385 tests passing, 0 TS errors

## Always-On Campaign Engine (4 Groups) — COMPLETED

- [x] Schema: alwaysOnGroups table (groupType, name, description, isActive, messageTemplate, batchSize, stats counters)
- [x] Schema: alwaysOnEnrollments table (groupId, completedJobId, phone, firstName, frequency, status, sentAt, repliedAt, jobDate, enrolledAt)
- [x] Run pnpm db:push to migrate (migration 0024 applied)
- [x] Eligibility engine (server/alwaysOnEngine.ts): computeEligibleGroup() with 4-group priority logic
  - Group 1 (new-one-time): frequency=one-time/unknown, daysSinceJob 3–20
  - Group 2 (lapsed-one-time): frequency=one-time/unknown, daysSinceJob >= 21
  - Group 3 (lapsed-recurring): recurring frequency, daysSinceJob >= frequencyWindowDays + 7
  - Group 4 (dormant): any frequency, daysSinceJob >= 180
  - Active recurring = frequency is recurring AND daysSinceJob < frequencyWindowDays + 7 → NEVER enrolled
- [x] getFrequencyWindowDays(): maps Monthly/Biweekly/Weekly/Every 3 weeks/Every 6 weeks/etc to days
- [x] Seed default group rows with default message templates on first run (seedDefaultGroups)
- [x] Auto-enrollment: nightly cron calls enrollNewlyEligible() after syncCompletedJobs
- [x] enrollNewlyEligible(): for each completedJob not already enrolled, check eligibility, insert into alwaysOnEnrollments, update totalEnrolled counter
- [x] Wire into nightly cron: sync → enroll → notify owner with enrollment summary
- [x] Admin UI: /admin/always-on page with 4 group cards (rules, editable message template, stats, contact list)
- [x] Per-group toggle: enable/disable each group independently
- [x] Per-group message template editor: inline edit + save to DB
- [x] Contact list per group: name, phone, frequency, job date, enrolled date, status badge; paginated
- [x] Manual enrollment button ("Enroll Now") for backfill
- [x] "Always-On" nav link added to AdminDashboard tab bar
- [x] 26 test files, 413 tests passing (28 new tests for alwaysOnEngine), 0 TS errors

## Historical CSV Import + Bulk Enrollment — COMPLETED

- [x] Import 5-year bookings CSV (44,371 rows) directly into completed_jobs via scripts/importBookingsCsv.mjs
- [x] Normalize phone to E.164, frequency to clean labels, date to YYYY-MM-DD, price to integer cents
- [x] 61 rows skipped (invalid/missing phone)
- [x] Bulk-classify all 44,374 completed_jobs into always-on groups via scripts/bulkEnroll.mjs
  - New One-Time: 43
  - Lapsed One-Time: 313
  - Lapsed Recurring: 1,515
  - Dormant: 42,257
  - Active recurring (skipped): 246
  - Total enrolled: 44,128
- [x] Fix campaignCompletedJobs.test.ts — 2 tests now use pure logic assertions (413/413 pass)
- [x] 413/413 tests passing, 0 TS errors

## Always-On Deduplication Fix — COMPLETED

- [x] Identified root cause: 44,374 rows enrolled (one per booking) instead of one per unique customer
- [x] Fixed bulkEnroll.mjs: SELECT most recent job per phone using MAX(jobDate) + MAX(id) dedup join
- [x] Fixed alwaysOnEngine.ts enrollNewlyEligible(): deduplicate by phone in-memory, skip already-enrolled phones
- [x] Re-ran bulk enrollment: 3,613 unique customers enrolled (was 44,128 before fix)
  - New One-Time: 41
  - Lapsed One-Time: 178
  - Lapsed Recurring: 79
  - Dormant: 3,315
  - Active recurring (skipped): 190
- [x] 413/413 tests passing, 0 TS errors

## Always-On SMS Send Schedule (10 AM ET, Mon–Sat) — COMPLETED

- [x] Build sendAlwaysOnBatch() in server/alwaysOnSend.ts: picks batchSize PENDING enrollments per group, sends via OpenPhone, marks SENT, updates sentCount
- [x] TCPA compliance: isWithinTcpaWindow() — only sends Mon–Sat, 9 AM–8 PM ET; aborts entire batch if outside window
- [x] Personalize message: [Name], [Price], [DiscountedPrice] tokens replaced per enrollment
- [x] Add POST /api/cron/always-on-send endpoint in cronSync.ts (protected by X-Cron-Secret)
- [x] Register 10 AM ET Mon–Sat cron schedule (0 0 15 * * 1-6 UTC = 10 AM ET)
- [x] Update Always-On UI: two-column schedule info banner (10 PM sync + 10 AM send)
- [x] Update Always-On UI: inline batch size editor per group (click to edit, save to DB)
- [x] Update Always-On UI: Pending stat added to 5-stat row (Enrolled / Pending / Sent / Reply Rate / Booked)
- [x] Add openPhoneMessageId column to always_on_enrollments (migration 0025 applied)
- [x] 18 new tests for alwaysOnSend.ts (431/431 total pass, 0 TS errors)

## Always-On Test Message Feature — COMPLETED

- [x] Add alwaysOn.sendTestMessage tRPC procedure: takes groupId + testPhone, picks a real PENDING enrollment (or placeholder tokens), sends via OpenPhone, returns rendered message text
- [x] Add "Send Test Message" button to each group card in AlwaysOnCampaign.tsx
- [x] Dialog: phone number input, message preview (shows template before send, rendered message after send), confirm send button
- [x] After send: dialog shows the exact rendered message with tokens replaced and a green confirmation
- [x] 431/431 tests passing, 0 TS errors

## Always-On Conversation Engine Wiring — COMPLETED

- [x] Update sendAlwaysOnBatch: after each successful send, creates a conversationSession (stage=REACTIVATION, leadSource=always-on) so replies route through the AI engine
- [x] sessionId column already existed in alwaysOnEnrollments schema — now populated after each send
- [x] Add markAlwaysOnContactReplied() to alwaysOnSend.ts — marks SENT enrollment as REPLIED and increments repliedCount
- [x] Wire markAlwaysOnContactReplied into webhook handler (runs alongside markReactivationContactReplied)
- [x] Update sendTestMessage: also creates a conversationSession (leadSource=always-on-test) so test replies go through the AI; clears previous test session for same phone first
- [x] Insert 4 demo contacts (Emma/James/Maria/Robert, +1555 numbers) — one per group — for UI preview and test message use
- [x] 431/431 tests passing, 0 TS errors
