import { z } from "zod";

export const CLAUDE_CUSTOMER_TASK_ACTION = "claude_customer_task" as const;
export const CLAUDE_CUSTOMER_REPLY_CAPABILITY = "claude_customer_reply_v1" as const;
export const taskActorSchema = z.object({ id: z.string().min(1), name: z.string().min(1) }).strict();
export type TaskActor = z.infer<typeof taskActorSchema>;
export const proposedCustomerTaskSchema = z.object({
  title: z.string().trim().min(1),
  items: z.array(z.object({ title: z.string().trim().min(1), evidenceQuote: z.string().trim().min(1) }).strict()).min(1),
}).strict();
export const customerReplyPlanSchema = z.object({
  replyText: z.string().trim().min(1), task: proposedCustomerTaskSchema.nullable(),
}).strict();
export type CustomerReplyPlan = z.infer<typeof customerReplyPlanSchema>;
export const customerTaskSchema = z.object({
  id: z.number().int().positive(), version: z.literal(1), kind: z.literal(CLAUDE_CUSTOMER_TASK_ACTION),
  sessionId: z.number().int().positive(), customerName: z.string().nullable(), customerPhone: z.string().min(1),
  sourceMessageId: z.string().min(1), sourceText: z.string().min(1), receivedAt: z.number().finite(),
  receivingPhoneNumberId: z.string().min(1), receivingPhoneNumber: z.string().min(1),
  title: z.string().min(1),
  items: z.array(z.object({ id: z.string().min(1), title: z.string().min(1), evidenceQuote: z.string().min(1), completedBy: taskActorSchema.nullable(), completedAt: z.number().finite().nullable() }).strict()).min(1),
  status: z.enum(["unclaimed", "claimed", "done"]), owner: taskActorSchema.nullable(),
  claimedAt: z.number().finite().nullable(), completedAt: z.number().finite().nullable(),
  completedBy: taskActorSchema.nullable(), completionNote: z.string().nullable(),
  reply: z.object({ text: z.string().min(1), status: z.enum(["prepared", "sent", "uncertain", "suppressed"]), providerMessageId: z.string().nullable() }).strict(),
  activity: z.array(z.object({ action: z.enum(["created", "claimed", "item_completed", "completed"]), actor: taskActorSchema.nullable(), at: z.number().finite(), note: z.string().nullable() }).strict()),
}).strict();
export type CustomerTask = z.infer<typeof customerTaskSchema>;
export type ProposedCustomerTask = z.infer<typeof proposedCustomerTaskSchema>;
