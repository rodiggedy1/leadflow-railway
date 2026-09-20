import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { callTemplates, leadflowJobs } from "../drizzle/schema";
import { router, agentProcedure } from "./_core/trpc";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { normalizePhoneLegacy } from "./utils/phone";

const issueTypes = [
  "late_team",
  "no_access",
  "parking",
  "delay",
  "lockout",
  "utility_issue",
  "no_checkin",
  "completion",
  "manual",
] as const;

const callStatuses = [
  "pending",
  "fired",
  "completed",
  "failed",
  "no_answer",
] as const;
const dateInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const vapiApiBase = "https://api.vapi.ai";
const vapiOutboundPhoneNumberId = "61431a3e-8144-4acd-b394-8f600ec3a473";
const vapiOutboundPhoneNumber = "+19347898077";

interface AssignmentRow {
  teamId: number | null;
  teamName: string | null;
  estimatedArrivalMs: number | null;
}

interface IssueRow {
  id: number;
}

interface DayIssueRow {
  id: number;
  leadflowJobId: number;
  jobDate: string;
  issueType: (typeof issueTypes)[number];
  raisedBy: "manual" | "auto";
  raisedByName: string | null;
  raisedAt: number;
  resolvedAt: number | null;
  callLogId: number | null;
  notes: string | null;
  clientName: string | null;
  teamName: string | null;
  jobAddress: string | null;
  serviceDateTime: string | null;
}

interface CallLogRow {
  id: number;
  leadflowJobId: number;
  teamId: number | null;
  teamName: string | null;
  clientName: string | null;
  calledPhone: string | null;
  calledTarget: "team" | "client";
  templateId: number | null;
  templateName: string | null;
  resolvedScript: string;
  status: (typeof callStatuses)[number];
  lifecycle: (typeof callStatuses)[number];
  vapiCallId: string | null;
  recordingUrl: string | null;
  transcript: string | null;
  transcriptLanguage: string | null;
  transcriptEnglish: string | null;
  durationSeconds: number | null;
  firedBy: string | null;
  firedAt: number | null;
  completedAt: number | null;
  notes: string | null;
  jobDate: string | null;
  jobAddress: string | null;
  serviceDateTime: string | null;
}

function rowsFrom<T>(result: unknown): T[] {
  if (Array.isArray(result) && Array.isArray(result[0]))
    return result[0] as T[];
  return result as T[];
}

function insertIdFrom(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  const insertId = Number(
    (header as { insertId?: number } | undefined)?.insertId
  );
  if (!Number.isInteger(insertId) || insertId <= 0) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Insert did not return an identifier",
    });
  }
  return insertId;
}

function formatTime(value: string | null): string {
  if (!value) return "";
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return "";
  return time.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  });
}

function resolveScript(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (match, key) => variables[key] ?? match
  );
}

function extractVariables(template: string): string[] {
  const variables = new Set<string>();
  const matcher = /\{\{(\w+)\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(template)) !== null) variables.add(match[1]);
  return Array.from(variables);
}

async function postOutboundVapiCall(body: unknown): Promise<{ id?: string }> {
  if (!ENV.vapiPrivateKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "VAPI_PRIVATE_KEY not configured",
    });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${vapiApiBase}/call`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${ENV.vapiPrivateKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`VAPI POST /call → ${response.status}: ${await response.text()}`);
    }
    return await response.json() as { id?: string };
  } finally {
    clearTimeout(timeout);
  }
}

async function findAssignment(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  leadflowJobId: number,
  jobDate: string
): Promise<AssignmentRow | null> {
  const result = await db.execute(sql`
    SELECT
      schedule_assignments.teamId AS teamId,
      scheduling_teams.name AS teamName,
      schedule_assignments.estimatedArrivalMs AS estimatedArrivalMs
    FROM schedule_assignments
    LEFT JOIN scheduling_teams ON scheduling_teams.id = schedule_assignments.teamId
    WHERE schedule_assignments.leadflowJobId = ${leadflowJobId}
      AND schedule_assignments.jobDate = ${jobDate}
    LIMIT 1
  `);
  return rowsFrom<AssignmentRow>(result)[0] ?? null;
}

async function markCallFailed(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  callLogId: number,
  leadflowJobId: number
): Promise<void> {
  await db.execute(sql`
    UPDATE call_log
    SET status = 'failed'
    WHERE id = ${callLogId}
      AND leadflowJobId = ${leadflowJobId}
  `);
}

/**
 * Isolated call and issue procedures for the LeadFlow-owned Schedule preview.
 * Every job relationship in this router is scoped through leadflowJobId.
 */
export const leadflowScheduleCallsRouter = router({
  raiseIssue: agentProcedure
    .input(
      z.object({
        leadflowJobId: z.number().int().positive(),
        jobDate: dateInput,
        issueType: z.enum(issueTypes),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "DB unavailable",
        });

      const [job] = await db
        .select({
          id: leadflowJobs.id,
          jobDate: leadflowJobs.jobDate,
          teamName: leadflowJobs.teamName,
          customerName: leadflowJobs.customerName,
          customerPhone: leadflowJobs.customerPhone,
          jobAddress: leadflowJobs.jobAddress,
          serviceDateTime: leadflowJobs.serviceDateTime,
        })
        .from(leadflowJobs)
        .where(
          sql`${leadflowJobs.id} = ${input.leadflowJobId} AND ${leadflowJobs.jobDate} = ${input.jobDate}`
        )
        .limit(1);

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "LeadFlow job was not found for the supplied date",
        });
      }

      const assignment = await findAssignment(
        db,
        input.leadflowJobId,
        input.jobDate
      );
      const scheduledTime = formatTime(job.serviceDateTime);
      const etaTime = assignment?.estimatedArrivalMs
        ? formatTime(
            new Date(Number(assignment.estimatedArrivalMs)).toISOString()
          )
        : "";
      const teamName = assignment?.teamName ?? job.teamName ?? null;
      const prefillVars: Record<string, string> = {
        team_name: teamName ?? "",
        client_name: job.customerName,
        address: job.jobAddress ?? "",
        time: scheduledTime,
        new_eta: etaTime || scheduledTime,
        water_power_access: "",
      };

      const triggerMap: Record<(typeof issueTypes)[number], string[]> = {
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
      const relevantTriggers = triggerMap[input.issueType];
      const templates = await db
        .select({
          id: callTemplates.id,
          name: callTemplates.name,
          triggerType: callTemplates.triggerType,
          targetType: callTemplates.targetType,
          scriptTemplate: callTemplates.scriptTemplate,
        })
        .from(callTemplates)
        .where(sql`${callTemplates.isActive} = 1`)
        .orderBy(callTemplates.sortOrder, callTemplates.name);
      const suggestedTemplates = templates
        .filter(template => relevantTriggers.includes(template.triggerType))
        .map(template => ({
          id: template.id,
          name: template.name,
          triggerType: template.triggerType,
          targetType: template.targetType,
          scriptTemplate: template.scriptTemplate,
          variables: extractVariables(template.scriptTemplate),
          prefilledScript: resolveScript(template.scriptTemplate, prefillVars),
        }));

      const callerName =
        (ctx as { agent?: { agentName?: string } }).agent?.agentName ??
        "Dispatcher";
      const inserted = await db.execute(sql`
        INSERT INTO job_issues (
          leadflowJobId,
          jobDate,
          issueType,
          raisedBy,
          raisedByName,
          raisedAt,
          resolvedAt,
          notes
        ) VALUES (
          ${input.leadflowJobId},
          ${input.jobDate},
          ${input.issueType},
          'manual',
          ${callerName},
          ${Date.now()},
          NULL,
          NULL
        )
      `);
      const issueId = insertIdFrom(inserted);

      return {
        issueId,
        prefillVars,
        job: {
          leadflowJobId: job.id,
          teamName,
          customerName: job.customerName,
          customerPhone: job.customerPhone ?? null,
          // No owned team-phone field is present in the verified Schedule data path.
          teamPhone: null,
          jobAddress: job.jobAddress ?? null,
          scheduledTime,
        },
        suggestedTemplates,
      };
    }),

  fireCall: agentProcedure
    .input(
      z.object({
        issueId: z.number().int().positive(),
        leadflowJobId: z.number().int().positive(),
        jobDate: dateInput,
        templateId: z.number().int().positive(),
        resolvedScript: z.string().trim().min(1),
        calledTarget: z.enum(["team", "client"]),
        calledPhone: z.string().trim().min(1),
        teamName: z.string().trim().min(1).optional(),
        clientName: z.string().trim().min(1).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "DB unavailable",
        });

      const issueResult = await db.execute(sql`
        SELECT id
        FROM job_issues
        WHERE id = ${input.issueId}
          AND leadflowJobId = ${input.leadflowJobId}
          AND jobDate = ${input.jobDate}
        LIMIT 1
      `);
      const issue = rowsFrom<IssueRow>(issueResult)[0];
      if (!issue) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Issue was not found for the supplied LeadFlow job and date",
        });
      }

      const [job] = await db
        .select({
          id: leadflowJobs.id,
          jobDate: leadflowJobs.jobDate,
          teamName: leadflowJobs.teamName,
          customerName: leadflowJobs.customerName,
        })
        .from(leadflowJobs)
        .where(
          sql`${leadflowJobs.id} = ${input.leadflowJobId} AND ${leadflowJobs.jobDate} = ${input.jobDate}`
        )
        .limit(1);
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "LeadFlow job was not found for the supplied date",
        });
      }

      const normalizedPhone = normalizePhoneLegacy(input.calledPhone);
      if (!normalizedPhone || normalizedPhone === "+") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A nonempty phone number is required",
        });
      }
      if (normalizedPhone === vapiOutboundPhoneNumber) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Self-call protection: cannot call the VAPI outbound number",
        });
      }

      const [template] = await db
        .select({ name: callTemplates.name })
        .from(callTemplates)
        .where(sql`${callTemplates.id} = ${input.templateId}`)
        .limit(1);
      const assignment = await findAssignment(
        db,
        input.leadflowJobId,
        input.jobDate
      );
      const callerName =
        (ctx as { agent?: { agentName?: string } }).agent?.agentName ??
        "Dispatcher";
      const now = Date.now();
      const effectiveTeamName =
        input.teamName ?? assignment?.teamName ?? job.teamName ?? null;
      const effectiveClientName = input.clientName ?? job.customerName;

      const inserted = await db.execute(sql`
        INSERT INTO call_log (
          leadflowJobId,
          teamId,
          teamName,
          clientName,
          calledPhone,
          calledTarget,
          templateId,
          templateName,
          resolvedScript,
          status,
          jobDate,
          firedBy,
          firedAt
        ) VALUES (
          ${input.leadflowJobId},
          ${assignment?.teamId ?? null},
          ${effectiveTeamName},
          ${effectiveClientName},
          ${normalizedPhone},
          ${input.calledTarget},
          ${input.templateId},
          ${template?.name ?? null},
          ${input.resolvedScript},
          'pending',
          ${input.jobDate},
          ${callerName},
          ${now}
        )
      `);
      const callLogId = insertIdFrom(inserted);

      await db.execute(sql`
        UPDATE job_issues
        SET callLogId = ${callLogId}
        WHERE id = ${input.issueId}
          AND leadflowJobId = ${input.leadflowJobId}
      `);

      let vapiCallId: string | null = null;
      try {
        const result = await postOutboundVapiCall({
          phoneNumberId: vapiOutboundPhoneNumberId,
          customer: { number: normalizedPhone },
          assistant: {
            name: "CallCommandCenter",
            firstMessage: input.resolvedScript,
            model: {
              provider: "openai",
              model: "gpt-4o-mini",
              messages: [{
                role: "system",
                content: "You are Madison, a professional dispatcher for Maids in Black. Read the provided message clearly and professionally. If the person responds, acknowledge politely and let them know the office has been notified. Keep the call brief and professional.",
              }],
            },
            voice: {
              provider: "11labs",
              voiceId: "EXAVITQu4vr4xnSDxMaL",
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
        });
        vapiCallId = result.id ?? null;
      } catch (error) {
        await markCallFailed(db, callLogId, input.leadflowJobId);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `VAPI call failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }

      await db.execute(sql`
        UPDATE call_log
        SET status = 'fired', vapiCallId = ${vapiCallId}
        WHERE id = ${callLogId}
          AND leadflowJobId = ${input.leadflowJobId}
      `);
      if (vapiCallId) {
        try {
          await db.execute(sql`
            INSERT INTO field_mgmt_calls (
              leadflowJobId,
              step,
              vapiCallId,
              calledPhone,
              outcome,
              durationSeconds,
              transcript,
              summary,
              endedReason,
              recordingUrl
            ) VALUES (
              ${input.leadflowJobId},
              'call_command_center',
              ${vapiCallId},
              ${normalizedPhone},
              'no_answer',
              0,
              NULL,
              NULL,
              NULL,
              NULL
            )
          `);
        } catch (error) {
          console.error("[LeadflowScheduleCalls] Failed to insert outbound-call guard:", error);
        }
      }
      return { callLogId, vapiCallId };
    }),

  getDayIssues: agentProcedure
    .input(z.object({ jobDate: dateInput }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "DB unavailable",
        });

      const result = await db.execute(sql`
        SELECT
          job_issues.id AS id,
          job_issues.leadflowJobId AS leadflowJobId,
          job_issues.jobDate AS jobDate,
          job_issues.issueType AS issueType,
          job_issues.raisedBy AS raisedBy,
          job_issues.raisedByName AS raisedByName,
          job_issues.raisedAt AS raisedAt,
          job_issues.resolvedAt AS resolvedAt,
          job_issues.callLogId AS callLogId,
          job_issues.notes AS notes,
          leadflow_jobs.customerName AS clientName,
          leadflow_jobs.teamName AS teamName,
          leadflow_jobs.jobAddress AS jobAddress,
          leadflow_jobs.serviceDateTime AS serviceDateTime
        FROM job_issues
        LEFT JOIN leadflow_jobs ON leadflow_jobs.id = job_issues.leadflowJobId
        WHERE job_issues.leadflowJobId IS NOT NULL
          AND job_issues.jobDate = ${input.jobDate}
          AND job_issues.resolvedAt IS NULL
        ORDER BY job_issues.raisedAt DESC
      `);
      return rowsFrom<DayIssueRow>(result);
    }),

  getCallLog: agentProcedure
    .input(
      z.object({
        jobDate: dateInput,
        limit: z.number().int().min(1).max(100).default(50),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "DB unavailable",
        });

      const result = await db.execute(sql`
        SELECT
          call_log.id AS id,
          call_log.leadflowJobId AS leadflowJobId,
          call_log.teamId AS teamId,
          COALESCE(call_log.teamName, leadflow_jobs.teamName) AS teamName,
          COALESCE(call_log.clientName, leadflow_jobs.customerName) AS clientName,
          call_log.calledPhone AS calledPhone,
          call_log.calledTarget AS calledTarget,
          call_log.templateId AS templateId,
          call_log.templateName AS templateName,
          call_log.resolvedScript AS resolvedScript,
          call_log.status AS status,
          call_log.status AS lifecycle,
          call_log.vapiCallId AS vapiCallId,
          call_log.recordingUrl AS recordingUrl,
          call_log.transcript AS transcript,
          call_log.transcriptLanguage AS transcriptLanguage,
          call_log.transcriptEnglish AS transcriptEnglish,
          call_log.durationSeconds AS durationSeconds,
          call_log.firedBy AS firedBy,
          call_log.firedAt AS firedAt,
          call_log.completedAt AS completedAt,
          call_log.notes AS notes,
          call_log.jobDate AS jobDate,
          leadflow_jobs.jobAddress AS jobAddress,
          leadflow_jobs.serviceDateTime AS serviceDateTime
        FROM call_log
        LEFT JOIN leadflow_jobs ON leadflow_jobs.id = call_log.leadflowJobId
        WHERE call_log.leadflowJobId IS NOT NULL
          AND call_log.jobDate = ${input.jobDate}
        ORDER BY call_log.firedAt DESC
        LIMIT ${input.limit}
      `);
      return rowsFrom<CallLogRow>(result);
    }),

  updateCallLog: agentProcedure
    .input(
      z.object({
        callLogId: z.number().int().positive(),
        notes: z.string().optional(),
        status: z.enum(callStatuses).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "DB unavailable",
        });
      if (input.notes === undefined && input.status === undefined)
        return { ok: true };

      if (input.notes !== undefined && input.status !== undefined) {
        await db.execute(sql`
          UPDATE call_log
          SET notes = ${input.notes}, status = ${input.status}
          WHERE id = ${input.callLogId}
            AND leadflowJobId IS NOT NULL
        `);
      } else if (input.notes !== undefined) {
        await db.execute(sql`
          UPDATE call_log
          SET notes = ${input.notes}
          WHERE id = ${input.callLogId}
            AND leadflowJobId IS NOT NULL
        `);
      } else {
        await db.execute(sql`
          UPDATE call_log
          SET status = ${input.status!}
          WHERE id = ${input.callLogId}
            AND leadflowJobId IS NOT NULL
        `);
      }
      return { ok: true };
    }),

  resolveIssue: agentProcedure
    .input(z.object({ issueId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "DB unavailable",
        });

      await db.execute(sql`
        UPDATE job_issues
        SET resolvedAt = ${Date.now()}
        WHERE id = ${input.issueId}
          AND leadflowJobId IS NOT NULL
      `);
      return { ok: true };
    }),
});

export type LeadflowScheduleCallsRouter = typeof leadflowScheduleCallsRouter;
