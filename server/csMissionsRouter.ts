/**
 * csMissionsRouter.ts
 * CRUD procedures for the Operations Center panel in the CS Inbox.
 *
 * Each cs_mission belongs to one conversation session and represents a live
 * piece of work (e.g. "Get ETA", "Send Gate Code") with a stage pipeline.
 *
 * Design principle: no assumed logic — only the exact operations the client asks for.
 * No auto-creating, auto-completing, or auto-cascading side effects.
 */
import { z } from "zod";
import { router, agentProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { csMissions, conversationSessions, cleanerJobs, cleanerProfiles } from "../drizzle/schema";
import { getMissionHandler } from "./missions/index";
import type { CsMissionStage } from "../drizzle/schema";
import { eq, and, inArray, asc, desc, sql } from "drizzle-orm";
import { broadcastOpsUpdate } from "./sseBroadcast";

const stageSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["done", "waiting", "ready", "pending"]),
  content: z.string().optional(),
  suggestedReply: z.string().optional(),
  ts: z.number().optional(),
});

export const csMissionsRouter = router({
  /**
   * listBySession — returns all non-cancelled missions for a conversation session.
   * Ordered by sortOrder ASC, then createdAt ASC.
   * Returns completed missions too so the panel can show history.
   */
  listBySession: agentProcedure
    .input(z.object({ sessionId: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const rows = await db
        .select()
        .from(csMissions)
        .where(
          and(
            eq(csMissions.sessionId, input.sessionId),
            // Return all except cancelled — let the UI decide what to show
            inArray(csMissions.status, ["active", "waiting", "ready", "sending", "completed", "needs_attention"])
          )
        )
        .orderBy(asc(csMissions.sortOrder), asc(csMissions.createdAt));
      return rows.map(r => ({
        id: r.id,
        sessionId: r.sessionId,
        agentId: r.agentId,
        agentName: r.agentName,
        title: r.title,
        emoji: r.emoji,
        status: r.status,
        stages: r.stages as CsMissionStage[],
        sortOrder: r.sortOrder,
        createdAt: r.createdAt ? r.createdAt.getTime() : null,
        updatedAt: r.updatedAt ? r.updatedAt.getTime() : null,
        completedAt: r.completedAt ? r.completedAt.getTime() : null,
        failureReason: (r as any).failureReason ?? null,
        missionType: (r as any).missionType ?? "MANUAL",
        cleanerName: (r as any).cleanerName ?? null,
        customerName: (r as any).customerName ?? null,
      }));
    }),

  /**
   * create — creates a new mission for a conversation session.
   * agentId is taken from ctx.agent — never from client input.
   */
  create: agentProcedure
    .input(z.object({
      sessionId: z.number().int(),
      title: z.string().min(1).max(255),
      emoji: z.string().max(16).optional(),
      stages: z.array(stageSchema).optional(),
      sortOrder: z.number().int().optional(),
      missionType: z.string().max(32).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const now = new Date();
      const missionType = input.missionType ?? "MANUAL";
      const initialStages: CsMissionStage[] = input.stages ?? [];

      // For GET_ETA missions, resolve cleaner/customer context from today's job
      let jobId: number | null = null;
      let cleanerPhone: string | null = null;
      let cleanerName: string | null = null;
      let customerPhone: string | null = null;
      let customerName: string | null = null;
      let missionStatus: string = "active";
      let failureReason: string | null = null;

      if (missionType === "GET_ETA") {
        try {
          // 1. Get session phone
          const [session] = await db
            .select({ leadPhone: conversationSessions.leadPhone, leadName: conversationSessions.leadName })
            .from(conversationSessions)
            .where(eq(conversationSessions.id, input.sessionId))
            .limit(1);
          const phone10 = session?.leadPhone?.replace(/[^\d]/g, "").slice(-10) ?? "";
          customerPhone = session?.leadPhone ?? null;
          customerName = (session as any)?.leadName ?? null;

          if (phone10.length >= 10) {
            // 2. Find today's job for this customer
            const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
            const todayET = nowET.toISOString().slice(0, 10);
            const [job] = await db
              .select({
                id: cleanerJobs.id,
                cleanerProfileId: cleanerJobs.cleanerProfileId,
                cleanerName: cleanerJobs.cleanerName,
                customerName: cleanerJobs.customerName,
              })
              .from(cleanerJobs)
              .where(
                and(
                  sql`REGEXP_REPLACE(${cleanerJobs.customerPhone}, '[^0-9]', '') = ${phone10}`,
                  sql`${cleanerJobs.jobDate} = ${todayET}`
                )
              )
              .orderBy(asc(cleanerJobs.id))
              .limit(1);

            if (!job) {
              missionStatus = "needs_attention";
              failureReason = "No job found for today";
            } else {
              jobId = job.id;
              customerName = customerName ?? job.customerName ?? null;
              // 3. Get cleaner phone from cleanerProfiles
              const [profile] = await db
                .select({ phone: cleanerProfiles.phone, name: cleanerProfiles.name })
                .from(cleanerProfiles)
                .where(eq(cleanerProfiles.id, job.cleanerProfileId))
                .limit(1);
              cleanerPhone = profile?.phone ?? null;
              cleanerName = profile?.name ?? job.cleanerName ?? null;
              if (!cleanerPhone) {
                missionStatus = "needs_attention";
                failureReason = "Cleaner has no phone on file";
              }
            }
          } else {
            missionStatus = "needs_attention";
            failureReason = "Session has no phone number";
          }
        } catch (ctxErr: any) {
          console.error("[csMissions.create] GET_ETA context lookup failed:", ctxErr?.message);
          // Non-fatal — create mission without context
        }
      }

      let result: any;
      try {
        [result] = await db.insert(csMissions).values({
          sessionId: input.sessionId,
          agentId: ctx.agent.agentId,
          agentName: ctx.agent.agentName,
          title: input.title,
          emoji: input.emoji ?? null,
          status: missionStatus as any,
          stages: initialStages,
          sortOrder: input.sortOrder ?? 0,
          missionType,
          jobId: jobId ?? undefined,
          cleanerPhone: cleanerPhone ?? undefined,
          cleanerName: cleanerName ?? undefined,
          customerPhone: customerPhone ?? undefined,
          customerName: customerName ?? undefined,
          failureReason: failureReason ?? undefined,
          createdAt: now,
          updatedAt: now,
        } as any);
      } catch (dbErr: any) {
        console.error("[csMissions.create] DB INSERT FAILED:", dbErr?.message ?? dbErr, "| code:", dbErr?.code, "| sqlMessage:", dbErr?.sqlMessage);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: dbErr?.sqlMessage ?? dbErr?.message ?? "DB insert failed" });
      }
      const newId = (result as any).insertId as number;

      // Fire onCreate handler for mission types that have automated kickoff
      if (missionStatus === "active") {
        const handler = getMissionHandler(missionType);
        if (handler?.onCreate) {
          // Fetch the newly created mission row so onCreate has full context
          const [newMission] = await db.select().from(csMissions).where(eq(csMissions.id, newId)).limit(1);
          if (newMission) {
            handler.onCreate(newMission as any).catch((e: any) =>
              console.error(`[csMissions.create] ${missionType}.onCreate failed:`, e?.message)
            );
          }
        }
      }

      broadcastOpsUpdate("cs_mission_update", { sessionId: input.sessionId });
      return { id: newId };
    }),

  /**
   * updateStages — updates the stages array and status of a mission.
   * Used when a stage progresses (e.g. waiting → ready after Maria replies).
   */
  updateStages: agentProcedure
    .input(z.object({
      missionId: z.number().int(),
      stages: z.array(stageSchema),
      status: z.enum(["active", "waiting", "ready", "completed", "cancelled"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      // Verify ownership — agent must own the session (or be admin)
      const [existing] = await db
        .select({ sessionId: csMissions.sessionId, agentId: csMissions.agentId })
        .from(csMissions)
        .where(eq(csMissions.id, input.missionId))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Mission not found" });
      const now = new Date();
      await db
        .update(csMissions)
        .set({
          stages: input.stages,
          status: input.status,
          updatedAt: now,
          completedAt: input.status === "completed" ? now : undefined,
        } as any)
        .where(eq(csMissions.id, input.missionId));
      broadcastOpsUpdate("cs_mission_update", { sessionId: existing.sessionId });
      return { ok: true };
    }),

  /**
   * complete — marks a mission as completed.
   */
  complete: agentProcedure
    .input(z.object({ missionId: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [existing] = await db
        .select({ sessionId: csMissions.sessionId })
        .from(csMissions)
        .where(eq(csMissions.id, input.missionId))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Mission not found" });
      const now = new Date();
      await db
        .update(csMissions)
        .set({ status: "completed", completedAt: now, updatedAt: now } as any)
        .where(eq(csMissions.id, input.missionId));
      broadcastOpsUpdate("cs_mission_update", { sessionId: existing.sessionId });
      return { ok: true };
    }),

  /**
   * cancel — removes a mission from the active list.
   */
  cancel: agentProcedure
    .input(z.object({ missionId: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [existing] = await db
        .select({ sessionId: csMissions.sessionId })
        .from(csMissions)
        .where(eq(csMissions.id, input.missionId))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Mission not found" });
      const now = new Date();
      await db
        .update(csMissions)
        .set({ status: "cancelled", updatedAt: now } as any)
        .where(eq(csMissions.id, input.missionId));
      broadcastOpsUpdate("cs_mission_update", { sessionId: existing.sessionId });
      return { ok: true };
    }),

  /**
   * updateTitle — edits the title/emoji of a mission.
   */
  updateTitle: agentProcedure
    .input(z.object({
      missionId: z.number().int(),
      title: z.string().min(1).max(255),
      emoji: z.string().max(16).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [existing] = await db
        .select({ sessionId: csMissions.sessionId })
        .from(csMissions)
        .where(eq(csMissions.id, input.missionId))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Mission not found" });
      await db
        .update(csMissions)
        .set({ title: input.title, emoji: input.emoji ?? null, updatedAt: new Date() } as any)
        .where(eq(csMissions.id, input.missionId));
      broadcastOpsUpdate("cs_mission_update", { sessionId: existing.sessionId });
      return { ok: true };
    }),

  /**
   * sendSuggestedReply — atomically transitions a mission from ready → sending,
   * sends the SMS to the customer, then marks stage 3 done and completes the mission.
   * Double-send protection: only the request that wins the ready→sending CAS may send.
   */
  sendSuggestedReply: agentProcedure
    .input(z.object({
      missionId: z.number().int(),
      text: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Atomic CAS: ready → sending. Only one request wins.
      const now = new Date();
      const casResult = await db.execute(
        sql`UPDATE cs_missions
            SET status = 'sending', updatedAt = ${now}
            WHERE id = ${input.missionId}
              AND status = 'ready'`
      ) as any;
      const affectedRows = Number(casResult?.[0]?.affectedRows ?? casResult?.affectedRows ?? 0);
      if (affectedRows === 0) {
        // Either already sent or not in ready state
        const [m] = await db.select({ status: csMissions.status }).from(csMissions).where(eq(csMissions.id, input.missionId)).limit(1);
        if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "Mission not found" });
        if ((m.status as string) === "completed") throw new TRPCError({ code: "CONFLICT", message: "Already sent" });
        throw new TRPCError({ code: "CONFLICT", message: `Cannot send from status: ${m.status}` });
      }

      // Fetch mission for customer phone
      const [mission] = await db.select().from(csMissions).where(eq(csMissions.id, input.missionId)).limit(1);
      if (!mission) throw new TRPCError({ code: "NOT_FOUND", message: "Mission not found after CAS" });

      const customerPhone = (mission as any).customerPhone as string | null;
      if (!customerPhone) {
        // Roll back to ready so agent can retry
        await db.execute(sql`UPDATE cs_missions SET status = 'ready', updatedAt = ${now} WHERE id = ${input.missionId}`);
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No customer phone on mission" });
      }

      // Send SMS
      try {
        const { sendSms } = await import("./openphone");
        await sendSms({ to: customerPhone, content: input.text });
      } catch (smsErr: any) {
        // Roll back to ready so agent can retry
        await db.execute(sql`UPDATE cs_missions SET status = 'ready', updatedAt = ${now} WHERE id = ${input.missionId}`);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `SMS send failed: ${smsErr?.message}` });
      }

      // Mark last stage done and complete the mission
      const stages = (mission.stages ?? []) as any[];
      const updatedStages = stages.map((s: any, i: number) =>
        i === stages.length - 1 ? { ...s, status: "done" } : s
      );
      const completedAt = new Date();
      await db.execute(
        sql`UPDATE cs_missions
            SET status = 'completed',
                stages = ${JSON.stringify(updatedStages)},
                activeDedupKey = NULL,
                completedAt = ${completedAt},
                updatedAt = ${completedAt}
            WHERE id = ${input.missionId}`
      );

      broadcastOpsUpdate("cs_mission_update", { sessionId: mission.sessionId });
      return { ok: true };
    }),

  /**
   * getSessionContext — returns the assigned team name for a session.
   * Looks up the session's leadPhone, then finds the next upcoming cleanerJob
   * to get the teamName (or cleanerName as fallback).
   */
  getSessionContext: agentProcedure
    .input(z.object({ sessionId: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { teamName: null, leadPhone: null, leadName: null, bedrooms: null, bathrooms: null, serviceType: null };
      // 1. Get the session's phone number + lead details
      const [session] = await db
        .select({
          leadPhone: conversationSessions.leadPhone,
          leadName: conversationSessions.leadName,
          bedrooms: conversationSessions.bedrooms,
          bathrooms: conversationSessions.bathrooms,
          serviceType: conversationSessions.serviceType,
        })
        .from(conversationSessions)
        .where(eq(conversationSessions.id, input.sessionId))
        .limit(1);
      if (!session?.leadPhone) return { teamName: null, leadPhone: null, leadName: null, bedrooms: null, bathrooms: null, serviceType: null };
      // Normalize to 10 digits
      const phone10 = session.leadPhone.replace(/[^\d]/g, "").slice(-10);
      if (phone10.length < 10) return { teamName: null, leadPhone: session.leadPhone, leadName: session.leadName ?? null, bedrooms: session.bedrooms ?? null, bathrooms: session.bathrooms ?? null, serviceType: session.serviceType ?? null };
      // 2. Find today's or next upcoming cleaner job for this customer
      const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
      const todayET = nowET.toISOString().slice(0, 10);
      const [job] = await db
        .select({
          teamName: cleanerJobs.teamName,
          cleanerName: cleanerJobs.cleanerName,
          jobDate: cleanerJobs.jobDate,
        })
        .from(cleanerJobs)
        .where(
          and(
            sql`REGEXP_REPLACE(${cleanerJobs.customerPhone}, '[^0-9]', '') = ${phone10}`,
            sql`${cleanerJobs.jobDate} >= ${todayET}`
          )
        )
        .orderBy(asc(cleanerJobs.jobDate))
        .limit(1);
      const teamName = job?.teamName ?? job?.cleanerName ?? null;
      return {
        teamName,
        leadPhone: session.leadPhone,
        leadName: session.leadName ?? null,
        bedrooms: session.bedrooms ?? null,
        bathrooms: session.bathrooms ?? null,
        serviceType: session.serviceType ?? null,
      };
    }),

  /**
   * sendQuoteSms — sends an SMS to the session's lead phone and marks the mission complete.
   * Used by the Send Quote widget where the mission may not have customerPhone set.
   */
  sendQuoteSms: agentProcedure
    .input(z.object({
      missionId: z.number().int(),
      sessionId: z.number().int(),
      text: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      // Get the session's lead phone
      const [session] = await db
        .select({ leadPhone: conversationSessions.leadPhone })
        .from(conversationSessions)
        .where(eq(conversationSessions.id, input.sessionId))
        .limit(1);
      if (!session?.leadPhone) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No phone number for this session" });
      // Send SMS
      const { sendSms } = await import("./openphone");
      await sendSms({ to: session.leadPhone, content: input.text });
      // Mark mission complete
      const now = new Date();
      await db.execute(
        sql`UPDATE cs_missions SET status = 'completed', completedAt = ${now}, updatedAt = ${now} WHERE id = ${input.missionId}`
      );
      broadcastOpsUpdate("cs_mission_update", { sessionId: input.sessionId });
      return { ok: true };
    }),

  /**
   * generateQuoteLink — creates a personalized quote page via the quote app API
   * and returns the URL to embed in the SMS message.
   */
  generateQuoteLink: agentProcedure
    .input(
      z.object({
        customerName: z.string(),
        customerPhone: z.string(),
        bedrooms: z.number().int().min(1).max(10),
        bathrooms: z.number().min(0.5).max(10),
        serviceType: z.string().default("Standard Cleaning"),
        price: z.number(),
        extras: z.array(z.string()).default([]),
      })
    )
    .mutation(async ({ input }) => {
      const { createQuoteLink } = await import("./quoteLink");
      const result = await createQuoteLink({
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        bedrooms: input.bedrooms,
        bathrooms: input.bathrooms,
        serviceType: input.serviceType,
        price: input.price,
        conversationSummary: input.extras.length ? `Extras: ${input.extras.join(", ")}` : "",
        source: "LeadFlow CS Mission",
      });
      if (!result) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to generate quote link" });
      return result;
    }),
});
