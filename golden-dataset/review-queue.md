# Madison Golden Dataset — Human Review Queue

> **Do not edit the held-out cases (MADISON-041–MADISON-050).** The cases below are anonymized candidates. Your labels become ground truth only after you independently review and approve them.

Generated: 2026-10-11T00:51:05.470Z
Total cases: 50 | Development: 40 | Held out: 10

## How to review each case

1. Read the current inbound SMS first.
2. Read context only when needed to interpret the current SMS.
3. Record every explicit fact and copy exact evidence text from the current SMS.
4. Record missing/conflicting information and both readiness decisions.
5. Add forbidden operational actions; human approval remains required.
6. After independent review, update the JSON case and set `approvalState` to `human_approved`.

---

## MADISON-001 — DEVELOPMENT CASE

- **Source draft:** 3061622
- **Captured:** 2026-10-11T00:44:09.773Z
- **Observed message type:** ACTION
- **Observed draft status:** DRAFT_READY

### Current inbound SMS

> Can you change my booking to monthly

### Bounded prior context

- **Customer:** Can you cancel service
- **Customer:** Can you reschedule please
- **Customer:** Can you reschedule please
- **Customer:** What cleaner supplies did you bring?

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-002 — DEVELOPMENT CASE

- **Source draft:** 3061621
- **Captured:** 2026-10-11T00:31:36.864Z
- **Observed message type:** QUESTION
- **Observed draft status:** DRAFT_READY

### Current inbound SMS

> What cleaner supplies did you bring?

### Bounded prior context

- **Customer:** Can you reschedule please
- **Customer:** Can you reschedule please
- **Customer:** What cleaner supplies did you bring?
- **Customer:** Can you change my booking to monthly

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-003 — DEVELOPMENT CASE

- **Source draft:** 3061619
- **Captured:** 2026-10-11T00:03:58.362Z
- **Observed message type:** INFORMATION
- **Observed draft status:** DRAFT_READY

### Current inbound SMS

> Hello - I don't have a cleaning scheduled for tomorrow

### Bounded prior context

- **Agent:** Hi Michael! 😊 Absolutely, we can reschedule your cleaning to next Friday. See you on 10/16/2026 12:30PM - 2:30PM! Looking forward to keeping your home feeling fresh. ✨
- **Customer:** Perfect thank you!
- **Agent:** Our pleasure Michael.
- **Agent:** Hi Michael, this is Maids in Black! 🖤 Confirming your cleaning appointment tomorrow.  ✅ Reply YES to confirm 🔄 Reply FLEXIBLE or NOT FLEXIBLE to let us know if you’re open to shifting your two-hour arrival window earlier or later  Quick note: we use a two-hour arrival window to account for traffic, weather, and other jobs running longer, this helps us to show up ready to do our best work for you.  Thanks so much, looking forward to seeing you tomorrow! 😊

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-004 — DEVELOPMENT CASE

- **Source draft:** 3061618
- **Captured:** 2026-10-11T00:00:35.079Z
- **Observed message type:** CONVERSATION
- **Observed draft status:** DRAFT_READY

### Current inbound SMS

> Ok

### Bounded prior context

- **Agent:** Please reply CONFIRM to let us know you're all set!
- **Customer:** Hi, sorry—I was told my day was set for 400 tomorrow, but I don't see it listed as 400.
- **Customer:** and there is a house in Maryland?
- **Agent:** Hey Team! Just a reminder to confirm your schedule for tomorrow. Reply CONFIRM when you're all set! 🧹

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-005 — DEVELOPMENT CASE

- **Source draft:** 3061616
- **Captured:** 2026-10-10T23:26:16.069Z
- **Observed message type:** QUESTION
- **Observed draft status:** DISMISSED

### Current inbound SMS

> and there is a house in Maryland?

### Bounded prior context

- **Agent:** Please reply CONFIRM to let us know you're all set!
- **Customer:** Hi, sorry—I was told my day was set for 400 tomorrow, but I don't see it listed as 400.
- **Agent:** Hey Team! Just a reminder to confirm your schedule for tomorrow. Reply CONFIRM when you're all set! 🧹
- **Customer:** Ok

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-006 — DEVELOPMENT CASE

- **Source draft:** 3061614
- **Captured:** 2026-10-10T23:24:31.287Z
- **Observed message type:** CONVERSATION
- **Observed draft status:** DISMISSED

### Current inbound SMS

> Ok. Thank you!

### Bounded prior context

- **Customer:** Does that mean that this is my new time slot tomorrow!
- **Customer:** Sorry. I didn't mean the exclamation point. I meant to add a question mark.
- **Agent:** Yes, we schedule you at 3:30PM
- **Agent:** You are welcome

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-007 — DEVELOPMENT CASE

- **Source draft:** 3061608
- **Captured:** 2026-10-10T22:31:02.554Z
- **Observed message type:** INFORMATION
- **Observed draft status:** DISMISSED

### Current inbound SMS

> I can do a visit after 3:30.

### Bounded prior context

- **Customer:** Sorry. I didn't mean the exclamation point. I meant to add a question mark.
- **Agent:** Yes, we schedule you at 3:30PM
- **Customer:** Ok. Thank you!
- **Agent:** You are welcome

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-008 — DEVELOPMENT CASE

- **Source draft:** 3061592
- **Captured:** 2026-10-10T21:10:44.686Z
- **Observed message type:** UNKNOWN
- **Observed draft status:** DRAFT_READY

### Current inbound SMS

> card payment

### Bounded prior context

- **Customer:** Hi, sorry—I was told my day was set for 400 tomorrow, but I don't see it listed as 400.
- **Customer:** and there is a house in Maryland?
- **Agent:** Hey Team! Just a reminder to confirm your schedule for tomorrow. Reply CONFIRM when you're all set! 🧹
- **Customer:** Ok

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-009 — DEVELOPMENT CASE

- **Source draft:** 3061589
- **Captured:** 2026-10-10T21:06:16.474Z
- **Observed message type:** ACTION
- **Observed draft status:** DISMISSED

### Current inbound SMS

> Yes and I'd like to use my complimentary cleaning

### Bounded prior context

- **Customer:** Please remove me from the schedule tomorrow.
- **Agent:** Thanks for letting us know. We’ve removed you from the schedule for tomorrow. We completely understand, and whenever you're ready to use your free cleaning, just reach out and we’ll get you set up!
- **Agent:** Hi Caity, this is Maids in Black! 🖤 Confirming your cleaning appointment tomorrow.  ✅ Reply YES to confirm 🔄 Reply FLEXIBLE or NOT FLEXIBLE to let us know if you’re open to shifting your two-hour arrival window earlier or later  Quick note: we use a two-hour arrival window to account for traffic, weather, and other jobs running longer, this helps us to show up ready to do our best work for you.  Thanks so much, looking forward to seeing you tomorrow! 😊
- **Agent:** Noted. We'll get everything set up for you.

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-010 — DEVELOPMENT CASE

- **Source draft:** 3061565
- **Captured:** 2026-10-10T19:23:40.094Z
- **Observed message type:** UNKNOWN
- **Observed draft status:** DISMISSED

### Current inbound SMS

> Morning please

### Bounded prior context

- **Customer:** Morning please
- **Agent:** Sure, How about 9:30 AM?
- **Customer:** Yes
- **Agent:** Great! I will move your schedule tomorrow at 9:30 AM. Thank you so much for your patience. We really appreciate you!

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-011 — DEVELOPMENT CASE

- **Source draft:** 3061551
- **Captured:** 2026-10-10T18:56:32.797Z
- **Observed message type:** CONVERSATION
- **Observed draft status:** SENT

### Current inbound SMS

> Thank you!

### Bounded prior context

- **Agent:** Hi Madi! Your Maids in Black team has arrived for your cleaning at 1150 First St Ne, Apt 1030, Washington, DC 20002.  Open My Home: <URL>
- **Customer:** Thank you! Will they update when it is complete?
- **Agent:** Sure, We will update you once it's completed
- **Agent:** Hi Madi! ✨ Martha Calderon just finished your clean — your home is sparkling!  Leave a 5-star Thumbtack review and we'll add a $50 tip to Martha Calderon:  Open My Home: <URL>

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-012 — DEVELOPMENT CASE

- **Source draft:** 3061406
- **Captured:** 2026-10-10T06:37:56.023Z
- **Observed message type:** ACTION
- **Observed draft status:** SENT

### Current inbound SMS

> Cancel entirely

### Bounded prior context

- **Customer:** Can you reschedule please
- **Customer:** Can you reschedule please
- **Customer:** What cleaner supplies did you bring?
- **Customer:** Can you change my booking to monthly

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-013 — DEVELOPMENT CASE

- **Source draft:** 3061255
- **Captured:** 2026-10-09T01:31:16.731Z
- **Observed message type:** QUESTION
- **Observed draft status:** SENT

### Current inbound SMS

> thanks! could you just confirm what's included in the deep cleaning and what, approximate,  window you'd have on that Thursday afternoon?

### Bounded prior context

- **Customer:** thank you for the quick response! I'm reviewing a few quotes and will be making a decision in the morning. I'll plan to reach out then,   thank you again!
- **Agent:** You're welcome, Christopher! Take all the time you need, and we'll be here ready to assist whenever you decide. Have a great evening! 😊
- **Agent:** Hi Christopher, made you a custom link you can use to hold onto your quote and book when you're ready. We've filled in most of the details in about 60 seconds :) <URL>
- **Agent:** Hello Christopher, When you have a moment, could you please provide your home address and email address so we can send your confirmation and finalize the details?  We can certainly schedule this for tomorrow with an arrival window between 10:30 AM and 12:30 PM. Thank you, and we look forward to hearing from you.

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-014 — DEVELOPMENT CASE

- **Source draft:** 3061238
- **Captured:** 2026-10-08T22:47:00.083Z
- **Observed message type:** INFORMATION
- **Observed draft status:** SENT

### Current inbound SMS

> Sorry my helper can't do it tomorrow

### Bounded prior context

- **Customer:** I was talking about the move in service
- **Customer:** At 6 pm
- **Agent:** no they didn't do it. can you work tomorrow? Yes. No. For a minimum of $400.
- **Customer:** For tomorrow none of them can't they said next week they can do 7 days thank you

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-015 — DEVELOPMENT CASE

- **Source draft:** 3061026
- **Captured:** 2026-10-08T00:13:36.318Z
- **Observed message type:** UNKNOWN
- **Observed draft status:** SENT

### Current inbound SMS

> We not go to brandywine

### Bounded prior context

- **Agent:** Hey GoGreen — reminder for your cleaning at 4:30 PM.  Before you arrive: • Review notes • Bring full supplies • Be ready to check in + upload photos  Set your status to "On the Way" in the app. <URL>
- **Agent:** Hi Team, can you give us your ETA for  Michael Murphy at 4835 Cordell Ave Apt 1124, Bethesda, MD 20814
- **Agent:** Hey — we haven't received your check-in. Is everything okay? <URL>
- **Agent:** Would anyone work tomorrow for a minimum of $400 😊

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-016 — DEVELOPMENT CASE

- **Source draft:** 3060800
- **Captured:** 2026-10-06T18:35:17.493Z
- **Observed message type:** QUESTION
- **Observed draft status:** FAILED

### Current inbound SMS

> I think I answered yours in Thumbtack. What time are you available on October 15 or 16th

### Bounded prior context

- **Customer:** Thank you for your help.   I went with another vendor.   I'll keep you in mind for future jobs.   Thank you again for your time
- **Agent:** Hi Kathleen, thanks so much for letting us know! 😊 We totally understand and appreciate you considering us. If you ever need a clean in the future, we’ll be ready to help. Wishing you a great day! 🏡✨
- **Customer:** Thank you so much!
- **Agent:** You are most welcome

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-017 — DEVELOPMENT CASE

- **Source draft:** 3060759
- **Captured:** 2026-10-06T13:52:30.303Z
- **Observed message type:** ACTION
- **Observed draft status:** FAILED

### Current inbound SMS

> I want to reschedule for tomorrow, the fifth

### Bounded prior context

- **Customer:** Can you reschedule please
- **Customer:** Can you reschedule please
- **Customer:** What cleaner supplies did you bring?
- **Customer:** Can you change my booking to monthly

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-018 — DEVELOPMENT CASE

- **Source draft:** 3060752
- **Captured:** 2026-10-06T12:35:05.878Z
- **Observed message type:** unknown
- **Observed draft status:** RECEIVED

### Current inbound SMS

> 1700, 3 bedrooms and 2 bathrooms, townhouse, no pets, 6-7

### Bounded prior context

- **Agent:** Are you moving in/out? what is the reason why you're needing this cleaning done?
- **Customer:** No. This is for my son and he has 4 small children. Cleaning is the one thing he really needs help with...
- **Agent:** Absolutely, we understand! With four small children, a deep cleaning would be a great option to give him a fresh start and take some of that stress off his plate. The price for the deep cleaning would be $448.   When would you like us to schedule the cleaning?
- **Agent:** Hi Patricia, we have a spot for tomorrow,. would you like to take it?

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-019 — DEVELOPMENT CASE

- **Source draft:** 3061620
- **Captured:** 2026-10-11T00:04:07.996Z
- **Observed message type:** ACTION
- **Observed draft status:** DRAFT_READY

### Current inbound SMS

> Can you reschedule please

### Bounded prior context

- **Customer:** Can you cancel service
- **Customer:** Can you cancel service
- **Customer:** What cleaner supplies did you bring?
- **Customer:** Can you change my booking to monthly

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-020 — DEVELOPMENT CASE

- **Source draft:** 3061615
- **Captured:** 2026-10-10T23:25:55.887Z
- **Observed message type:** QUESTION
- **Observed draft status:** DRAFT_READY

### Current inbound SMS

> Hi, sorry—I was told my day was set for 400 tomorrow, but I don't see it listed as 400.

### Bounded prior context

- **Agent:** Please reply CONFIRM to let us know you're all set!
- **Customer:** and there is a house in Maryland?
- **Agent:** Hey Team! Just a reminder to confirm your schedule for tomorrow. Reply CONFIRM when you're all set! 🧹
- **Customer:** Ok

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-021 — DEVELOPMENT CASE

- **Source draft:** 3061609
- **Captured:** 2026-10-10T22:40:20.120Z
- **Observed message type:** INFORMATION
- **Observed draft status:** DRAFT_READY

### Current inbound SMS

> I don't have any job today

### Bounded prior context

- **Agent:** Hi Pilar Duarte! Here's your schedule for tomorrow, Saturday, October 10:  1. 12:30 PM — Jill Caiazzo, 5806 Arlington Boulevard, Arlington, VA 22204  Please reply CONFIRM to let us know you're all set! 🧹
- **Agent:** Hey Pilar! Just a reminder to confirm your schedule for tomorrow. Reply CONFIRM when you're all set! 🧹
- **Agent:** Hey Pilar — reminder for your cleaning at 12:30 PM.  Before you arrive: • Review notes • Bring full supplies • Be ready to check in + upload photos  Set your status to "On the Way" in the app. <URL>
- **Agent:** Hey — we haven't received your check-in. Is everything okay? <URL>

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-022 — DEVELOPMENT CASE

- **Source draft:** 3061607
- **Captured:** 2026-10-10T22:30:33.489Z
- **Observed message type:** CONVERSATION
- **Observed draft status:** DRAFT_READY

### Current inbound SMS

> No

### Bounded prior context

- **Customer:** Sorry. I didn't mean the exclamation point. I meant to add a question mark.
- **Agent:** Yes, we schedule you at 3:30PM
- **Customer:** Ok. Thank you!
- **Agent:** You are welcome

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-023 — DEVELOPMENT CASE

- **Source draft:** 3061613
- **Captured:** 2026-10-10T23:05:39.217Z
- **Observed message type:** QUESTION
- **Observed draft status:** DISMISSED

### Current inbound SMS

> What link?

### Bounded prior context

- **Customer:** Not flexible are you available to come in the evening
- **Agent:** Hi what time in the evening were you thinking, as in last job like 4:30 pm?
- **Agent:** Hi what time in the evening were you thinking, as in last job like 4:30 pm?
- **Agent:** To secure your cleaning appointment, we just need a card on file via our secure Stripe link:  <URL>  🔒 100% secure – no one on our team sees or stores your card info  ✅ Pre-auth only – you're NOT charged yet  💳 Payment only processed after your cleaning is complete  Reply if you have any questions! 🧹✨

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-024 — DEVELOPMENT CASE

- **Source draft:** 3061611
- **Captured:** 2026-10-10T22:47:35.141Z
- **Observed message type:** CONVERSATION
- **Observed draft status:** DISMISSED

### Current inbound SMS

> Sorry. I didn't mean the exclamation point. I meant to add a question mark.

### Bounded prior context

- **Customer:** Sorry. I didn't mean the exclamation point. I meant to add a question mark.
- **Agent:** Yes, we schedule you at 3:30PM
- **Customer:** Ok. Thank you!
- **Agent:** You are welcome

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-025 — DEVELOPMENT CASE

- **Source draft:** 3061606
- **Captured:** 2026-10-10T22:25:30.739Z
- **Observed message type:** INFORMATION
- **Observed draft status:** DISMISSED

### Current inbound SMS

> 2800 4 bedroom 4 bath No pets  Single Family Home  6 to 7 Deep Clean/Standard

### Bounded prior context

- **Customer:** 6 to 7.
- **Agent:** Hi! 😊 To help us provide an accurate quote, could you please share a few details about your home?  Square footage: Approximately how many square feet is your home? Bedrooms and bathrooms: How many of each? Pets: Do you have any pets? Property type: Is it a single-family home, townhouse, condo, or apartment? Condition: On a scale of 1–10, with 10 being the dirtiest, how would you rate your home's current condition? Occupancy: Is the home empty or furnished? Type of cleaning: Are you looking for a standard cleaning, deep cleaning, move-in cleaning, or move-out cleaning?  Once I have these details, I'll be happy to provide you with a quote! 😊
- **Agent:** For your 4 beds and 4 baths deep cleaning we charge $420. But if you only want a standard cleaning, we charge $340
- **Agent:** when would you like to do the cleaning?

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-026 — DEVELOPMENT CASE

- **Source draft:** 3061555
- **Captured:** 2026-10-10T19:04:22.299Z
- **Observed message type:** UNKNOWN
- **Observed draft status:** DRAFT_READY

### Current inbound SMS

> I’m not sure I’d say definitely the two bathrooms upstairs and the bathroom upstairs.

### Bounded prior context

- **Agent:** Hi what time in the evening were you thinking, as in last job like 4:30 pm?
- **Customer:** What link?
- **Agent:** Hi what time in the evening were you thinking, as in last job like 4:30 pm?
- **Agent:** To secure your cleaning appointment, we just need a card on file via our secure Stripe link:  <URL>  🔒 100% secure – no one on our team sees or stores your card info  ✅ Pre-auth only – you're NOT charged yet  💳 Payment only processed after your cleaning is complete  Reply if you have any questions! 🧹✨

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-027 — DEVELOPMENT CASE

- **Source draft:** 3061580
- **Captured:** 2026-10-10T20:21:02.547Z
- **Observed message type:** ACTION
- **Observed draft status:** DISMISSED

### Current inbound SMS

> I need a refund

### Bounded prior context

- **Agent:** Hi Sean we could still come out on Monday and perform the service but we do not have control over the actual banking system, it's not within our control. We have already released theh hold on our end. Can send a screenshot to show this if needed.
- **Customer:** I don't wan't the service, I just want the refund
- **Customer:** payment was reversed, no issues
- **Agent:** Thank you for the update

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-028 — DEVELOPMENT CASE

- **Source draft:** 3061547
- **Captured:** 2026-10-10T18:53:06.947Z
- **Observed message type:** UNKNOWN
- **Observed draft status:** DISMISSED

### Current inbound SMS

> 4:20

### Bounded prior context

- **Agent:** So you already went there but the 2 ladies were not allowed to enter, right?
- **Customer:** Correct
- **Agent:** noted team
- **Agent:** Would anyone work tomorrow for a minimum of $400 😊

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-029 — DEVELOPMENT CASE

- **Source draft:** 3061535
- **Captured:** 2026-10-10T18:24:44.354Z
- **Observed message type:** CONVERSATION
- **Observed draft status:** SENT

### Current inbound SMS

> Ok thank you

### Bounded prior context

- **Customer:** Ok thank you
- **Agent:** You're welcome! 😊
- **Agent:** Hi Abiy! Your Maids in Black team has arrived for your cleaning at 5608 Kansas Ave Nw Suite G, Washington, DC 20011.  Open My Home: <URL>
- **Agent:** Hi Abiy! ✨ MaidsPlus just finished your clean — your home is sparkling!  Leave a 5-star Thumbtack review and we'll add a $50 tip to MaidsPlus:  Open My Home: <URL>

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-030 — DEVELOPMENT CASE

- **Source draft:** 3061405
- **Captured:** 2026-10-10T06:30:56.787Z
- **Observed message type:** ACTION
- **Observed draft status:** SENT

### Current inbound SMS

> Can you cancel my booking

### Bounded prior context

- **Customer:** Can you reschedule please
- **Customer:** Can you reschedule please
- **Customer:** What cleaner supplies did you bring?
- **Customer:** Can you change my booking to monthly

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-031 — DEVELOPMENT CASE

- **Source draft:** 3061171
- **Captured:** 2026-10-08T19:07:32.460Z
- **Observed message type:** QUESTION
- **Observed draft status:** SENT

### Current inbound SMS

> And I understand there is the two hour window, but if the crew has not started by 10:30 I will not be able to have a cleaning at all tomorrow

### Bounded prior context

- **Customer:** I was very clear I needed the cleaning to be started no later than 1030.  An arrival time of 12 o'clock is unacceptable
- **Agent:** Hello Lindsey, I’m sorry for the confusion. The team arrived at 8:30 and has already completed the job. We apologize for the mix-up; they accidentally updated the wrong job. They meant to say that they were heading to the next job. Thank you for your understanding!
- **Customer:** Thank you for clarifying
- **Agent:** Thank you for everything and Enjoy the weekend.

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-032 — DEVELOPMENT CASE

- **Source draft:** 3061192
- **Captured:** 2026-10-08T20:19:12.372Z
- **Observed message type:** INFORMATION
- **Observed draft status:** SENT

### Current inbound SMS

> Yo no estoy en Virginia estoy en Miami por eso no puedo trabajar te aviso cuando regrese a Virginia

### Bounded prior context

- **Agent:** Noted team
- **Customer:** Gracias
- **Agent:** You're welcome
- **Agent:** Hey S, — you've just been assigned a cleaning at 12:30 PM today.  Before you arrive: • Review notes • Bring full supplies • Be ready to check in + upload photos  Set your status to "On the Way" in the app. <URL>

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-033 — DEVELOPMENT CASE

- **Source draft:** 3060799
- **Captured:** 2026-10-06T18:33:29.895Z
- **Observed message type:** QUESTION
- **Observed draft status:** FAILED

### Current inbound SMS

> what's your availability on October 15 or 16th?

### Bounded prior context

- **Customer:** Thank you for your help.   I went with another vendor.   I'll keep you in mind for future jobs.   Thank you again for your time
- **Agent:** Hi Kathleen, thanks so much for letting us know! 😊 We totally understand and appreciate you considering us. If you ever need a clean in the future, we’ll be ready to help. Wishing you a great day! 🏡✨
- **Customer:** Thank you so much!
- **Agent:** You are most welcome

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-034 — DEVELOPMENT CASE

- **Source draft:** 3061617
- **Captured:** 2026-10-10T23:48:33.037Z
- **Observed message type:** ACTION
- **Observed draft status:** DRAFT_READY

### Current inbound SMS

> Can you reschedule please

### Bounded prior context

- **Customer:** Can you cancel service
- **Customer:** Can you cancel service
- **Customer:** What cleaner supplies did you bring?
- **Customer:** Can you change my booking to monthly

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-035 — DEVELOPMENT CASE

- **Source draft:** 3061610
- **Captured:** 2026-10-10T22:47:08.687Z
- **Observed message type:** QUESTION
- **Observed draft status:** DRAFT_READY

### Current inbound SMS

> Does that mean that this is my new time slot tomorrow!

### Bounded prior context

- **Customer:** Sorry. I didn't mean the exclamation point. I meant to add a question mark.
- **Agent:** Yes, we schedule you at 3:30PM
- **Customer:** Ok. Thank you!
- **Agent:** You are welcome

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-036 — DEVELOPMENT CASE

- **Source draft:** 3061601
- **Captured:** 2026-10-10T21:24:24.707Z
- **Observed message type:** INFORMATION
- **Observed draft status:** DRAFT_READY

### Current inbound SMS

> I did my work.

### Bounded prior context

- **Customer:** Hi, sorry—I was told my day was set for 400 tomorrow, but I don't see it listed as 400.
- **Customer:** and there is a house in Maryland?
- **Agent:** Hey Team! Just a reminder to confirm your schedule for tomorrow. Reply CONFIRM when you're all set! 🧹
- **Customer:** Ok

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-037 — DEVELOPMENT CASE

- **Source draft:** 3061605
- **Captured:** 2026-10-10T22:10:39.868Z
- **Observed message type:** CONVERSATION
- **Observed draft status:** DRAFT_READY

### Current inbound SMS

> Yes

### Bounded prior context

- **Agent:** Hey JessiCleaning — you've just been assigned a cleaning at 10:30 AM today.  Before you arrive: • Review notes • Bring full supplies • Be ready to check in + upload photos  Set your status to "On the Way" in the app. <URL>
- **Agent:** Hi JessiCleaning Team! Here's your schedule for tomorrow, Sunday, October 11:  1. 9:30 AM — Michael Murphy, 4835 Cordell Ave Apt 1124, Bethesda, MD 20814 2. 10:30 AM — Adam Tanenbaum, 18520 Boysenberry Dr Unit #230, Montgomery Village, MD 20879  Please reply CONFIRM to let us know you're all set! 🧹
- **Agent:** Please reply CONFIRM to let us know you're all set!
- **Agent:** Hey JessiCleaning! Just a reminder to confirm your schedule for tomorrow. Reply CONFIRM when you're all set! 🧹

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-038 — DEVELOPMENT CASE

- **Source draft:** 3061576
- **Captured:** 2026-10-10T20:07:19.287Z
- **Observed message type:** QUESTION
- **Observed draft status:** DISMISSED

### Current inbound SMS

> No tomorrow I was referring to do the move in service tomorrow instead of today at night time    Would it be possible for us to work Monday through Sunday this coming week? Thank you!

### Bounded prior context

- **Customer:** I was talking about the move in service
- **Customer:** At 6 pm
- **Agent:** no they didn't do it. can you work tomorrow? Yes. No. For a minimum of $400.
- **Customer:** For tomorrow none of them can't they said next week they can do 7 days thank you

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-039 — DEVELOPMENT CASE

- **Source draft:** 3061588
- **Captured:** 2026-10-10T20:59:13.688Z
- **Observed message type:** CONVERSATION
- **Observed draft status:** DISMISSED

### Current inbound SMS

> Okay

### Bounded prior context

- **Customer:** Hi, sorry—I was told my day was set for 400 tomorrow, but I don't see it listed as 400.
- **Customer:** and there is a house in Maryland?
- **Agent:** Hey Team! Just a reminder to confirm your schedule for tomorrow. Reply CONFIRM when you're all set! 🧹
- **Customer:** Ok

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-040 — DEVELOPMENT CASE

- **Source draft:** 3061583
- **Captured:** 2026-10-10T20:38:29.817Z
- **Observed message type:** INFORMATION
- **Observed draft status:** DISMISSED

### Current inbound SMS

> payment was reversed, no issues

### Bounded prior context

- **Agent:** Sean your card was not charged. There is a pre-auth/hold that has already been reversed you will see the hold drop off usually in one business day. Sometimes instantly but this depends on your bank, it has already been released on our end. Sorry things did not work out.
- **Agent:** Hi Sean we could still come out on Monday and perform the service but we do not have control over the actual banking system, it's not within our control. We have already released theh hold on our end. Can send a screenshot to show this if needed.
- **Customer:** I don't wan't the service, I just want the refund
- **Agent:** Thank you for the update

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-041 — HELD OUT — DO NOT LABEL YET

- **Source draft:** 3061543
- **Captured:** 2026-10-10T18:47:01.268Z
- **Observed message type:** UNKNOWN
- **Observed draft status:** DRAFT_READY

### Current inbound SMS

> Madi Poulin

### Bounded prior context

- **Agent:** Are you at the property now?
- **Customer:** Yes
- **Agent:** thanks team
- **Agent:** Hey Martha — you've just been assigned a cleaning at 9:30 AM today.  Before you arrive: • Review notes • Bring full supplies • Be ready to check in + upload photos  Set your status to "On the Way" in the app. <URL>

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-042 — HELD OUT — DO NOT LABEL YET

- **Source draft:** 3061579
- **Captured:** 2026-10-10T20:18:22.201Z
- **Observed message type:** ACTION
- **Observed draft status:** DISMISSED

### Current inbound SMS

> can you refund my money

### Bounded prior context

- **Agent:** Hi Sean we could still come out on Monday and perform the service but we do not have control over the actual banking system, it's not within our control. We have already released theh hold on our end. Can send a screenshot to show this if needed.
- **Customer:** I don't wan't the service, I just want the refund
- **Customer:** payment was reversed, no issues
- **Agent:** Thank you for the update

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-043 — HELD OUT — DO NOT LABEL YET

- **Source draft:** 3061538
- **Captured:** 2026-10-10T18:35:58.222Z
- **Observed message type:** UNKNOWN
- **Observed draft status:** DISMISSED

### Current inbound SMS

> Not

### Bounded prior context

- **Customer:** So they won't be here until after 3:30pm? That's over 3 hours from the originally scheduled cleaning. Why did no one update me of this as soon as they realized the mix up?   At 2:30 you said they were on their way and they were 30 minutes away.   This is extremely frustrating as we are moving and have been waiting around with false or no communication at all from you guys.
- **Customer:** We would like to cancel our cleaning
- **Customer:** We unfortunately no longer have time to continue to wait. Thank you.
- **Agent:** I am so sorry for the delay—I just saw your message. I also want to clarify that 3:30 PM is the team's estimated arrival time to get started, not when they will be finished. I completely understand how frustrating this is, especially during a move. As requested, I have processed the cancellation of your cleaning service. Again, we sincerely apologize for the miscommunication and all the inconvenience caused to you today!

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-044 — HELD OUT — DO NOT LABEL YET

- **Source draft:** 3061529
- **Captured:** 2026-10-10T18:19:35.859Z
- **Observed message type:** CONVERSATION
- **Observed draft status:** SENT

### Current inbound SMS

> Thank you

### Bounded prior context

- **Customer:** Oh no guys
- **Agent:** No worries team
- **Agent:** Hey MaidsPlus — you've just been assigned a cleaning at 10:30 AM today.  Before you arrive: • Review notes • Bring full supplies • Be ready to check in + upload photos  Set your status to "On the Way" in the app. <URL>
- **Agent:** Hey MaidsPlus — you've just been assigned a cleaning at 2:30 PM today.  Before you arrive: • Review notes • Bring full supplies • Be ready to check in + upload photos  Set your status to "On the Way" in the app. <URL>

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-045 — HELD OUT — DO NOT LABEL YET

- **Source draft:** 3061401
- **Captured:** 2026-10-10T02:21:13.200Z
- **Observed message type:** ACTION
- **Observed draft status:** SENT

### Current inbound SMS

> Hi, can you reschedule my service?

### Bounded prior context

- **Customer:** Can you reschedule please
- **Customer:** Can you reschedule please
- **Customer:** What cleaner supplies did you bring?
- **Customer:** Can you change my booking to monthly

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-046 — HELD OUT — DO NOT LABEL YET

- **Source draft:** 3061169
- **Captured:** 2026-10-08T19:03:25.347Z
- **Observed message type:** QUESTION
- **Observed draft status:** SENT

### Current inbound SMS

> What does a prehold entail?

### Bounded prior context

- **Customer:** The ladies did an awesome job. I look forward to using you in the future
- **Agent:** Hi Ugo! 🌟 Thank you so much for your kind words. We're thrilled to hear the team did an awesome job for you. Whenever you're ready to have us back, just let us know. We’d love to keep that fresh, clean feeling for you. Have a wonderful day! 😊💛
- **Customer:** Will it be the same ladies?
- **Agent:** Yes! We can set them as your preferred team so they'll handle all your cleaning appointments. If they ever take a day off, we'll let you know ahead of time so you can choose to either wait for their return or have a backup team step in.

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-047 — HELD OUT — DO NOT LABEL YET

- **Source draft:** 3060854
- **Captured:** 2026-10-06T23:31:21.889Z
- **Observed message type:** INFORMATION
- **Observed draft status:** SENT

### Current inbound SMS

> My husband just updated it

### Bounded prior context

- **Agent:** You can also relay your instructions here and we'll make sure to inform the team about it.
- **Customer:** I am driving back home
- **Agent:** Drive safe! Whenever you get home or have a moment, just send any instructions over and I'll make sure to pass them along to the team
- **Agent:** Hi Sabrina! ✨ Consuelo Alba just finished your clean — your home is sparkling!  Leave a 5-star Thumbtack review and we'll add a $50 tip to Consuelo Alba:  Open My Home: <URL>

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-048 — HELD OUT — DO NOT LABEL YET

- **Source draft:** 3060791
- **Captured:** 2026-10-06T18:20:26.606Z
- **Observed message type:** QUESTION
- **Observed draft status:** FAILED

### Current inbound SMS

> I would like a quote for a cleaning

### Bounded prior context

- **Customer:** Can you reschedule please
- **Customer:** Can you reschedule please
- **Customer:** What cleaner supplies did you bring?
- **Customer:** Can you change my booking to monthly

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-049 — HELD OUT — DO NOT LABEL YET

- **Source draft:** 3061612
- **Captured:** 2026-10-10T22:52:02.469Z
- **Observed message type:** ACTION
- **Observed draft status:** DRAFT_READY

### Current inbound SMS

> Can you cancel service

### Bounded prior context

- **Customer:** Can you reschedule please
- **Customer:** Can you reschedule please
- **Customer:** What cleaner supplies did you bring?
- **Customer:** Can you change my booking to monthly

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```

---

## MADISON-050 — HELD OUT — DO NOT LABEL YET

- **Source draft:** 3061596
- **Captured:** 2026-10-10T21:19:10.622Z
- **Observed message type:** QUESTION
- **Observed draft status:** DRAFT_READY

### Current inbound SMS

> I asked you if I could leave and check if I had already paid.

### Bounded prior context

- **Customer:** Hi, sorry—I was told my day was set for 400 tomorrow, but I don't see it listed as 400.
- **Customer:** and there is a house in Maryland?
- **Agent:** Hey Team! Just a reminder to confirm your schedule for tomorrow. Reply CONFIRM when you're all set! 🧹
- **Customer:** Ok

### Human label — fill this in

```text
Intent/category:
Mission:
Facts (fact key | normalized value | exact evidence excerpt):
-
Extraction completeness: COMPLETE / PARTIAL / NO_FACTS_PRESENT
Task completeness:
Missing information:
Conflicting information:
Target-resolution state:
Reply readiness: READY / NOT_READY / UNKNOWN
Action readiness: READY / NOT_READY / UNKNOWN
Forbidden operational actions:
Labeler ID:
Review notes:
Approval: candidate_unreviewed / human_approved / rejected
```
