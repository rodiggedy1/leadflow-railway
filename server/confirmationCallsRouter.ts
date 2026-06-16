/**
 * confirmationCallsRouter — AI Confirmation Calls
 *
 * Lets dispatchers pull today's jobs, select clients, and fire VAPI outbound
 * confirmation calls via the same pattern used by callsRouter.ts.
 *
 * VAPI pattern is copied verbatim from callsRouter.ts:
 *   1. Insert callLog row (status=pending)
 *   2. POST /call to VAPI
 *   3. Update callLog (status=fired, vapiCallId)
 *   4. Insert fieldMgmtCalls guard row (prevents vapiService from sending rogue SMS)
 *   5. Insert confirmationCalls row for this page's tracking
 */
import { z } from "zod";
import { router, opsChatProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import {
  cleanerJobs,
  cleanerProfiles,
  callLog,
  fieldMgmtCalls,
  confirmationCalls,
} from "../drizzle/schema";
import { eq, and, ne, desc, inArray } from "drizzle-orm";
import { ENV } from "./_core/env";

// ── VAPI constants — mirrors callsRouter.ts exactly ──────────────────────────
const VAPI_API_BASE = "https://api.vapi.ai";
const VAPI_OUTBOUND_PHONE_NUMBER_ID = "61431a3e-8144-4acd-b394-8f600ec3a473";
const VAPI_OUTBOUND_PHONE_NUMBER = "+19347898077";

async function vapiPost(path: string, body: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${VAPI_API_BASE}${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${ENV.vapiPrivateKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`VAPI POST ${path} → ${res.status}: ${text}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── Confirmation call script ──────────────────────────────────────────────────
const FIRST_MESSAGE =
  "Hi! This is Ava from Maids in Black. I'm just calling to confirm your cleaning appointment for tomorrow. Is everything still on track for your scheduled service?";

const SYSTEM_PROMPT =
  "You are Ava, a friendly and professional customer service representative for Maids in Black, a premium cleaning company. " +
  "Your goal is to confirm the client's cleaning appointment for tomorrow and ask about arrival flexibility. " +
  "If the client confirms: say 'Perfect! I have one quick question that helps us schedule our teams. If needed, how flexible are you with your arrival time? " +
  "For example, do you need us at the scheduled time exactly, are you okay with about an hour of flexibility, or are you flexible anytime that day?' " +
  "Listen carefully and note their answer. " +
  "If the client wants to cancel or reschedule: be understanding, note the details, and let them know the office will follow up. " +
  "Keep the call brief, warm, and professional. Do not discuss pricing or other services.";

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
            ne(cleanerJobs.bookingStatus, "rescheduled"),
          )
        )
        .orderBy(cleanerJobs.serviceDateTime, cleanerJobs.customerName);

      if (jobs.length === 0) return [];

      // Fetch any existing confirmation calls for these jobs on this date
      const jobIds = jobs.map((j) => j.id);
      const existingCalls = await db
        .select({
          cleanerJobId: confirmationCalls.cleanerJobId,
          id: confirmationCalls.id,
          status: confirmationCalls.status,
          vapiCallId: confirmationCalls.vapiCallId,
          recordingUrl: confirmationCalls.recordingUrl,
          summary: confirmationCalls.summary,
          durationSeconds: confirmationCalls.durationSeconds,
          endedReason: confirmationCalls.endedReason,
          firedAt: confirmationCalls.firedAt,
        })
        .from(confirmationCalls)
        .where(
          and(
            inArray(confirmationCalls.cleanerJobId, jobIds),
            eq(confirmationCalls.jobDate, input.date),
          )
        )
        .orderBy(desc(confirmationCalls.firedAt));

      // Map: cleanerJobId → most recent confirmation call
      const callMap = new Map<number, typeof existingCalls[number]>();
      for (const c of existingCalls) {
        if (!callMap.has(c.cleanerJobId)) callMap.set(c.cleanerJobId, c);
      }

      return jobs.map((job) => ({
        ...job,
        confirmationCall: callMap.get(job.id) ?? null,
      }));
    }),

  /**
   * Place a VAPI outbound confirmation call for a single job.
   * Mirrors callsRouter.ts fireCall exactly:
   *   1. callLog row (pending)
   *   2. VAPI POST /call
   *   3. callLog update (fired + vapiCallId)
   *   4. fieldMgmtCalls guard row
   *   5. confirmationCalls row
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

      // ── Normalize phone ───────────────────────────────────────────────────
      const normalizedPhone = input.calledPhone.startsWith("+")
        ? input.calledPhone
        : `+1${input.calledPhone.replace(/\D/g, "")}`;

      if (normalizedPhone === VAPI_OUTBOUND_PHONE_NUMBER) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Self-call protection: cannot call the VAPI outbound number",
        });
      }

      const now = Date.now();

      // ── 1. Insert callLog row (pending) ───────────────────────────────────
      const [logInsert] = await db.insert(callLog).values({
        cleanerJobId: input.cleanerJobId,
        clientName: input.clientName,
        calledPhone: normalizedPhone,
        calledTarget: "client",
        resolvedScript: FIRST_MESSAGE,
        status: "pending",
        jobDate: input.jobDate,
        firedBy: callerName,
        firedAt: now,
      });
      const callLogId = (logInsert as any).insertId as number;

      // ── 2. Place VAPI call ────────────────────────────────────────────────
      if (!ENV.vapiPrivateKey) {
        await db.update(callLog).set({ status: "failed" }).where(eq(callLog.id, callLogId));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "VAPI_PRIVATE_KEY not configured" });
      }

      let vapiCallId: string | null = null;
      try {
        const payload = {
          phoneNumberId: VAPI_OUTBOUND_PHONE_NUMBER_ID,
          customer: { number: normalizedPhone },
          assistant: {
            name: "Ava",
            firstMessage: FIRST_MESSAGE,
            model: {
              provider: "openai",
              model: "gpt-4o-mini",
              messages: [{ role: "system", content: SYSTEM_PROMPT }],
            },
            voice: {
              provider: "11labs",
              voiceId: "EXAVITQu4vr4xnSDxMaL", // Sarah — same as all other outbound calls
              stability: 0.5,
              similarityBoost: 0.75,
              style: 0.3,
              useSpeakerBoost: true,
            },
            maxDurationSeconds: 120,
            voicemailDetection: {
              provider: "twilio",
              voicemailDetectionTypes: ["machine_end_beep", "machine_end_silence"],
              enabled: true,
              machineDetectionTimeout: 8,
            },
            voicemailMessage: `Hi, this is Ava from Maids in Black. I was calling to confirm your cleaning appointment for tomorrow. Please call us back at your convenience. Thank you!`,
          },
        };
        const result = (await vapiPost("/call", payload)) as { id?: string };
        vapiCallId = result?.id ?? null;
        console.log(`[ConfirmationCalls] Call placed to ${normalizedPhone}. VAPI ID: ${vapiCallId ?? "unknown"}`);
      } catch (err) {
        console.error("[ConfirmationCalls] VAPI call failed:", err);
        await db.update(callLog).set({ status: "failed" }).where(eq(callLog.id, callLogId));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `VAPI call failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // ── 3. Update callLog (fired + vapiCallId) ────────────────────────────
      await db
        .update(callLog)
        .set({ status: "fired", vapiCallId: vapiCallId ?? undefined })
        .where(eq(callLog.id, callLogId));

      // ── 4. fieldMgmtCalls guard row — prevents vapiService rogue SMS ──────
      if (vapiCallId) {
        try {
          await db.insert(fieldMgmtCalls).values({
            cleanerJobId: input.cleanerJobId,
            step: "confirmation_call",
            vapiCallId,
            calledPhone: normalizedPhone,
            outcome: "no_answer",
            durationSeconds: 0,
            transcript: null,
            summary: null,
            endedReason: null,
            recordingUrl: null,
          });
          console.log(`[ConfirmationCalls] fieldMgmtCalls guard row inserted for vapiCallId=${vapiCallId}`);
        } catch (fmErr) {
          console.error("[ConfirmationCalls] Failed to insert fieldMgmtCalls guard row:", fmErr);
        }
      }

      // ── 5. Insert confirmationCalls tracking row ──────────────────────────
      const [ccInsert] = await db.insert(confirmationCalls).values({
        cleanerJobId: input.cleanerJobId,
        jobDate: input.jobDate,
        clientName: input.clientName,
        calledPhone: normalizedPhone,
        status: "fired",
        vapiCallId: vapiCallId ?? undefined,
        firedBy: callerName,
        firedAt: now,
      });
      const confirmationCallId = (ccInsert as any).insertId as number;

      return { callLogId, vapiCallId, confirmationCallId };
    }),

  /**
   * Get the latest call status for a specific job+date.
   * Polled by the frontend after placing a call to show live status updates.
   */
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
});
