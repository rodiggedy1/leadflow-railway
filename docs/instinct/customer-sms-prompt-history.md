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

## SMS-STYLE-002 | 2026-11-16 | Production release authorized

**User authorization:** Keep the good messages, but remove the restrictive emoji guidance. Let the agent use varied emojis naturally according to the conversation and cleaning context, without a fixed count or default repeated smiley face.

**Baseline:** Production source commit `9e359be4ef09200b0e4afa83fc4c766d4259585f`; SMS-STYLE-001 prompt commit `952271b5464b84929022bd66d1fb6c0d40e0a60f`.

**Before, emoji paragraph only:**

```text
Use a light, relevant emoji when it feels natural, rather than adding emojis to every reply or stacking several. Avoid playful emojis for complaints or sensitive issues.
```

**After, emoji paragraph only:**

```text
Use emojis naturally wherever they fit the conversation. Vary them to suit the actual message and cleaning context, such as cleaning, a fresh home, sparkle, appreciation or scheduling, rather than defaulting to the same smiley face. There is no fixed emoji count: use multiple emojis when they add appropriate warmth or meaning, or none when they do not fit. Avoid playful emojis for complaints or sensitive issues.
```

**Complete resulting writing-style block:**

```text
CUSTOMER SMS WRITING STYLE (replyText only):
Keep the reply warm, personal and natural, while making the wording more concise. Keep a personal greeting when it fits the conversation and acknowledge the specific current request. Remove repeated reassurance, unnecessary explanations and extra closing paragraphs, not friendliness or details needed to answer the customer correctly. Do not impose a character limit or cut off a reply.
Use emojis naturally wherever they fit the conversation. Vary them to suit the actual message and cleaning context, such as cleaning, a fresh home, sparkle, appreciation or scheduling, rather than defaulting to the same smiley face. There is no fixed emoji count: use multiple emojis when they add appropriate warmth or meaning, or none when they do not fit. Avoid playful emojis for complaints or sensitive issues.
Do not use em dashes (U+2014), en dashes (U+2013), dash-separated phrases or dash bullet lists in customer replies. Use natural sentences, commas or periods instead. Keep necessary factual hyphens in phone numbers or approved names intact.
Apply this replyText writing style even when the older writing examples below are longer or contain dash punctuation. This changes presentation only: preserve approved knowledge, truthful pending-human acknowledgment and every requested action. Do not change task titles, checklist content or evidence quotes for stylistic reasons.
```

**Rollback of SMS-STYLE-002 only:** Replace the new emoji paragraph inside `CLAUDE_CUSTOMER_SMS_STYLE_INSTRUCTIONS` with the exact previous paragraph above and restore the revision comment to SMS-STYLE-001. Adjust only the new emoji-specific test expectations. Keep all concise-tone and no-em-dash instructions, the `.concat(...)` attachment, original knowledge, complete CS prompt, task rules, model/sender, one-number gate and card improvement. Keep both history entries and append the rollback event rather than deleting history.

**Boundaries and status:** Instruction only. No fixed emoji limit, forced emoji, hard-coded rotating emoji, output rewriting, new model call, content fallback, business action, SMS send, or configuration change. User confirms the prior replies work well; this revision changes only the emoji paragraph. The user explicitly approved pushing only this adjustment to Production on 2026-11-16. Fifty-seven focused offline generator checks passed before release preparation. Commit/push evidence and final focused validation are recorded separately. No automated deployment-status or health verification is authorized.

## SMS-STYLE-003 | 2026-11-17 | Production release authorized

**User authorization:** Format extras as emoji-led lines, shorten the condition-scale question, make the introduction before the quote shorter and better formatted, and reduce general SMS verbosity without losing friendliness or necessary information.

**Baseline:** `a1164acdbb17dc85b6abaad19a8db2d363f63702`, including the accepted incomplete-quote repair. This revision must retain that repair.

**Prompt owners:** Only `SMS_BOOKING_QUOTE_INSTRUCTIONS` in `server/instinct/smsBookingQuote.ts` and `TEMPLATE_INSTRUCTIONS` in `server/instinct/smsBookingQuoteGeneration.ts`. The latter is attached by the existing automatic SMS wrapper for quote and ordinary SMS replies; email uses the unchanged shared reply generator, not this wrapper. `CLAUDE_CUSTOMER_SMS_STYLE_INSTRUCTIONS`, shared email/call prompts and canonical price/link presentation are unchanged.

**Qualification presentation:** Keep the existing scale interpretation and canonical extras catalog interpolation. Ask the scale question on two short lines. When offering extras, use a short heading, one relevant-emoji-led plain-text line per listed item, preserve catalog labels and quantity units, retain an explicit no-extras choice, and avoid re-offering the whole menu after a selection. Separate question topics with a blank line. This applies uniformly to every supported service and both pricing modes.

**Exact English SMS-owned missing-condition copy:**

```text
How much cleaning does it need (1 to 10)?
1 = already clean, 5 = normal, 10 = heavy buildup.
```

**Exact Spanish SMS-owned missing-condition copy:**

```text
¿Cuánta limpieza necesita (del 1 al 10)?
1 = limpio, 5 = normal, 10 = mucha suciedad.
```

These replace only the two condition strings in `server/instinct/smsBookingQuoteMissingQuestion.ts`. The authoritative missing-field logic and every other question remain unchanged.

**General SMS brevity and pre-quote recap:** Answer the current message directly with the shortest complete warm reply. Trim repeated greetings, reassurance, full-message restatements, long explanations and automatic closing offers. Preserve necessary answers, important clarifications, approved knowledge and truthful pending-human task acknowledgements. Before a fulfilled canonical quote/link, use a brief acknowledgement and only useful grounded details on separate short lines; label included date/time as requested, never confirmed. Do not repeat the server-owned price, extras summary or booking-page instruction. This is instruction-only, not truncation or a new reply-rewriting mechanism.

**Rollback of SMS-STYLE-003 only:** Restore the two named prompt initializers and the two condition strings from this exact baseline, preserving all surrounding runtime code and the earlier missing-field repair. Restore the affected style-test expectations while keeping all prior regressions. Preserve this history and append any rollback event. Do not revert the shared reply generator, canonical presentation, task storage, dispatch, transport, UI, pricing, links or payment. Any commit, deployment or rollback requires separate explicit target authorization.

**Validation limitation:** Offline prompt-contract and synthetic pipeline tests can verify instructions, accepted line breaks/emojis, preserved facts and unchanged runtime behavior; they do not prove actual Claude adherence to a new writing prompt. No live model/SMS/customer/provider/database action was performed or authorized for validation.

**Release authorization and validation:** The user approved the exact question, “Push only this SMS wording change to Production (`main`)?” on 2026-11-17. All 69 new writing tests and all 1,454 protected regression tests passed, along with the offline compile-only build and zero-diagnostic runtime type checks. Only the release-status documentation changed after validation; tested runtime and test contents are unchanged. Git push/rollback-point evidence is recorded separately. No automatic Railway, deployment-status, health or live-message verification is authorized.
