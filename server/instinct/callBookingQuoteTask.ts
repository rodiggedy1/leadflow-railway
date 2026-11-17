import type { ProposedCustomerTask } from "../../shared/claudeCustomerTasks";
import type { CustomerCallSource } from "./claudeCustomerCalls";

/** A saved quote link is not a completed booking. Add only the requested human
 * follow-up to the existing call task; all other generated caller actions remain. */
export function withCallBookingQuoteTask(options: {
  hasSavedQuote: (callId: string) => Promise<boolean>;
  generate: (source: CustomerCallSource) => Promise<ProposedCustomerTask | null>;
}) {
  return async (source: CustomerCallSource): Promise<ProposedCustomerTask | null> => {
    const task = await options.generate(source);
    if (!await options.hasSavedQuote(source.providerCallId)) return task;
    // Full call remains the source; use one actual complete caller utterance, not
    // a generated quotation, a tool result, a guessed identity or assistant speech.
    const evidenceQuote = [...source.customerTurns].filter(turn => turn.trim()).sort((a, b) => b.length - a.length)[0];
    if (!evidenceQuote) throw new Error("CALL_QUOTE_TASK_SOURCE_UNAVAILABLE");
    const title = "Follow up on cleaning booking link";
    const item = { title: "Review the customer's booking-link completion", evidenceQuote };
    if (!task) return { title, items: [item] };
    return { ...task, items: [...task.items, item] };
  };
}
