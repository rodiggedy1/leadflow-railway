import { z } from "zod";
import { sql } from "drizzle-orm";
import { adminAgentProcedure, router } from "./_core/trpc";
import { getDb } from "./db";

const policyMode = z.enum(["approval_required", "suggest_only", "automatic"]);
const merchantId = "default";

const DEFAULT_POLICIES = [
  { actionKey: "classify_inbound_message", label: "Classify inbound messages", category: "understanding", description: "Categorize customer messages and identify the next best operational path." },
  { actionKey: "draft_sms_reply", label: "Draft SMS replies", category: "communication", description: "Prepare a customer reply for review before anything is sent." },
  { actionKey: "send_sms_reply", label: "Send SMS replies", category: "communication", description: "Send an approved or automatically permitted SMS reply." },
  { actionKey: "create_support_task", label: "Create support tasks", category: "customer_care", description: "Create a follow-up task for a cancellation, reschedule, service issue, or payment question." },
  { actionKey: "check_availability", label: "Check availability", category: "operations", description: "Read current schedule capacity to support a proposed booking or reschedule." },
  { actionKey: "change_booking", label: "Change a booking", category: "operations", description: "Apply a booking date, time, team, or service change after verification." },
  { actionKey: "cancel_booking", label: "Cancel a booking", category: "operations", description: "Cancel a booking after the customer request is verified." },
  { actionKey: "create_quote", label: "Create and send quote links", category: "revenue", description: "Build a quote link and send it to the customer when quote requirements are complete." },
] as const;

async function ensureDefaults(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  for (const policy of DEFAULT_POLICIES) {
    await db.execute(sql`
      INSERT INTO ai_action_policies (merchantId, actionKey, label, description, category, mode, enabled)
      VALUES (${merchantId}, ${policy.actionKey}, ${policy.label}, ${policy.description}, ${policy.category}, 'approval_required', 1)
      ON DUPLICATE KEY UPDATE label = VALUES(label), description = VALUES(description), category = VALUES(category)
    `);
  }
}

export const aiActionsRouter = router({
  listPolicies: adminAgentProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    await ensureDefaults(db);
    const [rows] = await db.execute(sql`
      SELECT id, merchantId, actionKey, label, description, category, mode, enabled, updatedBy, createdAt, updatedAt
      FROM ai_action_policies WHERE merchantId = ${merchantId} ORDER BY category, id
    `);
    return rows as Array<{
      id: number; merchantId: string; actionKey: string; label: string; description: string;
      category: string; mode: z.infer<typeof policyMode>; enabled: number; updatedBy: string | null;
      createdAt: Date; updatedAt: Date;
    }>;
  }),
  updatePolicy: adminAgentProcedure
    .input(z.object({ actionKey: z.string().min(1).max(96), mode: policyMode, enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await ensureDefaults(db);
      await db.execute(sql`
        UPDATE ai_action_policies
        SET mode = ${input.mode}, enabled = ${input.enabled ? 1 : 0}, updatedBy = ${ctx.agent.agentEmail}
        WHERE merchantId = ${merchantId} AND actionKey = ${input.actionKey}
      `);
      return { success: true as const };
    }),
});
