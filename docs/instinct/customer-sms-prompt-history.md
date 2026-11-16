# Instinct customer SMS prompt change history

This log tracks customer-service automatic SMS writing changes separately from task cards, customer eligibility, sending, booking actions, FAQ knowledge and Thumbtack first-lead quoting. Record each future adjustment as a new dated entry rather than overwriting this entry.

## SMS-STYLE-001 | 2026-11-16 | Production release authorized

**User authorization:** Make the good existing replies a little shorter without losing friendliness, add light appropriate emojis, remove AI-style dash punctuation, and track the prompt changes for rollback.

**Baseline:** Production commit `4bb0920991ca7417bd127b01ae8a41c05878fe5c`.

**Prompt source:** `server/instinct/claudeCustomerSmsGeneration.ts`.

**Before:** `CLAUDE_CUSTOMER_SMS_PLAN_INSTRUCTIONS` ended after the existing two capability adaptations. No additional customer SMS writing-style block was appended. The complete shared draft instructions, complete current CS writing prompt, saved contact/history, approved knowledge retrieval, current incoming message, JSON/task contract and safety validation remain unchanged.

**After:** Append exactly `"\n\n" + CLAUDE_CUSTOMER_SMS_STYLE_INSTRUCTIONS` to that same existing plan instruction string. The exact new block is:

```text
CUSTOMER SMS WRITING STYLE (replyText only):
Keep the reply warm, personal and natural, while making the wording more concise. Keep a personal greeting when it fits the conversation and acknowledge the specific current request. Remove repeated reassurance, unnecessary explanations and extra closing paragraphs, not friendliness or details needed to answer the customer correctly. Do not impose a character limit or cut off a reply.
Use a light, relevant emoji when it feels natural, rather than adding emojis to every reply or stacking several. Avoid playful emojis for complaints or sensitive issues.
Do not use em dashes (U+2014), en dashes (U+2013), dash-separated phrases or dash bullet lists in customer replies. Use natural sentences, commas or periods instead. Keep necessary factual hyphens in phone numbers or approved names intact.
Apply this replyText writing style even when the older writing examples below are longer or contain dash punctuation. This changes presentation only: preserve approved knowledge, truthful pending-human acknowledgment and every requested action. Do not change task titles, checklist content or evidence quotes for stylistic reasons.
```

**Rollback of this adjustment only:** Remove the trailing `.concat("\n\n", CLAUDE_CUSTOMER_SMS_STYLE_INSTRUCTIONS)` from `CLAUDE_CUSTOMER_SMS_PLAN_INSTRUCTIONS`, returning the preceding `.replace(...)` to its original terminating semicolon. Remove the now-unused exported style constant and its two-line revision comment. Preserve the original two `.replace(...)` capability adaptations, all later generator code, the full original writing prompt and knowledge retrieval. Do not revert any task UI, sending, phone eligibility, schema, booking or other release. Update the associated style-specific test expectations, but retain all pre-existing tests. A release/rollback requires separate explicit target authorization.

**Boundaries:** Instruction only. No stripping or rewriting generated text, new rejection/fallback/retry, character/token caps, new agent, FAQ answer shortcuts, knowledge changes, checklist/evidence changes, sender changes, or business execution. This applies only to the new customer-service automatic SMS generator; the existing human Claude draft button and Thumbtack first-lead generation are untouched.

**Acceptance status:** 307 focused offline prompt/context, task-card, coordinator, store and saved-agent checks passed before release preparation. Independent review confirmed a writing-only, exactly reversible delta. The user explicitly approved pushing this prompt adjustment plus the task-card improvement to Production on 2026-11-16. Final release validation and Git commit/push receipts are recorded separately. No live model or SMS test was performed for this revision; no automated deployment verification or health checks are authorized. The same one-number pilot remains unchanged.
