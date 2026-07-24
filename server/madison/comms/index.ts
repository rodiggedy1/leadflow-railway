/**
 * server/madison/comms/index.ts
 * Orchestrates the Madison Communications pipeline:
 *   Gate → Planner → Validator → SmsPreview
 * Does NOT send SMS — returns a bulk_sms_confirm card for the agent to confirm.
 */
import { createCommsPlan } from "./planner";
export { isCommsDomain, evaluateCommsGate } from "./gate";
import { resolveCommsTarget } from "./validator";
import { buildSmsPreview } from "./smsService";
import type { CommsSmsPreview } from "./smsService";

type Db = NonNullable<Awaited<ReturnType<typeof import("../../db").getDb>>>;

export type CommsResult =
  | { handled: true; response: CommsSmsPreview | { type: "client_disambiguation"; query: string; messageHint: string | null; matches: Array<{ entityType: string; entityId: string; displayName: string; phone: string; contextLabel: string }> } | { type: "needs_clarification"; message: string } }
  | { handled: false; fallbackReason: string };

export async function handleMadisonComms(
  db: Db,
  message: string,
  rid: string,
  agentId: number
): Promise<CommsResult> {
  console.log(`[Comms:${rid}] start msg="${message}"`);

  // Step 1: Plan
  let plan;
  try {
    plan = await createCommsPlan(message);
    console.log(`[Comms:${rid}] plan=`, JSON.stringify(plan));
  } catch (err) {
    console.error(`[Comms:${rid}] planner error`, err);
    return { handled: false, fallbackReason: "Planner failed" };
  }

  // Step 2: Validate / resolve entities
  let validatorResult;
  try {
    validatorResult = await resolveCommsTarget(plan, db);
    console.log(`[Comms:${rid}] validator kind=${validatorResult.kind}`);
  } catch (err) {
    console.error(`[Comms:${rid}] validator error`, err);
    return { handled: false, fallbackReason: "Validator failed" };
  }

  if (validatorResult.kind === "needs_clarification") {
    return { handled: true, response: { type: "needs_clarification", message: validatorResult.reason } };
  }

  if (validatorResult.kind === "not_found") {
    return { handled: true, response: { type: "needs_clarification", message: validatorResult.message } };
  }

  if (validatorResult.kind === "disambiguation") {
    return {
      handled: true,
      response: {
        type: "client_disambiguation",
        query: validatorResult.targetRef,
        messageHint: validatorResult.messageHint,
        // Map CommsRecipient to ClientDisambiguationResult match shape
        matches: validatorResult.matches.map(m => ({
          phone: m.phone,
          name: m.displayName,
          city: m.contextLabel,
          totalCleans: 0,
          ltv: 0,
          lastJobDate: null,
          entityType: m.entityType as "customer" | "cleaner",
          cleanerProfileId: m.entityType === "cleaner"
            ? parseInt(m.entityId.replace("cleaner:", ""), 10) || undefined
            : undefined,
        })),
      },
    };
  }

  // Step 3: Build SMS preview (draft message + confirm card)
  const { recipients, targetDescription, excludedCount, excludedReasons } = validatorResult;
  const messageHint = plan.messageHint!;

  let preview: CommsSmsPreview;
  try {
    preview = await buildSmsPreview(recipients, targetDescription, messageHint, message, excludedCount, excludedReasons);
  } catch (err) {
    console.error(`[Comms:${rid}] smsService error`, err);
    return { handled: false, fallbackReason: "Message drafting failed" };
  }

  return { handled: true, response: preview };
}
