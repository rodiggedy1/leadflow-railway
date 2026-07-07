/**
 * confirmationCallsRouter — Appointment Confirmation (SMS only)
 *
 * Lets dispatchers pull today's jobs, select clients, and send a confirmation
 * SMS. The VAPI call has been removed — only SMS is sent now.
 *
 * Steps:
 *   1. Insert confirmationCalls row for tracking
 *   2. Send SMS via OpenPhone
 *   3. Update confirmationCalls row with SMS result
 */
import { z } from "zod";
import { router, opsChatProcedure, publicProcedure, agentProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import {
  cleanerJobs,
  cleanerProfiles,
  confirmationCalls,
} from "../drizzle/schema";
import { eq, and, ne, desc, inArray } from "drizzle-orm";
import { ENV } from "./_core/env";
import { sendSms } from "./openphone";



export const confirmationCallsRouter = router({
  /**
   * Get all jobs for a given day — reuses the same query as fieldMgmtRouter.getJobsForDay
   * but simplified to just the columns needed for this page.
   */
  getJobsForDay: opsChatProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const jobs = await db
        .select({
          id: cleanerJobs.id,
          customerName: cleanerJobs.customerName,
          customerPhone: cleanerJobs.customerPhone,
          jobAddress: cleanerJobs.jobAddress,
          serviceDateTime: cleanerJobs.serviceDateTime,
          serviceType: cleanerJobs.serviceType,
          teamName: cleanerJobs.teamName,
          bookingStatus: cleanerJobs.bookingStatus,
          jobStatus: cleanerJobs.jobStatus,
        })
        .from(cleanerJobs)
        .where(
          and(
            eq(cleanerJobs.jobDate, input.date),
            ne(cleanerJobs.bookingStatus, "cancelled"),
          )
        )
        .orderBy(cleanerJobs.serviceDateTime, cleanerJobs.customerName);

      if (jobs.length === 0) return [];

      // Fetch ALL confirmation calls for this date — by jobDate only, NOT by jobId.
      // This makes the lookup immune to job ID changes caused by team reassignments:
      // even if the cleaner_jobs row was deleted+re-inserted with a new ID, the call
      // is still found because we match by phone (then name as fallback), not by ID.
      const existingCalls = await db
        .select({
          cleanerJobId: confirmationCalls.cleanerJobId,
          calledPhone: confirmationCalls.calledPhone,
          clientName: confirmationCalls.clientName,
          id: confirmationCalls.id,
          status: confirmationCalls.status,
          vapiCallId: confirmationCalls.vapiCallId,
          recordingUrl: confirmationCalls.recordingUrl,
          summary: confirmationCalls.summary,
          transcript: confirmationCalls.transcript,
          durationSeconds: confirmationCalls.durationSeconds,
          endedReason: confirmationCalls.endedReason,
          firedAt: confirmationCalls.firedAt,
          aiOutcome: confirmationCalls.aiOutcome,
          aiFlexibility: confirmationCalls.aiFlexibility,
          aiNotes: confirmationCalls.aiNotes,
          aiOutcomeLabel: confirmationCalls.aiOutcomeLabel,
          manualOutcome: confirmationCalls.manualOutcome,
          manualOutcomeLabel: confirmationCalls.manualOutcomeLabel,
          manualOverrideBy: confirmationCalls.manualOverrideBy,
          manualOverrideAt: confirmationCalls.manualOverrideAt,
          smsFollowupSent: confirmationCalls.smsFollowupSent,
          smsFollowupAt: confirmationCalls.smsFollowupAt,
          smsFollowupBody: confirmationCalls.smsFollowupBody,
          smsReply: confirmationCalls.smsReply,
          smsReplies: confirmationCalls.smsReplies,
          smsConfirmedAt: confirmationCalls.smsConfirmedAt,
        })
        .from(confirmationCalls)
        .where(eq(confirmationCalls.jobDate, input.date))
        .orderBy(desc(confirmationCalls.firedAt));

      // Build lookup maps: phone → most recent call, name → most recent call (fallback)
      const callByPhone = new Map<string, typeof existingCalls[number]>();
      const callByName = new Map<string, typeof existingCalls[number]>();
      for (const c of existingCalls) {
        const phone = c.calledPhone?.replace(/\D/g, "");
        if (phone && !callByPhone.has(phone)) callByPhone.set(phone, c);
        const name = c.clientName?.trim().toLowerCase();
        if (name && !callByName.has(name)) callByName.set(name, c);
      }

      return jobs.map((job) => {
        const jobPhone = job.customerPhone?.replace(/\D/g, "");
        const call =
          (jobPhone && callByPhone.get(jobPhone)) ||
          callByName.get(job.customerName?.trim().toLowerCase() ?? "") ||
          null;
        return { ...job, confirmationCall: call ?? null };
      });
    }),

  /**
   * Send a confirmation SMS for a single job (VAPI call removed).
   * Steps:
   *   1. Insert confirmationCalls tracking row
   *   2. Send SMS via OpenPhone (fire-and-forget)
   *   3. Update confirmationCalls with SMS result
   */
  placeCall: opsChatProcedure
    .input(
      z.object({
        cleanerJobId: z.number(),
        jobDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        clientName: z.string(),
        calledPhone: z.string().min(7),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const callerName = (ctx as any).opsCaller?.name ?? "Dispatcher";

      // ── Normalize phone ─────────────────────────────────────────────────────
      const normalizedPhone = input.calledPhone.startsWith("+")
        ? input.calledPhone
        : `+1${input.calledPhone.replace(/\D/g, "")}`;

      const now = Date.now();

      // ── 1. Insert confirmationCalls tracking row ──────────────────────────────────────────────────────
      const [ccInsert] = await db.insert(confirmationCalls).values({
        cleanerJobId: input.cleanerJobId,
        jobDate: input.jobDate,
        clientName: input.clientName,
        calledPhone: normalizedPhone,
        status: "fired",
        firedBy: callerName,
        firedAt: now,
      });
      const confirmationCallId = (ccInsert as any).insertId as number;

      // ── 2. Send SMS (fire-and-forget) ────────────────────────────────────────────────────────────────
      ;(async () => {
        try {
          const firstName = input.clientName?.split(" ")[0] ?? "there";
          const smsBody =
            `Hi ${firstName}, this is Maids in Black! Just confirming your cleaning appointment tomorrow. ` +
            `Reply YES to confirm and FLEXIBLE or NOT FLEXIBLE to give us an idea on if you're okay moving your two hour arrival window to an earlier or later slot. ` +
            `Feel free to add any additional notes as well. We look forward to seeing you!`;
          const csNumberId = ENV.openPhoneCsNumberId;
          const smsResult = await sendSms({
            to: normalizedPhone,
            content: smsBody,
            ...(csNumberId ? { fromNumberId: csNumberId } : {}),
          });
          if (smsResult.success) {
            await db.update(confirmationCalls)
              .set({
                smsFollowupSent: 1,
                smsFollowupAt: Date.now(),
                smsFollowupBody: smsBody,
              })
              .where(eq(confirmationCalls.id, confirmationCallId));
            console.log(`[ConfirmationCalls] SMS sent to ${normalizedPhone} for job ${confirmationCallId}`);
          } else {
            console.error(`[ConfirmationCalls] SMS failed for job ${confirmationCallId}: ${smsResult.error}`);
          }
        } catch (smsErr) {
          console.error(`[ConfirmationCalls] SMS error for job ${confirmationCallId}:`, smsErr);
        }
      })();

      return { confirmationCallId };
    }),

  /**
   * No-op — VAPI calls removed, SMS-only now. Kept for frontend compatibility.
   */
  pollFiredCalls: publicProcedure
    .input(z.object({ jobDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .mutation(async () => {
      return { updated: 0 };
    }),

  /**
   * Get all completed/no_answer/failed calls for a given date.
   * Used by the Results tab — always fresh, no cache dependency.
   */
  getCompletedCalls: publicProcedure
    .input(z.object({ jobDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(confirmationCalls)
        .where(
          and(
            eq(confirmationCalls.jobDate, input.jobDate),
            ne(confirmationCalls.status, "fired"),
          )
        )
        .orderBy(desc(confirmationCalls.firedAt));
    }),

  getCallStatus: opsChatProcedure
    .input(
      z.object({
        cleanerJobId: z.number(),
        jobDate: z.string(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;

      const rows = await db
        .select()
        .from(confirmationCalls)
        .where(
          and(
            eq(confirmationCalls.cleanerJobId, input.cleanerJobId),
            eq(confirmationCalls.jobDate, input.jobDate),
          )
        )
        .orderBy(desc(confirmationCalls.firedAt))
        .limit(1);

      return rows[0] ?? null;
    }),

  /**
   * Manually override the outcome of a confirmation call.
   * Used when the AI got it wrong or the call was busy/voicemail and an agent
   * has since spoken to the customer directly.
   * Pass outcome: null to clear the override and revert to AI outcome.
   */
  overrideOutcome: agentProcedure
    .input(
      z.object({
        id: z.number(),
        outcome: z.enum(["confirmed", "reschedule", "cancel", "no_answer", "voicemail", "unknown"]).nullable(),
        label: z.string().max(128).nullable(),
        agentName: z.string().max(64),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      // Fetch the cleanerJobId so we can broadcast a targeted job_update
      const [row] = await db
        .select({ cleanerJobId: confirmationCalls.cleanerJobId })
        .from(confirmationCalls)
        .where(eq(confirmationCalls.id, input.id))
        .limit(1);
      await db
        .update(confirmationCalls)
        .set({
          manualOutcome: input.outcome,
          manualOutcomeLabel: input.label,
          manualOverrideBy: input.outcome ? input.agentName : null,
          manualOverrideAt: input.outcome ? Date.now() : null,
        })
        .where(eq(confirmationCalls.id, input.id));
      // Broadcast so SchedulingTab updates instantly on all connected clients
      const { broadcastOpsUpdate } = await import("./sseBroadcast");
      broadcastOpsUpdate("job_update", { jobId: row?.cleanerJobId ?? undefined });
      return { ok: true };
    }),
});
