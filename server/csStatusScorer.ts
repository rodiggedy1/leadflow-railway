/**
 * csStatusScorer.ts
 *
 * Computes the smart conversation status tier for CS inbox cards.
 * Two-layer approach:
 *   1. Rule-based fast path — instant, no LLM cost (handles clear terminal acks)
 *   2. LLM scoring — async, fires only for ambiguous messages
 *
 * Results are cached in conversation_sessions.csStatusTier.
 * Cache is considered stale when csStatusMsgLen !== current message count.
 *
 * ZERO impact on SMS flows, webhooks, or any existing functionality.
 */

import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { conversationSessions } from "../drizzle/schema";
import { invokeLLM } from "./_core/llm";

// ── Status keys ───────────────────────────────────────────────────────────────
// Client lane (Revenue)
export type ClientStatusTier =
  | "new_inquiry"       // New lead came in → Respond now
  | "waiting_on_you"    // Waiting on follow-up → Follow up now
  | "hot_lead"          // High intent / quick reply → Close now
  | "slow_response"     // No reply in X min → Nudge now
  | "scheduling"        // Back-and-forth on time → Lock in time
  | "objection"         // Price concern / unsure → Overcome objection
  | "post_job"          // Job finished → Push to recurring
  | "happy_customer"    // Positive sentiment → Ask for review
  | "cold_lead"         // No reply after days → Reactivate
  | "solved";           // Conversation concluded — no action needed

// Team lane (Ops)
export type TeamStatusTier =
  | "job_at_risk"       // Delay risk / cleaner issue → Fix now
  | "awaiting_team"     // Cleaner hasn't replied → Ping team
  | "needs_instruction" // Cleaner asking question → Send instructions
  | "schedule_conflict" // Overlap / timing → Adjust schedule
  | "otw_missing"       // Cleaner hasn't marked on the way → Confirm status
  | "arrival_issue"     // Late / not checked in → Check arrival
  | "payment_issue"     // Confusion / discrepancy → Resolve
  | "fyi"               // Informational → Review (no action)
  | "solved";           // Conversation concluded — no action needed

// Linked (cross-lane)
export type LinkedStatusTier =
  | "delay_impacting_client"   // Team delay + customer booked → Fix + notify
  | "reschedule_required"      // Team conflict + client scheduled → Offer new time

export type CsStatusTier = ClientStatusTier | TeamStatusTier | LinkedStatusTier;

// ── Terminal acknowledgment patterns (fast path) ──────────────────────────────
const TERMINAL_ACK_PATTERNS = [
  /^ok[.,!]?$/i,
  /^okay[.,!]?$/i,
  /^ok thanks[.,!]?$/i,
  /^okay thanks[.,!]?$/i,
  /^thanks[.,!]?$/i,
  /^thank you[.,!]?$/i,
  /^thx[.,!]?$/i,
  /^ty[.,!]?$/i,
  /^got it[.,!]?$/i,
  /^sounds good[.,!]?$/i,
  /^perfect[.,!]?$/i,
  /^great[.,!]?$/i,
  /^awesome[.,!]?$/i,
  /^noted[.,!]?$/i,
  /^understood[.,!]?$/i,
  /^will do[.,!]?$/i,
  /^👍+$/,
  /^✅+$/,
  /^🙏+$/,
  /^no problem[.,!]?$/i,
  /^np[.,!]?$/i,
  /^sure[.,!]?$/i,
  /^alright[.,!]?$/i,
  /^alright[.,!]?$/i,
  /^cool[.,!]?$/i,
];

function isTerminalAck(text: string): boolean {
  const trimmed = text.trim();
  return TERMINAL_ACK_PATTERNS.some((p) => p.test(trimmed));
}

// ── LLM scoring ───────────────────────────────────────────────────────────────
const CLIENT_STATUS_KEYS: ClientStatusTier[] = [
  "new_inquiry", "waiting_on_you", "hot_lead", "slow_response",
  "scheduling", "objection", "post_job", "happy_customer", "cold_lead", "solved",
];

const TEAM_STATUS_KEYS: TeamStatusTier[] = [
  "job_at_risk", "awaiting_team", "needs_instruction", "schedule_conflict",
  "otw_missing", "arrival_issue", "payment_issue", "fyi", "solved",
];

const CLIENT_STATUS_DESCRIPTIONS: Record<ClientStatusTier, string> = {
  new_inquiry: "New lead just came in, no substantive exchange yet",
  waiting_on_you: "Customer is waiting for an agent to follow up",
  hot_lead: "Customer shows high intent — replied quickly, asked about booking, price, or availability",
  slow_response: "Agent or AI has not responded in a while and customer may be losing interest",
  scheduling: "Conversation is actively going back and forth on dates, times, or availability",
  objection: "Customer expressed price concern, hesitation, or is unsure about booking",
  post_job: "Job has been completed; conversation is about post-job topics (feedback, rebooking, etc.)",
  happy_customer: "Customer expressed satisfaction, left a positive comment, or gave a good rating",
  cold_lead: "No reply from customer after multiple days; lead has gone cold",
  solved: "Conversation has naturally concluded — last message is an acknowledgment, confirmation, or sign-off with no open questions or pending actions",
};

const TEAM_STATUS_DESCRIPTIONS: Record<TeamStatusTier, string> = {
  job_at_risk: "There is a delay risk, cleaner issue, or something that could impact the job",
  awaiting_team: "Agent sent a message and the cleaner/team has not replied yet",
  needs_instruction: "Cleaner is asking a question or needs guidance to proceed",
  schedule_conflict: "There is an overlap, timing issue, or scheduling conflict that needs resolution",
  otw_missing: "Cleaner has not marked themselves as on the way when they should have",
  arrival_issue: "Cleaner is late, has not checked in, or there is an arrival problem",
  payment_issue: "There is confusion, a discrepancy, or a question about payment or billing",
  fyi: "Informational update only — no action is required from the agent",
  solved: "Conversation has naturally concluded — last message is an acknowledgment, confirmation, or sign-off with no open questions or pending actions",
};

async function scoreLLM(
  messages: Array<{ role: string; content: string }>,
  isTeam: boolean
): Promise<CsStatusTier> {
  const keys = isTeam ? TEAM_STATUS_KEYS : CLIENT_STATUS_KEYS;
  const descriptions = isTeam ? TEAM_STATUS_DESCRIPTIONS : CLIENT_STATUS_DESCRIPTIONS;

  const statusList = keys
    .map((k) => `- "${k}": ${descriptions[k as keyof typeof descriptions]}`)
    .join("\n");

  const lastFive = messages.slice(-5);
  const transcript = lastFive
    .map((m) => `[${m.role === "user" ? "CUSTOMER" : "AGENT"}]: ${m.content}`)
    .join("\n");

  const systemPrompt = isTeam
    ? `You are a CS inbox status classifier for a cleaning company's operations team conversations (agent ↔ cleaner/team member).`
    : `You are a CS inbox status classifier for a cleaning company's customer conversations (agent ↔ client).`;

  const userPrompt = `Classify this conversation into exactly one status key.

CONVERSATION (last 5 messages):
${transcript}

STATUS OPTIONS:
${statusList}

Return ONLY a JSON object with one field: { "status": "<key>" }
Choose the single most accurate status. When the last message is a simple acknowledgment ("ok", "thanks", "got it", "sounds good", "👍", etc.) with no open questions or pending actions, return "solved".`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "cs_status",
          strict: true,
          schema: {
            type: "object",
            properties: {
              status: { type: "string", description: "The status key" },
            },
            required: ["status"],
            additionalProperties: false,
          },
        },
      },
    });

    const rawContent = response?.choices?.[0]?.message?.content;
    const raw = typeof rawContent === "string" ? rawContent : null;
    if (!raw) return isTeam ? "fyi" : "waiting_on_you";

    const parsed = JSON.parse(raw);
    const status = parsed?.status as CsStatusTier;

    // Validate the key is one we know
    const validKeys: string[] = [...CLIENT_STATUS_KEYS, ...TEAM_STATUS_KEYS, "delay_impacting_client", "reschedule_required"];
    if (!validKeys.includes(status)) return isTeam ? "fyi" : "waiting_on_you";

    return status;
  } catch (err) {
    console.error("[csStatusScorer] LLM error:", err);
    return isTeam ? "fyi" : "waiting_on_you";
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Scores a conversation's status tier and persists it to the DB.
 * Safe to call fire-and-forget (never throws).
 *
 * @param sessionId  - conversation_sessions.id
 * @param isTeam     - true for ops/team lane, false for client/revenue lane
 * @param history    - parsed messageHistory array
 * @param currentMsgLen - current message count (for cache invalidation)
 * @param cachedTier - existing csStatusTier from DB (may be null)
 * @param cachedMsgLen - csStatusMsgLen from DB (may be null)
 */
export async function scoreAndCacheStatus(
  sessionId: number,
  isTeam: boolean,
  history: Array<{ role: string; content: string; ts?: number }>,
  currentMsgLen: number,
  cachedTier: string | null,
  cachedMsgLen: number | null
): Promise<void> {
  try {
    // Cache hit — nothing to do
    if (cachedTier && cachedMsgLen === currentMsgLen) return;

    const db = await getDb();
    if (!db) return;

    const lastMsg = history[history.length - 1];
    if (!lastMsg) return;

    let tier: CsStatusTier;

    // Fast path: terminal acknowledgment from user (customer or cleaner)
    if (lastMsg.role === "user" && isTerminalAck(lastMsg.content)) {
      tier = "solved";
    } else {
      // LLM path for everything else
      tier = await scoreLLM(history, isTeam);
    }

    // Persist to DB
    await db
      .update(conversationSessions)
      .set({
        csStatusTier: tier,
        csStatusTieredAt: Date.now(),
        csStatusMsgLen: currentMsgLen,
      })
      .where(eq(conversationSessions.id, sessionId));
  } catch (err) {
    // Never let scoring errors bubble up — this is purely additive
    console.error(`[csStatusScorer] Failed to score session ${sessionId}:`, err);
  }
}
