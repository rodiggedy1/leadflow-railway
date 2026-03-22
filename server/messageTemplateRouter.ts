/**
 * messageTemplateRouter.ts
 * Editable SMS copy for Reactivation and Post-Sale Review flows.
 *
 * Procedures:
 *   messageTemplates.list(flowType)   — all templates for a flow, ordered by id
 *   messageTemplates.update(id, body) — admin-only, update the body of an editable template
 *   messageTemplates.reset(id)        — admin-only, restore template to its DEFAULT_TEMPLATES value
 *   messageTemplates.seed             — idempotent seed of default templates (admin only)
 *
 * Server helper (not a tRPC procedure):
 *   getTemplate(stepKey, vars?)       — fetch body from DB, fall back to DEFAULT_TEMPLATES, substitute vars
 */
import { router, adminAgentProcedure } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import { messageTemplates } from "../drizzle/schema";
import { eq, asc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// ─── Default templates ────────────────────────────────────────────────────────

export const DEFAULT_TEMPLATES = [
  // ── Reactivation ──────────────────────────────────────────────────────────
  {
    flowType: "reactivation" as const,
    stepKey: "reactivation_initial",
    label: "Initial Outreach",
    triggerLabel: "Sent when campaign launches",
    body: "Hi [Name]! 👋 It's been a while since your last home cleaning with Maids in Black. We miss you! As a returning customer, we'd love to offer you [Discount]% off your next clean. Reply YES to book and we'll take care of everything on our end.",
    variables: JSON.stringify(["[Name]", "[Discount]"]),
    isEditable: 1,
  },
  {
    flowType: "reactivation" as const,
    stepKey: "reactivation_yes_reply",
    label: "Reply: Customer Says YES",
    triggerLabel: "Sent when customer replies YES / positive",
    body: "Amazing, [Name]! Let's get you scheduled. What days work best for you — mornings or afternoons?",
    variables: JSON.stringify(["[Name]"]),
    isEditable: 1,
  },
  {
    flowType: "reactivation" as const,
    stepKey: "reactivation_price_question",
    label: "Reply: Customer Asks About Price",
    triggerLabel: "Sent when customer asks how much it costs",
    body: "Hi [Name]! Your last clean with us was $[LastPrice]. With your [Discount]% returning customer discount, your next clean would be just $[DiscountedPrice]. Ready to get your home sparkling again? What days work best for you?",
    variables: JSON.stringify(["[Name]", "[LastPrice]", "[Discount]", "[DiscountedPrice]"]),
    isEditable: 1,
  },
  {
    flowType: "reactivation" as const,
    stepKey: "reactivation_time_ask",
    label: "Reply: Ask for Time Window",
    triggerLabel: "Sent after YES or price question — asks for preferred time",
    body: "Great! Can you give me a time window that works best for you? Looking forward to your cleaning appointment 🏠",
    variables: JSON.stringify([]),
    isEditable: 1,
  },
  {
    flowType: "reactivation" as const,
    stepKey: "reactivation_closing",
    label: "Closing Confirmation",
    triggerLabel: "Sent when customer gives their preferred time window",
    body: "Ok perfect, we'll confirm in a few moments but we should be good to go. See you soon [Name] 🎉",
    variables: JSON.stringify(["[Name]"]),
    isEditable: 1,
  },
  {
    flowType: "reactivation" as const,
    stepKey: "reactivation_opt_out",
    label: "Reply: Customer Opts Out",
    triggerLabel: "Sent when customer replies STOP / unsubscribe",
    body: "You've been unsubscribed and won't receive further messages from us. Have a great day! 🏠",
    variables: JSON.stringify([]),
    isEditable: 0, // locked — legal requirement
  },

  // ── Post-Sale Review ───────────────────────────────────────────────────────
  {
    flowType: "review" as const,
    stepKey: "review_initial",
    label: "Initial Feedback Request",
    triggerLabel: "Sent 24 hours after the job date",
    body: "Hi [Name]! 🏠 How did your cleaning go today? We'd love to hear your feedback — just reply and let us know!",
    variables: JSON.stringify(["[Name]"]),
    isEditable: 1,
  },
  {
    flowType: "review" as const,
    stepKey: "review_positive_response",
    label: "Reply: Customer is Happy (Positive)",
    triggerLabel: "Sent when customer gives positive feedback",
    body: "That's wonderful to hear, [Name]! 🎉 Since you're happy with the clean, we'd love if you could leave us a quick Google review — it really helps our small business grow. As a thank-you, we'll give you 10% off your next booking. Here's the link: [GoogleReviewUrl] — once you've left a review, just reply and we'll apply your discount right away!",
    variables: JSON.stringify(["[Name]", "[GoogleReviewUrl]"]),
    isEditable: 1,
  },
  {
    flowType: "review" as const,
    stepKey: "review_negative_response",
    label: "Reply: Customer is Unhappy (Negative)",
    triggerLabel: "Sent when customer gives negative feedback",
    body: "We're so sorry to hear that, [Name] — that's not the experience we want for you. A member of our team will reach out shortly to make it right. 💛",
    variables: JSON.stringify(["[Name]"]),
    isEditable: 1,
  },
  {
    flowType: "review" as const,
    stepKey: "review_confirmed_response",
    label: "Reply: Customer Confirms Review Left",
    triggerLabel: "Sent when customer confirms they left a Google review",
    body: "Thank you so much, [Name]! 🌟 Your 10% discount is saved for your next booking — just mention it when you're ready to schedule and we'll take care of you. See you next time!",
    variables: JSON.stringify(["[Name]"]),
    isEditable: 1,
  },
  {
    flowType: "review" as const,
    stepKey: "review_opt_out",
    label: "Reply: Customer Opts Out",
    triggerLabel: "Sent when customer replies STOP / unsubscribe",
    body: "You've been unsubscribed and won't receive further messages from us. Have a great day! 🏠",
    variables: JSON.stringify([]),
    isEditable: 0, // locked — legal requirement
  },
];

// ─── Server helper ────────────────────────────────────────────────────────────

/**
 * Fetch a template body from the DB by stepKey.
 * Falls back to the DEFAULT_TEMPLATES value if the DB row doesn't exist yet.
 * Optionally substitutes variables: pass { "[Name]": "Sarah", "[Discount]": "10" }.
 */
export async function getTemplate(
  stepKey: string,
  vars?: Record<string, string>
): Promise<string> {
  // Find the default as fallback
  const defaultEntry = DEFAULT_TEMPLATES.find(t => t.stepKey === stepKey);
  let body = defaultEntry?.body ?? "";

  // Try DB lookup
  try {
    const db = await getDb();
    if (db) {
      const [row] = await db
        .select({ body: messageTemplates.body })
        .from(messageTemplates)
        .where(eq(messageTemplates.stepKey, stepKey))
        .limit(1);
      if (row) body = row.body;
    }
  } catch {
    // DB unavailable — use default
  }

  // Substitute variables
  if (vars) {
    for (const [key, val] of Object.entries(vars)) {
      body = body.replaceAll(key, val);
    }
  }

  return body;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const messageTemplateRouter = router({
  /**
   * List all templates for a given flow type, ordered by id (insertion order = sequence order).
   */
  list: adminAgentProcedure
    .input(z.object({ flowType: z.enum(["reactivation", "review"]) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const rows = await db
        .select()
        .from(messageTemplates)
        .where(eq(messageTemplates.flowType, input.flowType))
        .orderBy(asc(messageTemplates.id));
      return rows.map(r => ({
        ...r,
        variables: r.variables ? (JSON.parse(r.variables) as string[]) : [],
        // Attach the default body so the UI can show a "Reset to default" diff
        defaultBody: DEFAULT_TEMPLATES.find(d => d.stepKey === r.stepKey)?.body ?? r.body,
      }));
    }),

  /**
   * Update the body of an editable template.
   * Locked templates (isEditable = 0) cannot be changed.
   */
  update: adminAgentProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        body: z.string().min(10).max(1600),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [existing] = await db
        .select({ id: messageTemplates.id, isEditable: messageTemplates.isEditable })
        .from(messageTemplates)
        .where(eq(messageTemplates.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
      if (!existing.isEditable) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This message is locked and cannot be edited (legal opt-out requirement).",
        });
      }
      await db
        .update(messageTemplates)
        .set({ body: input.body })
        .where(eq(messageTemplates.id, input.id));
      return { success: true };
    }),

  /**
   * Reset a template's body back to the DEFAULT_TEMPLATES value.
   * Locked templates cannot be reset (they never change anyway).
   */
  reset: adminAgentProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [existing] = await db
        .select({ id: messageTemplates.id, stepKey: messageTemplates.stepKey, isEditable: messageTemplates.isEditable })
        .from(messageTemplates)
        .where(eq(messageTemplates.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
      if (!existing.isEditable) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This template is locked." });
      }
      const defaultEntry = DEFAULT_TEMPLATES.find(d => d.stepKey === existing.stepKey);
      if (!defaultEntry) throw new TRPCError({ code: "NOT_FOUND", message: "No default found for this template." });
      await db
        .update(messageTemplates)
        .set({ body: defaultEntry.body })
        .where(eq(messageTemplates.id, input.id));
      return { success: true, restoredBody: defaultEntry.body };
    }),

  /**
   * Idempotent seed — inserts default templates if they don't already exist.
   * Safe to call multiple times; uses stepKey as the uniqueness guard.
   */
  seed: adminAgentProcedure.mutation(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    let inserted = 0;
    for (const t of DEFAULT_TEMPLATES) {
      const [existing] = await db
        .select({ id: messageTemplates.id })
        .from(messageTemplates)
        .where(eq(messageTemplates.stepKey, t.stepKey))
        .limit(1);
      if (!existing) {
        await db.insert(messageTemplates).values(t);
        inserted++;
      }
    }
    return { inserted, total: DEFAULT_TEMPLATES.length };
  }),
});
