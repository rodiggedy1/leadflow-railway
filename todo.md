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
- [x] "Contacted via Yelp Biz" button in Admin and Agent lead drawers for Yelp sessions (YELP_CONTACTED stage)
- [x] Fix notification sound firing every few seconds (removed 60s repeating interval in CommandChat)
- [x] Add Wistia video embed under title on QuoteForm with world-class UI
- [x] CommandChat: hide Announce Booking button, add Away status popover that posts status to chat
- [x] Away status: 4 options with styled chat cards (Away for a sec, Lunch break, Back in 15, EOD/Signing off)
- [x] Away/I'm Back toggle: button changes after Away selected, I'm Back posts card and resets
- [x] Auto-post I'm Back card on first keystroke while Away
- [x] Coloured status dot on agent avatars in Command Chat sidebar (agentStatus in DB)
- [x] Fix: I'm Back toggle not showing (myAwayStatus not being read correctly)
- [x] Fix: Auto-return on typing not firing while Away
- [x] Away banner: persistent amber strip at top of OpsChat showing all away agents + reason, disappears when all are back
- [x] Fix: away banner not visible to other users — reduced poll to 15s, staleTime 0, enabled guard correct
- [x] Fix: HTTP 414 on getReactions — converted from query (GET) to mutation (POST) so IDs go in body not URL
- [x] Fix: duplicate notifications when multiple tabs open — useTabLeader (BroadcastChannel) elects one leader; CommandChat duplicate removed; SW PLAY_SOUND gated to leader only
- [x] Fix: notification sound leaking — (1) OpsChat only mounts after first eligible route visit so quote form never gets sound hooks; (2) SW PLAY_SOUND now filtered to /admin|/agent|/call-assist tabs only
- [x] Fix: "📞 Call received" SMS firing on outbound FieldMgmt/LeadAlert calls — added phoneNumberId + business number guard to status-update handler
- [x] Vite manualChunks: split index vendor bundle from 1.36MB into 7 named chunks, largest is now 384KB
- [ ] Fix: notification sound not playing when OpsChat tab is closed (regression from sound-leak fix)
- [x] URGENT: quote form broken — vendor-react chunk caused dual-React conflict with Manus runtime injection; React moved back into index chunk
- [ ] Fix: video on quote page freezes at ~10 seconds
- [x] Fix notification sound regression — root cause: AudioContext was never created because the gesture-unlock listener required a click inside the hidden OpsChat overlay (display:none when minimized). Agents never triggered it, so ctx stayed null and every playSound() call silently failed. Fixed by replacing AudioContext with new Audio() + cloneNode() pattern — simpler, reliable, and works without any gesture-gating since agents have already interacted with the page.
- [x] Fix OpsChat autoscroll — last message is half-hidden or cut off when new message arrives; scroll must land with the message fully visible plus breathing room
- [x] Fix notification sound — still not playing after new Audio() rewrite; simplified to bare new Audio(CHIME_URL).play() on every call, no pre-load, no cloneNode, no AudioContext
- [x] Fix tRPC procedures on Home page (/) returning HTML instead of JSON — root cause was a transient 502 during server restart (vite.config.ts change at 15:45 UTC), not a code bug. Build and TypeScript are clean. No code changes needed.
- [x] Fix duplicate "I'm Back" notifications — added imBackFiredRef guard in CommandChat (prevents button + keystroke from both firing) and server-side dedup in sendMessage procedure (skips insert if same author posted away_status:back within last 10s). Also fixed pre-existing flaky test that made a real VAPI network call.
- [x] Auto-dismiss away status banner after 15 min for eod and back15 statuses only; other statuses stay until manually cleared. Added awaySetAt column to agents table, set it on setAwayStatus, returned it from getAgentStatusList, and filter in AwayBanner with 30s tick interval.
- [x] Restyle Photo/Voice/emoji buttons in CommandChat and OpsChat to pill-shaped with border and emoji+label treatment
- [x] Add Thumbtack Zapier webhook connection — POST /api/webhooks/thumbtack, mirrors Bark handler, AI extracts job details, sends intro+scheduling SMS, creates session with leadSource="thumbtack", posts 📌 card to command channel
- [x] Parse Thumbtack "New direct lead" email notifications — detect subject "New direct lead", extract name/phone/service/description from email body, route into lead pipeline with leadSource="thumbtack"
- [x] Thumbtack leads must appear on the Leads page — session now always created regardless of phone; no-phone case uses thumbtack-{timestamp} placeholder key and aiMode=0 so AI doesn't try to SMS
- [ ] Add "First Message Generator" quick-action button in Command Chat left column — paste booking details, AI generates first outbound message using the provided template, one-click copy to clipboard
- [x] First Message Generator — AI tool in Command Chat left column: paste booking details, generate personalized first outreach message, copy to clipboard
- [x] Replace Call Assist Wand2 icon on Yelp/Thumbtack lead cards with First Message Generator modal (pre-filled with lead details); remove standalone button from left column
- [x] Claiming a lead in Command Chat should also mark it as claimed in the Lead List (sync claimedBy/claimedAt to conversation_sessions or leads table)
- [x] Parse inbound Thumbtack SMS opportunity alerts ("New Thumbtack opportunity: ...") and auto-create a lead in the pipeline with leadSource="thumbtack-sms"
- [x] Relabel "thumbtack-sms" as "Thumbtack Opportunity" in Lead List and lead cards display labels
- [x] Lead drawer: make Thumbtack short URL in system message clickable (auto-linkify URLs in message history)
- [x] Lead drawer: add First Message Generator wand button pre-filled with lead details
- [x] Fix 2 bed/2 bath quote calculation (currently showing $404, needs to be corrected)
- [x] When client says "today" for availability, AI should offer only afternoon slot (not morning), and phrase naturally
- [x] Fix quote pricing: align engine/pricing.ts to use flat surcharge model (same as openphone.ts estimatePrice), quote base price only with no extras/add-ons
- [x] When client says "today" for availability, AI should offer only afternoon slot (not morning), phrased naturally
- [x] Thumbtack SMS duplicate detection: if same name+service+city arrives within 24h, drop the duplicate and add a note to the existing session instead of creating a new one
- [x] Command Chat: thumbtack-sms new_lead card header should say "New Thumbtack Opportunity" not "NEW LEAD"
- [x] Command Chat Hot Leads tray: show city for thumbtack-sms leads (currently missing)
- [x] Hot Leads tray card: show "New Thumbtack Opportunity" label for thumbtack-sms leads (currently missing from the card header)
- [x] Deleting a lead from the Lead List should also remove its card from the Command Chat Hot Leads tray
- [x] Fix bug: replying to long messages fails in Command Chat and Job Chat
- [x] Web Push: generate VAPID keys and store as secrets
- [x] Web Push: push_subscriptions table in schema + db push
- [x] Web Push: server endpoints to save/delete subscriptions
- [x] Web Push: trigger push when new ops/job/command message saved
- [x] Web Push: SW push event handler — show notification + play reminder chime
- [x] Web Push: client-side subscription registration on ops pages only (not quote page)

## SSE Real-Time Migration

- [x] Add SSE proof-of-concept test endpoint (/api/sse-test) to Express server
- [x] Add SSE test UI page (/sse-test) to frontend to verify proxy compatibility
- [x] Deploy and verify SSE events flow through Manus hosting proxy (PASS — pings every 2s, no buffering)
- [x] Full SSE migration for Command Chat (getCommandChatData, listChannelMessages, listTodayJobs)
- [x] Add live "Today's Revenue" ticker to Command Chat header

## SSE Full Migration (proxy confirmed PASS)

- [x] Build SSE broadcast hub (server/sseBroadcast.ts) — typed event emitter + client registry
- [x] Add GET /api/ops-stream SSE endpoint — streams ops_update events to authenticated agents
- [x] Wire broadcast calls into sendMessage, flagIssue, resolveIssue, claimLead, markComplete mutations
- [x] Replace getCommandChatData polling (20s) with SSE-triggered refetch
- [x] Replace listChannelMessages polling (15s) with SSE-triggered refetch
- [x] Replace listTodayJobs polling (30s) with SSE-triggered refetch
- [x] Replace getReactions polling (10s) with SSE-triggered refetch
- [x] Add useOpsStream hook — manages EventSource lifecycle, reconnect, and refetch dispatch
- [x] Add live Today's Revenue ticker to Command Chat header

## SSE Rate Limit Fix

- [x] Fix SSE auth to use local JWT verification only (no OAuth server round-trip)
- [x] Add exponential backoff reconnect with jitter on the client useOpsStream hook (5s min, 60s max)
- [x] Verify no rate limit errors after fix

## Auto-Scroll Fix

- [x] Fix CommandChat scroll: replace double-rAF + scrollHeight with sentinel div + scrollIntoView
- [x] Fix OpsChat channel scroll: same sentinel pattern
- [x] Fix OpsChat job thread scroll: same sentinel pattern
- [x] Increase isNearBottom threshold to 250px so it catches more "close enough" cases

## New Message Toast (WhatsApp pattern)

- [x] Add floating "↓ New message from X" toast to CommandChat when scrolled up
- [x] Add same toast to OpsChat job thread view
- [x] Add same toast to OpsChat channel view

## Bug Fixes (2026-03-30)

- [x] Fix server crash returning HTML instead of JSON — wrapped getSeenByBulk + getDueReminders in try/catch
- [x] Fix chat scroll-on-entry: added ResizeObserver on composer textarea to re-pin scroll when typing

## Scroll Layout Fix (shrink-0 on composer)

- [x] Add shrink-0 to CommandChat composer div so it never steals height from scroll container
- [x] Remove overflow-hidden from CommandChat relative wrapper that was clipping scroll container
- [x] Add shrink-0 to OpsChat job thread composer div
- [x] Add shrink-0 to OpsChat channel composer div

## Scroll Sentinel Fix (Pin Note / Away pills blocking bottom)

- [x] Fix CommandChat scroll: observe scroll container itself (not just composer) so any height change re-pins to bottom
- [x] Fix OpsChat job thread scroll: same fix — observe both scroll containers + composer
- [x] Fix OpsChat channel scroll: same fix
- [x] Raise near-bottom threshold to 400px to account for composer growth

- [ ] Add manual lead creation: modal with name, phone, email, service type, notes, amount, status, source (Yelp/Google/Thumbtack/Bark/Phone/Other); creates lead + conversationSession, posts new_lead card to CommandChat, auto-claims for adding user, invalidates leads.list

## Apply Form + Hiring Pipeline Integration

- [x] Fix duplicate US state keys (VA, MD) in Apply.tsx US_STATES array
- [x] Investigate and fix tRPC JSON parse error on /apply page (was missing trpc import)
- [x] Create candidates table in DB schema (drizzle/schema.ts)
- [x] Create submitApplication tRPC mutation (publicProcedure)
- [x] Create getCandidates tRPC query (protectedProcedure)
- [x] Wire Apply form to call submitApplication on final step
- [x] Display real candidates from DB in /admin/hiring pipeline board

## Apply Form — Validation + Video Interview

- [x] Basic Info: require firstName, lastName, phone before Continue (inline error messages)
- [x] Requirements: require at least one Yes/No answer before Continue
- [x] Video step: real browser MediaRecorder — countdown, live preview, stop, playback, re-record
- [x] Video step: upload recorded blob to S3 and save URL on submitApplication

## Hiring Pipeline — Video Playback

- [x] Return videoUrl from getCandidates tRPC query
- [x] Add videoUrl field to Candidate type in HiringPipeline.tsx
- [x] Show video player in candidate detail panel when videoUrl is present

## Hiring Pipeline — Application Details Popup + Photo Avatar

- [x] Add bioPhotoUrl, hasCleaning, hasBankAccount, isAuthorized, consentBackground, specialties, phone, email to getCandidates response
- [x] Update Candidate type in HiringPipeline.tsx with all new fields
- [x] Show bio photo (or initials fallback) on kanban card avatar
- [x] Show bio photo (or initials fallback) on detail panel header avatar
- [x] Add "View Application" button in detail panel that opens a popup modal
- [x] Popup modal shows all submitted fields: contact info, Yes/No answers, specialties, experience

## Bug Fixes — Hiring Pipeline

- [x] Fix bio photos not appearing on kanban card and detail panel avatars
- [x] Fix double-selection highlight (two cards appear selected at once)

## Bug Fix — Bio Photo Not Saving

- [ ] Trace why bioPhotoUrl is null in DB after submission and fix the upload flow

## AI Scoring on Applications

- [x] Add aiScore (int) and aiSummary (text) columns to candidates table
- [x] Call LLM in submitApplication to generate score + summary from application data
- [x] Return aiScore and aiSummary from getCandidates
- [x] Show aiScore badge on kanban card with color coding (green/amber/red)
- [x] Show aiSummary in detail panel AI Summary section

## Bug Fix — AI Scoring Stuck

- [x] Debug why LLM scoring never writes to DB (stuck on "Scoring..." forever) — was pre-existing candidate; added rescoreCandidate mutation + Re-score button

## Apply Page — Wistia Video

- [x] Replace video placeholder on welcome step with Wistia embed (hwmi77abbz)
- [x] Add Wistia player.js script to index.html head

## Apply Welcome Step — Layout

- [x] Move Start Application button directly below the video (above the fold)

## Navigation

- [x] Add Hiring link to top nav bar (admin-only, links to /admin/hiring)

## Hiring Pipeline — Drag & Drop

- [x] Install @dnd-kit/core and @dnd-kit/utilities
- [x] Wrap kanban board in DndContext with column drop zones
- [x] Make candidate cards draggable (useDraggable with 8px activation distance)
- [x] On drop, call updateStage mutation and optimistically update UI (with rollback on error)

## Apply Page — Mobile Responsive

- [x] Replace fixed sidebar nav with top progress bar on mobile (hidden on sm, shown on md+)
- [x] Stack two-column layouts vertically on mobile
- [x] Ensure all inputs/buttons have min 44px touch targets
- [x] Fix Wistia video aspect ratio on mobile
- [x] Fix specialty grid to single column on mobile
- [x] Fix video recorder layout on mobile

## AI Video Interview Page

- [x] Create /interview/:candidateId page with Zoom-style layout (big AI video, PiP self-view)
- [x] Integrate VAPI voice agent for conversational AI interview questions
- [x] Save transcript and AI score to candidate DB record
- [x] Add "Start AI Interview" button in hiring pipeline detail panel
- [x] Add route in App.tsx for /interview/:candidateId
- [x] Fix "Could not load interview configuration" error on deployed /interview/:candidateId page
- [x] Rebuild interview page: Start button (not auto-start), waveform visualizer, camera recording + S3 upload, allow retesting
- [x] Add saveInterviewVideo tRPC procedure to save recorded camera video URL to candidate record
- [x] Hide AI Interview button for mock demo candidates (id >= 10000)
- [x] Show recorded interview video in hiring pipeline candidate detail panel (playable video player)
- [x] Add separate interviewVideoUrl column to candidates table (distinct from application videoUrl)
- [x] Show Interview Recording thumbnail in detail panel separate from application video
- [x] Fix VAPI call connection on AI interview page so it actually connects and runs to completion
- [x] Fix camera recording only saving 5 seconds — full interview duration not being captured

## Hiring SMS Flow
- [x] Add INTERVIEW_LINK_SENT, INTERVIEW_NUDGE_1, INTERVIEW_NUDGE_2, INTERVIEW_LINK_DONE stages to schema + db:push
- [x] Auto-send interview link SMS on application submission
- [x] Wire "Do it later by text" button on thank you page
- [x] Schedule 2-hour nudge if interview not completed
- [x] Schedule next-morning final nudge if still not completed

## Hiring Notifications & SMS Copy
- [ ] Update 2-hour nudge SMS copy to include "Jade from Maids in Black"
- [ ] Update next-morning nudge SMS copy to include "Jade from Maids in Black"
- [ ] Build hiring notification card in Command Chat (applicant photo, name, link to hiring page)

## Applicant Magic Link Status Page
- [x] Generate signed JWT status token on submitApplication (30-day expiry)
- [x] Add hiring.getApplicantStatus(token) public tRPC procedure
- [x] Build /hiring-status/:token page matching design (two-column layout)
- [x] Send status page link SMS on submission (second SMS after interview link)
- [x] Stage-change SMS confirmation popup in hiring pipeline
- [x] Stage-change SMS messages for all stages (Real Interview, Background Check, Paid Test Clean, Onboarding, Rejected)

## Bidirectional Claim Sync
- [x] agents.claimLead: also update matching opsChatMessages.metadata (claimedBy/claimedAt) and broadcast lead_update
- [x] agents.unclaimLead: also clear claimedBy/claimedAt from matching opsChatMessages.metadata and broadcast lead_update
- [x] adminAssignAgent: also update matching opsChatMessages.metadata and broadcast lead_update
- [x] CommandChat claimLeadMutation onSuccess: also invalidate opsChat.listChannelMessages so hot leads tray refreshes
- [x] AgentDashboard claimLead/unclaimLead onSuccess: also invalidate opsChat.listChannelMessages
- [x] OpsChat onLeadUpdate: also invalidate opsChat.listChannelMessages so hot leads tray refreshes on SSE

## Magic Link Tracker Stage Mapping Fix
- [x] Fix HiringStatus.tsx STAGE_TO_STEP to use actual DB stage values (display names like "AI Interview", "Application Submitted", etc.) instead of uppercase enum keys
- [x] Fix Stage type and getCtaContent switch to use the same display name values

## New Application Card Not Appearing in Command Chat
- [x] Fix submitApplication: insert new_application card into channel "command" not "general"
- [x] Also broadcast lead_update SSE after inserting so the card appears instantly without a page refresh

## Call Assist Deepgram Live Mode
- [x] Install @deepgram/sdk on server
- [x] Build server WebSocket endpoint /api/deepgram-stream that proxies audio to Deepgram streaming ASR with diarization
- [x] Build useLiveTranscript hook in client that captures mic audio and streams to server WebSocket
- [x] Add Live Mode toggle and teleprompter UI to LiveCallAssist
- [x] Wire customer-only transcript lines to AI suggestion generation
- [ ] Deterministic stage advancement based on collected fields (not AI-driven)

## Call Assist — System Audio / Loopback Capture
- [x] Research getDisplayMedia system audio API and browser support
- [x] Mix mic + system audio tracks into a single AudioContext for Deepgram
- [x] Add audio source selector UI (Mic only / System audio / Both)
- [x] Handle permission denial gracefully with clear user instructions
- [x] Redesign command center navigation with icons (Ops / Chat / CS) and make it accessible from all admin pages

- [x] Filter cs-inbound and cs-inbound-cleaner sessions from all commandCenterRouter queries (13 query locations)
- [x] Filter cs-inbound and cs-inbound-cleaner sessions from daily summary query in routers.ts
- [x] Verify leads.list and leads.stats already had cs-inbound filter in place
- [x] Confirm TypeScript compilation passes with zero errors (tsc --noEmit exit 0)

- [ ] Filter cs-inbound / cs-inbound-cleaner sessions out of leads view
- [ ] Filter window cleaning and carpet cleaning sessions out of command center and hot leads
- [x] CS inbox: 6 AI-smart quick-reply buttons (Send quote, We'll make it right, Refer a friend, Running late, On the way, Review + rebook) — each reads conversation tone and generates a contextual draft
- [x] CS inbox: tone indicator badge on each conversation (Frustrated, Happy, Urgent, Neutral, etc.)
- [x] CS inbox: AI Suggest button — analyzes full conversation, recommends best action, pre-fills draft
- [x] CS inbox: auto-populate compose box with AI draft when agent opens a conversation
- [x] CS inbox: emoji picker button in compose area
- [x] CS inbox: red unread message counter badge on CS tab
- [x] CS inbox: Launch27 deep links on recent history booking items
- [ ] Investigate why inbound SMS to 202 CS number are not appearing in CS inbox
- [ ] Add MMS photo rendering in CS chat thread
- [x] CS inbox: MMS photo rendering inline in chat thread
- [ ] CS inbox: Ops/Chat/CS tab switcher above conversation list
- [ ] Auto-close left sidebar when switching back to Chat tab
## @mention Awareness System (Command Chat)
- [x] useMissedTags logic — tracks unread @mentions using localStorage (cmd_lastSeenMsgId_{callerName})
- [x] Re-entry banner — amber sticky strip at top of conversation thread: "You were mentioned in X messages" + Jump + Dismiss
- [x] Message highlights — amber left border on tagged messages in the conversation thread
- [x] Live floating pill — violet pill slides up from bottom when tagged while chat is visible, auto-dismisses after 7s
- [x] Sidebar badge — violet number badge on Chat tab showing unread @mention count

## Bug Fixes (Apr 1)
- [x] Fix @mention awareness: use myNames set (all possible names) for multi-name matching; fix prevTagCountRef to start at -1
- [x] Fix CS inbox: add syncCsOutboundMessages (polls OpenPhone API after each inbound); add "Sync OpenPhone" button in CS thread header
## Team Magic Link in CS Chat
- [x] Add "Team actions" card to Teams panel in CS inbox right sidebar
- [x] "Send magic link" button — generates cleaner portal one-tap login link and sends via SMS
- [x] "Copy magic link" button — generates link and copies to clipboard
- [x] Graceful fallback message when no cleaner profile is linked to the conversation
## CS Chat Photo Lightbox
- [x] Replace anchor-download behavior with click-to-enlarge lightbox for received MMS photos
- [x] Lightbox: full-screen dark overlay, close on backdrop click or X button, open-original button (top-left)
- [x] Thumbnail cursor changed to zoom-in to signal enlargeable

## CS Chat: Three New Features
- [x] Multi-photo swipe in lightbox — left/right arrows + keyboard nav when message has multiple photos
- [x] Phone icon next to customer number — initiates OpenPhone call via deep link
- [x] Start SMS from scratch — "New SMS" button opens dialog to send first message to any phone number

## CS Inbox UX Improvements (Apr 2)
- [x] Styled tooltips on icon-only buttons in CS thread header
- [x] Auto-sync OpenPhone messages when a conversation card is selected

## CS Chat Permissions Fix
- [x] Switch all CS procedures from protectedProcedure (owner-only) to opsChatProcedure (agents + owner)
  - listCsInbox, getCsUnreadCount, resolveSession, updateCsName, updateCsQueue, backfillCsNames
  - getCleanerTodayJobs, getCleanerProfileByPhone, getClientProfile, csQuickReply, batchResolveNames
  - getMagicLink (cleanerRouter)

## CS Chat Typing Indicator
- [x] Port existing typing indicator to CS chat (useTypingIndicator hook + TypingBubble, channelKey = cs:${sessionId})
- [ ] Replace TypingBubble with amber warning banner above compose box when another agent is typing (non-blocking, keeps AI draft editable)
- [x] Tweak CS chat AI suggestion prompt for Teams queue: cleaner context (access issues, job size, callouts, field mgmt questions) instead of client context
- [x] Improve CS chat AI suggestion tone: high-energy, presumptive, human — read full conversation intent, advance rather than re-ask decisions already made
- [x] Rebuild CS chat AI prompt with expert SMS tone principles: no price hallucination, no cringe phrases, world-class human energy
- [ ] Fine-tune CS chat AI prompt: add genuine warmth and excitement (client inviting us into their home), not cold/dry, not fake corporate
- [ ] Rebuild CS chat AI prompt with 10 real brand-voice few-shot examples from owner

## CS Chat Teams Job Card Enhancements
- [ ] Make job card clickable to open job details drawer (notes, client info, job details)
- [ ] Add call widget button on job card (click-to-call cleaner)
- [ ] Add SMS widget button on job card (quick SMS to cleaner)
- [ ] Add Launch27 booking link on job card

## CS Chat Teams Job Card Enhancements
- [x] Make job cards clickable to open full job details drawer (notes, checklist, status, client info)
- [x] Add Call client widget on job card (tel: link to customer phone)
- [x] Add SMS client widget on job card (sms: link to customer phone)
- [x] Add Launch27 booking link on job card (opens booking in new tab)
- [x] Replace tel: links with openphone://dial?number= in CS chat call buttons
- [x] Fix all call buttons to use openphone://call?to= scheme across entire app (CsInbox, CommandChat, OpsChat, AdminDashboard, AgentDashboard, KanbanBoard, DailyRecapModal, ControlTowerTab)
- [x] Add {recurringprice} placeholder (price minus 15%) to buildJadePriceReveal substitution in aiService.ts
- [ ] Audit and fix entire Jade widget flow to use DB templates instead of hardcoded strings throughout all stages

- [x] Follow-ups modal: add follow_ups DB table (id, name, nextStep, dueAt, owner, type, priority, internalNote, customerFacingMove, history JSON, completedAt, reminderSentAt)
- [x] Follow-ups modal: tRPC procedures — list, create, complete, addNote
- [x] Follow-ups modal: wire FollowUpsModal to real DB (replace mock data with trpc.followUps.*)
- [x] Follow-ups modal: due-time reminder cron (runFollowUpReminders, runs every 5 min via internalCron)
- [x] Follow-ups modal: vitest tests for deriveStatus logic and runFollowUpReminders
- [x] Follow-ups modal: wire "Reassign owner" button — trpc.followUps.reassign mutation + inline owner picker
- [x] Follow-ups modal: wire "Change due time" button — trpc.followUps.updateDueAt mutation + inline date/time input
- [x] Follow-ups modal: add "Team Issue" as a follow-up type
- [x] Follow-ups modal: replace hardcoded OWNERS with real CS agents from DB
- [x] Bug: Save button in new follow-up form does nothing — fixed: DB type enum missing Team Issue, history column needed explicit default in insert
- [x] Follow-ups modal: post a compact summary card into command chat when a new follow-up is created
- [x] Bug: AI priority queue resurrects dismissed/past items — fixed: tightened window to 24h, filter by last customer message recency, dismissal now permanent
- [x] CS inbox right panel: add Follow-ups section above AI priority queue with clickable cards that open inline detail
- [x] CS inbox: move Follow-ups section to left panel (below AI priority queue, above search bar) — actually user wants it in CommandChat right panel below issues
- [x] CommandChat right panel: add Follow-ups section below "No open issues" / AI issues area
- [x] CommandChat right panel: move Follow-ups section above Manual Issues
- [x] CS chat right panel: restore AI insight section with live AI advice about the selected conversation
- [x] CS chat right panel: remove Follow-ups queue card, replace with single "Add Follow-up" button that opens the new follow-up form
- [x] AI Priority Queue (CS chat sidebar): only surface conversations where last customer message arrived AFTER a fixed cutoff — no historical conversations ever appear
- [x] AI Upsell Detector: CS inbox right sidebar shows emerald card with AI-detected upsell opportunity (deep clean, add-ons, recurring) with ready-to-use pitch that pre-fills compose box
- [ ] Post-call instant debrief: 60s after call.transcript.completed webhook, run AI 3-bullet debrief and SMS it to the support line

- [x] BUG: Cleaner portal — completed jobs revert to incomplete (trace and fix persistence issue)
- [x] FEATURE: Cleaner portal — add uncomplete/undo button so cleaners can correct a mistaken completion
- [x] FEATURE: Cleaner portal — add finishing_up and wrapping_up job statuses with bidirectional auto-link (one tap updates both jobs)
- [x] POLISH: CS inbox debrief card — more whitespace, clearer section separation
- [x] POLISH: CS inbox quick action buttons — icon + label treatment
- [x] POLISH: Command Chat — replace priority alerts pill with online agent avatars
- [x] POLISH: Command Chat — full UI cohesion pass (spacing, bubbles, input, team feel)

- [x] BUG: Command Chat avatar row — agent photos not loading (synced Diane+Rohan photos from users table to agents table; uploadProfilePhoto now syncs to both tables)
- [x] BUG: Command Chat avatar row — online status dots not showing green/amber (added lastSeenAt heartbeat for owner in opsChatProcedure; getAgentStatusList now injects owner from users table)
- [x] BUG: Command Chat message bubbles — agent photos not showing in bubbles (getAllAgentPhotoMap now includes owner photo; staleTime=0 + 30s refetch)
- [x] BUG: Command Chat avatar row — owner (Rohan/RG) photo not showing in top avatar row (getAgentStatusList injects owner entry from users table when not in agents)

- [x] BUG: @mention banner — clicking Jump now navigates one-by-one (15→14→13→0); X still dismisses all; button shows count Jump (14)

- [x] FEATURE: Command Chat — mention history drawer ("See all mentions" button opens slide-in panel with all @mention messages, timestamps, author avatars, and jump-to links)

- [x] BUG: Online status dots — fixed: added 90s presence ping heartbeat; widened online threshold to 5 min, away to 20 min

- [x] BUG: Diane's photo not showing in message bubbles — fixed: getAllAgentPhotoMap now emits both short name ("Diane") and full OAuth name ("Diane Ruiz") as keys pointing to the same photo

- [x] BUG: Online status fixed — root cause: OAuth name "Rohan G" ≠ agents name "Rohan Gilkes"; fixed by first-name prefix matching in opsChatProcedure heartbeat, pingPresence, and getAgentStatusList (owner always shows green when they make the request)

- [x] BUG: CS chat manual SMS send — fixed: startConv onSuccess now calls setSelectedId(data.sessionId) after invalidating the inbox list, so the new/existing conversation is immediately selected and visible

- [x] FEATURE: CS chat new outbound conversation — auto-populate leadName using same backfillCsNames chain (completedJobs → cleanerJobs → quoteLeads → other sessions); also backfills existing sessions with raw phone as name

- [x] BUG: CS chat outbound SMS to existing conversation — fixed: when existing session found, now always sets csQueue + leadSource=cs_initiated so it surfaces in the CS inbox filter, then setSelectedId selects it

- [x] FEATURE: CS chat new outbound modal — show "Existing conversation found — will reopen it" warning when phone already has an open session
- [x] FEATURE: CS chat — auto-scroll to bottom of message list after outbound send opens the thread (400ms delay after setSelectedId)

- [x] BUG: startCsConversation — root cause: listCsInbox sourceFilter excluded 'cs_initiated'; added it so agent-initiated conversations now appear in the inbox

- [x] BUG: CS chat — view now switches correctly after send: replaced invalidate() with refetch() so list is populated before setSelectedId fires
- [x] BUG: Command Chat @mention dropdown — deduplicated by first name; only the longer/full name is kept (Diane Ruiz, not both Diane + Diane Ruiz)

- [ ] FEATURE: FAQ pill in CS chat and Command Chat — slide-up panel with AI Q&A backed by maidinblack.com content
- [ ] Add World-Class AI Response pencil button to CS Chat: click pencil → type scenario → get Disney/Ritz-Carlton quality response with copy-to-compose
- [x] Fix CS Chat agent messages showing wrong agent name (Rohan's name on Ianique's messages) — getAgentSessionFromCtx now returns fresh agent.name from DB instead of stale JWT name
- [x] Fix Live Call Assist not generating AI responses after first prompt — getLiveCallSuggestions was using agentProcedure (requires agent cookie) but admins use Manus OAuth; changed to opsChatProcedure which accepts both
- [x] Fix Live Call Assist stage looping — AI re-asks questions already in transcript
- [x] Rewrite Live Call Assist system prompt — sharp, human, high-converting, no bland generic questions
- [x] Remove currentStage from AI response — AI no longer auto-advances stage pills (stage tracking was causing loops)
- [x] Fix knownFields to populate from context panel for ALL calls
- [x] Replace Live Call Assist system prompt with new outbound call script (exact flow + objection handling from user)
- [x] Add "if they say yes" bridge card below opener in Live Call Assist
- [x] Pre-fill agent name from Manus OAuth when agent portal session is not present
- [x] Remove bridge line from system prompt (AI was repeating what agent already said from opener card)
- [x] Audit and fix all duplicate question/line patterns across SMS flow and Live Call Assist — only issue was Live Call Assist bridge line (already fixed), SMS flow is clean
- [x] Fix truncated confirmation line in Live Call Assist system prompt — removed 1-2 sentences MAX rule, added CRITICAL verbatim rule for script lines
- [x] Add card collection and closing confirmation steps to Live Call Assist system prompt; fix personal note loop
- [x] Fix personal touch step — AI must fill in actual detail from transcript, not print placeholder text
- [x] Add empathy acknowledgment rule before each discovery question in Live Call Assist
- [x] Add address confirmation rule after customer gives address in Live Call Assist
- [x] Wire pricing table prices (first clean + recurring) into Live Call Assist so AI uses real prices instead of [price] placeholders
- [x] Fix AI priority queue: Teams conversations are cleaners/staff, not customers — AI now receives [TEAM — cleaner/staff] label and treats them as operational issues, not customer complaints

- [x] CS Chat priority queue: AI draft for Teams conversations uses operational language (not customer-facing)
- [x] CS Chat priority queue: suppress conversations where an agent has already responded (only surface unanswered issues)

- [x] Bug: agent messages disappear from CS chat when a new customer message arrives (history overwritten by webhook) — fixed race condition: re-read history fresh from DB before appending inbound message

- [x] Agent on-call status: DB columns for active call tracking with TTL (openPhoneUserId, onCallSince, onCallCallId on agents table)
- [x] Agent on-call status: OpenPhone call.ringing / call.answered / call.completed webhook handlers
- [x] Agent on-call status: getAgentStatusList returns onCallSince with 2-hour TTL safety + SSE broadcast via agent_status event
- [x] Agent on-call status: on-call badge (green phone icon + ring) on agent photos in Command Chat header

- [x] Auto-populate openPhoneUserId: fetch OpenPhone users via API, match to agents by name, write to DB
- [x] Settings UI: show OpenPhone user match results, allow manual assignment for unmatched agents
- [x] Fix call card direction label: outbound calls showing as "inbound"
- [x] Fix call card latency: cards appearing late
- [x] Fix outbound calls not showing green badge in Command Chat header
- [x] Fix CS SMS not showing in CS inbox: direction check was blocking outbound agent replies before CS intercept
- [ ] Investigate false outbound call card at 11:24 AM (Rohan did not make a call)
- [x] CS Risk 1: Log error when OPENPHONE_CS_PHONE_NUMBER_ID is missing so silent drops are visible
- [x] CS Risk 2: Add retry with backoff to syncCsOutboundMessages on API failure
- [x] CS Risk 3: Increase history cap from 20 to 200 messages
- [x] CS Risk 4: Create CS session for proactive outbound messages (agent texts first from OpenPhone)
- [x] CS Risk 5: Switch inbound/outbound dedup to messageId-based (not content+time)
- [x] CS Risk 6: Add 30s polling fallback to CsInbox in case SSE misses a lead_update
- [ ] Fix CS number calls mapping to wrong agent (owner) in on-call header badge instead of actual agent
- [x] Fix on-call badge dedup guard: allow badge update when different agent answers shared-number call
- [x] Fix call_started card: only post on call.answered (not call.ringing) so correct agent name shows
- [x] Post call_started card on call.initiated when direction is outgoing
- [x] Show caller name/number on inbound call_started card (lookup from leads table)
- [x] Show customer name on outbound call cards (lookup call.to in quoteLeads)
- [x] Clear stuck on-call badge in DB (force-clear all agents)
- [x] Add TTL auto-expire: if onCallSince > 2 hours, auto-clear the badge

- [x] Fix call card: show phone/name on card (currently shows "started a inbound call" with no contact info)
- [x] Fix call card: outbound card not appearing (call.initiated not triggering card in UI)
- [x] Fix call card: lag in appearance (new_message broadcast missing channel param, OpsChat onNewMessage only invalidates when channel is truthy)
- [x] Fix call card: "a inbound" → "an inbound" grammar
- [ ] Fix call card showing wrong agent name — shared number payload always has Rohan's userId, need to fetch real caller from OpenPhone API using callId
- [x] For shared-number calls: show "An agent called X" instead of agent name, skip green badge on agent avatars
- [x] Inbound shared-number calls: show "An agent received a call from X" instead of "An agent answered a call from X"
- [ ] Show call duration in call_ended card UI (already in metadata, just needs rendering)
- [ ] When call.summary.completed fires, append recording URL and AI summary to the existing call_ended card
- [ ] Post a new call_debrief card in command channel after AI debrief is generated (recording player + AI summary)
- [ ] Render call_debrief card in CommandChat with audio player and AI debrief bullets
- [x] Fix priority queue click: clicking a priority item navigates to wrong conversation (e.g. Jennifer Casden → GoGreen)
- [x] Add dismiss (×) button to away status banner so the entire bar can be closed

- [x] CS Inbox: Internal notes — Reply/Note toggle in compose box with strong visual differentiation (amber background, lock icon, "not sent to customer" label), stored as role="note" in messageHistory, displayed in thread as amber sticky-note bubbles
- [x] CS Inbox: Fix — saving a note navigates away to another conversation instead of staying on the current one
- [x] Fix: tRPC query on /admin/command-center returns HTML error page instead of JSON (TRPCClientError: Unexpected token '<') — getCsConvInsight converted from .query (GET) to .mutation (POST) to avoid HTTP 414 URI-too-large
- [x] CS Inbox: Reduce wasted vertical space — shrink header, move Note toggle into compose bar, maximize thread height
- [x] CS Inbox: Rewrite World-Class Reply AI prompt to match warm/direct/conversational tone from provided Zappos SMS examples
- [x] CS Inbox: Add 30 new SMS tone examples (31-60) to csReply system prompt
- [x] CS Inbox: Pass last few conversation messages as context to both auto-draft AI and World-Class Reply panel
- [x] CS Inbox: Fix — clicking a filter tab (New/Active/Teams/etc.) did not reset selectedId, causing wrong conversation to show; fixed by resetting selectedId on tab switch
- [x] CS Inbox: Replace csQuickReply auto-draft with csReply (world-class prompt); keep elevateReply on send
- [x] CS Inbox: Pass customer first name into csReply prompt so AI addresses them by name
- [x] CS Inbox: Audit and improve csReply world-class prompt quality — prompt reviewed, examples confirmed good, customerName now explicitly passed
- [x] CS Inbox: Pass upcoming job details (date, service type, cleaner/team name) to csReply AI via jobContext field
- [x] CS Inbox: Fix prompt length restriction — removed 4-sentence cap, added "match the moment" guidance and Be SPECIFIC / Be CONNECTING instructions
- [x] CS Inbox: Add Regenerate button to auto-draft compose label for one-click fresh draft
- [x] CS Inbox: Rewrite csReply prompt to stop producing short hollow acknowledgments — removed sentence-count cap, added BAD EXAMPLES section with exact bad output to avoid, rewrote length guidance as "write until it feels complete"
- [x] CS Inbox: BUG — clicking a conversation in the list does not navigate to it (error toast shown, chat panel stays blank/wrong) — root cause: inline Resolve button triggered on touch tap after hover; fixed with pointer:fine media query (desktop mouse only)
- [x] CS Inbox: BUG (recurring) — sending a message jumps to a different conversation; FIXED: filtered useMemo now always pins the currently selected conversation so it is never evicted from the list after send (even when hasUnanswered flips to false)
- [x] CS Inbox: BUG — ReferenceError: Cannot access 'userNavigatedToId' before initialization; FIXED: removed ref from useMemo (temporal dead zone), using selectedId state directly as pinnedId
- [x] CS Inbox: Move all useRef declarations to top of component (before useMemo/useEffect) to prevent temporal dead zone issues
- [x] CS Inbox: Add vitest for filter pin invariant — 6 tests covering send-stays-on-conversation, tab filter eviction, search, Teams, Resolved (server/csInbox.filter.test.ts)
- [x] Fix 5 failing tests in opsChatNewFeatures.test.ts (dismissReminder/snoozeReminder mockUpdate called twice) — root cause: opsChatProcedure middleware fires a heartbeat db.update(agents) call; tests updated to expect 2 calls
- [x] Add test for Resolve button touch guard CSS class [@media(pointer:fine)]:flex — 5 assertions in server/csInbox.resolveGuard.test.ts
- [x] Wire jobContext into the elevate-on-send pass — added jobContext field to elevateReply input schema, injected into system prompt with job details section, wired from both triggerElevateDebounced and handleCsSend calls in CsInbox
- [x] CS Inbox: BUG — search not reliably finding conversations by name; FIXED: when query is active, search now scans ALL conversations across all tabs (tab filter is bypassed); also added phone number to the search haystack
- [x] CS Inbox: BUG — AI suggestion from previous conversation persists when switching; FIXED: added useEffect([selectedId]) that clears elevateSuggestion and elevateChecked on every conversation switch
- [x] CS Inbox: BUG — compose box draft text persists when switching conversations; FIXED: added setCompose("") to the selectedId useEffect alongside elevateSuggestion/elevateChecked clears
- [x] CS Inbox: BUG — Send button bypassed the world-class AI rewrite gate; PERMANENTLY FIXED: replaced elevateChecked:boolean with elevateApprovedText:string|null — gate only bypasses when compose.trim() exactly matches the text the agent explicitly approved (Use or Send Original). All other bypass paths closed.
- [ ] CS Inbox: Stream the world-class elevate suggestion so tokens appear word-by-word instead of a 3-second spinner
- [ ] CS Inbox: BUG — fake "Jillian McMahon" placeholder flashes for ~1 second on every visit to CS chat
- [ ] CS Inbox: BUG — first auto-selected conversation on load does not trigger the world-class AI draft
- [x] CS Inbox: BUG — elevate gate fires when clicking Send while auto-draft stream is still in progress; FIXED: added autoDraftLoading bypass in handleCsSend so streaming AI text sends directly
- [x] CS Inbox: BUG — tRPC fallback (csAutoDraft) did not set elevateApprovedText, causing gate to fire on AI-generated text from fallback path; FIXED: csAutoDraft.onSuccess now sets elevateApprovedText
- [x] CS Inbox: BUG — elevate suggestion card not appearing when agent types own words and clicks Send; ROOT CAUSE: pending debounce timer fired streamElevate after elevateReply.mutate() set the card, immediately wiping it by setting elevateSuggestion(""); FIXED: handleCsSend now cancels the debounce timer and any in-flight stream before calling elevateReply.mutate(), and also skips the mutate if the card is already visible
- [x] CS Inbox: Rename priority status pill from "Priority" to "Needs attention"
- [x] CS Inbox: Rename same-day job avatar badge from "Today" to "Booked"
- [x] CS Inbox: VIP avatar badge (4+ jobs) label confirmed as "VIP" (already correct)
- [x] CS Inbox: BUG — status pills show "Follow up" for all New and Active conversations; fix hasUnanswered to skip note/system roles, add "replied" status for Active tab, fix "waiting"/"live" for New tab
- [x] CS Inbox: Replace conversation card UI with new design (ring avatar, status pill bottom-left, priority badge top-left, activity strip, note line)
- [x] CS Inbox: VIP badge — use cleaner_jobs for job count, lower threshold to 3
- [x] CS Inbox: BUG — resolving a conversation doesn't update resolved count or show in resolved queue
- [x] CS Inbox: BUG — resolving a conversation doesn't update resolved count or show in resolved queue
- [ ] CS Inbox: BUG — New tab not showing conversations that should be there (e.g. Ricky Wilkins)
- [x] CS Inbox: Add "All" tab as default showing all unresolved conversations
- [ ] Remove action pills from CS chat (keep FAQs and Objections)
- [ ] Build Next Best Action Engine: 4-card inline UI (Confirm & Lock, Push to Recurring, Save/De-escalate, Call Now)
- [ ] Rules engine: re-evaluate on each inbound message, highlight recommended card
- [ ] Pre-fill reply input when a card is clicked
- [ ] Only show for customer conversations (not Teams)
- [x] Field Mgmt Sync: ALL jobs for a date must sync to cleanerJobs regardless of phone validity; bad phones flagged with phoneInvalid=1 instead of being silently dropped from completedJobs
- [x] Phone normalization pass: after sync, attempt to fix phoneInvalid=1 rows to valid +1XXXXXXXXXX format and clear the flag; rows that still cannot be fixed remain flagged
- [x] Fix: stale-cleanup incorrectly marks jobs as rescheduled when server is down; terminal-status guard then locks it permanently — allow L27 to override rescheduled back to assigned if L27 says active
- [x] CS chat SMS pre-send date/time sanity check: wrong day-of-week, implausible AM time, date mismatch vs conversation — inline warning card with Send Anyway / Edit
- [x] AI elevation: add hard rule to never change dates, times, or specific numbers from the agent's draft
- [x] AI csReply: add hard rule to never change dates, times, or specific numbers from job context or conversation
- [x] Restore carpet cleaning leads: removed from silenced_services setting (DB + seed default)
- [x] Silence check: add dynamic silenced_services filter to thumbtack-sms handler in webhooks.ts and replace hard-coded arrays in thumbtackWebhook.ts + emailLeadWebhook.ts
- [x] Settings: replace silenced_services textarea with checkbox list UI
- [x] Apply /apply welcome page: redesign to Maid Marines-style dark layout with video left, AI badge + Get Started CTA right
- [x] Hiring Pipeline SMS inbox: reuse leads.sendMessage (same phone number) instead of custom getConversation/sendToCandidate procedures; extract hiringRouter to separate file to fix TypeScript type inference depth limit
- [x] BUG: Hiring pipeline archive count shows 0 — confirmed no archive section exists in UI, was a misread
- [x] BUG: Hiring pipeline SMS send button does nothing — sessionId is null when candidate has no existing conversation session; need to create session on first send
- [ ] BUG: Hiring pipeline Text button does nothing when clicked — should open SMS drawer
- [ ] Send message button in hiring opens exact same ConversationDrawer as AgentDashboard with candidate name+phone
- [x] BUG: Hiring pipeline candidate cards — AI badge now only shows when interviewVideoUrl exists; Vid badge only shows when videoUrl exists; both hidden when inactive
- [ ] Fix Advance Stage button in hiring pipeline — must advance to next stage and send automated SMS
- [ ] Fix Reject button in hiring pipeline — must set stage to Rejected and send automated SMS
- [x] Fix stage-change SMS (Real Interview etc.) not firing: replaced setImmediate with inline await in updateStage; also switched to CS phone number (PN0wVLcpCq) for hiring SMS; manually sent missed SMS to all 18 Real Interview candidates
- [x] Fix ETA PASSED alert showing wrong time (UTC instead of ET): added timeZone: 'America/New_York' to toLocaleTimeString in StaleETA cron — DST-safe via IANA timezone
- [x] Fix all Command Chat time displays using UTC instead of ET: added timeZone: 'America/New_York' to formatTime() helper, pinnedJobs time, soon-alert startTime, etaLabel from live etaTimestamp (opsChatRouter), and running_late arrivalTime (cleanerRouter)
- [x] Fix no-check-in escalation card not dismissing when cleaner is running_late (had ETA but card stayed): added running_late to suppression filter in getCommandChatAlerts; also added auto-delete of noshow_alert/stale_eta cards from DB when cleaner updates status to on_the_way or arrived
- [ ] Add Calendar tab to hiring pipeline: LLM extracts scheduled call times from Real Interview conversations, weekly grid view
- [x] Add Calendar tab to hiring pipeline: LLM extracts scheduled call times from Real Interview conversations, weekly grid view
- [ ] Schedule Call button in candidate detail panel with date/time picker, saves to DB, reflects in calendar
- [ ] Calendar cards (scheduled + unscheduled) open SMS chat drawer for that candidate
- [x] Schedule Call button in candidate detail panel with date/time picker, saves to DB, reflects in calendar
- [x] Calendar cards (scheduled + unscheduled) open SMS chat drawer on click
- [x] Fix LLM extraction: recruiter confirmation = confirmed time; candidate stated time = fallback
- [x] Add Schedule button on unscheduled calendar cards (no need to leave Calendar tab)
- [ ] CS Chat UI rebuild: 5-column layout (nav rail, client lane, team lane, chat, collapsible right panel)
- [x] Rebuild CS Chat (CsInbox) into 5-column layout: Revenue Lane (clients) + Operations Lane (teams) + center thread + right unified profile
- [x] Replace M/U/D/C/Calendar icons in DashboardLayout left sidebar with A/P/N/A/R filter buttons (All, Priority, New, Active, Resolved) for CS inbox filter
- [x] Pixel-perfect redesign of Revenue Lane header (REVENUE LANE label, Clients heading, open count pill), priority queue card, and client conversation cards in CsInbox Col 1
- [x] Remove Ops/Chat/CS tab switcher from inside Revenue Lane card in CsInbox
- [x] Change CS inbox background to light grey matching the design
- [x] Pixel-perfect both priority queue cards (client blue, team purple) with hover-to-expand; add Team priority queue card to Operations Lane
- [x] Chat column: add rounded-[28px] card wrapper; right column: square corners, narrower width (280px); chat column wider; right column styling matches Unified Profile design
- [ ] Redesign center column header: compact single-row, clean typography, action icons in pill group
- [ ] Redesign compose area: full-width textarea, draft badge bar top, FAQ/Objections/Send toolbar bottom
- [x] Command Chat Issues tab: wire leftTab/centerView state to Chat/Issues tab buttons in left panel header
- [x] Command Chat Issues tab: render issue cards (alerts + manual issues) in left panel when leftTab === 'issues'
- [x] Command Chat Issues tab: build center Issues view with claim/resolve cards (shown when centerView === 'issues')
- [x] Command Chat Issues tab: hide conversation thread and composer when centerView === 'issues'
- [x] Redesign Issues center view cards: ACTIVE ISSUE CARD label, emoji+title+body left, Owner pill + Mark Resolved button right, 3 info tiles (Ownership / Customer Risk / Response Pressure) at bottom
- [x] Fix Issues card styling: bg-slate-50 outer card, white tiles, large rounded-2xl pill buttons, blue text on Claim/Owner, solid green Mark Resolved, correct spacing to match goal design
- [x] Fix Owner pill: light blue bg (bg-blue-50), blue border (border-blue-200), blue text — match goal design pixel-perfect
- [x] Add recommended action subtitle to issue cards (bold instruction derived from issue type, e.g. "Call cleaner + notify client")
- [x] Persist claim/resolve to DB: add claimedBy and resolvedAt columns to alerts table, wire claim/resolve tRPC mutations
- [x] Add unresolved issue count badge (red pill) on Issues tab button in CommandChat left panel
- [x] Fix CommandChat column spacing: uniform gutters between left panel, center panel, and collapsed right panel
- [x] Issue comments: add issue_comments table (issueKey, authorName, body, type: text|system, createdAt)
- [x] Issue comments: add addIssueComment + getIssueComments tRPC procedures; auto-log system events on claim/resolve
- [x] Issue comments: inline collapsible thread below each issue card, live polling every 5s, composer at bottom
- [x] Fix: resolved issues in Chat tab Live Alerts now show same resolved treatment as Issues tab (strikethrough, green tint, Resolved ✓)
- [x] Persist issue resolved state server-side: openIssue __resolve__ now upserts issue_ownership; Issues tab left panel Claim/Resolve buttons now call claimIssue/resolveIssueOwnership mutations; resolve dialog calls refetchOwnership after success; ownership poll interval reduced to 15s for cross-agent sync
- [x] Fix: resolving alert-type issues (Conrad Hipkins-jones) doesn't persist — comes back after refresh
- [x] Fix: creating issue from comment should include the comment text in the issue
- [ ] Fix: resolution note popup missing when marking an issue as resolved in Command Chat

- [x] Add Team Pay page UI under Jobs nav — leaderboard, payout breakdown, risk signals, timeline, recovery, job impact tabs (UI-only, mock data)
- [x] Add CleanerView modal to TeamPay — cleaner-facing performance view per team, triggered by button on each leaderboard card (UI only, mock data)
- [x] Wire TeamPay to real DB data — teamPayRouter.ts with getTeams procedure, Sun-Sat week filter, week picker UI, all mock data replaced
- [x] Backfill finalPay: recalculate all cleanerJobs from scratch using live pay rules (dry-run → review → apply)
- [x] Fix photo penalty: apply immediately on job completion (not just on rating), remove if photo uploaded in same pay period
- [x] Set finalPay=$0 + manualAdjustmentNote for no-show/cancelled jobs (rescheduled excluded per ops decision)
- [x] Auto-recalculate finalPay on photo upload in cleanerRouter (already handled in qualityRouter photo upload handler)
- [x] Fix: Bronia Yearwood Apr 5 job missing photoAdjustment bonus despite photo uploaded — root cause was $0-revenue guard blocking photo adj calc; removed guard in qualityRouter, cleanerRouter, and backfill script; re-ran backfill (208 jobs updated)
- [x] Add Google review bonus toggle to job detail pay panel in CleanerDashboard (same pattern as reclean penalty toggle)
- [x] Remove duplicate Google review bonus hardcoded PayRow — already exists as custom pay rule in the system
- [x] Wire googleReviewBonus column: auto-populate when Google Review custom rule is applied/removed
- [x] Add reclean penalty toggle to Team Pay Job Impact job cards
- [x] Fix: duplicate reclean penalty in Team Pay Job Impact — removed static reclean item from teamPayRouter items array, toggle is now sole source of truth
- [x] Fix: reclean toggle fires but job card values (Instant pay impact, Final team pay) don't update — root cause was (1) setRecleanPenalty not updating finalPay in DB, (2) staleTime:60s blocking immediate refetch; fixed both
- [x] Schema: add noEtaArrival (int 0/1) column to cleanerJobs
- [x] Schema: add customerComplaint (text nullable) column to cleanerJobs
- [x] Server: detect no-ETA arrival in updateJobStatus — set noEtaArrival=1 when arrived with no prior on_the_way in jobStatusHistory (dropped per user request)
- [x] Server: include noEtaArrivalCount in computeScore (−3 pts each) and teamPayRouter getTeams (schema column retained, detection dropped)
- [x] Server: add flagAsComplaint mutation in qualityRouter — stores complaint text, optionally applies −$20 charge, flags job, recalculates finalPay
- [x] Server: add setComplaint mutation in teamPayRouter for manual complaint add from Team Pay job card
- [x] Server: surface customerComplaint as line item in teamPayRouter job impact items
- [x] Team Pay UI: show "Arrived without ETA" line item on job cards where noEtaArrival=1 (dropped per user request)
- [x] Team Pay UI: show "Customer complaint" line item with expandable complaint text on job cards
- [x] Team Pay UI: add "Add complaint" manual button on job cards (like reclean toggle)
- [x] CS Inbox UI: show "Flag as complaint" button on hover for inbound customer messages
- [x] CS Inbox UI: complaint dialog with job link and optional −$20 charge checkbox
- [x] Fix: missed check-ins count includes rescheduled/cancelled jobs (jobStatus=null but bookingStatus=rescheduled/cancelled) — exclude non-active bookingStatuses from missedCheckins filter
- [x] Team Pay: show total finalPay for the period on the team summary card
- [x] Team Pay: show total finalPay for the period on the cleaner breakdown panel (inside team view)
- [x] Cleaner view: show finalTeamPay on each job card in the job list
- [x] Server: add getPayrollSummary procedure to teamPayRouter — per-team summed adjustments (reclean, complaints, rating, photo, google review, late, other), score, payout %, base pay, final pay
- [x] UI: build PayrollSummary page — spreadsheet table, totals row, CSV export button
- [x] UI: add "Payroll Summary" button on Team Pay page to open the new page
- [x] UI: register /payroll-summary route in App.tsx
- [x] Fix: "Back to Team Pay" button on PayrollSummary page doesn't navigate — was using /team-pay instead of /admin/team-pay
- [x] Fix: CS chat not showing full message history — root cause: dedup keyed on phone only, so a newer cs_initiated session (29 msgs) was hiding the cs-inbound-cleaner session (211 msgs) for the same phone. Fixed by keying dedup on phone+bucket (team/client/ops)
- [x] Fix hiring section: applicant SMS replies going to leads drawer instead of hiring section (root cause: handleCsInboundMessage was creating new cs-inbound sessions for hiring applicants who replied to the CS number; fixed by checking for existing hiring_interview session first and routing there instead)
- [x] Fix getSessionByPhone in hiringRouter to prefer hiring_interview/hiring sessions over cs-inbound sessions
- [x] Backfill: dedup duplicate messages in all hiring_interview sessions (12 candidates affected)
- [x] Fix daily bookings revenue badge: filter on bookedAt instead of createdAt in stats procedure
- [x] Fix duplicate stale ETA alerts: add job_alerts state table with atomic upsert (UNIQUE KEY cleanerJobId+alertType + INSERT ON DUPLICATE KEY UPDATE no-op)
- [x] Fix zombie jobs: close 7 prior-day on_the_way jobs (all confirmed completed in DB)
- [x] Add today-only guard to stale ETA cron (etaTimestamp >= start of today)
- [x] Add nightly auto-close cron (11:30 PM ET) for any on_the_way jobs from prior days
- [x] Clean up stale job_alerts and ops_chat_messages rows for now-closed zombie jobs
- [x] Fix field_mgmt_log duplicate-fire race: replace stepAlreadyFired (SELECT→INSERT) with atomic INSERT ON DUPLICATE KEY UPDATE (no-op) in all field mgmt steps
- [x] Fix TiDB affectedRows=1 bug: TiDB returns affectedRows=1 for both first insert AND no-op ON DUPLICATE KEY UPDATE — switched tryClaimStep and stale_eta cron to SELECT-first pattern; cleaned up all existing duplicate opsChatMessages rows (stale_eta: 11 jobs, noshow_alert: 5 jobs)
- [x] Leads page: reduce lead list row height (py-5 → py-3, text-[18px] → text-sm, text-[22px] → text-base in quote column)
- [x] Leads page: fix right panel sizing (text-[26px] → text-xl for name, h-12 → h-9 + rounded-2xl → rounded-xl for action buttons)
- [x] Leads page: reduce timeline event card padding (p-4 → p-3, rounded-2xl → rounded-xl)
- [x] Leads page: fix right panel padding (p-6 → p-4)
- [x] Leads page: auto-select first lead on load (useEffect already added, verify it works)

## Flow C — Widget SMS Quote Flow
- [ ] Add Flow C stages to conversation engine: ADDON_COLLECTION, DATE_COLLECTION, NOTES_COLLECTION, QUOTE_LINK_SEND
- [ ] Add flowC_sms1–5 templates to DB (with exact copy from user)
- [ ] Wire engine to collect add-ons, preferred dates, and special notes across 5 steps
- [ ] Pass enriched data (add-ons, dates, notes) to quote app API when generating quote link
- [ ] Set Flow C as default active widget flow (smsFlow = "C")
- [ ] Expose flowC_sms1–5 templates in Settings SMS editor

## Flow C — Booking Handler + Form SMS
- [ ] Add "Looks good" handler for FLOWC_QUOTE_SENT stage → address collection → confirmation (reuse flowB_sms3/sms4)
- [ ] Add Flow C to Form SMS flow (processSubmitQuote / submitQuote) in routers.ts
- [ ] Add Flow C option to Form SMS flow selector in SettingsPage.tsx

## Bug Fix — Flow C Sessions Going DONE (Apr 21, 2026)
- [x] Fix: INTERVIEW_LINK_SENT sessions stealing priority over newer active lead sessions in webhook session routing (root cause of Flow C sessions going DONE ~74s after creation)
- [x] Fix: Add FLOWC_ADDON/FLOWC_DATE/FLOWC_NOTES/FLOWC_QUOTE_SENT to submitQuote ACTIVE_LEAD_STAGES so re-submissions properly supersede them
- [x] Test: 8 new vitest tests for webhook session priority logic (all passing)
- [x] Remove FLOWC_NOTES step from Flow C (confirm → add-ons → date → quote link)
- [x] Update Settings UI Flow C template labels and DB values to reflect 4-step sequence (sms3=date, sms4=quote link, remove sms5)
- [x] Gap 4: Insert quoteLeads row for widget leads when FLOWC_QUOTE_SENT fires (webhooks.ts createQuoteLink block)
- [x] Gap 5: Call logActivity for widget leads in processWidgetLeadInBackground (routers.ts)
- [x] Add Bark SMS lead source: intercept inbound SMS from +16506469270, parse service/name, create conversationSessions row (leadSource=bark-sms, placeholder phone), post Command Chat card
- [x] Revert source badges to text-only rounded-full pills (no logos): MIB/Widget/Google Ads/Inbound/Yelp/Bark/Thumbtack + campaign variants
- [x] Add emoji+label service badges (getServiceBadge): ✨ Deep, 🏠 Standard, 📦 Move-out, 🏗️ Post-Con, 🏢 Office, 🏨 Rental
- [x] Wire getServiceBadge into Leads list service cell (replaces plain text)
- [x] Confirm all Bark leads (Yvonne, Diego, Donna, Shafaq, etc.) already in DB — backfill script updated to process all 50 messages
- [x] Create Performance page (Lead Source Performance dashboard) with provided UI code
- [x] Hide AI Center nav item, add Performance in its place
- [x] Register /performance route in App.tsx
- [x] Update Performance page sourceColors and source filter to cover all real DB lead sources
- [x] Replace single-color bar chart with overlapping bars (leads muted backdrop + bookings saturated foreground)
- [x] Wire Performance page to real DB data via tRPC procedure (no other pages touched)
- [x] Exclude internal sources (cs_initiated, cs-inbound-cleaner, cs-inbound, hiring_interview) from Performance page stats and leads queries
- [x] Also exclude email, review_rebooking, review from Performance page
- [x] Default Performance page date filter to All time
- [x] Merge thumbtack-sms into thumbtack in Performance page queries and frontend
- [x] Rename voice to AI Voice in Performance page labels
- [x] CRITICAL: Thumbtack direct leads go to hot leads but not conversation_sessions — root cause: messageHistory NOT NULL constraint, initialHistory was null when no phone number in email body. Fixed in emailLeadWebhook.ts and thumbtackWebhook.ts
- [x] CRITICAL: Audit ALL webhook handlers — no lead ever dropped silently (bark, thumbtack, email-lead, voice, form)
- [x] Fix: missing phone must use placeholder, not drop the lead
- [x] Fix: messageHistory must never be null in any handler
- [x] Fix: any session insert failure must notifyOwner immediately
- [x] CRITICAL: Fix cleaner sessions showing in CS Chat Clients column — set csQueue=Teams permanently in webhooks.ts and opsChatRouter.ts
- [x] Backfill existing cleaner sessions with csQueue=Teams (14 rows updated)

## Performance Optimization — Metrics Page

- [x] metricsRouter.ts: getAiAlerts reads from metrics_ai_alerts DB cache first (serves instantly if < 1 hour old), falls back to LLM, persists result to DB
- [x] internalCron.ts: hourly cron added to pre-generate AI alerts for all 5 ranges (today/7d/30d/90d/12m) via warmMetricsAiAlerts()
- [x] Metrics.tsx: stale-while-revalidate on getOverview (staleTime 5m, refetchOnMount always) and getAiAlerts (staleTime 1h, refetchOnMount always)

## Performance Optimization

- [x] leads.list: make AI summary LLM call non-blocking (fire-and-forget background job)

## CS Chat Two-Session Bug Fix

- [ ] Fix webhook cleaner session lookup to include cs-inbound sessions (prevents duplicate sessions)
- [ ] One-time DB cleanup: merge Solange's duplicate cs-inbound session into her cs-inbound-cleaner session
- [x] messageHistory column: migrate TEXT to MEDIUMTEXT to fix 65KB hard limit (Solange/GoGreen/MaidsPlus all at wall)
- [x] webhooks.ts: extend cleaner session lookup to include cs-inbound sessions (prevents two-session duplicate bug)

## AI SMS Conversation Bug Fixes

- [x] Fix {quoteLink} literal in SMS — store finalReplyContent (post-substitution) to messageHistory instead of result.reply
- [x] Fix wrong service type in quote — persist engineData.serviceType to DB in the session update (already persisted at line 967; root cause was {quoteLink} in history confusing AI)
- [x] Fix Command Chat "today's bookings" ticker: todayDateStr was a static useMemo (never updated), now uses useState+useEffect that ticks every minute so it rolls over at ET midnight
- [x] Fix Command Chat "today's bookings" ticker: always show $0 at midnight instead of disappearing (removed {todayRevenue > 0 &&} guard)
- [x] Fix duplicate unclaimed lead escalation alerts: added singleton guard to startInternalCron() + atomic DB-level UPDATE gate in runUnclaimedLeadEscalation to prevent race condition duplicates
- [x] Fix bookedAt timestamps being stored 4 hours ahead: added timezone:'Z' to mysql2 connection in db.ts so Date objects always serialize as UTC; corrected 3 existing bad rows (IDs 1680010, 1740005, 1710033) by subtracting 4 hours
- [x] Make marking a lead as BOOKED bump it to the top of the Leads list (include bookedAt in sort key)
- [x] Add hover tooltip on "booked today" ticker in Command Chat showing per-booking details (customer name, amount, agent)

- [x] Build Lead Nurturing page (Sequence Control Center) — pixel-perfect UI from spec
- [x] Add "Growth" dropdown to admin nav with "Lead Nurture" as first item
- [x] Move "Journey" from top-level nav into the Jobs dropdown
- [x] Register /admin/lead-nurturing route in App.tsx

- [x] Fix: inbound SMS replies not showing in drawer for leads with non-E.164 phone (e.g. "703-727-5500") — webhook lookup now uses digit-only fallback match
- [x] Fix: normalize phone to E.164 at manual lead creation and call-assist lead creation so new sessions always store +1XXXXXXXXXX
- [x] Data fix: backfilled 79 existing sessions with non-normalized phones to E.164 format

- [x] Nurture: Add nurture_enrollments DB table and migration
- [x] Nurture: Add message templates and sequence engine (nurtureSequence.ts, 15 steps, 20 tests all pass)
- [x] Nurture: Enrollment cron (detect eligible leads, enroll at +15min after nudge) — 100 leads enrolled on first run
- [x] Nurture: Send cron (fire due messages, handle exit conditions)
- [x] Nurture: Wire Lead Nurturing UI to real data (nurtureRouter.ts tRPC procedures)
- [x] Nurture: Manual re-enroll after human takeover (nurture.resume mutation)

## Nurture Sequence Critical Fixes

- [x] Nurture: Add NURTURE_SMS_ENABLED = false kill switch to nurtureCron.ts (SMS sends disabled until approved)
- [x] Nurture: Exclude cs_initiated sessions from enrollment (team members, not leads)
- [x] Nurture: Cancel 11 bad cs_initiated enrollments from DB (set to done/manual)
- [x] Nurture: Cancel 100 stale historical enrollments (48-hour enrollment window enforced)
- [x] Nurture: Wire Lead Nurturing UI lead progression table to real tRPC data (trpc.nurture.enrollments)
- [x] Nurture: Wire Lead Nurturing UI KPI cards to real tRPC data (trpc.nurture.stats)
- [x] Auto-pause nurture enrollment when lead sends any inbound reply (webhook)
- [x] Fix "Pause sequence (human takeover)" — calls trpc.nurture.end instead of a real pause (sets status=paused, not ended)
- [x] Fix "End sequence manually" — calls same pauseMutation (trpc.nurture.end with reason=manual) — this one is actually correct, just rename the variable
- [x] Fix "Open full thread" button — no onClick, should navigate to lead drawer in AdminDashboard
- [x] Fix "New automation rule" button — no onClick, placeholder
- [x] Fix personalization token buttons — no onClick, should insert token into textarea at cursor
- [x] Fix "Apply to all leads in this step" button — no onClick, placeholder
- [x] Fix "Regenerate with AI" button — no onClick, should call LLM to rewrite the script
- [x] Fix "Apply segment filter" button — no onClick, placeholder
- [ ] Add bookedRevenue column to nurture_enrollments schema
- [ ] Update endEnrollment to capture session estimatedValue when reason=booked
- [ ] Update stats query to return bookedCount and bookedRevenue
- [ ] Replace KPI cards: "Active leads in sequence" → "Booked in sequence", "Completed sequence" → "Booking revenue from sequence"
- [x] Enroll all new leads with real phone immediately (no delay/booked/aiMode checks)
- [x] Add recency gate to nurture send runner (skip if inbound message in last 30 min)
- [x] Add Speed to Lead status badge to enrollment table rows
- [x] Tighten recency gate from 30 to 20 minutes
- [x] Fix AI SLOT_CHOICE: "any day/either works/you pick" now picks 9am and advances to ADDRESS instead of re-asking
- [x] Fix AI WIDGET_SIZING: partial scope replies ("only the basement", "just the kitchen") now acknowledged and advanced instead of looping back to ask for room counts
- [x] Increase AI thinking budget from 128 to 2048 tokens globally in llm.ts for smarter reasoning across all AI features
- [x] Architectural rewrite: two-step conversation engine (extract → advance deterministically → reply). LLM no longer decides stage transitions — pure code does. Eliminates entire class of re-asking bugs.
- [x] Fix $0 price bug: add dollar-sign prefixed substitution key for ${price} in aiService.ts
- [x] Fix doubled "Perfect. Perfect" in flowB_sms2 DB template — removed bad saved template text
- [x] Fix insurance question ignored: when DB template override fires, prepend question answer before price reveal
