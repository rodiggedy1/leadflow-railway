# SMS Conversation Engine — LLM-First Architecture

## Core Principle

**One LLM call per inbound message. Full context in. Typed decision out.**

The LLM is the brain. The engine is the guardrail.

```
Inbound SMS
    │
    ▼
┌─────────────────────────────────────────────────────┐
│  processLeadReply(leadReply, context)               │
│                                                     │
│  1. Build prompt: stage + context + knowledge base  │
│  2. Call LLM → get LLMDecision (structured JSON)    │
│  3. Validate decision against business rules        │
│  4. Return StageResult                              │
└─────────────────────────────────────────────────────┘
    │
    ▼
Outbound SMS + DB update
```

## LLMDecision Schema

```typescript
interface LLMDecision {
  reply: string;                    // The SMS to send (already in lead's language)
  nextStage: ConversationStage;     // Where to go next
  extractedData?: {
    bedrooms?: string;
    bathrooms?: string;
    selectedSlot?: string;
    address?: string;
    callPreference?: string;
    quotedPrice?: string;
    serviceType?: string;
  };
  reasoning?: string;               // Internal chain-of-thought (not sent to lead)
}
```

## Business Rule Enforcer

The engine validates the LLM decision BEFORE acting on it:

| Rule | Condition | Action |
|------|-----------|--------|
| No stage advance without required data | nextStage advances but required field missing | Override nextStage to current stage |
| No booking without address | nextStage = BOOKED but no address | Override nextStage to ADDRESS |
| No DONE without confirmation | nextStage = DONE but stage is ADDRESS | Override nextStage to CONFIRMATION |
| Reply must not be empty | reply is blank | Use fallback reply |
| Stage must be valid | nextStage not in enum | Keep current stage |

## System Prompt Structure

```
[ROLE]        You are Madison, SMS assistant for Maids in Black.
[CONTEXT]     Current stage, lead name, price, selected slot, address, message history
[STAGE_RULES] What the current stage needs (required data, valid next stages)
[KNOWLEDGE]   Full business knowledge base (pricing, FAQs, policies)
[PRICING]     Exact pricing table (standard + recurring discounts)
[OUTPUT]      Return ONLY valid JSON matching LLMDecision schema
```

## Stage Contracts

Each stage defines:
- **What question was asked** (so LLM knows what it's waiting for)
- **Required data to advance** (enforced by business rule layer)
- **Valid next stages** (LLM is told these explicitly)
- **Fallback behavior** (if LLM fails entirely)

| Stage | Waiting For | Required to Advance | Valid Next Stages |
|-------|------------|---------------------|-------------------|
| WIDGET_SIZING | bedrooms + bathrooms | both extracted | AVAILABILITY |
| QUOTE_SENT | any reply | — | AVAILABILITY |
| AVAILABILITY | day/slot selection | selectedSlot | SLOT_CHOICE |
| SLOT_CHOICE | specific slot choice | selectedSlot | ADDRESS |
| TIME_PREF | morning/afternoon | selectedSlot with time | ADDRESS |
| ADDRESS | street address | address (≥10 chars) | CONFIRMATION |
| CONFIRMATION | call now/few min | callPreference | CALL_SCHEDULED |
| REACTIVATION | yes/no to return | — | AVAILABILITY or DONE |
| FUTURE_BOOKING | ready to book | — | AVAILABILITY |
| DONE/CALL_SCHEDULED | post-booking chat | — | DONE |

## What the LLM Handles Natively (No Code Needed)

- **Any language** — LLM reads and responds in the lead's language automatically
- **FAQ answers** — knowledge base is in the prompt; LLM answers then steers back
- **Recurring pricing questions** — pricing table is in the prompt with discount %
- **Objections** — LLM handles "too expensive", "need to think", "not sure" naturally
- **Existing customer / support requests** — LLM recognizes and routes gracefully
- **Ambiguous replies** — LLM asks for clarification naturally
- **Partial answers** — LLM asks for the missing piece naturally
- **Tone matching** — LLM adapts to the lead's communication style

## Files

```
server/
  engine/
    index.ts          ← processLeadReply (public API, unchanged signature)
    prompt.ts         ← buildSystemPrompt() — the full LLM prompt
    schema.ts         ← LLMDecision type + JSON schema for structured output
    rules.ts          ← Business rule enforcer (validates LLM decision)
    stages.ts         ← Stage contracts (what each stage needs)
    pricing.ts        ← Pricing table (moved from conversationEngine.ts)
    fallbacks.ts      ← Hardcoded fallback messages if LLM fails
```

## Backward Compatibility

- `processLeadReply(leadReply, context)` signature is unchanged
- `StageResult` interface is unchanged
- `ConversationContext` interface is unchanged
- `webhooks.ts` requires no changes
- All existing tests that mock LLM responses will need to be updated
