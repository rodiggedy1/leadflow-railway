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
import { router, opsChatProcedure, publicProcedure, agentProcedure } from "./_core/trpc";
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
import { sendSms } from "./openphone";

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
  "Your goal is to confirm the client's cleaning appointment for tomorrow, ask about arrival flexibility, and collect any service notes. " +
  "Follow this exact flow:\n" +
  "1. After the client confirms, ask: 'Perfect! I have one quick question that helps us schedule our teams. If needed, how flexible are you with your arrival time? " +
  "For example, do you need us at the scheduled time exactly, are you okay with about a 2-hour window of flexibility, or are you flexible anytime that day?'\n" +
  "2. Listen and note their flexibility answer.\n" +
  "3. Then ask: 'Great, I'll make a note of that. One last thing — are there any notes for the service? For example, if you'll be home, any pets we should know about, or any special requests?'\n" +
  "4. Listen and note any details they share.\n" +
  "5. Close with: 'Thank you so much! We look forward to seeing you tomorrow — have a lovely day!'\n" +
  "If the client wants to cancel or reschedule: be understanding, say 'Of course, I completely understand. I\'ll make a note of that and have someone from our office follow up with you to get that sorted. Is there anything else I can help you with before I let you go?' then end the call.\n" +
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
          smsConfirmedAt: confirmationCalls.smsConfirmedAt,
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
              voiceId: "9FuMHon7Kyk1AGgnR8C2",
              stability: 0.5,
              similarityBoost: 0.75,
              style: 0.3,
              useSpeakerBoost: true,
            },
            maxDurationSeconds: 120,
            endCallFunctionEnabled: true,
            silenceTimeoutSeconds: 20,
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

      // ── 6. Send simultaneous SMS alongside the call ───────────────────────────
      // Fire-and-forget: don't block the response if SMS fails
      ;(async () => {
        try {
          const firstName = input.clientName?.split(" ")[0] ?? "there";
          const smsBody =
            `Hi ${firstName}, this is Maids in Black! Just confirming your cleaning appointment tomorrow. ` +
            `Reply YES to confirm and FLEXIBLE or NOT FLEXIBLE to give us an idea of how flexible you are for your arrival window. ` +
            `We look forward to seeing you! Feel free to add any additional notes as well.`;
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
            console.log(`[ConfirmationCalls] Simultaneous SMS sent to ${normalizedPhone} for call ${confirmationCallId}`);
          } else {
            console.error(`[ConfirmationCalls] Simultaneous SMS failed for call ${confirmationCallId}: ${smsResult.error}`);
          }
        } catch (smsErr) {
          console.error(`[ConfirmationCalls] Simultaneous SMS error for call ${confirmationCallId}:`, smsErr);
        }
      })();

      return { callLogId, vapiCallId, confirmationCallId };
    }),

  /**
   * Get the latest call status for a specific job+date.
   * Polled by the frontend after placing a call to show live status updates.
   */
  /**
   * Poll VAPI directly for any calls still in "fired" state.
   * Called by the frontend every 5s so results appear immediately without
   * waiting for VAPI's end-of-call webhook (which can take 30-90s).
   */
  pollFiredCalls: publicProcedure
    .input(z.object({ jobDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { updated: 0 };

      // Find all calls still in "fired" state for this date
      const firedCalls = await db
        .select({
          id: confirmationCalls.id,
          vapiCallId: confirmationCalls.vapiCallId,
          calledPhone: confirmationCalls.calledPhone,
          clientName: confirmationCalls.clientName,
          smsFollowupSent: confirmationCalls.smsFollowupSent,
        })
        .from(confirmationCalls)
        .where(
          and(
            eq(confirmationCalls.jobDate, input.jobDate),
            eq(confirmationCalls.status, "fired"),
          )
        );

      if (firedCalls.length === 0) return { updated: 0 };

      let updated = 0;
      for (const row of firedCalls) {
        if (!row.vapiCallId) continue;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 8_000);
          let vapiCall: Record<string, unknown> | null = null;
          try {
            const res = await fetch(`${VAPI_API_BASE}/call/${row.vapiCallId}`, {
              signal: controller.signal,
              headers: { Authorization: `Bearer ${ENV.vapiPrivateKey}` },
            });
            if (res.ok) vapiCall = await res.json() as Record<string, unknown>;
          } finally {
            clearTimeout(timer);
          }

          if (!vapiCall) continue;

          // Only process if VAPI says the call has ended
          const vapiStatus = vapiCall.status as string | undefined;
          if (vapiStatus !== "ended") continue;

          const endedReason = (vapiCall.endedReason as string | undefined) ?? null;
          const artifact = vapiCall.artifact as Record<string, unknown> | undefined;
          const transcript = (artifact?.transcript as string | undefined) ?? (vapiCall.transcript as string | undefined) ?? null;
          const summary = (artifact?.summary as string | undefined) ?? null;
          const recordingUrl = (artifact?.recordingUrl as string | undefined) ?? null;
          const durationSeconds = vapiCall.endedAt && vapiCall.startedAt
            ? Math.round((new Date(vapiCall.endedAt as string).getTime() - new Date(vapiCall.startedAt as string).getTime()) / 1000)
            : null;

          const ccStatus =
            (endedReason === "customer-ended-call" || endedReason === "assistant-ended-call" || endedReason === "exceeded-max-duration") ? "completed"
            : (endedReason === "no-answer" || endedReason === "voicemail" || endedReason === "machine_end_beep" || endedReason === "machine_end_silence" || endedReason === "silence-timed-out") ? "no_answer"
            : (endedReason === "customer-did-not-give-microphone-permission" || endedReason === "twilio-failed-to-connect-call") ? "failed"
            : "completed";

          await db.update(confirmationCalls)
            .set({
              status: ccStatus,
              durationSeconds,
              transcript,
              summary,
              endedReason,
              recordingUrl,
              completedAt: Date.now(),
            })
            .where(eq(confirmationCalls.id, row.id));

          console.log(`[ConfirmationCalls] Polled VAPI — updated call ${row.vapiCallId}: status=${ccStatus}, endedReason=${endedReason}`);
          updated++;

          // Fire AI parsing async (same as webhook path)
          if (transcript || summary) {
            const { invokeLLM } = await import("./_core/llm");
            (async () => {
              try {
                const textToAnalyze = transcript ?? summary ?? "";
                const aiResult = await invokeLLM({
                  messages: [
                    {
                      role: "system",
                      content: `You are analyzing a phone call transcript between an AI agent (Ava) from Maids in Black and a client, where Ava called to confirm a cleaning appointment for tomorrow.\n\nExtract the following fields and return ONLY valid JSON:\n- outcome: one of "confirmed", "reschedule", "cancel", "no_answer", "voicemail", "unknown"\n- flexibility: one of "exact", "two_hour", "anytime", "unknown"\n- notes: array of short strings for special circumstances (e.g. "Dog home", "Lockbox", "WFH", "Baby sleeping"). Empty array if none.\n- outcomeLabel: short human-readable label max 4 words e.g. "Confirmed ✓", "Wants to Reschedule"`,
                    },
                    { role: "user", content: `Transcript:\n${textToAnalyze.slice(0, 4000)}` },
                  ],
                  response_format: {
                    type: "json_schema",
                    json_schema: {
                      name: "confirmation_call_analysis",
                      strict: true,
                      schema: {
                        type: "object",
                        properties: {
                          outcome: { type: "string" },
                          flexibility: { type: "string" },
                          notes: { type: "array", items: { type: "string" } },
                          outcomeLabel: { type: "string" },
                        },
                        required: ["outcome", "flexibility", "notes", "outcomeLabel"],
                        additionalProperties: false,
                      },
                    },
                  },
                });
                const raw = aiResult?.choices?.[0]?.message?.content;
                if (raw) {
                  const parsed = JSON.parse(raw);
                  await db.update(confirmationCalls)
                    .set({
                      aiOutcome: parsed.outcome ?? null,
                      aiFlexibility: parsed.flexibility ?? null,
                      aiNotes: parsed.notes?.length ? JSON.stringify(parsed.notes) : null,
                      aiOutcomeLabel: parsed.outcomeLabel ?? null,
                    })
                    .where(eq(confirmationCalls.id, row.id));
                  console.log(`[ConfirmationCalls] AI parsed polled call ${row.vapiCallId}: outcome=${parsed.outcome}`);
                }
              } catch (aiErr) {
                console.error("[ConfirmationCalls] AI parsing failed for polled call:", aiErr);
              }
            })();
          }
        } catch (err) {
          console.error(`[ConfirmationCalls] Poll failed for vapiCallId=${row.vapiCallId}:`, err);
        }
      }

      return { updated };
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
