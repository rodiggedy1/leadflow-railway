import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { confirmationCalls, leadflowJobs } from "../drizzle/schema";
import { opsChatProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { sendSms } from "./openphone";
import { ENV } from "./_core/env";
import { normalizePhone } from "./utils/phone";

const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const outcomeInput = z.enum(["confirmed", "reschedule", "cancel", "no_answer", "voicemail", "unknown"]);

const confirmationSms = (firstName: string) =>
  `Hi ${firstName}, this is Maids in Black! 🖤 Confirming your cleaning appointment tomorrow.\n\n` +
  `✅ Reply YES to confirm\n` +
  `🔄 Reply FLEXIBLE or NOT FLEXIBLE to let us know if you’re open to shifting your two-hour arrival window earlier or later\n\n` +
  `Quick note: we use a two-hour arrival window to account for traffic, weather, and other jobs running longer, this helps us to show up ready to do our best work for you.\n\n` +
  `Thanks so much, looking forward to seeing you tomorrow! 😊`;

/**
 * Confirmation Calls exact-live adapter.
 *
 * The queue reads only LeadFlow-owned jobs. New confirmation records are keyed
 * by confirmation_calls.leadflowJobId; legacy confirmation rows are neither
 * read nor modified by this adapter. Sending a message and manually overriding
 * its outcome retain the existing human-triggered behavior only.
 */
export const leadflowConfirmationCallsRouter = router({
  getJobsForDay: opsChatProcedure
    .input(z.object({ date: dateInput }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const jobs = await db
        .select({
          id: leadflowJobs.id,
          customerName: leadflowJobs.customerName,
          customerPhone: leadflowJobs.customerPhone,
          jobAddress: leadflowJobs.jobAddress,
          serviceDateTime: leadflowJobs.serviceDateTime,
          serviceType: leadflowJobs.serviceName,
          teamName: leadflowJobs.teamName,
        })
        .from(leadflowJobs)
        .where(and(eq(leadflowJobs.jobDate, input.date), ne(leadflowJobs.bookingStatus, "cancelled")))
        .orderBy(asc(leadflowJobs.serviceDateTime), asc(leadflowJobs.customerName), asc(leadflowJobs.id));

      if (!jobs.length) return [];
      const jobIds = jobs.map(job => job.id);
      const calls = await db
        .select({
          id: confirmationCalls.id,
          leadflowJobId: confirmationCalls.leadflowJobId,
          status: confirmationCalls.status,
          recordingUrl: confirmationCalls.recordingUrl,
          summary: confirmationCalls.summary,
          transcript: confirmationCalls.transcript,
          durationSeconds: confirmationCalls.durationSeconds,
          endedReason: confirmationCalls.endedReason,
          aiOutcome: confirmationCalls.aiOutcome,
          aiFlexibility: confirmationCalls.aiFlexibility,
          aiNotes: confirmationCalls.aiNotes,
          aiOutcomeLabel: confirmationCalls.aiOutcomeLabel,
          manualOutcome: confirmationCalls.manualOutcome,
          manualOutcomeLabel: confirmationCalls.manualOutcomeLabel,
          smsFollowupSent: confirmationCalls.smsFollowupSent,
          smsFollowupBody: confirmationCalls.smsFollowupBody,
          smsReply: confirmationCalls.smsReply,
          smsReplies: confirmationCalls.smsReplies,
          smsConfirmedAt: confirmationCalls.smsConfirmedAt,
        })
        .from(confirmationCalls)
        .where(and(eq(confirmationCalls.jobDate, input.date), inArray(confirmationCalls.leadflowJobId, jobIds)))
        .orderBy(desc(confirmationCalls.firedAt), desc(confirmationCalls.id));

      const newestCallByJob = new Map<number, (typeof calls)[number]>();
      for (const call of calls) {
        if (call.leadflowJobId != null && !newestCallByJob.has(call.leadflowJobId)) {
          newestCallByJob.set(call.leadflowJobId, call);
        }
      }

      return jobs.map(job => ({
        ...job,
        confirmationCall: newestCallByJob.get(job.id) ?? null,
      }));
    }),

  placeCall: opsChatProcedure
    .input(z.object({ leadflowJobId: z.number().int().positive(), jobDate: dateInput }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const rows = await db
        .select({
          id: leadflowJobs.id,
          jobDate: leadflowJobs.jobDate,
          customerName: leadflowJobs.customerName,
          customerPhone: leadflowJobs.customerPhone,
          bookingStatus: leadflowJobs.bookingStatus,
        })
        .from(leadflowJobs)
        .where(and(eq(leadflowJobs.id, input.leadflowJobId), eq(leadflowJobs.jobDate, input.jobDate)))
        .limit(1);
      const job = rows[0];
      if (!job || job.bookingStatus.toLowerCase() === "cancelled") {
        throw new TRPCError({ code: "NOT_FOUND", message: "LeadFlow job is unavailable for confirmation." });
      }

      const calledPhone = normalizePhone(job.customerPhone);
      if (!calledPhone) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "LeadFlow job has no valid customer phone number." });
      }

      const clientName = job.customerName?.trim() || "Client";
      const callerName = (ctx as { opsCaller?: { name?: string } }).opsCaller?.name ?? "Dispatcher";
      const now = Date.now();
      const [inserted] = await db.insert(confirmationCalls).values({
        cleanerJobId: null,
        leadflowJobId: job.id,
        jobDate: job.jobDate,
        clientName,
        calledPhone,
        status: "fired",
        firedBy: callerName,
        firedAt: now,
      });
      const confirmationCallId = Number((inserted as { insertId?: number }).insertId);
      const smsBody = confirmationSms(clientName.split(" ")[0] || "there");

      try {
        const smsResult = await sendSms({
          to: calledPhone,
          content: smsBody,
          ...(ENV.openPhoneCsNumberId ? { fromNumberId: ENV.openPhoneCsNumberId } : {}),
        });
        if (smsResult.success) {
          await db.update(confirmationCalls).set({
            status: "completed",
            smsFollowupSent: 1,
            smsFollowupAt: Date.now(),
            smsFollowupBody: smsBody,
          }).where(eq(confirmationCalls.id, confirmationCallId));
        } else {
          await db.update(confirmationCalls).set({ status: "failed" }).where(eq(confirmationCalls.id, confirmationCallId));
        }
      } catch (error) {
        await db.update(confirmationCalls).set({ status: "failed" }).where(eq(confirmationCalls.id, confirmationCallId));
        console.error("[LeadFlowConfirmationCalls] SMS error", error);
      }

      return { confirmationCallId };
    }),

  overrideOutcome: opsChatProcedure
    .input(z.object({
      id: z.number().int().positive(),
      outcome: outcomeInput.nullable(),
      label: z.string().max(128).nullable(),
      agentName: z.string().max(64),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const rows = await db
        .select({ id: confirmationCalls.id, leadflowJobId: confirmationCalls.leadflowJobId })
        .from(confirmationCalls)
        .where(eq(confirmationCalls.id, input.id))
        .limit(1);
      const call = rows[0];
      if (!call?.leadflowJobId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "LeadFlow confirmation record not found." });
      }

      await db.update(confirmationCalls).set({
        manualOutcome: input.outcome,
        manualOutcomeLabel: input.label,
        manualOverrideBy: input.outcome ? input.agentName : null,
        manualOverrideAt: input.outcome ? Date.now() : null,
      }).where(and(eq(confirmationCalls.id, call.id), eq(confirmationCalls.leadflowJobId, call.leadflowJobId)));

      const { broadcastOpsUpdate } = await import("./sseBroadcast");
      broadcastOpsUpdate("job_update", { jobId: call.leadflowJobId });
      return { ok: true };
    }),
});
