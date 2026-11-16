import { z } from "zod";

const positiveId = z.number().int().positive().refine(Number.isSafeInteger);
const text = z.string().min(1);
export const claudeSmsAlternativeGenerateInputSchema = z.object({
  sessionId: positiveId,
  providerMessageId: text,
  receivingPhoneNumberId: text,
  requestId: z.uuid(),
}).strict();

// Verbatim proven strict reply schema; operational fields are never accepted.
export const claudeSmsAlternativeReplySchema = z.object({ replyText: z.string().trim().min(1) }).strict();
export const claudeSmsAlternativeResultSchema = z.object({
  requestId: z.uuid(),
  sessionId: positiveId,
  providerMessageId: text,
  receivingPhoneNumberId: text,
  receivingPhoneNumber: z.string().regex(/^\+[1-9]\d{7,14}$/),
  replyText: z.string().min(1),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/),
  mode: z.literal("review_only"),
  smsSent: z.literal(false),
  actionsExecuted: z.literal(false),
  agentId: text,
  agentSessionId: text,
}).strict();
export type ClaudeSmsAlternativeGenerateInput = z.infer<typeof claudeSmsAlternativeGenerateInputSchema>;
export type ClaudeSmsAlternativeResult = z.infer<typeof claudeSmsAlternativeResultSchema>;

// Saved JSON is preserved completely, including old/undated/outgoing metadata.
export type ReviewJson = null | boolean | number | string | ReviewJson[] | { [key: string]: ReviewJson };
export const reviewJsonSchema: z.ZodType<ReviewJson> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string(), z.array(reviewJsonSchema), z.record(z.string(), reviewJsonSchema),
]));
