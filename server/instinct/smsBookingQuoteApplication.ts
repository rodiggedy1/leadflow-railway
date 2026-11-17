import { z } from "zod";
import { customerReplyPlanSchema, type CustomerReplyPlan } from "../../shared/claudeCustomerTasks";
import { reviewJsonSchema } from "../../shared/claudeSmsAlternative";
import { smsBookingQuoteStateSchema, smsBookingQuoteUpdateSchema } from "./smsBookingQuote";
import type { createSmsBookingQuoteStore } from "./smsBookingQuoteStore";
import type { CustomerSmsClaim } from "./claudeCustomerTasksStore";
import { appendBookingQuoteFollowup } from "./callBookingQuoteTask";

const preparationSchema = z.object({
  previous: smsBookingQuoteStateSchema.nullable(),
  update: smsBookingQuoteUpdateSchema,
  originalConversation: z.array(reviewJsonSchema),
  quoteTextTemplate: z.string().nullable(),
}).strict();
const preparedReplySchema = customerReplyPlanSchema.extend({ smsBookingQuote: preparationSchema }).strict();
type Store = ReturnType<typeof createSmsBookingQuoteStore>;

/** Used only by automatic SMS, inside the existing fresh task/reply transaction.
 * The model cannot provide this server-owned envelope, recipient or sender. */
export function createSmsBookingQuotePlanPreparer(store: Store, nowMs: () => number = Date.now, onLinkPrepared?: () => void) {
  return async (tx: Parameters<Store["prepare"]>[0], claim: CustomerSmsClaim, rawPlan: CustomerReplyPlan): Promise<CustomerReplyPlan | null> => {
    if (!("smsBookingQuote" in rawPlan)) return null;
    const plan = preparedReplySchema.parse(rawPlan);
    const prepared = await store.prepare(tx, {
      binding: claim.binding,
      ...plan.smsBookingQuote,
      replyText: plan.replyText,
      nowMs: nowMs(),
    });
    if (prepared.linkCreated) onLinkPrepared?.();
    const task = prepared.linkIncluded
      ? appendBookingQuoteFollowup(plan.task, claim.binding.inboundText)
      : plan.task;
    return customerReplyPlanSchema.parse({ replyText: prepared.planReplyText, task });
  };
}
