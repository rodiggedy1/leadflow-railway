/**
 * callMatrixRouter.ts
 * Provides data and call-firing for the AI Call Matrix page.
 *
 * Procedures:
 *   getPeople   — returns today's customers and cleaners for the call matrix people list.
 *   startCall   — fires a Vapi outbound call using the script from the UI, writes to field_mgmt_calls.
 *   pollCall    — polls Vapi for a call's current status (called every 5s after firing).
 */

import { z } from "zod";
import { eq, and, sql, inArray, desc, like } from "drizzle-orm";
import { router, agentProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import {
  cleanerJobs,
  cleanerProfiles,
  scheduleAssignments,
  callLog,
  fieldMgmtCalls,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

// ── VAPI constants — copied verbatim from confirmationCallsRouter.ts ──────────
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

async function vapiGet(path: string): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(`${VAPI_API_BASE}${path}`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${ENV.vapiPrivateKey}` },
    });
    if (!res.ok) return null;
    return res.json() as Promise<Record<string, unknown>>;
  } finally {
    clearTimeout(timer);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "TBD";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" });
  } catch {
    return iso;
  }
}

function etaLabel(
  jobStatus: string | null | undefined,
  etaTimestamp: number | null | undefined,
  delayMinutes: number | null | undefined,
): string {
  if (jobStatus === "completed") return "Completed";
  if (jobStatus === "in_progress" || jobStatus === "arrived") return "On site";
  if (jobStatus === "finishing_up" || jobStatus === "wrapping_up") return "Finishing up";
  if (etaTimestamp) {
    const now = Date.now();
    const diffMin = Math.round((etaTimestamp - now) / 60000);
    if (diffMin <= 0) return "Arriving now";
    return `~${diffMin} min`;
  }
  if (jobStatus === "running_late") return delayMinutes ? `${delayMinutes} min late` : "Running late";
  if (jobStatus === "on_the_way") return "On the way";
  return "Unknown";
}

function customerRisk(job: {
  jobStatus: string | null | undefined;
  etaTimestamp: number | null | undefined;
  delayMinutes: number | null | undefined;
  scheduleConfirmed: number;
}): string {
  if (job.jobStatus === "running_late" || job.delayMinutes) return "High impact";
  if (!job.scheduleConfirmed) return "Unconfirmed";
  if (job.etaTimestamp) {
    const diffMin = Math.round((job.etaTimestamp - Date.now()) / 60000);
    if (diffMin < 0) return "High impact";
  }
  return "On track";
}

function cleanerRisk(job: {
  jobStatus: string | null | undefined;
  scheduleConfirmed: number;
  photoSubmitted: number;
}): string {
  if (job.jobStatus === "running_late") return "Urgent";
  if (!job.scheduleConfirmed) return "Schedule risk";
  if (!job.jobStatus) return "No check-in";
  if (job.jobStatus === "completed" && !job.photoSubmitted) return "QA risk";
  return "On track";
}

// ── Router ────────────────────────────────────────────────────────────────────

export const callMatrixRouter = router({
  /**
   * getPeople
   * Returns customers and cleaners for today's (or a given date's) jobs.
   */
  getPeople: agentProcedure
    .input(z.object({ date: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();

      const jobs = await db.select().from(cleanerJobs)
        .where(and(
          eq(cleanerJobs.jobDate, input.date),
          sql`${cleanerJobs.bookingStatus} != 'cancelled'`,
        ));

      if (jobs.length === 0) return { customers: [], cleaners: [] };

      const jobIds = jobs.map(j => j.id);
      const assignments = jobIds.length > 0
        ? await db.select().from(scheduleAssignments)
            .where(inArray(scheduleAssignments.cleanerJobId, jobIds))
        : [];

      const assignmentByJobId = new Map(assignments.map(a => [a.cleanerJobId, a]));

      const customers = jobs.map(j => {
        const assignment = assignmentByJobId.get(j.id);
        const assignedTeam = assignment?.teamName ?? j.teamName ?? "Unassigned";
        const eta = etaLabel(j.jobStatus, j.etaTimestamp ?? undefined, j.delayMinutes ?? undefined);
        const risk = customerRisk({
          jobStatus: j.jobStatus,
          etaTimestamp: j.etaTimestamp ?? undefined,
          delayMinutes: j.delayMinutes ?? undefined,
          scheduleConfirmed: j.scheduleConfirmed,
        });
        return {
          cleanerJobId: j.id,
          name: j.customerName ?? "Unknown Customer",
          phone: j.customerPhone ?? null,
          meta: [j.serviceType, j.jobAddress].filter(Boolean).join(" · "),
          jobTime: formatTime(j.serviceDateTime),
          eta,
          pay: "Card on file",
          access: j.staffNotes ? j.staffNotes.slice(0, 60) : (j.customerNotes ? j.customerNotes.slice(0, 60) : "No notes"),
          risk,
          assignedTeam,
          jobAddress: j.jobAddress ?? "",
          serviceType: j.serviceType ?? "",
          customerNotes: j.customerNotes ?? "",
          staffNotes: j.staffNotes ?? "",
          jobStatus: j.jobStatus ?? null,
          scheduleConfirmed: j.scheduleConfirmed,
        };
      });

      const teamMap = new Map<string, {
        teamName: string; jobCount: number; jobIds: number[];
        hasNoCheckIn: boolean; hasGpsStale: boolean; hasUnconfirmed: boolean; hasPhotoMissing: boolean;
        phone: string | null;
      }>();

      for (const j of jobs) {
        const assignment = assignmentByJobId.get(j.id);
        const teamName = assignment?.teamName ?? j.teamName;
        if (!teamName) continue;
        const existing = teamMap.get(teamName);
        const noCheckIn = !j.jobStatus;
        const photoMissing = j.jobStatus === "completed" && !j.photoSubmitted;
        const unconfirmed = !j.scheduleConfirmed;
        if (existing) {
          existing.jobCount++;
          existing.jobIds.push(j.id);
          if (noCheckIn) existing.hasNoCheckIn = true;
          if (photoMissing) existing.hasPhotoMissing = true;
          if (unconfirmed) existing.hasUnconfirmed = true;
        } else {
          teamMap.set(teamName, { teamName, jobCount: 1, jobIds: [j.id], hasNoCheckIn: noCheckIn, hasGpsStale: false, hasUnconfirmed: unconfirmed, hasPhotoMissing: photoMissing, phone: null });
        }
      }

      const teamNames = Array.from(teamMap.keys());
      if (teamNames.length > 0) {
        const profiles = await db.select({ name: cleanerProfiles.name, phone: cleanerProfiles.phone })
          .from(cleanerProfiles).where(inArray(cleanerProfiles.name, teamNames));
        for (const p of profiles) {
          const entry = teamMap.get(p.name);
          if (entry && p.phone) entry.phone = p.phone;
        }
      }

      const cleaners = Array.from(teamMap.values()).map(t => {
        const flags: string[] = [];
        if (t.hasNoCheckIn) flags.push("no check-in");
        if (t.hasUnconfirmed) flags.push("unconfirmed");
        if (t.hasPhotoMissing) flags.push("photos missing");
        const meta = `Assigned: ${t.jobCount} job${t.jobCount !== 1 ? "s" : ""} today${flags.length ? " · " + flags.join(", ") : ""}`;
        let risk = "On track";
        if (t.hasNoCheckIn) risk = "No check-in";
        else if (t.hasUnconfirmed) risk = "Schedule risk";
        else if (t.hasPhotoMissing) risk = "QA risk";
        return { teamName: t.teamName, phone: t.phone, meta, jobCount: t.jobCount, risk, hasNoCheckIn: t.hasNoCheckIn, hasUnconfirmed: t.hasUnconfirmed, hasPhotoMissing: t.hasPhotoMissing };
      });

      return { customers, cleaners };
    }),

  /**
   * startCall
   * Fires a Vapi outbound call using the script/firstMessage from the UI.
   * Follows the exact same 4-step pattern as confirmationCallsRouter.placeCall:
   *   1. callLog row (pending)
   *   2. Vapi POST /call
   *   3. callLog update (fired + vapiCallId)
   *   4. fieldMgmtCalls guard row
   */
  startCall: agentProcedure
    .input(z.object({
      cleanerJobId: z.number(),
      jobDate: z.string(),
      personName: z.string(),
      phone: z.string().min(7),
      scenario: z.string(),
      /** The full script text from the textarea — used as both firstMessage and system prompt context */
      script: z.string().min(10),
      /** "customer" | "cleaner" — used to tag the step in field_mgmt_calls */
      audience: z.enum(["customer", "cleaner"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const callerName = (ctx as any).agent?.name ?? (ctx as any).user?.name ?? "Dispatcher";

      // ── Normalize phone ────────────────────────────────────────────────────
      const normalizedPhone = input.phone.startsWith("+")
        ? input.phone
        : `+1${input.phone.replace(/\D/g, "")}`;

      if (normalizedPhone === VAPI_OUTBOUND_PHONE_NUMBER) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Self-call protection: cannot call the VAPI outbound number" });
      }

      const now = Date.now();
      const step = input.audience === "cleaner" ? "ai_matrix_cleaner" : "ai_matrix_customer";

      // ── 1. callLog row (pending) ───────────────────────────────────────────
      const [logInsert] = await db.insert(callLog).values({
        cleanerJobId: input.cleanerJobId,
        clientName: input.personName,
        calledPhone: normalizedPhone,
        calledTarget: input.audience === "cleaner" ? "cleaner" : "client",
        resolvedScript: input.script.slice(0, 1000),
        status: "pending",
        jobDate: input.jobDate,
        firedBy: callerName,
        firedAt: now,
      });
      const callLogId = (logInsert as any).insertId as number;

      if (!ENV.vapiPrivateKey) {
        await db.update(callLog).set({ status: "failed" }).where(eq(callLog.id, callLogId));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "VAPI_PRIVATE_KEY not configured" });
      }

      // ── 2. Vapi POST /call ─────────────────────────────────────────────────
      let vapiCallId: string | null = null;
      try {
        const systemPrompt =
          `You are Ava, a professional operations coordinator for Maids in Black, a premium cleaning company. ` +
          `You are calling ${input.personName} regarding: ${input.scenario}. ` +
          `Be warm, concise, and professional. Listen carefully for the outcome. ` +
          `Once you have delivered the message and received a response, close the call naturally with: ` +
          `'Thank you so much, I really appreciate your time. Have a wonderful day!' and then end the call. ` +
          `If the person wants to call back later, say 'Of course, I completely understand. I'll make a note of that and have someone follow up with you. Have a great day!' then end the call. ` +
          `Do not repeat yourself. Do not ask multiple questions. Do not discuss pricing, other services, or anything outside the scope of this call. ` +
          `Keep the call under 2 minutes.`;

        const payload = {
          phoneNumberId: VAPI_OUTBOUND_PHONE_NUMBER_ID,
          customer: { number: normalizedPhone },
          assistant: {
            name: "Ava",
            firstMessage: input.script,
            model: {
              provider: "openai",
              model: "gpt-4o-mini",
              messages: [{ role: "system", content: systemPrompt }],
            },
            voice: {
              provider: "11labs",
              voiceId: "9FuMHon7Kyk1AGgnR8C2",
              stability: 0.5,
              similarityBoost: 0.75,
              style: 0.3,
              useSpeakerBoost: true,
            },
            maxDurationSeconds: 180,
            endCallFunctionEnabled: true,
            silenceTimeoutSeconds: 20,
            voicemailDetection: {
              provider: "twilio",
              voicemailDetectionTypes: ["machine_end_beep", "machine_end_silence"],
              enabled: true,
              machineDetectionTimeout: 8,
            },
            voicemailMessage: `Hi, this is Ava from Maids in Black. I was calling about ${input.scenario.toLowerCase()}. Please call us back at your convenience. Thank you!`,
          },
        };

        const result = (await vapiPost("/call", payload)) as { id?: string };
        vapiCallId = result?.id ?? null;
        console.log(`[CallMatrix] Call placed to ${normalizedPhone} for "${input.scenario}". VAPI ID: ${vapiCallId ?? "unknown"}`);
      } catch (err) {
        console.error("[CallMatrix] VAPI call failed:", err);
        await db.update(callLog).set({ status: "failed" }).where(eq(callLog.id, callLogId));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `VAPI call failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // ── 3. callLog update (fired + vapiCallId) ─────────────────────────────
      await db.update(callLog)
        .set({ status: "fired", vapiCallId: vapiCallId ?? undefined })
        .where(eq(callLog.id, callLogId));

      // ── 4. fieldMgmtCalls guard row ────────────────────────────────────────
      let fieldMgmtCallId: number | null = null;
      if (vapiCallId) {
        try {
          const [fmInsert] = await db.insert(fieldMgmtCalls).values({
            cleanerJobId: input.cleanerJobId,
            step,
            vapiCallId,
            calledPhone: normalizedPhone,
            outcome: "no_answer",
            durationSeconds: 0,
            transcript: null,
            summary: null,
            endedReason: null,
            recordingUrl: null,
          });
          fieldMgmtCallId = (fmInsert as any).insertId as number;
          console.log(`[CallMatrix] fieldMgmtCalls guard row inserted id=${fieldMgmtCallId} vapiCallId=${vapiCallId}`);
        } catch (fmErr) {
          console.error("[CallMatrix] Failed to insert fieldMgmtCalls guard row:", fmErr);
        }
      }

      return { callLogId, vapiCallId, fieldMgmtCallId };
    }),

  /**
   * pollCall
   * First checks fieldMgmtCalls (updated by the Vapi end-of-call webhook) for the final outcome.
   * Falls back to polling Vapi directly if the webhook hasn't fired yet.
   * Called every 5s by the frontend after firing a call.
   */
  pollCall: agentProcedure
    .input(z.object({ vapiCallId: z.string() }))
    .query(async ({ input }) => {
      // ── 1. Check fieldMgmtCalls first — webhook updates this reliably ────────
      try {
        const db = await getDb();
        if (db) {
          const [fmRow] = await db
            .select()
            .from(fieldMgmtCalls)
            .where(eq(fieldMgmtCalls.vapiCallId, input.vapiCallId))
            .limit(1);

          if (fmRow) {
            // If outcome has been updated from the default "no_answer" by the webhook
            // OR if endedReason is set, the call has ended
            const hasEnded = fmRow.endedReason !== null || fmRow.durationSeconds > 0;
            if (hasEnded) {
              const outcome = fmRow.outcome;
              const status =
                outcome === "answered"  ? "completed" as const :
                outcome === "voicemail" ? "voicemail" as const :
                outcome === "no_answer" ? "no_answer" as const :
                outcome === "failed"    ? "failed"    as const :
                "completed" as const;
              return {
                status,
                endedReason: fmRow.endedReason ?? null,
                summary: fmRow.summary ?? null,
                transcript: fmRow.transcript ?? null,
                durationSeconds: fmRow.durationSeconds ?? null,
                recordingUrl: fmRow.recordingUrl ?? null,
              };
            }
          }
        }
      } catch (err) {
        console.error("[CallMatrix] fieldMgmtCalls poll check failed:", err);
      }

      // ── 2. Fall back to Vapi direct poll ─────────────────────────────────────
      const vapiCall = await vapiGet(`/call/${input.vapiCallId}`);
      if (!vapiCall) return { status: "queued" as const, endedReason: null, summary: null, durationSeconds: null, transcript: null, recordingUrl: null };

      const vapiStatus = vapiCall.status as string | undefined;
      const endedReason = (vapiCall.endedReason as string | undefined) ?? null;
      const artifact = vapiCall.artifact as Record<string, unknown> | undefined;
      const summary = (artifact?.summary as string | undefined) ?? null;
      const transcript = (artifact?.transcript as string | undefined) ?? null;
      const recordingUrl = (artifact?.recordingUrl as string | undefined) ?? null;
      const durationSeconds = vapiCall.endedAt && vapiCall.startedAt
        ? Math.round((new Date(vapiCall.endedAt as string).getTime() - new Date(vapiCall.startedAt as string).getTime()) / 1000)
        : null;

      let status: "queued" | "ringing" | "in_progress" | "completed" | "voicemail" | "no_answer" | "failed" = "queued";
      if (vapiStatus === "queued") status = "queued";
      else if (vapiStatus === "ringing") status = "ringing";
      else if (vapiStatus === "in-progress") status = "in_progress";
      else if (vapiStatus === "ended") {
        if (endedReason === "customer-ended-call" || endedReason === "assistant-ended-call" || endedReason === "exceeded-max-duration") status = "completed";
        else if (endedReason?.includes("voicemail") || endedReason === "machine_end_beep" || endedReason === "machine_end_silence") status = "voicemail";
        else if (endedReason === "no-answer" || endedReason === "silence-timed-out" || endedReason === "customer-did-not-answer") status = "no_answer";
        else if (endedReason === "twilio-failed-to-connect-call" || endedReason === "customer-did-not-give-microphone-permission") status = "failed";
        else if (durationSeconds && durationSeconds > 5) status = "completed";
        else status = "no_answer";
      }

      // If Vapi says ended, write back to fieldMgmtCalls so next poll hits the fast path
      if (vapiStatus === "ended") {
        try {
          const db = await getDb();
          if (db) {
            await db.update(fieldMgmtCalls)
              .set({
                outcome: status === "completed" ? "answered" : status,
                durationSeconds: durationSeconds ?? 0,
                transcript,
                summary,
                endedReason,
                recordingUrl,
              })
              .where(eq(fieldMgmtCalls.vapiCallId, input.vapiCallId));
          }
        } catch (err) {
          console.error("[CallMatrix] Failed to update fieldMgmtCalls on Vapi poll:", err);
        }
      }

      return { status, endedReason, summary, transcript, durationSeconds, recordingUrl };
    }),

  /**
   * getCallHistory
   * Returns recent AI Matrix calls from field_mgmt_calls (step starts with 'ai_matrix').
   * Includes recording URL, transcript, outcome, and duration.
   */
  getCallHistory: agentProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(50) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const rows = await db
        .select()
        .from(fieldMgmtCalls)
        .where(like(fieldMgmtCalls.step, "ai_matrix%"))
        .orderBy(desc(fieldMgmtCalls.createdAt))
        .limit(input.limit);

      return rows.map(r => ({
        id: r.id,
        cleanerJobId: r.cleanerJobId,
        step: r.step,
        calledPhone: r.calledPhone,
        outcome: r.outcome,
        durationSeconds: r.durationSeconds,
        transcript: r.transcript,
        summary: r.summary,
        endedReason: r.endedReason,
        recordingUrl: r.recordingUrl,
        createdAt: r.createdAt,
        vapiCallId: r.vapiCallId,
      }));
    }),
});
