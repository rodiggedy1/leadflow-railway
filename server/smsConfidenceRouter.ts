import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { invokeLLM } from "./_core/llm";
import { opsChatProcedure, router } from "./_core/trpc";

const SMS_CONFIDENCE_THRESHOLD = 98;

const evaluationInput = z.object({
  conversationContext: z.string().min(1).max(12_000),
  draftText: z.string().min(1).max(2_000),
});

type ConfidenceEvaluation = {
  confidence: number;
  wouldSendIfAllTopicsAllowed: boolean;
  category: string;
  rationale: string;
  flags: string[];
};

function rawConfidencePercent(value: unknown): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return 0;
  return Math.max(0, Math.min(100, normalized));
}

export function normalizeSmsConfidence(value: Partial<ConfidenceEvaluation>): ConfidenceEvaluation {
  const rawConfidence = rawConfidencePercent(value.confidence);
  const confidence = Math.round(rawConfidence);
  const flags = Array.isArray(value.flags)
    ? value.flags.filter((flag): flag is string => typeof flag === "string" && flag.trim().length > 0).slice(0, 5)
    : [];

  return {
    confidence,
    // This is a simulated quality bar only. It never changes live send behavior.
    wouldSendIfAllTopicsAllowed: value.wouldSendIfAllTopicsAllowed === true && rawConfidence >= SMS_CONFIDENCE_THRESHOLD && flags.length === 0,
    category: typeof value.category === "string" && value.category.trim() ? value.category.trim().slice(0, 80) : "unknown",
    rationale: typeof value.rationale === "string" && value.rationale.trim()
      ? value.rationale.trim().slice(0, 240)
      : "The evaluator could not provide a rationale.",
    flags,
  };
}

/**
 * Read-only evaluator for the existing SMS workspace draft. It has no database,
 * delivery, queue, Command Chat, or streaming-route dependency.
 */
export const smsConfidenceRouter = router({
  evaluate: opsChatProcedure
    .input(evaluationInput)
    .mutation(async ({ input }) => {
      try {
        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `You are a strict quality evaluator for a proposed customer-service SMS reply. You do not write, send, modify, or store messages.

Assess the proposed draft only against the supplied conversation. Return a confidence percentage from 0 to 100 for whether the exact draft is appropriate, grounded in the conversation, internally consistent, and safe for a human to send. Lower confidence for missing facts, invented commitments, incorrect claims, or unclear next steps.

wouldSendIfAllTopicsAllowed is a hypothetical quality judgment: assume every topic category is allowed for automation, then set it true only if confidence is at least 98 and flags is empty. This field never permits or sends a message.

The rationale must be one short generic sentence without names, phone numbers, addresses, or quoted message text.`,
            },
            {
              role: "user",
              content: JSON.stringify({
                conversation: input.conversationContext,
                proposedDraft: input.draftText,
              }),
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "sms_confidence_evaluation",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  confidence: { type: "number" },
                  wouldSendIfAllTopicsAllowed: { type: "boolean" },
                  category: { type: "string" },
                  rationale: { type: "string" },
                  flags: { type: "array", items: { type: "string" } },
                },
                required: ["confidence", "wouldSendIfAllTopicsAllowed", "category", "rationale", "flags"],
                additionalProperties: false,
              },
            },
          },
        });

        const content = response.choices?.[0]?.message?.content;
        const parsed = typeof content === "string" ? JSON.parse(content) : content;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Confidence evaluator returned an invalid result");
        }
        return normalizeSmsConfidence(parsed as Partial<ConfidenceEvaluation>);
      } catch (error) {
        console.error("[SmsConfidence] evaluation failed", error);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Unable to score this draft." });
      }
    }),
});
