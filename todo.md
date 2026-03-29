# LeadFlow Quote Form — TODO

## Recently Completed

- [x] Pay Rules Settings Page — 7 configurable rules in Settings → Pay Rules tab
- [x] All pay calculations read from DB (no hardcoded values)
- [x] Photo bonus/penalty applied immediately on photo upload
- [x] Backfilled photoAdjustment for 61 existing jobs
- [x] Custom Pay Rules — add/edit/delete/toggle active rules in Settings
- [x] Custom rules shown in Cleaner Portal "How Your Pay Works" card
- [x] Unified PayBreakdownPanel on job card — all adjustments as toggleable checkboxes
- [x] All panel amounts read from Settings DB (photo, reclean, rating, streak)
- [x] Fix Settings tab bar overflow so Pay Rules tab is always visible
- [x] Admin login redirect fix (handleLoginSuccess was no-op)

## Pending

- [ ] Show net pay on job card itself (next to cleaner name, without opening panel)
- [ ] Include applied custom rule totals in weekly pay summary
- [ ] Add note field when toggling a custom rule on (audit trail)
- [ ] Add "Recalculate Pay" button for existing jobs after rule changes
- [x] Fix pre-existing TS error: runClientPreJobNotifications not exported from fieldMgmtEngine
- [x] Fix leads page: add "Google Ads Form" badge for leadSource="email"
- [x] Fix leads page: add "Google Ads Call" badge for leadSource="voice"
- [x] Fix leads page: show barkQA details (cleaning type, email, call time) in lead card detail panel
- [x] Fix leads page: add "Google Ads Form" and "Google Ads Call" to source filter dropdown
- [x] Fix voice lead session not being created (invalid stage "NEW" → "UNHANDLED")
- [x] Disable AI auto-responses for Google Ads Call leads (leadSource=voice)
- [x] Switch Google Ads Form leads (leadSource=email) from Madison to Jade AI flow
- [x] Fix auto-nudge using "Form" as name for email leads (should use "there")
- [x] Fix bedroom/bathroom parsing from Google Ads Form email body (not an issue — parsing correct)
- [x] Fix campaign fire timeout: make async with background job + progress polling
- [x] Pull full names (first + last) for all lead sources — keep first-name-only for SMS
- [x] Fix campaign blast leads showing only first name — store and use full name from reactivationContacts
- [x] Add STOP/UNSUBSCRIBE single-word detection in inbound SMS webhook — record opt-out, skip AI
- [x] Remove "Quote Form" link from conversation drawer header (waste of space)
- [x] Add previous job info (price, frequency, last job date) back to conversation drawer
- [x] Replace "Follow Up" button in drawer header with a "Status" dropdown to update stage directly
- [x] Fix: updated pay rules (bonuses/deductions) not reflecting in Cleaner Portal (JobCard had hardcoded amounts)
- [x] Audit and fix: actual pay adjustment amounts (rating, photo, reclean, streak) confirmed reading from live pay rules; fixed last hardcoded streak target note in PayBreakdownPanel
- [x] Fix cron_heartbeats resultSummary column overflow (truncate before insert)
- [x] Pin Node to exact version 22.13.0 (.node-version + package.json engines)
- [x] Audit lifecycle scripts (postinstall/prepare) across all dependencies
- [ ] Add Handover to Human / Handover to AI toggle button left of AI Assist in drawer bottom bar
- [x] Remove streamdown (pulls 130MB of mermaid/shiki/katex bloat), replace with react-markdown in AIChatBox
- [x] Color positive amounts green in Cleaner Portal job card description text
- [x] Show custom pay rules (Google Review bonus, Late penalty, etc.) in Cleaner Portal job card breakdown
- [x] Show all active custom pay rules automatically on every cleaner portal job card (not per-job application)
- [x] Redesign Cleaner Portal job card pay breakdown: 4-tile summary (Base Pay / Likely Pay / Potential Earnings / Risk Floor), status badges, downside amounts, streak progress bar
- [x] Add "View Payout Rules" button in pay summary header opening a modal with plain-language rule explanations
- [x] Update Likely Pay tile subtitle to "Best-case: 5 stars + photo bonus"
- [x] Add cleaner's first name to Payout Rules modal greeting
- [x] Add "Tips to maximize your pay" section at bottom of Payout Rules modal
- [x] Build Reactivation Engine UI page: header stats, AI Priority Queue, Lead Pipeline, Leads list, Sequences, AI Recommendation panel, Deliverability panel
- [x] Wire Reactivation Engine route and add to admin navigation
- [x] Add world-class daily bookings + revenue visualization to Reactivation Engine
- [x] Add depth-on-click lead drawer: smooth expand with full SMS thread, touch timeline, AI reasoning
- [x] Upgrade AI Recommendation panel to live AI state: "AI is acting", "Next action in 2h", "Waiting on reply", "Recycling in 14 days"
- [x] Add additional world-class UI elements to Reactivation Engine (AI Activity Feed, score rings, segment sparklines)
- [x] Add "Run Today" confirmation modal to Reactivation Engine with segment breakdown, lead counts, and projected revenue
- [x] Fix NowLine red time indicator to re-evaluate todayET on every interval tick (not just on mount)
- [ ] Fix duplicate key error for job 120003-in_progress in DayBoard swim lanes
- [x] Prevent AI from auto re-engaging booked leads — guard in webhook auto-reply, 5-min silence nudge, and scheduled circle-back cron (campaign and always-on sends are deliberate outreach, not affected)
- [x] Replace permanent isBooked guard with 30-day recency check — only suppress AI auto-replies if bookedAt is within the last 30 days
- [x] Fix AI recommendation buttons — each button now inserts the AI-written message matching its label (not hardcoded templates)
- [x] Redesign lead drawer status selector — now shows colored stage label with border and chevron icon
- [x] Replace stale "Waiting until March" tag — now shows exact follow-up date (Overdue in red if past), and lead source instead of hardcoded "Warm lead"
- [x] Replace header tags with AI-generated conversation context phrase showing where the conversation left off
- [x] Redesign Lead Snapshot card — returning customer hero block at top, source demoted to small footer pill
- [x] Shorten AI context phrase in drawer header to 4-5 word pill
- [x] Add SMS preview/confirm dialog to Hot Leads Queue SMS button — shows AI-drafted message, editable, confirm before send
- [x] Fix reassigned job creating duplicate card on DayBoard — added team-reassignment cleanup in syncTodayJobs to delete stale team rows; manually removed existing duplicate for Sarah Schultz (booking 443884)
- [ ] Persistent 30-day session cookie with maxAge (currently session-only)
- [ ] Sliding expiration — refresh cookie on every authenticated request
- [x] SMS magic link login for cleaners — generate token, send SMS, verify and set session
- [x] Send Login Link button in Field Management UI per cleaner profile
- [x] Fix magic link logging into wrong cleaner (GoGreen instead of MaidsPlus)
- [x] Extend magic link token expiry from 15 minutes to 30 days
- [x] Fix magic link: after tapping link it shows login page instead of auto-logging in (verifyMagicLink failing or MagicLinkHandler not working)
- [x] Fix magic link: first tap showed wrong cleaner (GoGreen) because existing session was not cleared before verifying new token
- [x] Extend magic link token expiry from 15 minutes to 30 days
- [x] Debug magic link: clicking link still shows login page — run end-to-end test to find exact failure
- [x] Build dedicated /auth/cleaner-callback route for magic link token exchange (separate from CleanerPortal)
- [x] Fix 404 on /auth/cleaner-callback — Express server not serving SPA for this path (was stale build; fixed by publishing)
- [x] Add magic login link to all 6 cleaner SMS messages (Pre-Job, Late-Assignment, Arrived, Mid-Job, Completion, Exception)
- [x] Remove static portal URL and email login hint from cleaner SMS
- [x] Update SMS preview text in job log UI to match new format
- [x] Update FieldManagement workflow page SMS preview text to reflect new magic link messages
- [x] Add ability to set/edit lead name from the drawer for leads with no name
- [x] Redesign drawer bottom action bar: clean layout for AI recommendation buttons, no wrapping
- [x] Add "Add Note" button to lead drawer (saves a timestamped internal note on the lead)
- [x] Show saved note visibly in drawer without clicking — amber block below header, edit pencil to modify
- [x] Label note block as "Staff note:" in the drawer
- [x] Fix drawer scroll bleeding through to the page behind it
- [ ] Fix background page scrolling when drawer is open (regression from recent changes)
- [x] Add transcript column to openphone_call_recordings table
- [x] Add call.transcript.completed webhook handler (uses OpenPhone's native transcript, no Whisper needed)
- [x] Show transcript inline in call card (AdminDashboard + AgentDashboard)
- [x] Keep audio player + transcript together in call card
- [x] Transcribe Leah Butterfield's call via Whisper and store in DB
- [x] Add callScore + scoreData columns to openphone_call_recordings schema
- [x] Add scoreCall tRPC procedure with home services AI sales rubric
- [x] Add AI Score button + score breakdown UI to call card in AdminDashboard
- [x] Add call/transcript indicator badges to lead list rows
- [x] Move AI call score breakdown from inline call card to a full popup modal
- [x] Fix scoreColor ReferenceError in AI score modal
- [x] Build CallGuide component with 6-stage home services sales playbook
- [x] Add AI objection rebuttal tRPC procedure
- [x] Integrate CallGuide widget into Agent Dashboard
- [x] Integrate CallGuide widget into Admin Dashboard (ConversationDrawer)
- [x] Move Call Guide to top nav button in AdminDashboard (next to Widget/SMS Webhook/Sync Issue/Refresh)
- [x] Move Call Guide to top nav button in AgentDashboard
- [x] Remove CallGuide from conversation drawer sidebar (now accessible via nav)
- [x] Build LiveCallAssist full-page component with 3-column layout (Quick Context, AI Suggestion card, Live Signals)
- [x] Add getLiveCallSuggestions tRPC procedure with context-aware AI generation
- [x] Register /call-assist route in App.tsx
- [x] Add Call Assist navigation from both dashboards

- [x] Live Call Assist: remove confirm-click on stage progression — clicking a stage should immediately show suggestions, not require a second click
- [x] Live Call Assist: move "What did the customer say?" field to top of center column so it kicks off the conversation
- [x] Live Call Assist: add intro/opening script at the top of the page (before any stage is active)
- [x] Live Call Assist: rewrite all 6 stage intro scripts for inbound booking calls (not cold outbound)
- [x] Live Call Assist: fix customer line input — add Enter key submit and a visible submit button
- [x] Live Call Assist: add Recap micro-stage between Value and Close
- [x] Live Call Assist: split Objection stage into quick-tap sub-types (Price, Timing, Trust, Already have someone)
- [x] Live Call Assist: clicking a suggestion logs it as agent line in conversation, clears customer input, and auto-focuses for next customer response
- [x] Live Call Assist: remove alternative suggestions — return single best AI response, update backend prompt for world-class human-sounding home service selling
- [x] Live Call Assist: strip rationale and coachingNote from AI response — return suggestion only for faster output
- [x] Live Call Assist: log customer line to transcript when Enter is pressed in the center column
- [x] Live Call Assist: update stage descriptions to inbound booking framing
- [x] Live Call Assist: keep intro script visible above AI suggestion (don't hide it when AI loads)
- [ ] Live Call Assist: reduce recap stage repetition — only show Recap once, not on every exchange
- [x] Live Call Assist: move stage-advance button to center column (not left sidebar)
- [x] Live Call Assist: add AI-suggested next stage hint so agent knows when to advance without manual guessing
- [x] Live Call Assist: remove AI auto-fire on stage click — show intro script only, AI fires only when agent types customer response
- [ ] Live Call Assist: replace context fields with bedrooms, bathrooms, address, home details (remove service type and quoted price)
- [x] Live Call Assist: AI auto-advances to next stage when it determines the current stage is complete (advanceStage flag in response)
- [x] Live Call Assist: hide intro after first customer input is submitted, never show again for that stage
- [x] Live Call Assist: remove advance delay and toast — instant stage transition, AI suggestion appears immediately
- [x] Live Call Assist: fix Situation stage looping — AI should advance after 1-2 exchanges, not keep reflecting back
- [x] Live Call Assist: fix Recap intro script — remove placeholder brackets, make it a natural fill-in-the-blanks prompt
- [x] Live Call Assist: enlarge customer input textarea — more height, more padding, not cramped at bottom of page
- [x] Live Call Assist: remove objection sub-type buttons — just show AI suggestion directly (kept buttons, removed rebuttal card)
- [x] Live Call Assist: Recap intro pulls real beds/baths/clean type from context panel
- [x] Live Call Assist: Close intro pulls real quoted price from context panel
- [x] Live Call Assist: remove pre-written rebuttal card from objection sub-types — clicking fires AI only, one clean response
- [x] Live Call Assist: Recap and Close intro scripts pull real values from context panel (beds/baths, service type, quoted price)
- [x] Live Call Assist: fix Recap intro — AI generates the mirror-back line from the transcript on stage entry (no placeholder text)
- [x] Live Call Assist: wire pricing engine to auto-calculate quoted price from beds/baths/clean type — replace free-text Quoted Price field
- [x] Live Call Assist: fix Situation stage — one direct question, advance immediately after answer, no mirroring back
- [x] Live Call Assist: change Situation question to "What's most important to you in a cleaning service?" — use answer to tailor Value pitch
- [x] Live Call Assist: Situation intro should be a natural transition from Discovery — acknowledge beds/baths then ask priority question
- [x] Live Call Assist: rewrite system prompt with Jade-style hard rules — one job, strict length, always ends with specific next step, no mirroring
- [x] Live Call Assist: remove introNote fallback from Situation/Recap/Close — show spinner only while AI loads, no stale text
- [x] Live Call Assist: fix Situation/Value/Recap blank — advanceStage was clearing suggestion before agent could read it; now shows suggestion for 3s before advancing
- [x] Live Call Assist: rewrite system prompt + stage scripts to be more human/empathetic based on AI call scoring feedback (better opener, pain amplification, value before price, assumptive close)
- [x] Live Call Assist: remove auto-advance entirely — suggestion was flashing then disappearing; agent now reads and moves manually
- [x] Live Call Assist: rebuild as continuous flow — no manual stage clicks, no auto-advance; AI tracks where you are internally and just gives the next line every time agent presses Enter
- [ ] Live Call Assist: full rebuild — world-class, high-converting, human. Type → get next line. Stages as read-only guide only.
- [x] Live Call Assist: discovery stage should ask bedrooms/bathrooms first, then clean type — not jump straight to clean type
- [x] Live Call Assist: discovery should ask bedrooms, bathrooms, AND service type (standard/recurring/move-out) all in one question
- [x] Live Call Assist: opener should immediately ask bedrooms/bathrooms/service type — not ask "what can I help you with today" when they already called for a quote
- [x] Live Call Assist: move stages to top bar, remove quick context header, fix page scroll, make input field larger
- [x] Live Call Assist: restore opener to "You called at the perfect time! How can I help you today?" — don't ask beds/baths until they confirm they want a cleaning
- [x] Live Call Assist: upgrade system prompt with world-class sales coach principles (pattern interrupt, pain amplification, value-first, assumptive close, objection-proof)
- [x] Live Call Assist: Situation stage must NEVER give price, must ask ONE emotional WHY question then advance immediately — no therapy, no follow-ups
- [x] Live Call Assist: Recap stage must mirror back what the customer said (beds/baths/service type + their WHY) — not a generic value statement
- [x] Live Call Assist: Situation stage — ONE question only, must end with a question mark, no statements, no comments, no empathy filler, fires once and advances
- [x] Live Call Assist: remove Situation stage entirely — flow goes Opener → Discovery → Value → Recap → Close → Objection
- [x] Live Call Assist: apply provided Recap and Objection prompts to those stages
- [x] Live Call Assist: transcript must show both agent (A:) and customer (C:) lines; when agent uses a suggestion, log it as agent line; pass full transcript to AI so it stops repeating itself
- [x] Live Call Assist: make intro script and AI suggestion text larger for easier reading
- [x] Live Call Assist: Value stage must deliver a real pitch with differentiators (same team, background-checked, supplies included, weekends back) — not just echo what customer said
- [x] Live Call Assist: Value stage must NOT auto-fire — wait for agent to type customer's WHY before generating the pitch
- [x] Live Call Assist: remove all stage logic from AI — pure conversation, agent types customer line, AI gives next line, stage pills are visual only
- [x] Live Call Assist: auto-advance stage pill after each AI response (AI returns currentStage, frontend updates pill)
- [x] Live Call Assist: AI must always end response with a forward-moving question — no dead-end statements
- [x] Agent drawer: add AI recommendation strip (orange pinned banner at top of conversation)
- [x] Agent drawer: add AI suggestion pills row (Primary move + alternatives that pre-fill compose)
- [x] Agent drawer: add Conversation / Flow View tabs matching admin
- [x] Agent drawer: unify compose toolbar to match admin (note icon + AI toggle + Send in one row)
- [x] Add Call Assist nav button to Agent Dashboard header (matching admin)
- [x] Verify Call Assist page uses only local React state (no shared server-side session state that could bleed between agents)
- [x] Ensure /call-assist route is accessible to agents — changed getLiveCallSuggestions and saveCallLead from adminAgentProcedure to agentProcedure
- [x] Add tRPC procedure for per-agent call stats (calls today, total calls, booked calls, conversion rate)
- [x] Add "My Calls Today" stat card to agent dashboard
- [x] Add per-agent call conversion columns to Team page (calls, booked, conversion %)
- [x] Store voice alert call recording URL in DB after call completes (already handled by Vapi end-of-call webhook)
- [x] Add tRPC procedure to fetch call recordings per job/cleaner (getJobCalls already existed)
- [x] Display call recording player in Control Tower Communication & Workflow section
- [x] Copy Magic Link button: generate token on demand if none exists (don't depend on pre-job SMS having fired)
- [x] ETA mandatory: remove "Don't know" from CleanerPortal ETA picker
- [x] ETA mandatory: add etaTimestamp to getJobsForDay select clause (server)
- [x] ETA mandatory: add etaTimestamp to getJobsForDay return object (server)
- [x] ETA display: show 🚗 ETA badge on DayBoard job blocks (on_the_way / running_late)
- [x] ETA display: show ETA banner in DayBoard detail panel (on_the_way / running_late)
- [x] ETA display: Control Tower already had ETA on job cards and detail panel
- [x] Cleaner portal: "Are you sure?" confirmation modal before Mark Complete (warn if no photos uploaded)
- [x] Cleaner portal: confirmation modal for "Completed" status button (irreversible)
- [x] Update Mark Complete modal copy: shorten irreversible note to "Once marked complete, the job is closed."
- [x] Cleaner portal: Issue at Property note is now required — Report button disabled until note has content, red border + helper text shown
- [x] On the Way: replace inline ETA picker with a blocking full-screen modal — must select ETA before submitting
- [x] Cleaner portal: "Update ETA" button on job card when status is on_the_way or running_late — reopens ETA modal
- [x] Fix voiceAlertCleaner: surface actual VAPI error in the toast instead of generic message; refactored to return reason string so toast shows the real failure cause
- [x] Expand voice alert hours from 8 AM–5 PM to 7 AM–6 PM ET
- [x] Fix VAPI 400 "property server should not exist" error on voice alert cleaner call — removed server field from payload (VAPI API no longer accepts it)
- [x] Voice alert: show "Call placed to cleaner — (XXX) XXX-XXXX" confirmation toast after successful call; shows CS fallback message if no cleaner phone on file
- [x] Fix VAPI end-of-call webhook: set serverUrl directly on the VAPI phone number via API (PATCH /phone-number) — no code change needed
- [x] B Karla phone: confirmed genuinely NULL in cleaner_profiles — needs to be added via Cleaner Profiles admin UI
- [x] Reduce VAPI maxDurationSeconds from 45s to 25s to release concurrent slots faster
- [x] Stagger cleaner voice alert calls by 30 seconds each (jobIndex * 30s offset on sleep) to prevent concurrent slot exhaustion
- [x] Tracker review flow: add reviewChipsSelected, reviewDraftPicked, reviewCopied columns to cleanerJobs schema
- [x] Tracker review flow: server procedure tracker.generateReviewDrafts (AI, uses chips + job data)
- [x] Tracker review flow: SMS trigger when job marked completed (send tracker link again with review CTA)
- [x] Tracker review flow: Step 1 — reframed 5-star rating with "$50 tip" hook
- [x] Tracker review flow: Step 2 — quick-tap chip selection + optional free text
- [x] Tracker review flow: Step 3 — AI generates 3 personalized draft options
- [x] Tracker review flow: Step 4 — pick + inline edit
- [x] Tracker review flow: Step 5 — 1-tap copy + open Google review link (https://tinyurl.com/26rjz5jn)
- [x] Tracker UI overhaul: celebratory completed state (confetti, hero moment)
- [x] Tracker UI overhaul: improved progress stepper (larger, labeled)
- [x] Tracker UI overhaul: warm team section with highlighted pill
- [x] Tracker UI overhaul: overall polish (spacing, typography, micro-interactions)
- [x] Post-review SMS: 4 & 5 star one-time customers get rebooking pitch ("Want me to grab you a spot in ~2 weeks?")
- [x] Post-review SMS: 4 & 5 star recurring customers get warm thank-you ("We'll see you at the next one!")
- [x] Post-review SMS: 1-3 star customers get customer-facing apology SMS + owner alert
- [x] isRecurringServiceType helper exported from trackerRouter for reuse
- [x] Review Tracker page: tracker.getReviewAnalytics tRPC procedure (jobs with ratings, SMS replies joined)
- [x] Review Tracker page: /admin/review-tracker route + AdminHeader nav entry ("Reviews" tab)
- [x] Review Tracker page: team leaderboard cards (avg rating, funnel %, total jobs)
- [x] Review Tracker page: funnel table (date, customer, team, rating, chips, draft picked, copied) with sort + filter
- [x] Review Tracker page: expandable SMS reply drawer per job row
- [x] Review Tracker page: vitest tests for getReviewAnalytics procedure
- [ ] Review Tracker: add reviewDraftText column to cleanerJobs, store actual draft text when picked
- [ ] Review Tracker: show "View Draft" popup on each row with the full AI draft text
- [ ] Review Tracker: update recordReviewAction to accept and save draftText
- [ ] Review Tracker: update JobTracker.tsx to send draftText when recording pick
- [ ] Review replies → Leads: add REVIEW_REBOOKING_REQUESTED/DONE stages to schema enum + db:push
- [ ] Review replies → Leads: create conversation_session before sending post-review rebooking SMS
- [ ] Review replies → Leads: wire webhook handler for REVIEW_REBOOKING_REQUESTED stage
- [ ] Review replies → Leads: show review_rebooking sessions on Leads page with "Review" badge
- [x] Review Tracker: add reviewDraftText column to cleanerJobs schema + DB
- [x] Review Tracker: store draft text when customer picks a draft (recordReviewAction)
- [x] Review Tracker: "View Draft" button on each row opens popup with full draft text
- [x] Review Tracker: REVIEW_REBOOKING_REQUESTED/DONE stages added to schema enum
- [x] Review Tracker: submitRating creates conversation_session before sending rebooking SMS
- [x] Review Tracker: webhook handler for REVIEW_REBOOKING_REQUESTED stage
- [x] Review Tracker: review_rebooking sessions appear on Leads page (only after customer replies) with "Review" badge
- [x] Review Tracker: KanbanBoard getSourceInfo updated with review_rebooking badge
- [x] Backfill reviewDraftText for March 26 "riz gamela" review (job 180002, draftPicked=3)
- [x] Review Tracker: highlight 1-3 star rows in red in the funnel table
- [x] Rebooking reply intent: detect "yes" reply → stage set to CONFIRMATION (surfaces in New Leads pipeline)
- [x] Leads pipeline: new SMS replies always surface at the top (sort by lastCustomerReplyAt desc — already implemented, confirmed working)
- [x] Review rebooking: surface ALL replies (yes/no/ambiguous) in the leads pipeline
- [x] Kanban card: add "Review Reply" badge for review_rebooking leadSource
- [x] Outbound Call Assist: appendCallToSession procedure (update existing session with transcript + outcome, no new lead created)
- [x] Outbound Call Assist: LiveCallAssist reads URL params (name, phone, bedrooms, bathrooms, serviceType, address, sessionId) and enters outbound mode
- [x] Outbound Call Assist: personalized opener line shown immediately ("Hi [name], this is [agent] from Maids in Black — we saw your request for X bed/bath...")
- [x] Outbound Call Assist: discovery stage skips re-asking known home details (pre-filled in context)
- [x] Outbound Call Assist: on clear call, appends transcript to existing session instead of creating new lead
- [x] Outbound Call Assist: "Call Assist" button in ConversationDrawer Quick Controls navigates to /call-assist with lead context params
- [x] Outbound Call Assist: remove top-of-page violet banner — replace inbound opener script inline with outbound opener in center column
- [x] Outbound Call Assist: add Call Assist button directly on leads table row (not just inside the drawer)
- [x] AdminDashboard: fix Call Assist button not visible on lead table rows
- [x] LiveCallAssist: rewrite outbound opener with world-class high-converting sales script
- [x] Leads page: add persistent Call Assist icon next to phone icon on lead table rows
- [x] CleanerPortal: post-completion modal after marking job done — earn $50 review ask + set next job on the way
- [x] CleanerPortal: separate Google Review bonus ($50) from in-app 5-star rating bonus — add pay_googleReviewBonus setting, revert fiveStarBonus to $10
- [x] syncTodayJobs: detect cleaner change/new assignment mid-day and auto-send magic link SMS to new cleaner
- [x] CleanerPortal: remove Google review URL from post-completion modal — cleaners should verbally ask client for review, not share a link (client already gets it via SMS)
- [x] maybeTriggerLateAssignmentSms: remove 2-hour window restriction — fire for any new/re-assigned job regardless of start time
- [x] maybeTriggerLateAssignmentSms: use assignment_sms step key (not pre_job_reminder) so the T-2hr cron reminder still fires independently
- [x] Fix 3 pre-existing test failures: isWithinEscalationHours boundary tests and confirmAssignment source-check
- [x] Vapi webhook: when call is answered, also send SMS to 302-981-6191 notifying that a call has been received

## OpsChat — Internal Team Communication Tool
- [x] OpsChat: audit existing job/cleaner/timeline data in DB schema and routers
- [x] OpsChat: add ops_chat_messages table to DB schema (job-scoped threads + channel messages)
- [x] OpsChat: tRPC procedures — listTodayJobs, getJobThread, sendMessage, quickAction
- [x] OpsChat: build 3-column desktop UI matching design (priority queue, job list, timeline, thread, job details, actions)
- [x] OpsChat: wire real data from DB, add /ops-chat route, protect with auth
- [x] OpsChat: write vitest tests for new procedures
- [x] OpsChat: redesign left panel to match screenshot — narrower, scrollable, full-width conversation rows, dark job cards
- [x] OpsChat: redesign right panel to match screenshot — 300px wide, JOB DETAILS label/value grid, Notes box, ACTIONS 2-col grid
- [x] OpsChat: redesign center panel — job header with status badge, timeline as colored pill chips (last 3 visible, scrollable), thread below, quick-action chips + composer at bottom
- [x] OpsChat: make Live Activity Timeline horizontal (left-to-right, oldest first, horizontally scrollable)
- [x] OpsChat: update chat bubbles to match screenshot — light grey card, sender/role top, message body, timestamp bottom-left
- [x] OpsChat: replace horizontal scrollbar on timeline with left/right arrow buttons

## OpsChat Improvements — Batch 2
- [ ] OpsChat: issue_flags table — flaggedAt, resolvedAt, resolvedBy, resolution note
- [ ] OpsChat: flag issue procedure + resolve issue procedure (agent resolves, not cleaner)
- [ ] OpsChat: escalation countdown timer on job cards in left panel (⚠️ X min unresolved)
- [ ] OpsChat: unread/unanswered red dot on job cards when last message is from cleaner/client
- [ ] OpsChat: issue photo requirement in CleanerPortal before flag is accepted
- [ ] OpsChat: resolve button in thread with resolution note input
- [ ] OpsChat: all logged-in users (agents) share same OpsChat — add to sidebar nav
- [x] OpsChat agent access — agents can log in at /admin/ops-chat using their existing email+password; opsChatProcedure accepts both owner OAuth and agent sessions; callerName resolves to agent name in messages; OpsChat link added to Agent Dashboard header
- [x] OpsChat maximize/minimize — minimize button in OpsChat header collapses to floating bubble; clicking bubble restores full-screen; works for both agents and admins
- [x] OpsChat global bubble — visible minimize button in OpsChat top bar; floating bubble persists across ALL pages via localStorage; clicking bubble navigates back to /admin/ops-chat
- [x] OpsChat inline overlay — render OpsChat as a global overlay in App.tsx (not a page route); bubble opens it full-screen over current page; Minimize button collapses back to bubble without navigation
- [x] OpsChat thread: my messages right-aligned (slate-900 dark bubble), others left-aligned (white card with border) — iMessage-style; sender name shown only on others' messages
- [x] OpsChat: avatar initials circle on others' messages (left side of bubble) — deterministic pastel color per name
- [x] OpsChat: unread badge on floating bubble — red count badge shows total unread across all channels, clears when OpsChat is opened
- [x] OpsChat: read receipts — "Seen by X" shown under your last message when another agent views the thread; ops_chat_reads table tracks per-caller last-read message
- [x] OpsChat scroll fix: thread/channel area scrollable via overflow-y-auto; duplicate scrollbars on left sidebar and right panel hidden with scrollbarWidth:none
- [x] Fix NaN messageId error from OpsChat unread badge query when no messages exist — tightened enabled guards and added ?? 0 fallback on getSeenBy queries
- [x] OpsChat timeline: color-coded pill chips (green=check-in/complete, blue=photos, red=issues, amber=on-the-way); status history + photos only; FM log and SMS removed; cleaner first name in labels; photos grouped by minute with count
- [ ] OpsChat timeline: fix missing check-in and completed events — only showing on_the_way and arrived for completed jobs
- [x] OpsChat photo upload: drag-drop or click Camera, multi-image preview strip with upload progress, S3 storage, inline image rendering in thread with lightbox viewer
- [x] OpsChat voice recording: click to start, live timer, stop to transcribe via Whisper, inserts text into composer
- [x] OpsChat emoji picker: popover on Smile button, inserts emoji at cursor position
- [x] OpsChat Flag as Needs Attention: modal with issue note, wired to flagIssue procedure, moves job to top of priority queue
- [x] Fix toPriorityStatus: flagged=1 jobs always appear in issue bucket regardless of jobStatus
- [x] Resolve Issue: button in right panel clears flag, logs resolution note, moves job back to normal status bucket
- [x] Channel composer parity: photos (drag-drop + preview strip + S3 upload), emoji picker, voice recording now in channel composer
- [x] Move Actions card to top of right panel (above Job Details) so flag/resolve buttons are immediately visible without scrolling
- [x] Right panel: Flag/Resolve as standalone card at top, Job Details middle, other action buttons at bottom
- [x] Floating chat widget: make bigger, rename to "MIB Chat", add MIB logo to header
- [x] Timeline pills: 12-hour time, strip team name, add contextual icon per event type (car, play, checkmark, etc.)
- [x] Priority queue rows clickable: tap a bucket to filter job list to only that status, tap again to clear
- [x] MIB Command Chat: rename General → MIB Command Chat, move to top of Conversations
- [x] MIB Command Chat: custom 3-column layout (Ops Snapshot + Live Alerts | Pinned Day Status + Chat thread | Auto-Raised Issues + Command Center Rules)
- [x] MIB Command Chat: auto-post alert message + card when any job is flagged
- [x] MIB Command Chat: Auto-Raised Issues panel with "Jump to Job Thread" that switches to Today tab and selects the job
- [x] MIB Command Chat: Broadcast Update chip sends SMS to all cleaners via OpenPhone
- [x] MIB Command Chat: auto-collapse left sidebar to slim icon rail when command channel is selected; expand button to restore
- [ ] Auto-post system alert to MIB Command Chat (command channel) when flagIssue is called
- [ ] Live escalation countdown on flagged job cards in sidebar (e.g. "⚠️ 12 min unresolved")
- [x] Auto-post system alert to MIB Command Chat when flagIssue is called (includes job name, job ID, issue note)
- [x] Escalation timer on flagged job cards — live "⚠️ X min unresolved" badge using flaggedAt timestamp, updates every 30 seconds
- [x] Add Photo, Voice, Emoji composer toolbar to MIB Command Chat (copy from channel composer)
- [x] Sidebar default: only auto-collapse when command channel is active; job thread always starts expanded
- [x] Clicking "Channels" tab from Jobs view defaults to MIB Command Chat with sidebar collapsed
- [x] Auto-post ✅ Resolved message to command channel when resolveIssue is called
- [x] Post ended AI call summary to command channel (caller, duration, outcome, summary, recording link)
- [x] Post review confirmation to command channel (client name, rating, team/cleaner)
- [x] Backfill Jill Caiazzo review confirmation into command channel
- [x] Fix review command-chat message: change label to "Review Received" (not Google confirmed) and include star rating
- [x] Fix AI call not posting to command channel after call completes (backfilled manually; will work automatically post-publish)
- [x] Widget chat link defaults to MIB Command Center (command channel, sidebar collapsed)
- [x] Inline audio player for call_summary messages in Command Chat (store recordingUrl in mediaUrl, render <audio> player in bubble)
- [x] Fix review message body: "Google Review Confirmed" → "Review Received" in DB and server code
- [x] Fix star rating missing on review messages in Command Chat (backfill Jill Caiazzo + verify code path)
- [x] Styled cards for review_confirmed (gold) and call_summary (blue) messages in Command Chat
- [x] Refine review + call summary cards: constrain width, more sophisticated palette
- [x] Post new leads to Command Chat as styled cards with Claim button, elapsed timer, and claimed-by attribution
- [x] Fix TypeError: extras.join is not a function in CommandChat new_lead card (extras stored as JSON string, not array)
- [x] Add Call Assist icon and Call icon to new_lead card in Command Chat
- [x] Add Today Ops / Channels pill switcher above Ops Snapshot in Command Chat left column
- [x] Add "View Conversation" icon to new_lead card in Command Chat (opens Admin Leads page with session pre-selected); improved icon spacing
- [x] Unclaimed lead escalation: auto-post nudge to Command Chat if lead sits unclaimed for 5+ minutes
- [x] Fix Today Ops: all jobs showing last name "Home" instead of actual customer last name
- [x] Command Chat: replace Raise Alert / Ask Status / Route Reminder chips with Open Issue, Set Reminder, Pin Note, Announce Booking; keep Broadcast Update
- [x] Command Chat: Open Issue modal — title + note + optional job tag → posts styled issue card to channel; resolvable from channel
- [x] Command Chat: Set Reminder modal — message + time picker (5/15/30/60 min / custom) → cron posts reminder card back to channel at trigger time
- [x] Command Chat: Pin Note — sticky note UI (amber/yellow card) pinned above thread; one active pin at a time; dismiss button
- [x] Command Chat: Announce Booking — celebratory modal with person selector + booking amount → posts confetti/glitter card to channel
- [x] Command Chat: move header, Pinned Day Status, and pin banner above the scrollable thread so chat area is taller
- [x] Command Chat: surface general_issue cards in Live Alerts & Escalations left column (with Resolve button)
- [x] Command Chat: show pending reminder count indicator in header bar
- [x] Command Chat: redesign pin banner as real sticky note (pushpin, drop shadow, lined texture, slight rotation)
- [x] Command Chat: add CSS confetti burst animation to Announce Booking card on render
- [x] Command Chat: replace horizontal scrollbar on Pinned Day Status chip strip with left/right arrow buttons
- [x] Remove Good Morning popup from admin dashboard
- [x] Command Chat: full-page glitter/confetti burst across entire viewport when Announce Booking is posted
- [x] Announce Booking: play celebration chime sound effect alongside glitter burst
- [x] Announce Booking: broadcast glitter + sound to all agents on Command Chat page simultaneously via polling
- [x] Fix GlitterBurst: animation should stop after 6 seconds, not run indefinitely
- [x] Command Chat: fix photo viewer — replace full-page takeover with proper lightbox modal (close button, ESC, backdrop click)

- [x] Command Center: draggable resize handles between columns (left/center and center/right dividers)
- [x] Command Center: collapse/expand chevron buttons on left and right side panels
- [x] Command Center: persist column widths and collapse state in localStorage
- [x] Command Center: enforce min-width guards (left ≥ 200px, right ≥ 180px, center ≥ 400px)

## Quote-Reply + Resolve-with-Note — Batch
- [x] Resolve Issue: world-class modal with original issue preview + resolution note textarea (Command Center)
- [x] Resolve Issue: post styled resolution card to thread (original issue text + resolution note + resolver name)
- [x] Resolve Issue: same modal + resolution card in Job thread (OpsChat job channels)
- [x] Quote-reply: hover reply button on any message bubble in Command Center thread
- [x] Quote-reply: quoted-message preview bar in composer (shows sender + snippet, X to cancel)
- [x] Quote-reply: send message with replyTo metadata, render indented quoted bubble above reply in thread
- [x] Quote-reply: same quote-reply UI in Job thread (OpsChat job channels)

## Quote-Reply UI Redesign (WhatsApp style)
- [ ] Replace hover reply icon button with hover dropdown chevron showing "Reply" label (WhatsApp style)
- [ ] Quoted block inside reply bubble: left-border accent, sender name in accent color, truncated snippet, full reply text below
- [ ] Apply redesign to both CommandChat and ThreadMessage (OpsChat job thread)

## Chat Enhancements Batch 2

- [ ] Quoted block accent bar: deterministic hash-based color per sender (teal/violet/amber/rose/sky/emerald/indigo/orange)
- [ ] Click quoted block to scroll to original message with brief highlight flash
- [ ] Emoji reactions: hover bubble shows 👍 ❤️ ✅ 🔥 picker, reactions stored in DB, pill counts shown below bubble
- [ ] Read receipts: mark messages as read on view, show double-tick (✓✓) with reader names on sent messages
- [ ] Apply all above to both Command Center and Job thread

## CommandChat Fixes + Profile Photos
- [ ] CommandChat: fix quoted block accent bar — make color vivid (use senderHex, not grey bg)
- [ ] CommandChat: add colored avatar initials circle next to each bubble (like OpsChat)
- [ ] CommandChat: wire emoji reactions — picker on hover, pill counts below bubble, toggleReaction server call
- [ ] Profile photos: add avatarUrl column to users/callers table, S3 upload endpoint
- [ ] Profile photos: profile settings page where agents can upload their photo
- [ ] Profile photos: show photo in CommandChat and OpsChat bubbles with colored-initial fallback

## Notification Sound + Typing Indicators

- [ ] Notification sound: source a WhatsApp-style chime, upload to CDN
- [ ] Notification sound: play on new incoming message in CommandChat (not own messages)
- [ ] Notification sound: play on new incoming message in OpsChat job thread (not own messages)
- [ ] Typing indicator: server endpoint to set/get typing presence per channel
- [ ] Typing indicator: send typing event on keypress in CommandChat composer
- [ ] Typing indicator: send typing event on keypress in OpsChat job thread composer
- [ ] Typing indicator: show animated "X is typing..." bubble at bottom of thread (WhatsApp style)
- [ ] Typing indicator: show multiple names when >1 person typing
- [ ] Typing indicator: auto-clear after 3s of no keypress

## Feature Batch 3: Issue Notes, Reminder Popups, Profile Photos

- [x] Issue cards: add/edit note inline on left-panel issue cards (both Command Center alerts and Job thread issues)
- [x] Issue cards: note persists in DB and shows on the card with pencil-edit icon
- [x] Resolve flow: styled issue_resolved card posted to thread showing original issue + resolution note + resolver name
- [x] Reminder popup: server cron checks due reminders every minute, marks them as fired
- [x] Reminder popup: client polls for due reminders, shows modal with snooze (5/15/30 min) and dismiss
- [x] Reminder popup: works for both owner (Manus OAuth) and agents (email/password)
- [x] Profile photo: add profilePhotoUrl column to agents table and users table
- [x] Profile photo: S3 upload endpoint for agents and owner
- [x] Profile photo: profile settings page / modal for agents to upload their photo
- [x] Profile photo: show profile photos in all avatar circles in CommandChat and OpsChat job thread
- [x] Profile photo: fallback to colored initial circle when no photo is set

## Feature Batch 4: Profile Photo Visibility + Issue Resolved Card

- [x] Profile photo: make upload accessible — show avatar button in sidebar even when sidebar is collapsed (collapsed mode shows icon-only nav)
- [x] Profile photo: load current user's photo on mount via getMyProfile and persist in state
- [x] Profile photo: show sender photos in OpsChat job thread message bubbles (with colored-initial fallback)
- [x] Profile photo: show sender photos in CommandChat channel message bubbles (with colored-initial fallback)
- [x] Issue resolved card: when resolveIssue is called, auto-post a styled system message to the job thread showing original issue note + resolution note + resolver name

## Bug Fixes: Avatar Layout + Profile Photo + Notification Sound

- [x] Fix: own-message avatar appearing on wrong side in ThreadMessage — causes large gap between avatar and bubble
- [x] Fix: own-message avatar appearing on wrong side in CommandChat — same gap issue
- [x] Fix: profile photo upload not saving / not displaying after upload
- [x] Fix: notification sound only fires when returning to tab — should fire immediately even when tab is in background

## Command Center Layout: Manual Issues + Remove Suggested Widgets

- [x] CommandChat: move manually-created issue cards (openIssue) to right panel under "Manual Issues" label
- [x] CommandChat: remove "Suggested Widgets" placeholder section from right panel
- [x] CommandChat: add browser OS notification (Notification API) for new messages — fires even in background tab
- [x] CommandChat: request notification permission on first interaction
- [x] OpsChat job thread: add browser OS notification for new job thread messages in background tab

## Bug Fixes: Sidebar + System Cards + Profile Photo

- [x] OpsChat: add agent status icon in collapsed sidebar that opens a popover showing all agents with online/last-seen status
- [x] OpsChat: add close button to expanded sidebar so it can be collapsed back
- [x] OpsChat: system cards (issue, issue_resolved, reminder) should align right when authored by current user, left for others
- [x] OpsChat: fix profile photo not persisting after page refresh — owner now stored in users table by openId, agents stored by email

## Bug Fixes: Agent Status Panel + Profile Photo Button

- [x] Fix: agent status panel does not open when status icon is clicked in collapsed sidebar
- [x] Fix: profile photo avatar button not visible in lower-left of collapsed sidebar for agent accounts (confirmed present by user)

## Bug Fix: Agent Status lastSeenAt

- [ ] Fix: agent status panel shows "Never logged in" for all agents — backfill lastSeenAt from recent message activity

## Bug Fix: Profile Photo Button for Agents + lastSeenAt Backfill

- [x] Fix: agents cannot see the profile photo upload button — added h-full to both sidebar containers so footer button is always visible
- [x] Fix: backfill lastSeenAt for agents from opsChatMessages history via SQL UPDATE

## WhatsApp-style Read Receipts

- [x] Replace plain text ✓/✓✓ with proper SVG double-checkmark icons (single grey = sent, double blue = seen) in OpsChat job thread
- [x] Same checkmark upgrade in CommandChat channel messages (ThreadMessage is shared)
- [x] Show "Seen by X" tooltip on hover over the blue double-tick

## Online Status Dots + Per-Message Read Receipts

- [x] Add getSeenByBulk server procedure: given array of messageIds + context, return map of messageId -> seenBy[]
- [x] Build senderStatusMap (name -> "online"|"away"|"offline") from agentStatusList in OpsChat page
- [x] Add status dot overlay to ThreadMessage avatar (green=online <=2min, amber=away <=15min, hidden=offline)
- [x] Upgrade agent status modal to 3-state: green/amber/grey with coloured status text and wifi icon
- [x] Replace single-message seenBy query with bulk getSeenByBulk — show tick on every sent message
- [x] Pass senderStatusMap into ThreadMessage for both job thread and channel views

## Bug: Profile photo not appearing in message avatars
- [x] After uploadProfilePhoto succeeds, invalidate getAllAgentPhotoMap + getMyProfile cache so bubbles refresh immediately
- [x] Also invalidate agentStatusList (it also carries photoUrl)
- [x] DM unread badge on agent status button (red count badge when unread DMs exist)
- [x] DM notification sound — plays chime when new DM arrives in closed panel
- [x] Fix TS errors: moved DM unread query/effect after callerName and playNotification declarations
- [x] Fix notification sound not playing for regular chats (job threads + command channel)
- [x] Swap chat bubble colors: my messages = dark navy, others = light grey (OpsChat, CommandChat, DmPanel)
- [x] Fix DM send/receive not working between users — email-based thread keys, no more name slug mismatch
- [ ] Allow agents to edit customer name in job drawer (currently admin-only)
- [ ] Add price field to admin job drawer (agents have it, admin drawer is missing it)
- [ ] Allow agents to add/edit phone number in job drawer
- [x] Allow agents to edit customer name in drawer (removed adminAgentProcedure gate from updateLeadName)
- [x] Add Booked Amount input to AdminDashboard drawer (was declared but never rendered in JSX)
- [x] Allow agents to edit phone number in both AdminDashboard and AgentDashboard drawers (new updateLeadPhone procedure)
- [x] Add SMS drawer link button to new lead cards in CommandChat (next to call + call-assist icons), fix icon row spacing
- [ ] Background push notifications + sound for DMs and chats when tab is not focused (Service Worker + Web Push API)
- [x] Replace "Command Center Rules" static text in right panel with live "Hot Leads" tray
- [x] Hot Leads tray: derive unclaimed new_lead messages from channelMsgs prop (no new query needed)
- [x] Pulsing amber ring animation on unclaimed lead cards in the tray
- [x] Live time-to-claim counter on each tray card
- [x] Claim button on tray card — calls existing claimLead mutation, stops pulse on success
- [x] Claimed cards show agent name + claimed time, no longer pulse
- [x] Tray shows empty state when no unclaimed leads
- [x] Add Call Assist button to Hot Leads tray cards (matching the chat card's Wand2 icon)
- [x] Backfill last new_lead message arrivedAt to now so it shows in the 8h tray window
- [x] Fix Hot Leads tray Call Assist button to open outbound call flow (not inbound)
- [x] Fix Hot Leads tray SMS button to open the drawer directly on the lead (not the leads list)
- [x] Fix emailLeadWebhook: look up sessionId after session insert and include it in new_lead metadata (email/form leads)
- [x] Fix emailLeadWebhook: look up sessionId for missed call leads and include in new_lead metadata
- [x] Fix barkWebhook: post new_lead card to command channel after session creation (Bark leads never appear in tray)
- [x] Hot Leads tray: time-to-claim timer turns amber at 2 min, red at 5 min on unclaimed cards
- [x] Unclaimed Hot Lead cards shake animation until claimed
- [x] Repeating sound notification every 60 seconds while any unclaimed lead exists
- [x] Show live lead status (booked/lost/etc.) on new_lead cards in chat feed and Hot Leads tray
- [x] Join session status at query time so status updates in AdminDashboard reflect on cards immediately
- [x] Hide mid-conversation stages from stage dropdown in admin drawer (show outcome-level only)
- [x] Hide mid-conversation stages from stage dropdown in agent drawer (show outcome-level only)
- [x] Update Hot Leads tray to show NOT_INTERESTED and FOLLOW_UP_SCHEDULED bands
- [x] Fix Cold→Lost display bug: setting stage to Cold shows as Lost on tray card
- [x] Add icons + sub-label explanations to each outcome stage in the dropdown
- [x] Ensure tray card band shows exact stage label (not a mapped/overridden value)
- [x] Remove Not Interested and Future Booking from outcome stages everywhere
- [x] Add VOICEMAIL outcome stage to Stage type, STAGE_CONFIG, OUTCOME_STAGES, tray band, server z.enum
- [x] Change Booked icon to dollar sign, Lost icon to sad face in tray band and dropdown
- [x] Add lost reason quick-select in drawer when Lost stage is selected
- [x] Verify all 5 outcome stages wire correctly from drawer → DB → tray card
- [x] Fix agent drawer: stage dropdown hidden behind isAdmin guard — show to all agents via agentUpdateStage procedure
- [x] Delete lead from drawer should also remove the corresponding hot_lead card from the command channel tray
- [x] Fix CommandChat + OpsChat bug: navigating back to command chat fires notification sound and fast-scrolls the page
- [x] CommandChat: restore scroll position when re-opening chat (currently jumps to top)
- [x] CommandChat: message history cut off — load more messages beyond the current limit (raised to 500)
- [x] Fix OpsChat scroll position not restoring on re-open (still jumps to top)
- [x] Yelp lead flow: parse Yelp inquiry emails via Zapier, post Command Chat alert card (no SMS — no phone number from Yelp)
- [x] Yelp leads: create placeholder conversationSession (no phone) so they appear in Leads list with Yelp badge
