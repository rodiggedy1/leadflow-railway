/**
 * callsRouter — AI Call Command Center
 *
 * Provides procedures for managing the operational call template library,
 * raising job issues, firing VAPI outbound calls, and viewing the call log.
 *
 * VAPI setup mirrors fieldMgmtEngine.ts:
 *   - Phone number ID: 61431a3e-8144-4acd-b394-8f600ec3a473 (Twilio-backed, no daily cap)
 *   - Outbound number: +19347898077 (never call this — self-call protection)
 */

import { z } from "zod";
import { router, agentProcedure, opsChatProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { callTemplates, callLog, jobIssues, cleanerJobs, cleanerProfiles, scheduleAssignments, schedulingTeams, fieldMgmtCalls } from "../drizzle/schema";
import { eq, and, desc, isNull } from "drizzle-orm";
import { ENV } from "./_core/env";

// ── VAPI constants (mirrors fieldMgmtEngine.ts) ───────────────────────────────
const VAPI_API_BASE = "https://api.vapi.ai";
const VAPI_OUTBOUND_PHONE_NUMBER_ID = "61431a3e-8144-4acd-b394-8f600ec3a473"; // Twilio-backed
const VAPI_OUTBOUND_PHONE_NUMBER = "+19347898077"; // self-call protection — never call this

// ── VAPI helper ───────────────────────────────────────────────────────────────
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

// ── Variable resolution ───────────────────────────────────────────────────────
/**
 * Resolves {{variable}} placeholders in a script template.
 * Unknown variables are left as-is so the dispatcher can see what still needs filling.
 */
function resolveScript(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return vars[key] ?? match;
  });
}

/**
 * Extracts all {{variable}} names from a script template.
 */
function extractVariables(template: string): string[] {
  const vars = new Set<string>();
  let m: RegExpExecArray | null;
  const re = /\{\{(\w+)\}\}/g;
  while ((m = re.exec(template)) !== null) vars.add(m[1]);
  return Array.from(vars);
}

// ── Router ────────────────────────────────────────────────────────────────────
export const callsRouter = router({

  /**
   * List all active call templates.
   * Used to populate the template selector in the Issue Dialog.
   */
  getCallTemplates: opsChatProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      return db
        .select({
          id: callTemplates.id,
          name: callTemplates.name,
          triggerType: callTemplates.triggerType,
          targetType: callTemplates.targetType,
          scriptTemplate: callTemplates.scriptTemplate,
          isActive: callTemplates.isActive,
          sortOrder: callTemplates.sortOrder,
        })
        .from(callTemplates)
        .where(eq(callTemplates.isActive, 1))
        .orderBy(callTemplates.sortOrder, callTemplates.name);
    }),

  /**
   * Raise an issue for a job+date.
   * Returns the new issue row plus suggested templates and pre-filled variables
   * pulled from the schedule (team name, client name, address, scheduled time).
   * Dispatcher can override variables before firing.
   */
  raiseIssue: opsChatProcedure
    .input(z.object({
      cleanerJobId: z.number(),
      jobDate: z.string(), // YYYY-MM-DD
      issueType: z.enum([
        "late_team", "no_access", "parking", "delay", "lockout",
        "utility_issue", "no_checkin", "completion", "manual",
      ]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const callerName = (ctx as any).opsCaller?.name ?? "Dispatcher";

      // ── 1. Fetch job data for variable pre-fill ──────────────────────────
      const [job] = await db
        .select({
          id: cleanerJobs.id,
          teamName: cleanerJobs.teamName,
          customerName: cleanerJobs.customerName,
          customerPhone: cleanerJobs.customerPhone,
          jobAddress: cleanerJobs.jobAddress,
          serviceDateTime: cleanerJobs.serviceDateTime,
          cleanerName: cleanerJobs.cleanerName,
          teamId: cleanerJobs.teamId,
          cleanerProfileId: cleanerJobs.cleanerProfileId,
        })
        .from(cleanerJobs)
        .where(eq(cleanerJobs.id, input.cleanerJobId))
        .limit(1);

      // ── 1b. Fetch cleaner phone from cleanerProfiles ─────────────────────
      let teamPhone: string | null = null;
      if (job?.cleanerProfileId) {
        const [profile] = await db
          .select({ phone: cleanerProfiles.phone })
          .from(cleanerProfiles)
          .where(eq(cleanerProfiles.id, job.cleanerProfileId))
          .limit(1);
        teamPhone = profile?.phone ?? null;
      }

      // ── 2. Get ETA from schedule assignment if available ─────────────────
      let estimatedArrivalMs: number | null = null;
      if (job) {
        const [assignment] = await db
          .select({ estimatedArrivalMs: scheduleAssignments.estimatedArrivalMs })
          .from(scheduleAssignments)
          .where(and(
            eq(scheduleAssignments.cleanerJobId, input.cleanerJobId),
            eq(scheduleAssignments.jobDate, input.jobDate),
          ))
          .limit(1);
        if (assignment?.estimatedArrivalMs) {
          estimatedArrivalMs = assignment.estimatedArrivalMs;
        }
      }

      // ── 3. Build pre-filled variable map ─────────────────────────────────
      const scheduledTime = job?.serviceDateTime
        ? new Date(job.serviceDateTime).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
            timeZone: ENV.businessTimezone,
          })
        : "";
      const etaTime = estimatedArrivalMs
        ? new Date(estimatedArrivalMs).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
            timeZone: ENV.businessTimezone,
          })
        : "";

      const prefillVars: Record<string, string> = {
        team_name: job?.teamName ?? job?.cleanerName ?? "",
        client_name: job?.customerName ?? "",
        address: job?.jobAddress ?? "",
        time: scheduledTime,
        new_eta: etaTime || scheduledTime,
        water_power_access: "",
      };

      // ── 4. Suggest matching templates ─────────────────────────────────────
      // Map issue type → relevant trigger types
      const triggerMap: Record<string, string[]> = {
        late_team: ["late_team", "checkin_reminder"],
        no_access: ["no_access", "lockout_warning"],
        parking: ["parking"],
        delay: ["delay_update", "late_team"],
        lockout: ["lockout_warning", "lockout_final"],
        utility_issue: ["utility_issue"],
        no_checkin: ["checkin_reminder", "arrival_confirmation"],
        completion: ["completion_walkthrough"],
        manual: ["manual"],
      };
      const relevantTriggers = triggerMap[input.issueType] ?? ["manual"];

      const templates = await db
        .select()
        .from(callTemplates)
        .where(eq(callTemplates.isActive, 1))
        .orderBy(callTemplates.sortOrder);

      const suggestedTemplates = templates
        .filter(t => relevantTriggers.includes(t.triggerType))
        .map(t => ({
          // Only return primitive fields — avoid spreading Date columns (createdAt/updatedAt)
          // which cause superjson deserialization crashes on the client.
          id: t.id,
          name: t.name,
          triggerType: t.triggerType,
          targetType: t.targetType,
          scriptTemplate: t.scriptTemplate,
          isActive: t.isActive,
          sortOrder: t.sortOrder,
          variables: extractVariables(t.scriptTemplate),
          prefilledScript: resolveScript(t.scriptTemplate, prefillVars),
        }));

      // ── 5. Create the issue row ───────────────────────────────────────────
      const [insertResult] = await db.insert(jobIssues).values({
        cleanerJobId: input.cleanerJobId,
        jobDate: input.jobDate,
        issueType: input.issueType as any,
        raisedBy: "manual",
        raisedByName: callerName,
        raisedAt: Date.now(),
        notes: input.notes,
      });

      const issueId = (insertResult as any).insertId as number;

      return {
        issueId,
        prefillVars,
        suggestedTemplates,
        job: job
          ? {
              teamName: job.teamName,
              customerName: job.customerName,
              customerPhone: job.customerPhone ?? null,
              teamPhone: teamPhone ?? null,
              jobAddress: job.jobAddress,
              scheduledTime,
            }
          : null,
      };
    }),

  /**
   * Fire an AI call for a given issue.
   * Resolves template variables, places the VAPI call, and creates a callLog row.
   */
  fireCall: opsChatProcedure
    .input(z.object({
      issueId: z.number(),
      cleanerJobId: z.number(),
      jobDate: z.string(),
      templateId: z.number(),
      /** Fully resolved script (variables already substituted by dispatcher) */
      resolvedScript: z.string().min(1),
      /** Who to call */
      calledTarget: z.enum(["team", "client"]),
      /** Phone number to call (E.164) */
      calledPhone: z.string().min(10),
      /** Denormalized names for the log */
      teamName: z.string().optional(),
      clientName: z.string().optional(),
      teamId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const callerName = (ctx as any).opsCaller?.name ?? "Dispatcher";

      // ── Validate phone ────────────────────────────────────────────────────
      const normalizedPhone = input.calledPhone.startsWith("+")
        ? input.calledPhone
        : `+1${input.calledPhone.replace(/\D/g, "")}`;

      if (normalizedPhone === VAPI_OUTBOUND_PHONE_NUMBER) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Self-call protection: cannot call the VAPI outbound number",
        });
      }

      // ── Fetch template name ───────────────────────────────────────────────
      const [template] = await db
        .select({ name: callTemplates.name })
        .from(callTemplates)
        .where(eq(callTemplates.id, input.templateId))
        .limit(1);

      const now = Date.now();

      // ── Create callLog row (pending) ──────────────────────────────────────
      const [logInsert] = await db.insert(callLog).values({
        cleanerJobId: input.cleanerJobId,
        teamId: input.teamId,
        teamName: input.teamName,
        clientName: input.clientName,
        calledPhone: normalizedPhone,
        calledTarget: input.calledTarget,
        templateId: input.templateId,
        templateName: template?.name,
        resolvedScript: input.resolvedScript,
        status: "pending",
        jobDate: input.jobDate,
        firedBy: callerName,
        firedAt: now,
      });
      const callLogId = (logInsert as any).insertId as number;

      // ── Link issue to this call log ───────────────────────────────────────
      await db
        .update(jobIssues)
        .set({ callLogId })
        .where(eq(jobIssues.id, input.issueId));

      // ── Place VAPI call ───────────────────────────────────────────────────
      if (!ENV.vapiPrivateKey) {
        await db
          .update(callLog)
          .set({ status: "failed" })
          .where(eq(callLog.id, callLogId));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "VAPI_PRIVATE_KEY not configured",
        });
      }

      let vapiCallId: string | null = null;
      try {
        const payload = {
          phoneNumberId: VAPI_OUTBOUND_PHONE_NUMBER_ID,
          customer: { number: normalizedPhone },
          assistant: {
            name: "CallCommandCenter",
            firstMessage: input.resolvedScript,
            model: {
              provider: "openai",
              model: "gpt-4o-mini",
              messages: [
                {
                  role: "system",
                  content:
                    "You are Madison, a professional dispatcher for Maids in Black. " +
                    "Read the provided message clearly and professionally. " +
                    "If the person responds, acknowledge politely and let them know the office has been notified. " +
                    "Keep the call brief and professional.",
                },
              ],
            },
            voice: {
              provider: "11labs",
              voiceId: "EXAVITQu4vr4xnSDxMaL", // Sarah — same as working fieldMgmt calls
              stability: 0.5,
              similarityBoost: 0.75,
              style: 0.3,
              useSpeakerBoost: true,
            },
            maxDurationSeconds: 40,
            voicemailDetection: {
              provider: "twilio",
              voicemailDetectionTypes: ["machine_end_beep", "machine_end_silence"],
              enabled: true,
              machineDetectionTimeout: 8,
            },
            voicemailMessage: input.resolvedScript,
          },
        };

        const result = await vapiPost("/call", payload) as { id?: string };
        vapiCallId = result?.id ?? null;
        console.log(`[CallCenter] Call placed to ${normalizedPhone}. VAPI ID: ${vapiCallId ?? "unknown"}`);
      } catch (err) {
        console.error("[CallCenter] VAPI call failed:", err);
        await db
          .update(callLog)
          .set({ status: "failed" })
          .where(eq(callLog.id, callLogId));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `VAPI call failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // ── Update callLog with VAPI call ID and fired status ─────────────────
      await db
        .update(callLog)
        .set({ status: "fired", vapiCallId: vapiCallId ?? undefined })
        .where(eq(callLog.id, callLogId));

      // ── Guard: insert fieldMgmtCalls row so vapiService skips post-call SMS ──────
      // vapiService.processEndOfCallReport checks fieldMgmtCalls for the vapiCallId
      // to determine if this is an internal outbound call. Without this row, it
      // treats the call as an inbound customer call and sends a "Hi There, thank you
      // for reaching out" SMS to the cleaner/client being called.
      if (vapiCallId) {
        try {
          await db.insert(fieldMgmtCalls).values({
            cleanerJobId: input.cleanerJobId,
            step: "call_command_center",
            vapiCallId,
            calledPhone: normalizedPhone,
            outcome: "no_answer", // updated by end-of-call webhook
            durationSeconds: 0,
            transcript: null,
            summary: null,
            endedReason: null,
            recordingUrl: null,
          });
          console.log(`[CallCenter] fieldMgmtCalls guard row inserted for vapiCallId=${vapiCallId}`);
        } catch (fmErr) {
          console.error("[CallCenter] Failed to insert fieldMgmtCalls guard row:", fmErr);
        }
      }

      return { callLogId, vapiCallId };
    }),

  /**
   * Get call log for a specific date (or all recent calls).
   * Used by the Call Log panel in the toolbar.
   */
  getCallLog: opsChatProcedure
    .input(z.object({
      jobDate: z.string().optional(), // YYYY-MM-DD filter
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions = input.jobDate
        ? [eq(callLog.jobDate, input.jobDate)]
        : [];

      return db
        .select({
          id: callLog.id,
          cleanerJobId: callLog.cleanerJobId,
          teamId: callLog.teamId,
          teamName: callLog.teamName,
          clientName: callLog.clientName,
          calledPhone: callLog.calledPhone,
          calledTarget: callLog.calledTarget,
          templateId: callLog.templateId,
          templateName: callLog.templateName,
          resolvedScript: callLog.resolvedScript,
          status: callLog.status,
          vapiCallId: callLog.vapiCallId,
          recordingUrl: callLog.recordingUrl,
          transcript: callLog.transcript,
          durationSeconds: callLog.durationSeconds,
          firedBy: callLog.firedBy,
          firedAt: callLog.firedAt,
          completedAt: callLog.completedAt,
          notes: callLog.notes,
          jobDate: callLog.jobDate,
        })
        .from(callLog)
        .where(conditions.length > 0 ? conditions[0] : undefined)
        .orderBy(desc(callLog.firedAt))
        .limit(input.limit);
    }),

  /**
   * Get open issues for a specific job+date.
   * Used to show the issue badge on job cards.
   */
  getJobIssues: opsChatProcedure
    .input(z.object({
      cleanerJobId: z.number(),
      jobDate: z.string(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select({
          id: jobIssues.id,
          cleanerJobId: jobIssues.cleanerJobId,
          jobDate: jobIssues.jobDate,
          issueType: jobIssues.issueType,
          raisedBy: jobIssues.raisedBy,
          raisedByName: jobIssues.raisedByName,
          raisedAt: jobIssues.raisedAt,
          resolvedAt: jobIssues.resolvedAt,
          callLogId: jobIssues.callLogId,
          notes: jobIssues.notes,
        })
        .from(jobIssues)
        .where(and(
          eq(jobIssues.cleanerJobId, input.cleanerJobId),
          eq(jobIssues.jobDate, input.jobDate),
          isNull(jobIssues.resolvedAt),
        ))
        .orderBy(desc(jobIssues.raisedAt));
    }),

  /**
   * Get all open issues for a date (for the toolbar badge count).
   */
  getDayIssues: opsChatProcedure
    .input(z.object({ jobDate: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select({
          id: jobIssues.id,
          cleanerJobId: jobIssues.cleanerJobId,
          jobDate: jobIssues.jobDate,
          issueType: jobIssues.issueType,
          raisedBy: jobIssues.raisedBy,
          raisedByName: jobIssues.raisedByName,
          raisedAt: jobIssues.raisedAt,
          resolvedAt: jobIssues.resolvedAt,
          callLogId: jobIssues.callLogId,
          notes: jobIssues.notes,
        })
        .from(jobIssues)
        .where(and(
          eq(jobIssues.jobDate, input.jobDate),
          isNull(jobIssues.resolvedAt),
        ))
        .orderBy(desc(jobIssues.raisedAt));
    }),

  /**
   * Resolve an issue (mark it done).
   */
  resolveIssue: opsChatProcedure
    .input(z.object({ issueId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db
        .update(jobIssues)
        .set({ resolvedAt: Date.now() })
        .where(eq(jobIssues.id, input.issueId));
      return { ok: true };
    }),

  /**
   * Update a call log entry (e.g. add dispatcher notes after the call).
   */
  updateCallLog: opsChatProcedure
    .input(z.object({
      callLogId: z.number(),
      notes: z.string().optional(),
      status: z.enum(["pending", "fired", "completed", "failed", "no_answer"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const updates: Record<string, unknown> = {};
      if (input.notes !== undefined) updates.notes = input.notes;
      if (input.status !== undefined) updates.status = input.status;
      if (Object.keys(updates).length === 0) return { ok: true };
      await db.update(callLog).set(updates as any).where(eq(callLog.id, input.callLogId));
      return { ok: true };
    }),

  /**
   * Auto-raise issues for jobs with no check-in past their scheduled time.
   * Called by the periodic cron. Returns the number of issues raised.
   */
  autoRaiseNoCheckinIssues: opsChatProcedure
    .input(z.object({ jobDate: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { raised: 0 };

      const nowMs = Date.now();
      const GRACE_MINUTES = 15; // raise issue if 15+ min past scheduled time with no check-in

      // Get all jobs for the date that haven't checked in
      const jobs = await db
        .select({
          id: cleanerJobs.id,
          serviceDateTime: cleanerJobs.serviceDateTime,
          jobStatus: cleanerJobs.jobStatus,
          teamName: cleanerJobs.teamName,
          customerName: cleanerJobs.customerName,
          jobDate: cleanerJobs.jobDate,
        })
        .from(cleanerJobs)
        .where(eq(cleanerJobs.jobDate, input.jobDate));

      let raised = 0;

      for (const job of jobs) {
        if (!job.serviceDateTime) continue;

        // Skip if already checked in (any status beyond initial)
        const checkedInStatuses = ["arrived", "in_progress", "finishing_up", "wrapping_up", "completed"];
        if (job.jobStatus && checkedInStatuses.includes(job.jobStatus)) continue;

        const scheduledMs = new Date(job.serviceDateTime).getTime();
        const minutesPast = (nowMs - scheduledMs) / 60_000;

        if (minutesPast < GRACE_MINUTES) continue;

        // Check if we already have an open no_checkin issue for this job+date
        const existing = await db
          .select({ id: jobIssues.id })
          .from(jobIssues)
          .where(and(
            eq(jobIssues.cleanerJobId, job.id),
            eq(jobIssues.jobDate, input.jobDate),
            eq(jobIssues.issueType, "no_checkin"),
            isNull(jobIssues.resolvedAt),
          ))
          .limit(1);

        if (existing.length > 0) continue;

        await db.insert(jobIssues).values({
          cleanerJobId: job.id,
          jobDate: input.jobDate,
          issueType: "no_checkin",
          raisedBy: "auto",
          raisedByName: "system",
          raisedAt: nowMs,
          notes: `Auto-raised: no check-in ${Math.round(minutesPast)} min past scheduled time`,
        });
        raised++;
      }

      return { raised };
    }),
});

export type CallsRouter = typeof callsRouter;
