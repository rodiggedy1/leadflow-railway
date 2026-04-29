/**
 * nurtureRouter.ts
 *
 * tRPC procedures for the Lead Nurturing page:
 *  - nurture.stats         — KPI cards (enrolled, active, paused, done)
 *  - nurture.enrollments   — paginated list of active/paused enrollments with lead info
 *  - nurture.resume        — manually re-enroll / resume a paused enrollment
 *  - nurture.end           — manually end an enrollment
 *  - nurture.enroll        — manually enroll a specific session
 */

import { router, adminAgentProcedure } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import { nurtureEnrollments, conversationSessions, nurtureStepScripts } from "../drizzle/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { enrollLead, resumeEnrollment, endEnrollment, pauseEnrollment } from "./nurtureSequence";
import { NURTURE_STEPS } from "./nurtureSequence";
import { invokeLLM } from "./_core/llm";

export const nurtureRouter = router({
  /** KPI stats for the header cards */
  stats: adminAgentProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { active: 0, paused: 0, done: 0, total: 0 };

    const rows = await db
      .select({
        status: nurtureEnrollments.status,
        count: sql<number>`COUNT(*)`,
      })
      .from(nurtureEnrollments)
      .groupBy(nurtureEnrollments.status);

    const result = { active: 0, paused: 0, done: 0, total: 0 };
    for (const r of rows) {
      const count = Number(r.count);
      if (r.status === "active") result.active = count;
      else if (r.status === "paused") result.paused = count;
      else if (r.status === "done") result.done = count;
      result.total += count;
    }
    return result;
  }),

  /** Paginated list of enrollments with lead info */
  enrollments: adminAgentProcedure
    .input(
      z.object({
        status: z.enum(["active", "paused", "done", "all"]).default("active"),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { rows: [], total: 0 };

      const whereClause =
        input.status === "all"
          ? undefined
          : eq(nurtureEnrollments.status, input.status);

      const rows = await db
        .select({
          id: nurtureEnrollments.id,
          sessionId: nurtureEnrollments.sessionId,
          leadPhone: nurtureEnrollments.leadPhone,
          leadFirstName: nurtureEnrollments.leadFirstName,
          serviceType: nurtureEnrollments.serviceType,
          status: nurtureEnrollments.status,
          nextStep: nurtureEnrollments.nextStep,
          nextSendAt: nurtureEnrollments.nextSendAt,
          lastStepSent: nurtureEnrollments.lastStepSent,
          lastSentAt: nurtureEnrollments.lastSentAt,
          endReason: nurtureEnrollments.endReason,
          endedAt: nurtureEnrollments.endedAt,
          enrolledAt: nurtureEnrollments.enrolledAt,
          leadCreatedAt: nurtureEnrollments.leadCreatedAt,
          // Join session for stage info
          sessionStage: conversationSessions.stage,
          sessionLeadName: conversationSessions.leadName,
          sessionSource: conversationSessions.leadSource,
        })
        .from(nurtureEnrollments)
        .leftJoin(
          conversationSessions,
          eq(nurtureEnrollments.sessionId, conversationSessions.id)
        )
        .where(whereClause)
        .orderBy(desc(nurtureEnrollments.enrolledAt))
        .limit(input.limit)
        .offset(input.offset);

      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(nurtureEnrollments)
        .where(whereClause);

      return { rows, total: Number(count) };
    }),

  /** Manually pause an active enrollment (human takeover) */
  pause: adminAgentProcedure
    .input(z.object({ enrollmentId: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const [enrollment] = await db
        .select({ sessionId: nurtureEnrollments.sessionId })
        .from(nurtureEnrollments)
        .where(eq(nurtureEnrollments.id, input.enrollmentId))
        .limit(1);
      if (!enrollment) throw new Error("Enrollment not found");
      await pauseEnrollment(db, enrollment.sessionId);
      return { success: true };
    }),

  /** Resume a paused enrollment (manual re-enroll after human takeover) */
  resume: adminAgentProcedure
    .input(z.object({ sessionId: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await resumeEnrollment(db, input.sessionId);
      return { success: true };
    }),

  /** Manually end an enrollment */
  end: adminAgentProcedure
    .input(
      z.object({
        enrollmentId: z.number().int(),
        reason: z.enum(["booked", "opted_out", "day30", "manual"]).default("manual"),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await endEnrollment(db, input.enrollmentId, input.reason);
      return { success: true };
    }),

  /** Manually enroll a specific session */
  enroll: adminAgentProcedure
    .input(z.object({ sessionId: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      const [session] = await db
        .select({
          id: conversationSessions.id,
          leadPhone: conversationSessions.leadPhone,
          leadName: conversationSessions.leadName,
          serviceType: conversationSessions.serviceType,
          createdAt: conversationSessions.createdAt,
        })
        .from(conversationSessions)
        .where(eq(conversationSessions.id, input.sessionId))
        .limit(1);

      if (!session) throw new Error("Session not found");

      const enrollmentId = await enrollLead(db, {
        id: session.id,
        leadPhone: session.leadPhone,
        leadName: session.leadName,
        serviceType: session.serviceType,
        createdAt:
          session.createdAt instanceof Date
            ? session.createdAt
            : new Date(session.createdAt),
      });

      return { success: true, enrollmentId };
    }),

  /** Session detail — message history + session info for timeline */
  sessionDetail: adminAgentProcedure
    .input(z.object({ sessionId: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;

      const [session] = await db
        .select({
          id: conversationSessions.id,
          leadPhone: conversationSessions.leadPhone,
          leadName: conversationSessions.leadName,
          serviceType: conversationSessions.serviceType,
          leadSource: conversationSessions.leadSource,
          stage: conversationSessions.stage,
          createdAt: conversationSessions.createdAt,
          messageHistory: conversationSessions.messageHistory,
        })
        .from(conversationSessions)
        .where(eq(conversationSessions.id, input.sessionId))
        .limit(1);

      if (!session) return null;

      // Parse message history
      let messages: Array<{ role: string; content: string; ts?: number; source?: string; nurtureStep?: number }> = [];
      try {
        messages = JSON.parse(session.messageHistory ?? "[]");
      } catch {
        messages = [];
      }

      return {
        id: session.id,
        leadPhone: session.leadPhone,
        leadName: session.leadName,
        serviceType: session.serviceType,
        leadSource: session.leadSource,
        stage: session.stage,
        createdAt: session.createdAt,
        messages,
      };
    }),

  /** Regenerate a step script using AI */
  regenerateScript: adminAgentProcedure
    .input(z.object({
      step: z.number().int().min(1).max(17),
      stepLabel: z.string(),
      phase: z.string(),
      currentScript: z.string(),
    }))
    .mutation(async ({ input }) => {
      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are an expert SMS copywriter for Maids in Black, a premium home cleaning service in the DC Metro area. Write a single short SMS nurture message for a lead who hasn't booked yet. Rules: max 160 characters, conversational and warm, no emojis unless they feel natural, ends with a soft CTA or question, use {{first_name}} for personalization where appropriate. Return ONLY the SMS text — no explanation, no quotes.`,
          },
          {
            role: "user",
            content: `Rewrite this nurture step SMS for step ${input.step} ("${input.stepLabel}", ${input.phase}). Current version: "${input.currentScript}". Same intent, fresh wording.`,
          },
        ],
      });
      const newScript = (response.choices[0]?.message?.content as string ?? "").trim();
      if (!newScript) throw new Error("LLM returned empty response");
      return { body: newScript };
    }),

  /** Step definitions for the sequence map UI */
  steps: adminAgentProcedure.query(() => {
    return NURTURE_STEPS.map((s) => ({
      step: s.step,
      phase: s.phase,
      label: s.label,
    }));
  }),

  /** Get all custom script overrides from DB */
  getScripts: adminAgentProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [] as Array<{ step: number; body: string }>;
    const rows = await db.select({ step: nurtureStepScripts.step, body: nurtureStepScripts.body }).from(nurtureStepScripts);
    return rows;
  }),

  /** Upsert a custom script override for a step */
  saveScript: adminAgentProcedure
    .input(z.object({ step: z.number().int().min(1).max(17), body: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await db
        .insert(nurtureStepScripts)
        .values({ step: input.step, body: input.body })
        .onDuplicateKeyUpdate({ set: { body: input.body } });
      return { ok: true };
    }),

  /** Send a test SMS for a given step to the test number +13029816191 */
  testSend: adminAgentProcedure
    .input(z.object({ step: z.number().int().min(1).max(17), body: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const { sendSms } = await import("./openphone");
      // Substitute template placeholders with test values
      const rendered = input.body
        .replace(/\{\{first_name\}\}/g, "Rohan")
        .replace(/\{\{service\}\}/g, "house cleaning");
      const result = await sendSms({
        to: "+13029816191",
        content: `[TEST step ${input.step}] ${rendered}`,
      });
      if (!result.success) throw new Error(result.error ?? "SMS failed");
      return { ok: true };
    }),
});
