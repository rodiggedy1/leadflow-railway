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

## Fix Lead Source Labels in Admin Conversations — COMPLETED

- [x] Add getSourceBadge(leadSource) helper + formatGroupType() to AdminDashboard
- [x] Handles always-on:{groupType} → orange badge "Always-On: New One-Time" etc.
- [x] Handles always-on-test:{groupType} → yellow badge "Test: New One-Time" etc.
- [x] Handles reactivation → purple "Campaign", widget → blue "Widget", form/null → grey "Quote Form"
- [x] Updated both badge locations (drawer header + table row)
- [x] Added "Always-On" filter option to source filter dropdown
- [x] Updated sendAlwaysOnBatch to store leadSource as always-on:{groupType}
- [x] Updated sendTestMessage to store leadSource as always-on-test:{groupType}
- [x] 431/431 tests passing, 0 TS errors

## Sync Health Dashboard — COMPLETED

- [x] Add sync_runs table to schema (runType, status, message, errorDetail, recordsInserted, recordsSkipped, smsSent, smsFailed, groupBreakdown, enrollmentBreakdown, targetDate, durationMs, startedAt, completedAt)
- [x] Migration 0026 applied successfully
- [x] recordSyncRun() helper in cronSync.ts — non-fatal, logs every run outcome
- [x] runNightlySync() records success/partial/error/skipped with timing and enrollment breakdown
- [x] always-on-send cron endpoint records per-group SMS breakdown
- [x] syncHealthRouter.ts: getRecentRuns, getSummary (with streak), triggerSync procedures
- [x] SyncHealthPage.tsx: status cards with last run, duration, streak, inserted/sent counts, mini sparkline
- [x] Run History table with collapsible group/enrollment breakdowns
- [x] Manual Sync Trigger with date picker
- [x] "Sync Health" nav link added to AdminDashboard header
- [x] Route /admin/sync-health registered in App.tsx
- [x] 431/431 tests passing, 0 TS errors

## AI Future Booking Intelligence — COMPLETED

- [x] Add FUTURE_BOOKING stage to conversationStages enum in schema.ts
- [x] Run pnpm db:push (migration 0027 applied)
- [x] Add "future_booking" to ObjectionType in aiService.ts
- [x] Update detectObjection LLM classifier to recognize future-date intent (e.g. "early May", "next month", "after the holidays")
- [x] Add handleObjection prompt for future_booking: warm acknowledgment, no slot pushing, invite to reach back out
- [x] Add fallback response for future_booking
- [x] handleObjection returns nextStage: "FUTURE_BOOKING" for future_booking type
- [x] Add regex pre-check in AVAILABILITY stage to catch month names, "next month", "in a few weeks" BEFORE the LLM
- [x] Add FUTURE_BOOKING stage handler in processLeadReply: stays warm, re-enters AVAILABILITY if lead says they're ready
- [x] Add FUTURE_BOOKING to AdminDashboard Stage type, STAGE_CONFIG (blue badge), and stage dropdown
- [x] Add FUTURE_BOOKING to adminUpdateStage z.enum in routers.ts
- [x] 431/431 tests passing, 0 TS errors

## Cron Date Fix — COMPLETED

- [x] Fix cronSync.ts "yesterday" date calculation to use Eastern Time instead of UTC
- [x] 431/431 tests passing, 0 TS errors
- [ ] Backfill missed March 16 bookings via manual sync trigger on health page

## Always-On: Skip Address for Existing Customers — IN PROGRESS

- [ ] Detect always-on leads in conversation engine and skip ADDRESS stage (address already in completedJobs)
- [ ] Pre-populate address from completedJobs when creating always-on conversation session
- [ ] Go straight from TIME_PREF (or SLOT_CHOICE) to CONFIRMATION with address already set

## Always-On: Full Conversation Thread Viewer — IN PROGRESS

- [ ] Add tRPC procedure to fetch full conversation messages for a given phone/session
- [ ] Add "View Conversation" button/link on Always-On contacts list rows
- [ ] Build conversation thread drawer showing all SMS messages in chronological order

## Always-On Improvements — COMPLETED (2026-03-17)

- [x] Skip ADDRESS stage for always-on leads — address pre-populated from completedJobs at session creation
- [x] TIME_PREF stage now checks context.address and jumps straight to CONFIRMATION if address is on file
- [x] Added getConversation tRPC procedure to alwaysOnRouter
- [x] Added "Conversation" column to contacts table with "View" button for REPLIED/BOOKED contacts
- [x] Built conversation thread Sheet drawer with message bubbles, stage badge, address/slot metadata strip
- [x] 431/431 tests passing, 0 TS errors

## Always-On Responders on Main Leads Page — IN PROGRESS

- [ ] Update leads query to include always-on sessions where stage != REACTIVATION (i.e. they replied)
- [ ] Add "Always-On" source badge to leads table rows sourced from always-on campaigns
- [ ] Filter Always-On contacts table to REPLIED/BOOKED only (remove SENT/PENDING noise)

## Always-On Responders on Main Leads Page — COMPLETED (2026-03-17)

- [x] Updated leads.list query to include always-on sessions where stage != REACTIVATION (replied leads)
- [x] Always-on responders now appear on main leads page with orange "Always-On: <group>" badge
- [x] Always-On contacts table defaults to "Responded" view (REPLIED + BOOKED only)
- [x] Added "Responded / All Sent" toggle on contacts table header for full list access
- [x] 431/431 tests passing, 0 TS errors

## Always-On First-Reply SMS Alert — IN PROGRESS

- [ ] Send SMS to admin (302-981-6191) when an always-on lead replies for the first time

## Always-On First-Reply SMS Alert — COMPLETED (2026-03-17)

- [x] markAlwaysOnContactReplied now returns enrollment info (name, groupType) on first reply
- [x] Webhook awaits the result and fires admin SMS to +13029816191 on first reply
- [x] Alert message: "🔔 Always-On Reply: {Name} ({phone}) just responded to your {Group} campaign."
- [x] 431/431 tests passing, 0 TS errors

## Follow-Up Features — IN PROGRESS

- [x] Add FOLLOW_UP_SCHEDULED to conversationStages enum in schema + db:push
- [x] Add lastAiMessageAt timestamp column to conversationSessions for silence detection
- [x] Build 5-minute silence follow-up cron: send contextual nudge if no reply in 5 min
- [x] Add followUpDate + followUpMessage columns to conversationSessions
- [x] Add manual follow-up date setter in admin lead detail (date picker + editable message)
- [x] Build scheduled follow-up cron: fire circle-back SMS on followUpDate
- [x] Show FOLLOW_UP_SCHEDULED badge in admin leads table

## Activity Notification Widget — IN PROGRESS
- [ ] Add activity_log table to schema (type, title, body, metadata, readAt, createdAt)
- [ ] Instrument: inbound lead replies (webhooks.ts)
- [ ] Instrument: outbound AI SMS sends (webhooks.ts)
- [ ] Instrument: silence nudge sends (followUpCron.ts)
- [ ] Instrument: scheduled follow-up sends (followUpCron.ts)
- [ ] Instrument: always-on SMS batch sends (cronSync.ts)
- [ ] Instrument: nightly sync completions (cronSync.ts)
- [ ] Instrument: new bookings (conversationEngine.ts)
- [ ] Add tRPC procedures: getActivityFeed, markAllRead
- [ ] Build NotificationBell component with unread badge and dropdown feed
- [ ] Wire NotificationBell into AdminDashboard header

## Multilingual Support — IN PROGRESS
- [ ] Add `language` column to conversationSessions schema
- [ ] Create language detection utility (LLM-based)
- [ ] Add LANGUAGE_CONFIRM stage to conversationStages enum
- [ ] Detect non-English on first message and send bilingual confirmation
- [ ] Persist confirmed language on session
- [ ] Inject language instruction into all AI prompts
- [ ] Show language flag badge in admin leads table

## Multilingual Support — COMPLETED
- [x] Add language column and LANGUAGE_CONFIRM stage to schema
- [x] Create language detection utility (LLM-based, regex pre-filter)
- [x] Add LANGUAGE_CONFIRM stage to conversation engine with bilingual confirmation message
- [x] Persist confirmed language on session in webhooks.ts
- [x] Inject language instruction into all AI prompts (handleOffScriptReply, handleObjection, handlePostBookingReply)
- [x] Show language flag badge in leads table (Source column)
- [x] Show language flag badge in lead detail drawer header

## Conversation Engine Bug Fixes — COMPLETED
- [x] Fix Bug 1: language confirmation reply sent in English even after "sí" confirms Spanish
  - Root cause: context.language was not populated from session.language in webhooks.ts
  - Fix: added language + preLangStage to context object in webhooks.ts (lines 199-200)
- [x] Fix Bug 2: resume message after language confirmation was in English (static builders)
  - Fix: resumeStageAfterLanguageConfirm now translates messages using LLM when language != en
- [x] Fix: parseLeadReply is now language-aware (passes language code to LLM for non-English replies)
- [x] Fix: all static English message builders wrapped with translateIfNeeded() for non-English sessions
- [x] Fix: handleOffScriptReply, handleObjection, handlePostBookingReply now receive language context
- [x] Fix: preLangStage is explicitly cleared (set to null) after language confirmation to prevent re-triggering

## Multilingual Resume Bug — COMPLETED
- [x] Fix: after language confirmation, conversation now correctly resumes the interrupted stage
  - Added WIDGET_SIZING case to resumeStageAfterLanguageConfirm — asks bedrooms/bathrooms in confirmed language
  - Fixed default fallback: if no quote yet, returns to WIDGET_SIZING; if quote exists, goes to AVAILABILITY
  - Made handleWidgetSizingReply async and wrapped all static strings with translateIfNeeded()
  - Fixed CONFIRMATION case in resume function to use buildConfirmationMessage instead of wrong address question
  - 431/431 tests pass, 0 TS errors

## Stage Guard Rule — COMPLETED
- [x] Define required data for each stage (what must be present before advancing)
- [x] TIME_PREF: removed silent default to "Morning" — now calls handleOffScriptReply and stays on TIME_PREF if no morning/afternoon answer
- [x] ADDRESS: removed raw reply fallback — now only uses LLM-extracted address; FAQ replies stay on ADDRESS
- [x] WIDGET_SIZING: FAQ/unclear replies now use handleOffScriptReply and stay on WIDGET_SIZING
- [x] AVAILABILITY: unclear/FAQ replies already stayed on AVAILABILITY (confirmed correct)
- [x] SLOT_CHOICE: unclear replies already stayed on SLOT_CHOICE (confirmed correct)
- [x] CONFIRMATION: unclear replies already stayed on CONFIRMATION (confirmed correct)
- [x] Added TIME_PREF and WIDGET_SIZING cases to getNextActionPrompt in aiService.ts
- [x] Wrote 14 new vitest guard rule tests covering all 6 stages
- [x] 445/445 tests passing, 0 TS errors

## Smart Off-Script Routing — COMPLETED
- [x] Added isWrongPathReply() classifier in aiService.ts: detects existing customers, support requests, wrong number
- [x] wrong_path → exit funnel gracefully (warm exit message with 202-888-5362 / support@maidsinblacksupport.com, nextStage: DONE)
- [x] FAQ/curiosity → answer + re-ask stage question (existing behavior, kept)
- [x] Soft objection → already handled by detectObjection (confirmed correct)
- [x] All 7 handleOffScriptReply call sites in conversationEngine.ts updated to check isWrongPath
- [x] Wrote 7 new vitest wrong-path routing tests
- [x] 452/452 tests passing, 0 TS errors

## Language-Agnostic Room Count Parsing — COMPLETED
- [x] Added extractRoomInfoWithLLM(text, language): regex fast path for English (no LLM cost), LLM fallback for all other languages
- [x] LLM fallback uses structured JSON schema (bedrooms: int|null, bathrooms: number|null) — works for any language
- [x] handleWidgetSizingReply now calls extractRoomInfoWithLLM(leadReply, context.language)
- [x] Numeric inputs ("3 bed 2 bath") use regex even in non-English sessions (no LLM cost)
- [x] LLM failure falls back gracefully to regex result
- [x] 12 new vitest tests: English fast path, Spanish/French/Portuguese LLM fallback, partial results, LLM failure
- [x] 464/464 tests passing, 0 TS errors

## Infrastructure-Level Language Handling — COMPLETED
- [x] Added normalizeInput(text, language): translates lead reply to English (no-op for English, no LLM cost)
- [x] Added localizeOutput(msg, language): translates bot reply to lead's language (no-op for English, no LLM cost)
- [x] processLeadReply is now the single language boundary: normalize → _processLeadReplyCore → localize
- [x] Removed all 20 translateIfNeeded/localizeOutput calls from stage handlers
- [x] Removed language parameter from parseLeadReply (langNote removed — input is always English)
- [x] Removed language field and langInstruction from all aiService.ts context interfaces
- [x] Removed extractRoomInfoWithLLM — extractRoomInfo (regex) is sufficient since input is always English
- [x] Removed lang variable from handleWidgetSizingReply
- [x] 464/464 tests passing, 0 TS errors
- [x] Architecture: any new stage added in future requires ZERO language work

## AVAILABILITY Stage Recurring Pricing Bug — IN PROGRESS
- [ ] Bug: "How much for recurring" in AVAILABILITY stage is ignored — bot sends generic slot re-ask instead of answering the pricing question
- [ ] Root cause: isPricingQuestion() or the AVAILABILITY unclear path doesn't recognize recurring pricing questions
- [ ] Fix: detect recurring pricing questions in AVAILABILITY, answer with actual recurring pricing, then re-ask for availability
- [ ] Fix: ensure handleOffScriptReply receives enough context (quotedPrice, bedrooms, bathrooms) to give a real recurring price answer
- [ ] Write vitest tests for recurring pricing question in AVAILABILITY stage

## LLM-First Engine Rebuild — COMPLETED
- [x] Built server/engine/ module: schema.ts, pricing.ts, stages.ts, rules.ts, prompt.ts, index.ts
- [x] Single LLM call per message with structured JSON output (LLMDecision schema)
- [x] System prompt includes: full pricing table with recurring discounts, knowledge base, stage instructions, available slots
- [x] Business rule enforcer (rules.ts): validates LLM decisions, enforces stage guards, merges context, allows DONE from any stage
- [x] Stage contracts (stages.ts): defines required fields and valid transitions per stage
- [x] Language handled natively by LLM — no translation layer, no per-stage language code
- [x] Recurring pricing, FAQs, objections, existing customers all handled by LLM with no special cases
- [x] webhooks.ts updated to use processLeadReplyV2 from new engine
- [x] 493/493 tests passing, 0 TS errors

## Admin: Show Call Logs & Agent Notes in Lead Detail — COMPLETED
- [x] Added Call History section to admin lead detail drawer (right panel, above Internal Notes)
- [x] Shows outcome badge (color-coded), agent name, timestamp, and notes for each call log
- [x] Section auto-opens when call logs exist; hidden when no calls logged yet
- [x] 493/493 tests passing, 0 TS errors

## Notification Dropdown Scroll Fix — COMPLETED
- [x] Fixed Activity Feed dropdown scrolling the page underneath instead of scrolling internally
- [x] Root cause: Radix ScrollArea viewport uses size-full (100% height) — needs explicit height on root, not max-height
- [x] Fix: changed ScrollArea from max-h-[480px] to h-[480px] so viewport has a fixed height to fill
- [x] Added overflow-hidden + flex flex-col to outer dropdown container for clean layout
- [x] 0 TS errors

## Availability Question Wording — COMPLETED
- [x] Updated AVAILABILITY stage: bot now asks "Got it, [echo what they need]. When were you hoping to schedule that so we can see how fast we can get you taken care of?"
- [x] Updated WIDGET_SIZING: after quoting, uses same "Got it..." format before moving to AVAILABILITY
- [x] Updated QUOTE_SENT: when lead says yes/ready, uses same "Got it..." format
- [x] Bot no longer offers specific days upfront — asks open-ended "when" first, then offers slots if they say ASAP
- [x] 493/493 tests passing, 0 TS errors

## Dashboard Redundancy Fix — COMPLETED

- [x] Merged 3-card booking metrics row + separate Conversion Funnel card into one unified 4-card summary row (Visitors → Leads → Jobs Booked → Booked Revenue) with inline conversion rates as sub-labels
- [x] Removed ConversionFunnelCard component usage from AdminDashboard (no longer needed)
- [x] Added visitorStats query directly in AdminDashboard so Visitors card is date-range aware
- [x] 493/493 tests pass, 0 TS errors

## Last Activity Column + Sparkline Trends

- [x] Backend: extend leads.list to return lastActivity (text + timestamp) — most recent inbound SMS or call log entry
- [x] Backend: extend leads.stats (or add new procedure) to return 7-day daily breakdown for visitors, leads, and booked
- [x] Frontend: add "Last Activity" column to leads table showing truncated message text + relative time
- [x] Frontend: add inline sparkline bar charts to each of the 4 summary cards (Visitors, Leads, Jobs Booked, Booked Revenue)
- [x] Write vitest tests for new backend procedures/fields

## Remove Stage Funnel Cards

- [x] Remove the FunnelStats stage breakdown grid from the admin dashboard

## Voice AI Agent (Vapi Integration)

- [x] Validate Vapi API keys with a lightweight API call test
- [x] Database: add voice_calls table (vapiCallId, leadId, sessionId, callerPhone, duration, transcript, summary, recordingUrl, outcome, structuredData, createdAt)
- [x] Backend: Vapi assistant bootstrap on server start (create or update assistant in Vapi API)
- [x] Backend: POST /api/webhooks/vapi — handle end-of-call-report and tool-calls
- [x] Backend: tool endpoint — getQuote(bedrooms, bathrooms, cleaningType) → price
- [x] Backend: tool endpoint — createLead(name, phone, address, quote, preferredDate) → leadId
- [x] Backend: tool endpoint — sendSms(phone, message) → via OpenPhone API
- [x] Backend: on call end → create/update lead record, set stage, send SMS summary, notify agent
- [x] Frontend: "Source: Voice" badge on leads that came via call
- [x] Frontend: Call log tab in lead drawer (transcript, recording player, AI summary)
- [x] Frontend: Voice stats on summary cards (calls answered, avg duration, voice conversion)
- [x] Frontend: Vapi settings page in admin (toggle agent on/off, edit greeting, FAQ knowledge base)
- [x] Write vitest tests for webhook handler and tool endpoints

## Voice Agent Troubleshooting

- [x] Diagnose: getQuote tool call failing during live call
- [x] Diagnose: lead not created in dashboard after call
- [x] Fix root cause and verify end-to-end — tools were pointing to dev sandbox URL, fixed to always use quote.maidinblack.com

## Voice Agent Bug Fixes (Round 2)

- [x] Bug: getQuote returning wrong price ($179 for 3bed/2bath standard — should be ~$269)
- [x] Bug: createLead failing mid-call ("issue with saving my service")
- [x] Fix: Madison should not hang up on tool failure — gracefully continue conversation

## Critical Voice Agent Fix — Webhook Payload Format

- [x] Root cause identified: Vapi sends toolCallList items as { name, parameters } (native format), NOT { function: { name, arguments } } (OpenAI format) — our handler was reading the wrong fields, causing all args to be undefined
- [x] Fix: vapiWebhook.ts now handles BOTH formats via parseToolCall() — { name, parameters } and { function: { name, arguments } }
- [x] Verified: getQuote returns $259 for 3bed/2bath in both formats
- [x] Verified: createLead successfully inserts to DB with all fields populated

## Voice Agent Behavioral Fixes (Round 3 — Full Diagnostic)

- [x] Root cause analysis: wrong price ($179) and failed lead creation were due to OLD code running before the parseToolCall fix was deployed — production server NOW correctly returns $259
- [x] Fix: System prompt now injects {{customer.number}} (Vapi built-in variable) so LLM always knows the real caller phone — no more hallucinating the business number
- [x] Fix: Added name verification step — Madison now reads the name back: "Just to confirm, I have your name as [Name] — did I get that right?"
- [x] Fix: Added email collection step (optional) — Madison asks for email for booking confirmation
- [x] Fix: vapiWebhook.ts now has a business-phone safety guard — if LLM passes +12028885362 as phone, it is overridden with the real callerPhone from the call object
- [x] Fix: createLead tool definition updated on Vapi API to include optional email parameter
- [x] Fix: handleCreateLead now accepts and stores email (nullable in DB — migration applied)
- [x] Fix: structuredDataSchema now extracts callerEmail from transcript for end-of-call fallback
- [x] Vapi assistant system prompt updated live via PATCH API — effective immediately for all new calls
- [x] 529/529 tests passing, 0 TS errors

## Voice Agent Fix Round 4

- [x] Fix bedroom question wording: "How many bedrooms does your home have?" not "How many bedrooms do you want cleaned?"
- [x] Fix $179 pricing bug — root cause: production server running old code during test call; server now returns $259 correctly; added explicit rule: LLM must ONLY quote price from getQuote tool result, never from memory
- [x] Add name spelling step: after hearing name, ask caller to spell it, then read it back letter by letter to confirm
- [x] Remove email collection step entirely (will collect on follow-up call)

## Voice Agent Fix Round 5 — Pricing (Definitive Fix)

- [x] Root cause confirmed: getQuote server tool was unreliable due to Vapi webhook routing ambiguity (assistant.server vs tool.server) causing args to arrive as undefined on production
- [x] Elegant solution: removed getQuote as a server-side tool entirely — pricing is now computed by the LLM directly
- [x] Full pricing table + bathroom surcharge + service multipliers + worked examples embedded in system prompt
- [x] LLM (GPT-4o) computes price itself — no HTTP call, no format issues, no deployment lag, no parsing failures
- [x] getQuote removed from buildToolDefinitions; only createLead and sendSms remain as server tools
- [x] Vapi assistant updated live: toolIds now [createLead, sendSms] only, system prompt has full pricing table
- [x] 529/529 tests passing, 0 TS errors

## REGRESSION: createLead broken after Round 5

- [x] Diagnose: createLead was working — delay was async Vapi processing (30-60s after call ends)
- [x] Fix and verify end-to-end lead creation — production server confirmed working, delay was due to async Vapi processing

## Bug: Missing AI notes, summary, recording, transcript on voice leads

- [x] Diagnosed: voice_calls.sessionId was set to the OLD session (from a previous call) before the new lead/session was created mid-call — dashboard queries by sessionId so it found nothing
- [x] Fix: voice call record now inserted with sessionId=null, then updated AFTER all lead creation to always link to the most recent session for that phone
- [x] Fix: existing broken record (019cff18) manually corrected in DB to point to session 750002
- [x] 529/529 tests passing, 0 TS errors

## Bug: Voice agent SMS not showing in lead message thread

- [x] Diagnosed: sendSms in vapiService sent via OpenPhone but never wrote to conversationSessions.messageHistory
- [x] Fix: added appendMessageToSession() helper; called after mid-call sendSms tool (with batchSessionId from createLead) and after end-of-call follow-up SMS
- [x] Backfilled existing session 750002 with the confirmation SMS
- [x] 529/529 tests passing, 0 TS errors

## UX: Remove Slot/Address column from leads table

- [x] Remove Slot/Address column from AdminDashboard leads table to fix horizontal scrolling

## Design: World-class leads table redesign

- [x] Tight 44px rows, single dominant font size, no visual noise
- [x] Fix raw enum labels (WIDGET_SIZING → Widget Sizing, bd/ba → clean · separator or clean dash)
- [x] Status-driven row accents: booked = green left-border + #f0fdf4 tint, hover = warm coral tint
- [x] Remove Updated column (replaced with single "When" column using lastActivityAt)
- [x] Agent column: avatar initial circle (coral) + name — compact and professional
- [x] Human-readable stage labels throughout (WIDGET_SIZING added to STAGE_CONFIG)
- [x] Consistent type hierarchy: name bold text-sm, phone text-xs gray-400, service text-sm + size secondary

## Design: Table polish pass

- [x] Fix isBooked green tint: MySQL returns integer as string "1" — fixed with Number(session.isBooked) === 1
- [x] Fix "3 Bedrooms bd · 2 Bathrooms ba" → "3 bd · 2 ba" using regex replace
- [x] Tighten row height: py-3 → py-2 on all cells for denser CRM-like feel
- [x] Fix "365d ago" timestamp: cap lastActivityAt at session.updatedAt to prevent stale message timestamps from showing future/past dates
- [x] Stage badges: reduced to 11px font, tighter px-2 padding
- [x] Last Activity column: max-w-[180px] for tighter truncation

## Kanban Pipeline Board — COMPLETED

- [x] Install @dnd-kit drag-and-drop library
- [x] Build KanbanBoard component with 6 columns: New, Quote Sent, Follow Up, Availability, Booked, Lost
- [x] Lead cards: name, phone, service, quote value, time since last activity, source badge
- [x] Column headers: stage name, lead count, total pipeline value
- [x] Drag-and-drop cards between columns to update stage
- [x] Wire adminUpdateStage tRPC mutation on drop
- [x] Add Pipeline tab to AdminDashboard alongside Leads tab
- [x] 531/531 tests passing

## Click-to-Call — COMPLETED

- [x] Phone icon appears on lead row hover in Leads table
- [x] Clicking fires tel: link with lead's phone number
- [x] Icon is visually subtle on hover, doesn't disrupt row layout

## Admin → Agent Preview — IN PROGRESS

- [ ] tRPC procedure: agents.getPreviewToken — issues short-lived agent session token for admin
- [ ] Preview button in admin dashboard header: "Preview Agent View"
- [ ] Clicking opens /agent in new tab with admin signed in as agent
- [ ] Write vitest test for getPreviewToken procedure

## UI Polish Batch — IN PROGRESS

- [ ] Click-to-call phone icon on Kanban card hover (tel: link)
- [ ] Rename "History" tab/label to "Details" in lead drawer
- [ ] Notification bell widget for agents (/agent page)
- [ ] Call button inside lead detail drawer (tel: link with lead phone)

## Agent Lead Card Redesign — COMPLETED

- [x] Color-coded left border accent by stage
- [x] Name + price as dominant top row, phone secondary
- [x] Stage badge shows human-readable text (no underscores)
- [x] Single action row: Mark Booked (primary CTA) + Details + Log Call as ghost buttons
- [x] Not Interested moved to far-right icon-only button
- [x] Phone number is a tel: link for click-to-call directly from card

## Agent Drawer — Voice Call Sections — IN PROGRESS

- [ ] Add AI call history section to agent drawer (same as admin)
- [ ] Add call transcript section to agent drawer
- [ ] Add voice recording playback to agent drawer

## Kanban Drag-and-Drop Fix — IN PROGRESS

- [ ] Fix drag-and-drop so cards can be dragged between columns

## Voice AI Improvements (Round 2)

- [x] Voice: callback scheduling — Madison collects preferred callback time when transfer goes to voicemail, creates a callbackTasks record, shows pending callbacks in admin dashboard
- [x] Voice: dynamic post-call SMS — replace hardcoded template with LLM-generated message personalized to call outcome and summary

## Voice AI: Proactive Callback (No Transfer)

- [x] Remove transfer tool from Vapi assistant config
- [x] Rewrite system prompt: Madison goes straight to callback scheduling when caller asks for human
- [x] Add business-hours awareness: inject current day/time so Madison suggests correct next business morning
- [x] Madison offers two specific time slots (e.g. "9am or 10am") instead of open-ended "what time?"

## Voice Calls: Enriched Callbacks + All Calls Page

- [x] Enrich listCallbacks: join with voice_calls to include recording URL, transcript, summary on each callback card
- [x] Build /admin/calls page: all voice calls with recording player, transcript expand, summary, outcome badge
- [x] Add "All Calls" nav link in admin header

## Voice Calls: Fixes

- [x] Fix callback cards: voiceCallId not being saved — link callbackTasks to voice_calls at end-of-call
- [x] Add date filters to All Calls page (Today / Last 7 / Last 30 / All)

## Post-call SMS gate fix

- [x] Fix post-call SMS gate: remove leadCreated||sessionId condition so SMS fires for all completed calls (FAQ-only calls were silently skipped)

## All Calls: Outcome Filter + Caller Name + Missed Call SMS

- [x] All Calls: add outcome filter dropdown (booked, callback_requested, faq_answered, etc.)
- [x] All Calls: join conversationSessions to show caller name when available
- [x] Missed call auto-SMS: detect no-answer end reason, send "Sorry we missed you" SMS with quote link

## Double post-call SMS fix

- [x] Fix double SMS: end-of-call SMS now skipped when leadCreated=true (mid-call sendSms tool already ran during booking flow)

## Manual send double-message fix
- [x] Fix double manual send: added isPending guard to handleSend in AdminDashboard and AgentDashboard — prevents second mutate() call if button clicked while first request is in flight

## AI Conversation: Slot preference bug
- [x] Fix: AI ignores client's stated date preference and offers hardcoded Thursday/Friday slots instead
- [x] Fix: "tomorrow morning preferred" mapped to wrong day (Friday instead of Thursday)

## Pipeline + AI Simulator UX
- [ ] Remove "New" pipeline column (quotes go out automatically, no need for a New stage)
- [ ] Move AI simulator to robot icon button in admin header next to widget health indicator

## Post-call SMS null-summary fix
- [x] Fix: post-call SMS silently skipped when Vapi returns null for analysis.summary (FAQ/callback calls) — now falls back to transcript so SMS always fires for non-booking calls

## Source filter: Voice Call
- [x] Add "Voice Call" option to source filter dropdown in admin leads list

## Voice: Post-call SMS null-summary root cause fix
- [x] Root cause confirmed: production code had `if (normalizedPhone && summary && !leadCreated)` — Vapi returns null for analysis.summary on FAQ/short calls, so SMS was silently skipped
- [x] Fix: `callSummaryForSms = summary ?? transcript.slice(0, 600)` — transcript is always available so SMS now fires for all completed calls
- [x] Fix: normalizedPhone now falls back to structuredData.callerPhone when call.customer.number is empty
- [x] Added diagnostic logging to trace phone number resolution in end-of-call webhook
- [x] Reverted unnecessary FAQ phone-collection prompt (call.customer.number is reliably populated for direct Vapi calls)

## Voice: Phone Number Confirmation Before SMS
- [x] Madison always confirms the SMS/callback number before any tool call — reads back {{customer.number}} digit by digit if available and asks caller to confirm, or asks for the number directly if blank
- [x] FAQ close flow added: Madison confirms number, sends summary SMS, then closes the call
- [x] Callback flow updated: confirm number before scheduling callback

## Voice: New Call Notification Bell
- [x] Fire notifyOwner when call status becomes in-progress (status-update webhook) — immediate bell when call connects, showing caller phone number

## Voice: Add-ons Upsell in Booking Flow
- [x] After quoting base price, Madison asks about high-value extras (pets, oven, fridge, etc.) conversationally
- [x] Madison updates the total with any selected add-ons and states the new price
- [x] createLead tool updated to accept selectedExtras array
- [x] Extras saved to both quoteLeads and conversationSessions records
- [x] structuredDataSchema updated to extract selectedExtras from transcript (fallback path)

## Voice: Time-Aware Callback Scheduling
- [x] 8am–5pm any day: Madison offers "a few minutes" callback, still creates card in dashboard with time "today, as soon as possible"
- [x] Outside 8am–5pm: Madison offers 9am or 10am on the next available morning (same day if before 8am, next day if after 5pm)
- [x] callbackSchedulingInstructions variable injected into system prompt dynamically at call time

## Team SMS on New Lead
- [x] Send SMS to both CS (+12028885362) and secondary (+13029816191) when a voice lead is created via createLead tool
- [x] Form lead team SMS already existed; voice lead was the gap

## STOP / Opt-Out Compliance
- [x] Detect STOP/UNSUBSCRIBE/CANCEL/QUIT/END reply in incoming SMS webhook before LLM processing
- [x] Set smsOptOut=1 and stage=DONE in DB when STOP received
- [x] Send TCPA-compliant acknowledgement: "You have been unsubscribed..."
- [x] Added smsOptOut column to conversationSessions schema and migrated DB
- [x] Skip post-call SMS in end-of-call handler when smsOptOut=1
- [x] Skip mid-call sendSms tool when smsOptOut=1

## Voice Call Notification Bell Fix
- [x] Root cause: status-update handler was in dev code but never published to production
- [x] Fix is included in this checkpoint — will activate on next Publish

## Bug: All Calls Page Missing Header
- [x] Replaced minimal breadcrumb header with full admin nav tab header matching other sub-pages (Leads, Campaigns, Completed Jobs, Always-On, Sync Health, All Calls)
- [x] All Calls tab highlighted as active; NotificationBell and refresh button added to right side

## Shared AdminHeader Component
- [x] Created AdminHeader component with full logo row, widget badge, notification bell, agent view button, and all nav tabs
- [x] Used AdminHeader on AllCalls, SyncHealthPage, AlwaysOnCampaign, CompletedJobs, ReactivationCampaigns

## Voice: Live Call Transfer (Warm Handoff)
- [x] Added transferCall tool to Vapi with destination +12028885362 (Maids in Black CS line)
- [x] Madison offers live transfer during business hours (8am–5pm ET) when caller asks for a human
- [x] If transfer fails or nobody answers, Madison falls back to scheduling a callback
- [x] Outside business hours, goes straight to callback scheduling (9am or 10am next morning)

## Bug: Live Transfer Went Silent and Dropped
- [x] Root cause: missing function.parameters (destination enum) and messages array in transferCall tool definition
- [x] Fixed: added destination enum, required parameters, and request-start message with conditions per Vapi docs

## Visitor Count Fix

- [x] Fix inflated visitor count: add UNIQUE constraint on page_views.sessionKey
- [x] Fix visitorStats query to use COUNT(DISTINCT sessionKey) as fallback for historical data
- [x] Fix dailyTrend query to use COUNT(DISTINCT sessionKey) per day
- [x] Fix sourceBreakdown query to use COUNT(DISTINCT sessionKey) per source

## Bot Filter for Visitor Tracking

- [x] Add timeOnPage (int, seconds) column to page_views schema
- [x] Frontend: track elapsed seconds from mount to first interaction, send with trackPageView
- [x] Raise minimum timer from 2s to 8s before tracking fires
- [x] Server: store timeOnPage in page_views row
- [x] Count queries: filter WHERE timeOnPage >= 8 OR timeOnPage IS NULL to exclude instant bot sessions

## Revenue Attribution Dashboard

- [x] Backend: leads.revenueAttribution procedure — monthly revenue, ROI, channel breakdown, trend
- [x] Backend: include voice call stats (calls handled, avg duration, booked via voice)
- [x] Frontend: new /admin/revenue page with ROI hero card, channel breakdown, monthly trend chart
- [x] Frontend: wire Revenue ROI tab in AdminHeader nav
- [x] Tests for revenueAttribution procedure (17 tests, all passing)

## Google Review SMS Automation

- [x] Change review SMS timing: send at 10 AM ET the day after service (not 24h after upload)
- [x] Add /api/cron/review-send endpoint (10 AM ET daily, same CRON_SECRET auth)
- [x] Include review SMS count in owner notification and sync health log
- [x] Tests for new timing logic (11 tests, all passing)

## Reviews Analytics Tab

- [x] Rename "Completed Jobs" to "Reviews" in nav header
- [x] Backend: reviewRouter.analytics procedure — happiness score, trend, sentiment breakdown, service type breakdown
- [x] Frontend: Analytics tab on Reviews page with hero score, 4 stat cards, trend chart, sentiment breakdown, service type breakdown
- [x] Date range filter: 7d / 30d / 3m / 6m / all time
- [x] Tests for analytics procedure (10 tests, all passing — 570 total)

## Critical Fixes (Mar 18) — Review Cron Over-Send- [x] Disable review-send cron until timing is verified
- [x] Filter review sessions (leadSource = 'review') out of admin lead list — also filtered from funnel stats
- [x] Investigate 49 SMS over-send: root cause = 46 jobs had placeholder date 2020-01-02 from old CSV imports; fixed by adding 7-day lookback window to sendPendingReviewSmsntion

## Review SMS Manual Approval Flow

-- [x] Add reviewSkipped boolean column to completed_jobs schema
- [x] Mark all completed_jobs with jobDate < 2026-03-18 as reviewSkipped = true (44,333 rows marked)
- [x] Update sendPendingReviewSms to skip rows where reviewSkipped = true
- [x] Add pendingApproval tRPC query — count + list of PENDING jobs eligible for today's review send
- [x] Add approveDailyBatch tRPC mutation — sends the batch after admin confirms
- [x] Build approval UI on Reviews Batches tab: pending count card + customer list preview + Approve & Send button with confirmation dialog
- [x] Keep cron endpoint in code but disabled — do not schedule until manually re-enabled
- [x] Add Conversations tab to Reviews page — shows all review sessions (leadSource='review') with name, phone, date, sentiment, last reply
- [x] Backend: reviewRouter.conversations query — list all review conversation_sessions with their stage and last message

## Test Review SMS Send

- [x] Backend: reviewRouter.sendTest procedure — sends a real review SMS to a provided phone number with a fake job, creates a proper conversation session
- [x] Frontend: Test Send card on Reviews Batches tab — phone input + first name input + Send Test button with preview of sent message

## Nav + SMS Investigation (Mar 18)

- [x] Fix "Completed Jobs" label on lead page nav — should say "Reviews" (star icon added)
- [x] Investigate 3 SMS: were the 3 legitimate March 15th jobs picked up by the cron before the 7-day guard was added; March 18th jobs still PENDING awaiting manual approval

## Review Reply Bug

- [ ] Debug why review-test session replies are not getting AI responses

## OpenPhone Webhook Bootstrap

- [ ] Build bootstrapOpenPhoneWebhook function — auto-registers message.received webhook with OpenPhone API on server start
- [ ] Call it in server/_core/index.ts after server starts (same pattern as bootstrapVapiAssistant)

## Review Responses UI
- [x] Fix review SMS reply routing (webhook session priority bug)
- [x] Fix empty review AI replies (wrong template step keys)
- [x] Add OpenPhone webhook health badge to admin header
- [x] Test sends create real completed_jobs rows for full analytics flow
- [x] Redesign Conversations tab: expandable SMS thread cards, sentiment filter pills, search, TEST badge
- [x] conversations tRPC procedure includes review-test sessions and full message history
- [x] Fix sentiment filter pill counts (all showing as No Reply instead of correct categories)
- [x] Fix Customer Happiness Score card centering
- [x] Fix double SMS when sending from admin drawer (server-side dedup guard: same message within 10s is rejected)
- [x] Real-time typing indicator in conversation drawers (see who is typing)
- [x] Show sender name on outbound message bubbles in conversation drawers
- [x] Show "AI" badge on AI-generated outbound message bubbles
- [x] Fix AI badge wrongly showing on manually-sent messages (senderName not stored)
- [x] Move robot icon to left of bubble instead of below it

## HeyJade Brand Redesign (Admin/Agent Dashboard)
- [x] HeyJade brand mockup on AdminDashboard home (dark + lime green theme) — SUPERSEDED
- [x] Retheme AdminDashboard to match heyjade.co light theme (white bg, black text, lime green accent)
- [x] New hj-theme CSS system: --hj-green, --hj-bg, --hj-text, --hj-border, hj-card, hj-header, hj-tab, hj-metric-card, hj-table-wrap, hj-input, hj-btn-primary, hj-date-btn
- [x] Active tab underline changed to black; active date button changed to black fill
- [x] Login screen updated to white card with lime green icon and black Sign In button
- [x] Apply jade theme to AdminLoginScreen (dark card, lime green button/icon)
- [x] Apply jade theme to all AdminDashboard components: header, tabs, funnel stats, metric cards, search/filter bar, lead table, traffic source card
- [x] Add jade CSS utility classes: jade-input, jade-select, jade-table-wrap, jade-table-header, jade-th, jade-stat-label, jade-stat-value, jade-stat-sub, jade-stat-card--accent, --jade-accent variable

## HeyJade Light Theme — All Admin Pages
- [x] Apply hj-theme to Campaigns page (ReactivationCampaigns.tsx)
- [x] Apply hj-theme to Reviews page (CompletedJobs.tsx)
- [x] Apply hj-theme to Always-On page (AlwaysOnCampaign.tsx)
- [x] Apply hj-theme to Sync Health page (SyncHealthPage.tsx)
- [x] Apply hj-theme to All Calls page (AllCalls.tsx)
- [x] Apply hj-theme to Revenue ROI page (RevenueAttribution.tsx)
- [x] Update AdminHeader shared component to HeyJade branding (lime green J logo, black active tab underline)

## HeyJade Light Theme — Pipeline Page
- [x] Apply hj-theme to KanbanBoard component: black Call button, gray card hover border, lime-green drop zone highlight, black price values

## Lead Table Fixes
- [x] Fix lead name color — too muted/light, needs to be darker (gray-900 or black)
- [x] Fix quote price color — bright lime green (#AAFF00) is too intense on white, change to dark gray or black

## Traffic Source Section Redesign
- [x] Remove bar chart, replace with unified table + inline progress bars
- [x] Add color-coded conversion rate pills (green >40%, amber 20-40%, gray <20%)
- [x] Add best-source highlight callout card at top
- [x] Clean up typography and spacing

## Kanban Board Polish
- [x] Fix "Drop leads here" empty state — center vertically with dashed border drop zone
- [x] Hide drag handle (⋮⋮) until card hover
- [x] Add colored top border to each column matching its stage color
- [x] Improve card visual hierarchy — larger/bolder price, cleaner metadata row
- [x] Fix orange card border (drag-over state) to use gray/neutral instead of coral

## Kanban Board — New Features
- [x] Add total pipeline summary bar above board (X leads · $Y total pipeline · $Z booked)
- [x] Add "Move to Booked" quick-action button on Availability cards (hover only)

## Daily Recap Popup
- [x] Add yesterdayRecap tRPC procedure returning leads, bookings, revenue, agent stats, source stats, pending follow-ups
- [x] Build DailyRecapModal component: headline stat, funnel snapshot, agent leaderboard, best source, pending action items
- [x] Wire modal into AdminDashboard with once-per-day localStorage gate (key: recap_shown_YYYY-MM-DD)
- [x] Close only on explicit user action (X button or "Let's go" CTA)
- [x] Fix: trigger also fires when already-authed page loads (not just after login form)

## Daily Recap Modal Redesign
- [x] Switch from dark header to white/light background throughout
- [x] Use lime green (#AAFF00) as accent color for key stats and highlights
- [x] Make "Yesterday" label large and prominent (lime green pill at top)
- [x] Match overall hj-theme aesthetic (white card, clean borders, black text)

## Bug Fixes
- [x] Fix page_views DATE() grouping query error — changed GROUP BY to use alias (only_full_group_by mode)
- [x] Fix DATE() GROUP BY alias error — use full expression GROUP BY DATE(col) instead of alias
- [x] Fix DATE() GROUP BY error permanently — use LEFT(col, 10) instead of DATE(col) in all daily trend queries

## Agent Workspace Bug Fixes
- [x] Fix Claim button not visible/accessible to agents
- [x] Fix agents cannot change a Booked lead's stage to another stage
- [x] Fix TiDB only_full_group_by error: LEFT() in SELECT vs GROUP BY uses different column refs when Drizzle interpolates — fixed by using db.execute(sql\`...\`) with explicit table.column names in dailyTrend (routers.ts) and voice.stats (voiceRouter.ts)

## Bark.com Lead Integration
- [x] Schema: add barkQA text column to conversationSessions
- [x] Webhook: POST /api/webhooks/bark receiver + AI Q&A parser
- [x] Conversation engine: skip qualification for bark leads, go straight to scheduling SMS
- [x] Pipeline UI: Bark badge (green) + Q&A summary on lead cards
- [x] Pipeline filter: add "bark" to source filter dropdown
- [x] Tests: 16 bark webhook handler unit tests (all passing)

## Cleaner Quality Management System
- [x] Schema: cleaner_profiles, cleaner_jobs, job_photos, rating_sms_pending, cleaner_streaks tables
- [x] Replace completed-job SMS flow with new rating SMS queue (no duplicate)
- [x] Cron: queue rating SMS for each completed job (7pm EST same day), status=pending
- [x] Admin: Rating SMS approval queue UI (review + approve/skip before 7pm send)
- [x] Cron: at 7pm EST send all approved pending rating SMS via OpenPhone
- [x] Inbound handler: parse 1-5 rating reply, store in cleanerJobs, send follow-up for 1-3
- [x] Inbound handler: parse YES/NO "was anything missed?" reply, store missedSomething
- [x] Cleaner job dashboard (/admin/quality): daily job list from Launch27 (time, address, service, revenue)
- [x] Cleaner job dashboard: show customer rating per job (once received)
- [x] Cleaner job dashboard: photo upload per job (completion photo → S3)
- [x] Pay calculation: base pay = revenue × cleaner% + $10 for 5-star + -$20 for ≤3-star or complaint + $50 streak bonus at 10 consecutive clean jobs
- [x] Admin quality view: per-cleaner stats, flagged jobs, weekly pay summary, streak leaderboard
- [x] Tests: 21 pay calculation, rating reply parsing, and streak logic tests (all passing)

## Quality Widget & Launch27 Sync Improvements
- [x] Quality widget in AdminHeader: visible on all admin pages, quick link to /admin/quality (pulses amber when SMS pending)
- [x] Manual sync button on quality page: pulls today's jobs from Launch27 (date-aware, shows created/updated counts)
- [x] Expand Launch27 sync: pull cleaner assignment (name, team), job price, team % into cleaner_jobs
- [x] Auto-populate basePay from job price x cleaner % on sync
- [x] Auto-create cleaner_profiles from Launch27 team data on first sync
- [x] getJobsForDay procedure for quality dashboard date browsing

## Bug Fix: Quality Widget Missing from Main Admin Header
- [x] Add Quality widget to AdminDashboard inline header (the /admin page has its own header, not using AdminHeader component)
- [x] Add Quality tab link to AdminDashboard tab nav row

## Bug Fix: Synced Jobs Not Appearing on Quality Dashboard
- [x] Investigate mismatch between syncTodayJobs stored data and getJobsForDate/getJobsForDay query
- [x] Fix so synced jobs appear correctly on the quality dashboard

## Quality Dashboard Enhancements
- [x] Show service time (from serviceDateTime) on each job card next to the address
- [x] Add by-time / by-cleaner view toggle on quality dashboard

## Bug Fix: Rating SMS Approve Button Does Nothing
- [x] Debug approveAllRatingSms procedure - approve sets status but SMS not sent (working, just waits for cron)
- [x] Add sendApprovedRatingSmsNow procedure + Send Now button on dashboard to fire immediately

## Bug Fix: Send Now Returns "Send Failed"
- [x] Root cause 1: sendApprovedRatingSms tried to update completedJobs table - removed (quality jobs use cleanerJobs)
- [x] Root cause 2: QUALITY_RATING_REQUESTED and QUALITY_MISSED_FOLLOWUP were missing from conversationStages enum - added and migrated
- [x] Fix: both issues resolved, Send Now now works end-to-end

## Webhook Routing & Re-queue Button
- [x] Fixed webhook: QUALITY_RATING_FOLLOWUP renamed to QUALITY_MISSED_FOLLOWUP in both session filter and routing block
- [x] Fixed handleRatingReply: now looks up cleanerJob by cleanerJobId directly (not via completedJobId which was 0 for synced jobs)
- [x] Added requeueRatingSms procedure: resets sent/skipped rows back to pending
- [x] Added Re-queue button in Review dialog for sent and skipped items

## Job Card Star Rating & Notification Fix
- [x] Show star rating visually on job card (e.g. 4/5 stars) when customerRating is set; hidden when no rating yet
- [x] Fix complaint notification to include customer name, address, service date, rating, and cleaner name

## Bug Fix: Thank-you SMS Not Sent After Customer Rating Reply
- [x] Root cause: listPendingRatingSms only returned status=pending rows - sent items disappeared from Review dialog
- [x] Fix: listPendingRatingSms now returns ALL of today's rows (pending/approved/sent/skipped)
- [x] Fix: Review button + banner now always visible when any items exist today (not just when pending/approved)
- [x] Fix: Re-queue button always reachable after Send Now fires

## Bug Fix: Requeue + Thank-you SMS
- [x] Requeue now clears customerRating, missedSomething, flagged on the linked cleanerJob
- [x] Requeue now resets the conversation session back to QUALITY_RATING_REQUESTED (removes old reply from history)
- [x] Thank-you SMS: webhook code is correct - published site was running old version, new checkpoint forces fresh publish

## CRITICAL BUG FIX: Thank-you SMS Root Cause Found & Fixed
- [x] Root cause identified: QUALITY_RATING_DONE was missing from conversationStages enum in schema.ts
- [x] When webhook tried to set stage='QUALITY_RATING_DONE', MySQL threw "Data truncated" error
- [x] The DB update error was caught by outer try/catch, preventing sendSms from ever executing
- [x] Fix: added QUALITY_RATING_DONE to conversationStages enum in schema.ts, ran db:push (migration 0043)
- [x] Defensive fix: moved sendSms call BEFORE DB update in webhook handler so SMS fires even if DB update fails
- [x] Verified end-to-end: webhook now logs "[OpenPhone] SMS sent successfully" after customer replies "5"

## Cleaner Portal (/cleaner)
- [x] Add passwordHash column to cleaner_profiles schema, run db:push
- [x] Add cleanerAuth.ts: signCleanerSession / verifyCleanerSession (JWT cookie, CLEANER_COOKIE_NAME)
- [x] Add cleanerProcedure middleware to trpc.ts
- [x] Add cleaner router: login (phone+password), logout, me, myJobs (by date range), uploadPhoto, markComplete
- [x] Add admin procedures: setCleanerPassword, listCleaners (for admin to manage portal access)
- [x] Build CleanerPortal page (/cleaner): login form + authenticated job view
- [x] Job list: date picker, today default, date range browsing
- [x] Job cards: address, service type, time, customer name, status
- [x] Pay breakdown per job: base pay, rating adjustment, streak bonus, final pay
- [x] Customer rating display on job card (stars)
- [x] Photo upload per job (camera/file, S3 upload)
- [x] Mark job complete button
- [x] Earnings summary: total for selected day, week total
- [x] Admin: add Set Password button on cleaner profile in quality dashboard
- [x] Wire /cleaner route in App.tsx
- [ ] Write vitest tests for cleaner auth and job query procedures (pending)

## Cleaner Portal: Switch to Email+Password Login
- [x] Update cleaner.login procedure to accept email instead of phone
- [x] Update cleaner.setPassword procedure to also accept email input
- [x] Update CleanerPortal login form: phone field → email field
- [x] Update quality dashboard Set PW dialog: add email field (same as agent Create dialog)
- [x] Test email+password login end-to-end

## Job Photos in Admin Quality View
- [ ] Add getJobPhotos query to qualityRouter (fetch job_photos by cleanerJobId or completedJobId)
- [ ] Show photo thumbnails on job cards in the quality dashboard (lightbox on click)
- [ ] Test end-to-end: upload photo as cleaner, see it appear in admin quality view

## Cleaner Portal: Detailed Pay Breakdown
- [x] Redesign pay breakdown card: base pay, rating bonus/penalty, photo bonus/penalty, streak bonus, final total
- [x] Rating: +$10 if 5 stars, -$20 if 3 stars or below or customer unhappy
- [x] Photo: +$5 if uploaded, -$10 if no upload
- [x] Streak: +$50 if 10 clean jobs no issues
- [x] Show each line with label, amount (green/red), and reason
- [x] Show final total prominently at bottom

## Pay Adjustments: DB as Source of Truth + Weekly View
- [x] Audit admin quality dashboard: how/when ratingAdjustment is written to DB
- [x] Add photoAdjustment column to cleaner_jobs schema, run db:push (migration 0045)
- [x] Admin writes ratingAdjustment (+10/-20) and photoAdjustment (+5/-10) to DB when rating webhook fires; recalculates when photo uploaded
- [x] Cleaner portal reads ratingAdjustment and photoAdjustment from DB; falls back to client-side preview before rating
- [x] Add This Week tab to cleaner portal: Mon-Sun jobs, daily subtotals, weekly grand total

## Bug Fix: Total Pay not reflecting photo penalty
- [x] Fix: Total Pay in cleaner portal must always include photoAdjustment (photo penalty/bonus)
- [x] Fix: finalPay from DB may be stale (set before photoAdjustment column existed) — always recalculate display total as basePay + ratingAdj + photoAdj + streakBonus

## Admin Quality: Better Photo Presentation
- [x] Replace "Photo submitted" button with thumbnail grid (2-3 per row) in quality job card
- [x] Add lightbox modal: click thumbnail → full-size photo with prev/next navigation
- [x] Show photo count badge on the job card

## Cleaner Portal: Photos in This Week View
- [x] Show photo thumbnails on each job row in the This Week tab
- [x] Click thumbnail opens lightbox (reuse same pattern as Today view)

## Bug Fix: Photo Thumbnails Too Large
- [x] Fix admin quality view: thumbnails should be small fixed-size squares (48px), not full-width
- [x] Fix cleaner portal This Week view: same small thumbnail treatment

## Job Status System (Cleaner Portal + Admin)
- [x] Add jobStatus enum column to cleanerJobs schema (on_the_way, arrived, running_late, in_progress, completed, issue_at_property)
- [x] Run db:push (migration 0046)
- [x] Add cleaner.updateJobStatus procedure: validates transitions, auto-sets in_progress when arrived, sends owner notification for running_late and issue_at_property
- [x] Add status buttons to cleaner portal job cards with visual flow
- [x] Show status badge on admin quality job cards (color-coded, live)
- [x] Admin quality cards update when cleaner changes status
- [x] Owner notification on Running Late and Issue at Property

## Admin Quality: Status Badge Update
- [x] Update admin quality job cards to show new status labels: On the Way, Arrived, Running Late, In Progress, Completed, Issue at Property
- [x] Color-coded badges: blue (on_the_way), amber (in_progress), orange (running_late), red (issue_at_property), emerald (completed)
- [x] Issue at Property badge shows issueNote inline

## Manual Pay Adjustment
- [x] Add manualAdjustment and manualAdjustmentNote columns to cleanerJobs schema (migration 0047)
- [x] Add quality.setManualAdjustment tRPC procedure (admin-only)
- [x] Add + Adj button to each admin quality job card — opens dialog with amount + reason
- [x] Show manual adjustment line in admin quality pay breakdown
- [x] Show manual adjustment line in cleaner portal pay breakdown (visible to cleaner)
- [x] Include manualAdjustment in finalPay calculation (cleaner portal today + week views)

## UX: Remove Redundant "Completed" Status Button
- [x] Remove "completed" from JOB_STATUSES in CleanerPortal.tsx (redundant with Mark Complete button)
- [x] Keep "completed" badge in admin quality view (still useful to show the state was reached)

## Auto-Complete Status + Running Late ETA
- [x] Auto-set jobStatus=completed when cleaner taps Mark Complete (cleanerRouter.markComplete)
- [x] Add etaLabel field to updateJobStatus procedure (string, stored in issueNote as "ETA: X")
- [x] Add Running Late ETA popup in CleanerPortal: 30 min, 1 hr, 1 hr 30 min, 2 hrs, Don't know
- [x] Store ETA in issueNote field (e.g. "ETA: 30 minutes")
- [x] Show ETA on admin quality Running Late badge (via issueNote)

## On the Way ETA Picker
- [x] Show ETA picker when cleaner taps "On the Way" (same 5 options as Running Late)
- [x] Store ETA in issueNote for on_the_way (e.g. "ETA: 30 minutes")
- [x] Show ETA on admin quality card for on_the_way and running_late badges

## Admin Quality Auto-Refresh + ETA Update + Clearer Status UI
- [x] Add 30s polling (refetchInterval) to admin quality getJobsForDate query
- [x] Show a subtle "Last updated X seconds ago" indicator on the quality dashboard
- [x] Allow cleaner to re-tap active on_the_way/running_late badge to reopen ETA picker and update
- [x] Improve active status button styling: checkmark prefix, ring/scale effect, inactive buttons dimmed

## ETA Absolute Timestamp
- [x] Add etaTimestamp (bigint, nullable) column to cleanerJobs schema
- [x] Run db:push (migration 0048)
- [x] Compute arrival time on submit: now + duration minutes, store as Unix ms timestamp
- [x] Expose etaTimestamp in qualityRouter getJobsForDate
- [x] Admin quality badge shows "~9:45 AM" instead of "30 minutes"
- [x] Cleaner portal note shows "Arrives ~9:45 AM" instead of raw label

## ETA Overdue Alert on Admin Quality Cards
- [x] Amber card border + "⚠ Due Soon" badge when within 10 min of ETA (on_the_way / running_late)
- [x] Red card border + "🚨 Overdue" badge when ETA has passed (on_the_way / running_late)
- [x] Live re-evaluation using a 30s interval so cards update without page reload

## Per-Cleaner Color Accent on Job Cards
- [x] Add cleanerColor(id) helper that maps cleaner ID to a consistent accent color
- [x] Apply subtle left border stripe to each job card using the cleaner's color
- [x] Color does not override overdue/flagged red highlights (those take priority)
- [x] Color dot shown in the "By Cleaner" grouped header next to cleaner name

## Sync Notes to Admin + Cleaner Views
- [x] Expose customerNotes and staffNotes in qualityRouter getJobsForDate result
- [x] Show customerNotes (blue) and staffNotes (amber) on admin quality job cards
- [x] Expose customerNotes and staffNotes in cleanerRouter myJobs/myJobsRange (already in DB via select *)
- [x] Show customerNotes on cleaner portal job cards (amber, 📋 Customer Notes)
- [x] Show staffNotes on cleaner portal job cards (blue, 🗒️ Staff Notes)
