import { z } from "zod";

/** Optional internal-only input. It cannot claim an automatic send. */
export const claudeDraftSourceSchema = z.object({
  requestId: z.string().uuid(),
  kind: z.enum(["initial_lead", "sms_reply"]),
}).strict();
export type ClaudeDraftSource = z.infer<typeof claudeDraftSourceSchema>;

/** Truthful provider/model identity for the existing direct WorldClass call. */
export const CHATGPT_WORLDCLASS_GENERATOR_ID = "openai:gpt-4o";
const automaticSchema = z.object({
  version: z.literal(1), generator: z.enum(["claude", "chatgpt"]), mode: z.literal("automatic"),
  workflow: z.literal("thumbtack_first_response"),
  receiptId: z.number().int().positive(), providerMessageId: z.string().min(1),
}).strict();
const reviewedSchema = z.object({
  version: z.literal(1), generator: z.literal("claude"), mode: z.literal("human_reviewed"),
  requestId: z.string().uuid(), kind: z.enum(["initial_lead", "sms_reply"]),
  reviewedBy: z.string().min(1),
}).strict();
export const smsSenderProvenanceSchema = z.discriminatedUnion("mode", [automaticSchema, reviewedSchema]);
export type SmsSenderProvenance = z.infer<typeof smsSenderProvenanceSchema>;

/** Only the existing server automatic acceptance path supplies this marker. */
export function automaticClaudeSmsProvenance(receiptId: number, providerMessageId: string): SmsSenderProvenance {
  return automaticSchema.parse({ version: 1, generator: "claude", mode: "automatic",
    workflow: "thumbtack_first_response", receiptId, providerMessageId });
}

export function automaticChatGptSmsProvenance(receiptId: number, providerMessageId: string): SmsSenderProvenance {
  return automaticSchema.parse({ version: 1, generator: "chatgpt", mode: "automatic",
    workflow: "thumbtack_first_response", receiptId, providerMessageId });
}

/** Attribution is optional; absence/invalid metadata must not change sending. */
export function reviewedClaudeSmsProvenance(source: unknown, reviewer: unknown): SmsSenderProvenance | null {
  const parsed = claudeDraftSourceSchema.safeParse(source);
  if (!parsed.success || typeof reviewer !== "string" || !reviewer.trim()) return null;
  return { version: 1, generator: "claude", mode: "human_reviewed", ...parsed.data, reviewedBy: reviewer.trim() };
}

export interface SmsSenderLabelMessage {
  role: string;
  senderName?: string | null;
  opMsgId?: string;
  smsProvenance?: unknown;
}
export function smsSenderLabel(message: SmsSenderLabelMessage, fallback: string): string {
  const sender = message.senderName?.trim() || fallback;
  if (message.role !== "assistant") return sender;
  const parsed = smsSenderProvenanceSchema.safeParse(message.smsProvenance);
  if (!parsed.success) return sender;
  const provenance = parsed.data;
  if (provenance.mode === "automatic") {
    return message.opMsgId && message.opMsgId === provenance.providerMessageId
      ? provenance.generator === "chatgpt" ? "ChatGPT · Automatic" : "Claude AI · Automatic" : sender;
  }
  return `${message.senderName?.trim() || provenance.reviewedBy} · Claude draft`;
}
