import { createHash } from "node:crypto";
import type { Express, Request, Response } from "express";
import { parse as parseCookieHeader } from "cookie";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { invokeLLM } from "./_core/llm";
import { getAgentFromRequest } from "./_core/agentAuth";
import { sdk } from "./_core/sdk";
import { COOKIE_NAME } from "@shared/const";

/**
 * SMS shadow mode deliberately has no outbound delivery dependency. It evaluates
 * a human-visible draft and records only the simulated decision plus the result
 * of a human's later send. Nothing in this module can send an SMS.
 */
export const SMS_SHADOW_POLICY_VERSION = "sms-shadow-v1";

export type ShadowDecisionKind = "would_send" | "review" | "blocked";
export type ShadowOutcome = "sent_unchanged" | "sent_edited";

type Preflight = {
  eligibleCourtesy: boolean;
  inboundQuestion: boolean;
  draftQuestion: boolean;
  hardStops: string[];
};

type VerifierResult = {
  confidence: number;
  wouldSendIfInScope: boolean;
  safeToSimulate: boolean;
  category: string;
  reasonCode: string;
  rationale: string;
  flags: string[];
};

export type SmsShadowDecision = {
  evaluationId: number;
  policyVersion: string;
  decision: ShadowDecisionKind;
  score: number;
  confidence: number;
  wouldSendIfInScope: boolean;
  reasonCode: string;
  rationale: string;
  preflight: Preflight;
  verifier: VerifierResult | null;
  outcome: ShadowOutcome | null;
  outcomeAt: string | null;
};

const HIGH_CONFIDENCE_THRESHOLD = 0.98;
const MAX_DRAFT_CHARS = 2_000;

const HIGH_IMPACT_TERMS = [
  "reschedule", "cancel", "cancellation", "appointment", "booking", "booked",
  "schedule", "availability", "available", "price", "pricing", "quote", "cost",
  "payment", "pay", "charged", "charge", "refund", "fee", "card", "invoice",
  "damage", "broken", "missing", "stolen", "complaint", "unhappy", "disappointed",
  "unsafe", "emergency", "police", "lawyer", "legal", "injury", "hurt",
  "key", "code", "lock", "alarm", "gate", "access", "address",
  "late", "no show", "not here", "where is", "eta", "when will",
];

const DRAFT_COMMITMENT_TERMS = [
  "we will", "we'll", "we can", "you are booked", "you're booked", "confirmed",
  "scheduled", "rescheduled", "cancelled", "canceled", "refunded", "charged",
  "your total", "your appointment", "arrive at", "on our way",
];

function asRows<T>(result: unknown): T[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as T[];
  return Array.isArray(result) ? result as T[] : [];
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function findTerms(value: string, terms: string[]): string[] {
  const lower = normalized(value);
  return terms.filter(term => lower.includes(term));
}

function isCourtesyAcknowledgement(inboundText: string): boolean {
  const text = normalized(inboundText);
  return /\b(thank(?:s| you)|appreciate|love(?:d)?|amazing|awesome|wonderful|perfect|great job|looks great|beautiful|fantastic)\b/.test(text);
}

export function buildShadowPreflight(inboundText: string, draftText: string): Preflight {
  const inboundStops = findTerms(inboundText, HIGH_IMPACT_TERMS).map(term => `inbound:${term}`);
  const draftStops = findTerms(draftText, [...HIGH_IMPACT_TERMS, ...DRAFT_COMMITMENT_TERMS]).map(term => `draft:${term}`);
  return {
    eligibleCourtesy: isCourtesyAcknowledgement(inboundText),
    inboundQuestion: inboundText.includes("?"),
    draftQuestion: draftText.includes("?"),
    hardStops: Array.from(new Set([...inboundStops, ...draftStops])),
  };
}

export function selectShadowDecision(preflight: Preflight, verifier: VerifierResult | null): Omit<SmsShadowDecision, "evaluationId" | "policyVersion" | "outcome" | "outcomeAt"> {
  const score = verifier ? Math.round(verifier.confidence * 100) : 0;
  const confidence = verifier?.confidence ?? 0;
  const wouldSendIfInScope = Boolean(
    verifier?.wouldSendIfInScope
      && verifier.confidence >= HIGH_CONFIDENCE_THRESHOLD
      && verifier.flags.length === 0,
  );

  if (preflight.hardStops.length > 0) {
    return {
      decision: "blocked",
      score,
      confidence,
      wouldSendIfInScope,
      reasonCode: "high_impact_topic",
      rationale: "Shadow mode blocks this category because it could change a booking, payment, access, service outcome, or safety response.",
      preflight,
      verifier,
    };
  }

  if (preflight.inboundQuestion || preflight.draftQuestion) {
    return {
      decision: "review",
      score,
      confidence,
      wouldSendIfInScope,
      reasonCode: "question_requires_human_review",
      rationale: "A question needs a human review even when the draft sounds straightforward.",
      preflight,
      verifier,
    };
  }

  if (!preflight.eligibleCourtesy) {
    return {
      decision: "review",
      score,
      confidence,
      wouldSendIfInScope,
      reasonCode: "outside_courtesy_allowlist",
      rationale: "The initial shadow policy only simulates low-risk courtesy acknowledgements.",
      preflight,
      verifier,
    };
  }

  if (!verifier) {
    return {
      decision: "review",
      score: 0,
      confidence: 0,
      wouldSendIfInScope: false,
      reasonCode: "verifier_unavailable",
      rationale: "The independent verifier did not return a usable result, so this remains human review.",
      preflight,
      verifier: null,
    };
  }

  const wouldSend = verifier.safeToSimulate
    && verifier.category === "compliment_acknowledgement"
    && verifier.confidence >= HIGH_CONFIDENCE_THRESHOLD
    && verifier.flags.length === 0;

  return {
    decision: wouldSend ? "would_send" : "review",
    score,
    confidence: verifier.confidence,
    wouldSendIfInScope,
    reasonCode: wouldSend ? "high_confidence_courtesy" : verifier.reasonCode || "verifier_requires_review",
    rationale: verifier.rationale || "The independent verifier requires a human review.",
    preflight,
    verifier,
  };
}

async function isAuthorizedOpsUser(req: Request): Promise<{ actor: string } | null> {
  const agent = await getAgentFromRequest(req);
  if (agent) return { actor: agent.agentEmail };
  try {
    const cookies = parseCookieHeader(req.headers.cookie ?? "");
    const session = await sdk.verifySession(cookies[COOKIE_NAME]);
    if (session) return { actor: "manus_owner" };
  } catch {
    // An invalid owner cookie falls through to the ordinary unauthorized response.
  }
  return null;
}

function latestCustomerMessage(messageHistory: unknown): string | null {
  try {
    const parsed = typeof messageHistory === "string" ? JSON.parse(messageHistory) : messageHistory;
    if (!Array.isArray(parsed)) return null;
    for (let index = parsed.length - 1; index >= 0; index -= 1) {
      const message = parsed[index] as { role?: unknown; content?: unknown };
      if (message?.role === "user" && typeof message.content === "string" && message.content.trim()) {
        return message.content.trim();
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function evaluateDraftConfidence(params: { inboundText: string; draftText: string }): Promise<VerifierResult | null> {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are an independent evaluator for an SMS shadow-mode experiment. You never write or send a reply. Score the proposed response's quality for the inbound customer message, even when the topic is booking, scheduling, payment, access, a complaint, damage, safety, or another high-impact subject.

confidence means confidence from 0 to 1 that the proposed response is appropriate, accurate, grounded in the supplied message, and safe for a human to review and send. It does NOT mean the system may auto-send it. Identify the message category and any concerns in flags. Be conservative: a missing fact, invented commitment, incorrect claim, or unsafe advice lowers confidence.

wouldSendIfInScope answers a hypothetical question: assuming this message category were explicitly allowed for automatic sending, would this exact proposed draft meet the automatic-send quality bar? Set it true only when confidence is at least 0.98, flags is empty, and the draft is appropriate and grounded. This is a simulated quality judgment only; it never changes the live sending policy.

safeToSimulate is a separate, much narrower flag. Set it true only for a simple compliment acknowledgement: positive sentiment, no question, no request, no booking/service/access/payment/pricing/operational change, and a draft that is only a simple acknowledgement with no promise, new fact, or follow-up question. Set it false for every other category, including any high-impact topic, regardless of confidence.

Return JSON only. The rationale must be one short generic sentence without names, phone numbers, addresses, or quoting the message.`,
      },
      {
        role: "user",
        content: JSON.stringify({ inboundText: params.inboundText, proposedDraft: params.draftText }),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "sms_shadow_verifier",
        strict: true,
        schema: {
          type: "object",
          properties: {
            confidence: { type: "number" },
            wouldSendIfInScope: { type: "boolean" },
            safeToSimulate: { type: "boolean" },
            category: { type: "string" },
            reasonCode: { type: "string" },
            rationale: { type: "string" },
            flags: { type: "array", items: { type: "string" } },
          },
          required: ["confidence", "wouldSendIfInScope", "safeToSimulate", "category", "reasonCode", "rationale", "flags"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices?.[0]?.message?.content;
  const parsed = typeof content === "string" ? JSON.parse(content) : content;
  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as Partial<VerifierResult>;
  return {
    confidence: Math.max(0, Math.min(1, Number(candidate.confidence) || 0)),
    wouldSendIfInScope: candidate.wouldSendIfInScope === true,
    safeToSimulate: candidate.safeToSimulate === true,
    category: typeof candidate.category === "string" ? candidate.category : "unknown",
    reasonCode: typeof candidate.reasonCode === "string" ? candidate.reasonCode : "verifier_requires_review",
    rationale: typeof candidate.rationale === "string" ? candidate.rationale.slice(0, 360) : "The independent verifier requires a human review.",
    flags: Array.isArray(candidate.flags) ? candidate.flags.filter((flag): flag is string => typeof flag === "string").slice(0, 8) : [],
  };
}

function asDecision(row: Record<string, unknown>): SmsShadowDecision {
  const parseJson = <T>(value: unknown, fallback: T): T => {
    try { return (typeof value === "string" ? JSON.parse(value) : value) as T ?? fallback; } catch { return fallback; }
  };
  const verifier = parseJson<VerifierResult | null>(row.verifierResult, null);
  return {
    evaluationId: Number(row.id),
    policyVersion: String(row.policyVersion),
    decision: row.decision === "would_send" || row.decision === "blocked" ? row.decision : "review",
    score: Number(row.score) || 0,
    confidence: Number(row.confidence) || 0,
    wouldSendIfInScope: Boolean(
      verifier?.wouldSendIfInScope
        && verifier.confidence >= HIGH_CONFIDENCE_THRESHOLD
        && verifier.flags.length === 0,
    ),
    reasonCode: String(row.reasonCode ?? "verifier_requires_review"),
    rationale: String(row.rationale ?? "The independent verifier requires a human review."),
    preflight: parseJson<Preflight>(row.preflight, { eligibleCourtesy: false, inboundQuestion: false, draftQuestion: false, hardStops: [] }),
    verifier,
    outcome: row.outcome === "sent_unchanged" || row.outcome === "sent_edited" ? row.outcome : null,
    outcomeAt: row.outcomeAt ? new Date(row.outcomeAt as string | Date).toISOString() : null,
  };
}

export function registerSmsShadowModeRoutes(app: Express): void {
  app.post("/api/sms-shadow-evaluations", async (req: Request, res: Response) => {
    const auth = await isAuthorizedOpsUser(req);
    if (!auth) return void res.status(401).json({ error: "Unauthorized" });

    const sessionId = Number(req.body?.sessionId);
    const draftText = typeof req.body?.draftText === "string" ? req.body.draftText.trim() : "";
    if (!Number.isSafeInteger(sessionId) || sessionId <= 0 || !draftText || draftText.length > MAX_DRAFT_CHARS) {
      return void res.status(400).json({ error: "A valid session and draft are required." });
    }

    const db = await getDb();
    if (!db) return void res.status(503).json({ error: "Database unavailable" });

    try {
      const sessions = asRows<{ messageHistory: string | null }>(await db.execute(sql`
        SELECT messageHistory
        FROM conversation_sessions
        WHERE id = ${sessionId}
        LIMIT 1
      `));
      const inboundText = latestCustomerMessage(sessions[0]?.messageHistory);
      if (!inboundText) return void res.status(409).json({ error: "No inbound customer message is available for this session." });

      const draftHash = hash(draftText);
      const existing = asRows<Record<string, unknown>>(await db.execute(sql`
        SELECT id, policyVersion, decision, score, confidence, reasonCode, rationale,
               preflight, verifierResult, outcome, outcomeAt
        FROM sms_shadow_evaluations
        WHERE sessionId = ${sessionId}
          AND draftHash = ${draftHash}
          AND policyVersion = ${SMS_SHADOW_POLICY_VERSION}
        LIMIT 1
      `));
      if (existing[0]) return void res.json({ evaluation: asDecision(existing[0]), source: "cached" });

      const preflight = buildShadowPreflight(inboundText, draftText);
      let verifier: VerifierResult | null = null;
      try {
        verifier = await evaluateDraftConfidence({ inboundText, draftText });
      } catch (error) {
        console.warn("[SmsShadow] verifier unavailable", error instanceof Error ? error.message : String(error));
      }
      const evaluated = selectShadowDecision(preflight, verifier);
      const now = new Date();
      const insertResult = await db.execute(sql`
        INSERT INTO sms_shadow_evaluations (
          sessionId, draftHash, policyVersion, source, decision, score, confidence,
          reasonCode, rationale, preflight, verifierResult, createdAt, updatedAt
        ) VALUES (
          ${sessionId}, ${draftHash}, ${SMS_SHADOW_POLICY_VERSION}, ${"sms_exact_live"},
          ${evaluated.decision}, ${evaluated.score}, ${evaluated.confidence},
          ${evaluated.reasonCode}, ${evaluated.rationale}, ${JSON.stringify(evaluated.preflight)},
          ${JSON.stringify(evaluated.verifier)}, ${now}, ${now}
        )
      `);
      const insertHeader = (Array.isArray(insertResult) ? insertResult[0] : insertResult) as { insertId?: number } | undefined;
      const evaluationId = Number(insertHeader?.insertId);
      if (!Number.isInteger(evaluationId) || evaluationId <= 0) {
        throw new Error("Shadow evaluation insert did not return an identifier");
      }
      const evaluation: SmsShadowDecision = {
        evaluationId,
        policyVersion: SMS_SHADOW_POLICY_VERSION,
        ...evaluated,
        outcome: null,
        outcomeAt: null,
      };
      return void res.json({ evaluation, source: "new" });
    } catch (error) {
      console.error("[SmsShadow] evaluation failed", error);
      return void res.status(500).json({ error: "Unable to evaluate the shadow decision." });
    }
  });

  app.post("/api/sms-shadow-evaluations/:evaluationId/outcome", async (req: Request, res: Response) => {
    const auth = await isAuthorizedOpsUser(req);
    if (!auth) return void res.status(401).json({ error: "Unauthorized" });

    const evaluationId = Number(req.params.evaluationId);
    const sessionId = Number(req.body?.sessionId);
    const sentText = typeof req.body?.sentText === "string" ? req.body.sentText.trim() : "";
    if (!Number.isSafeInteger(evaluationId) || evaluationId <= 0 || !Number.isSafeInteger(sessionId) || sessionId <= 0 || !sentText) {
      return void res.status(400).json({ error: "A valid evaluation, session, and sent text are required." });
    }

    const db = await getDb();
    if (!db) return void res.status(503).json({ error: "Database unavailable" });

    try {
      const rows = asRows<{ draftHash: string }>(await db.execute(sql`
        SELECT draftHash
        FROM sms_shadow_evaluations
        WHERE id = ${evaluationId} AND sessionId = ${sessionId}
        LIMIT 1
      `));
      const row = rows[0];
      if (!row) return void res.status(404).json({ error: "Shadow evaluation not found." });
      const sentHash = hash(sentText);
      const outcome: ShadowOutcome = sentHash === row.draftHash ? "sent_unchanged" : "sent_edited";
      const now = new Date();
      await db.execute(sql`
        UPDATE sms_shadow_evaluations
        SET outcome = ${outcome}, outcomeAt = ${now}, outcomeActor = ${auth.actor}, sentDraftHash = ${sentHash}, updatedAt = ${now}
        WHERE id = ${evaluationId} AND sessionId = ${sessionId}
      `);
      return void res.json({ outcome });
    } catch (error) {
      console.error("[SmsShadow] outcome recording failed", error);
      return void res.status(500).json({ error: "Unable to record the shadow outcome." });
    }
  });
}
