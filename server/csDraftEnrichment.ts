/**
 * csDraftEnrichment.ts — Background job that enriches historical customer→agent SMS pairs
 * for use as few-shot examples in the AI auto-draft system.
 *
 * POST /api/cron/cs-draft-enrich
 * Auth: x-cron-secret header
 *
 * Run every 6 hours via Railway cron or manually.
 * Processes up to 500 new pairs per run (20 pairs per LLM batch call).
 */
import type { Express, Request, Response } from "express";
import { getDb } from "./db";
import { conversationSessions, csDraftExamples } from "../drizzle/schema";
import { sql, and, isNotNull, gte, eq } from "drizzle-orm";
import { ENV } from "./_core/env";

const MAX_PAIRS_PER_RUN = 500;
const MAX_PAIRS_PER_SESSION = 10;
const BATCH_SIZE = 20;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

interface RawPair {
  sessionId: number;
  pairIndex: number;
  userMsg: string;
  agentReply: string;
  msgTs: number;
}

interface EnrichedPair extends RawPair {
  primaryIntent: string;
  secondaryIntents: string[];
  customerGoal: string;
  customerType: "new_lead" | "existing_customer" | "booked_customer" | "unknown";
  situation: string;
}

/** Extract the 10 most recent qualifying user→assistant pairs from a session's messageHistory */
function extractPairs(sessionId: number, messageHistoryJson: string, cutoffTs: number): RawPair[] {
  let history: Array<{ role: string; content?: string; ts?: number }> = [];
  try { history = JSON.parse(messageHistoryJson); } catch { return []; }

  const pairs: RawPair[] = [];
  for (let i = 0; i < history.length - 1; i++) {
    const userMsg = history[i];
    const agentMsg = history[i + 1];
    if (userMsg.role !== "user" && userMsg.role !== "customer") continue;
    if (agentMsg.role !== "assistant") continue;
    const userText = (userMsg.content ?? "").trim();
    const agentText = (agentMsg.content ?? "").trim();
    if (!userText || agentText.length < 20 || agentText.length > 500) continue;
    const msgTs = userMsg.ts ?? 0;
    if (msgTs < cutoffTs) continue; // pair-level timestamp check
    pairs.push({ sessionId, pairIndex: i, userMsg: userText, agentReply: agentText, msgTs });
  }

  // Return the 10 most recent qualifying pairs (not first 10)
  return pairs.sort((a, b) => b.msgTs - a.msgTs).slice(0, MAX_PAIRS_PER_SESSION);
}

/** Batch-classify pairs using a single LLM call (20 pairs per call) */
async function classifyBatch(pairs: RawPair[]): Promise<EnrichedPair[]> {
  const forgeApiUrl = ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0
    ? `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions`
    : "https://forge.manus.im/v1/chat/completions";

  const pairsInput = pairs.map(p => ({
    id: `${p.sessionId}:${p.pairIndex}`,
    userMsg: p.userMsg.slice(0, 300),
    agentReply: p.agentReply.slice(0, 300),
  }));

  const prompt = `You are classifying customer service SMS conversations for a residential cleaning company (Maids in Black, Washington DC).

For each pair below, return a JSON object with:
- primaryIntent: one of: reschedule, complaint, pricing_question, booking_inquiry, confirmation, cancel, compliment, eta_question, payment, address_question, general_question, other
- secondaryIntents: array of 0-2 additional intents from the same list
- customerGoal: short phrase (max 10 words) describing what the customer wants
- customerType: "new_lead" | "existing_customer" | "booked_customer" | "unknown"
- situation: one sentence describing the situation (max 20 words)

Return ONLY a JSON object: { "results": [ { "id": "...", "primaryIntent": "...", "secondaryIntents": [...], "customerGoal": "...", "customerType": "...", "situation": "..." }, ... ] }

Pairs to classify:
${JSON.stringify(pairsInput, null, 2)}`;

  try {
    const res = await fetch(forgeApiUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ENV.forgeApiKey}` },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        stream: false,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 4096,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    const content = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as { results?: Array<{ id: string; primaryIntent: string; secondaryIntents: string[]; customerGoal: string; customerType: string; situation: string }> };
    const resultMap = new Map((parsed.results ?? []).map(r => [r.id, r]));

    return pairs.map(p => {
      const r = resultMap.get(`${p.sessionId}:${p.pairIndex}`);
      return {
        ...p,
        primaryIntent: r?.primaryIntent ?? "other",
        secondaryIntents: r?.secondaryIntents ?? [],
        customerGoal: r?.customerGoal ?? "",
        customerType: (r?.customerType ?? "unknown") as EnrichedPair["customerType"],
        situation: r?.situation ?? "",
      };
    });
  } catch (err) {
    console.error("[CS_DRAFT_ENRICH] classifyBatch error:", err);
    // Return pairs with fallback classification rather than dropping them
    return pairs.map(p => ({ ...p, primaryIntent: "other", secondaryIntents: [], customerGoal: "", customerType: "unknown" as const, situation: "" }));
  }
}

export async function runCsDraftEnrichment(): Promise<{ processed: number; inserted: number; skipped: number }> {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");

  const cutoffTs = Date.now() - NINETY_DAYS_MS;
  const cutoffDate = new Date(cutoffTs);

  // Query resolved sessions updated in the last 90 days with enough messages
  const [sessions] = await db.execute(sql`
    SELECT id, messageHistory
    FROM conversation_sessions
    WHERE csResolvedAt IS NOT NULL
      AND messageCount >= 4
      AND lastMessageRole = 'assistant'
      AND updatedAt >= ${cutoffDate}
    ORDER BY updatedAt DESC
    LIMIT 200
  `);

  const sessionRows = sessions as Array<{ id: number; messageHistory: string }>;
  console.log(`[CS_DRAFT_ENRICH] Found ${sessionRows.length} candidate sessions`);

  // Get already-processed pairs to skip
  const [existingRows] = await db.execute(sql`
    SELECT sessionId, pairIndex FROM cs_draft_examples
    WHERE sessionId IN (${sql.raw(sessionRows.map(s => s.id).join(",") || "0")})
  `);
  const existingSet = new Set((existingRows as Array<{ sessionId: number; pairIndex: number }>).map(r => `${r.sessionId}:${r.pairIndex}`));

  // Extract new pairs
  const newPairs: RawPair[] = [];
  for (const session of sessionRows) {
    if (newPairs.length >= MAX_PAIRS_PER_RUN) break;
    const pairs = extractPairs(session.id, session.messageHistory ?? "[]", cutoffTs);
    for (const pair of pairs) {
      if (!existingSet.has(`${pair.sessionId}:${pair.pairIndex}`)) {
        newPairs.push(pair);
        if (newPairs.length >= MAX_PAIRS_PER_RUN) break;
      }
    }
  }

  console.log(`[CS_DRAFT_ENRICH] ${newPairs.length} new pairs to classify`);
  if (newPairs.length === 0) return { processed: 0, inserted: 0, skipped: 0 };

  // Classify in batches of BATCH_SIZE
  const enriched: EnrichedPair[] = [];
  for (let i = 0; i < newPairs.length; i += BATCH_SIZE) {
    const batch = newPairs.slice(i, i + BATCH_SIZE);
    const classified = await classifyBatch(batch);
    enriched.push(...classified);
  }

  // Insert enriched pairs
  let inserted = 0;
  let skipped = 0;
  for (const pair of enriched) {
    try {
      await db.execute(sql`
        INSERT IGNORE INTO cs_draft_examples
          (sessionId, pairIndex, userMsg, agentReply, msgTs, primaryIntent, secondaryIntents, customerGoal, customerType, situation, enrichedAt)
        VALUES
          (${pair.sessionId}, ${pair.pairIndex}, ${pair.userMsg}, ${pair.agentReply}, ${pair.msgTs},
           ${pair.primaryIntent}, ${JSON.stringify(pair.secondaryIntents)}, ${pair.customerGoal},
           ${pair.customerType}, ${pair.situation}, ${Date.now()})
      `);
      inserted++;
    } catch {
      skipped++;
    }
  }

  console.log(`[CS_DRAFT_ENRICH] Done: inserted=${inserted} skipped=${skipped}`);
  return { processed: newPairs.length, inserted, skipped };
}

export function registerCsDraftEnrichRoute(app: Express): void {
  app.post("/api/cron/cs-draft-enrich", async (req: Request, res: Response) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) { res.status(503).json({ error: "CRON_SECRET not configured" }); return; }
    const provided = req.headers["x-cron-secret"] ?? req.query.secret;
    if (provided !== secret) { res.status(401).json({ error: "Unauthorized" }); return; }
    try {
      const result = await runCsDraftEnrichment();
      res.json({ ok: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[CS_DRAFT_ENRICH] Error:", msg);
      res.status(500).json({ ok: false, error: msg });
    }
  });
  // GET handler so the endpoint can be triggered from a browser
  app.get("/api/cron/cs-draft-enrich", async (req: Request, res: Response) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) { res.status(503).json({ error: "CRON_SECRET not configured" }); return; }
    const provided = req.headers["x-cron-secret"] ?? req.query.secret;
    if (provided !== secret) { res.status(401).json({ error: "Unauthorized" }); return; }
    try {
      const result = await runCsDraftEnrichment();
      res.json({ ok: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[CS_DRAFT_ENRICH] Error:", msg);
      res.status(500).json({ ok: false, error: msg });
    }
  });
}
