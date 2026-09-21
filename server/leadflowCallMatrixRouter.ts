import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, like, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  aiCallTemplates,
  cleanerPortalJobPhotos,
  cleanerPortalJobProgress,
  cleanerProfiles,
  fieldMgmtCalls,
  leadflowJobs,
  schedulingTeams,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { agentProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { normalizePhoneLegacy } from "./utils/phone";

const VAPI_API_BASE = "https://api.vapi.ai";
const VAPI_OUTBOUND_PHONE_NUMBER_ID = "61431a3e-8144-4acd-b394-8f600ec3a473";
const VAPI_OUTBOUND_PHONE_NUMBER = "+19347898077";
const VOICE_ID_EN = "9FuMHon7Kyk1AGgnR8C2";
const VOICE_ID_ES = "kcQkGnn0HAT2JRDQ4Ljp";
const activeBookingStatuses = ["cancelled", "rescheduled", "missing_from_launch27"] as const;

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type OwnedAssignment = {
  leadflowJobId: number;
  teamId: number | null;
  teamName: string | null;
};

type OwnedCallLogInsert = { insertId?: number };

function rowsFrom<T>(result: unknown): T[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as T[];
  return result as T[];
}

function insertIdFrom(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  const id = Number((header as OwnedCallLogInsert | undefined)?.insertId);
  if (!Number.isInteger(id) || id < 1) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Call record could not be created" });
  }
  return id;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "TBD";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "TBD";
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  });
}

function etaLabel(jobStatus: string | null, etaTimestamp: number | null): string {
  if (jobStatus === "completed") return "Completed";
  if (jobStatus === "in_progress" || jobStatus === "arrived") return "On site";
  if (jobStatus === "finishing_up" || jobStatus === "wrapping_up") return "Finishing up";
  if (etaTimestamp) {
    const minutes = Math.round((etaTimestamp - Date.now()) / 60_000);
    if (minutes <= 0) return "Arriving now";
    return `~${minutes} min`;
  }
  if (jobStatus === "running_late") return "Running late";
  if (jobStatus === "on_the_way") return "On the way";
  return "Unknown";
}

function customerRisk(jobStatus: string | null, etaTimestamp: number | null): string {
  if (jobStatus === "running_late") return "High impact";
  if (etaTimestamp && etaTimestamp < Date.now()) return "High impact";
  return "On track";
}

function cleanerRisk(input: {
  hasNoCheckIn: boolean;
  hasPhotoMissing: boolean;
  hasRunningLate: boolean;
}): string {
  if (input.hasRunningLate) return "Urgent";
  if (input.hasNoCheckIn) return "Needs update";
  if (input.hasPhotoMissing) return "QA risk";
  return "On track";
}

async function vapiPost(path: string, body: unknown): Promise<{ id?: string }> {
  if (!ENV.vapiPrivateKey) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "VAPI_PRIVATE_KEY not configured" });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${VAPI_API_BASE}${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${ENV.vapiPrivateKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`VAPI POST ${path} → ${response.status}: ${await response.text()}`);
    }
    return await response.json() as { id?: string };
  } finally {
    clearTimeout(timer);
  }
}

async function vapiGet(path: string): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${VAPI_API_BASE}${path}`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${ENV.vapiPrivateKey}` },
    });
    if (!response.ok) return null;
    return await response.json() as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

async function ownedAssignments(db: Db, date: string): Promise<OwnedAssignment[]> {
  const result = await db.execute(sql`
    SELECT leadflowJobId, teamId, teamName
    FROM schedule_assignments
    WHERE jobDate = ${date}
      AND leadflowJobId IS NOT NULL
  `);
  return rowsFrom<OwnedAssignment>(result);
}

async function markCallFailed(db: Db, callLogId: number): Promise<void> {
  await db.execute(sql`
    UPDATE call_log
    SET status = 'failed'
    WHERE id = ${callLogId}
  `);
}

export const leadflowCallMatrixRouter = router({
  /**
   * Read-only Matrix people list. Every operational relationship is drawn from
   * LeadFlow-owned jobs, explicit portal progress, and the owned Schedule map.
   */
  getPeople: agentProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const jobs = await db.select({
        id: leadflowJobs.id,
        teamId: leadflowJobs.teamId,
        teamName: leadflowJobs.teamName,
        customerName: leadflowJobs.customerName,
        customerPhone: leadflowJobs.customerPhone,
        customerNotes: leadflowJobs.customerNotes,
        jobAddress: leadflowJobs.jobAddress,
        serviceName: leadflowJobs.serviceName,
        serviceDateTime: leadflowJobs.serviceDateTime,
        bookingStatus: leadflowJobs.bookingStatus,
        hasStripeCard: leadflowJobs.hasStripeCard,
        paymentBrand: leadflowJobs.paymentBrand,
        paymentLast4: leadflowJobs.paymentLast4,
        progressStatus: cleanerPortalJobProgress.jobStatus,
        etaTimestamp: cleanerPortalJobProgress.etaTimestamp,
      }).from(leadflowJobs)
        .leftJoin(cleanerPortalJobProgress, eq(cleanerPortalJobProgress.leadflowJobId, leadflowJobs.id))
        .where(and(
          eq(leadflowJobs.jobDate, input.date),
          notInArray(leadflowJobs.bookingStatus, [...activeBookingStatuses]),
        ));

      if (!jobs.length) return { customers: [], cleaners: [] };

      const [assignments, photoRows] = await Promise.all([
        ownedAssignments(db, input.date),
        db.select({ leadflowJobId: cleanerPortalJobPhotos.leadflowJobId })
          .from(cleanerPortalJobPhotos)
          .where(inArray(cleanerPortalJobPhotos.leadflowJobId, jobs.map(job => job.id))),
      ]);
      const assignmentByJobId = new Map(assignments.map(assignment => [Number(assignment.leadflowJobId), assignment]));
      const scheduleTeamIds = Array.from(new Set(assignments
        .map(assignment => assignment.teamId)
        .filter((teamId): teamId is number => teamId !== null)));
      const scheduleTeams = scheduleTeamIds.length
        ? await db.select({ id: schedulingTeams.id, launch27TeamId: schedulingTeams.launch27TeamId })
          .from(schedulingTeams)
          .where(inArray(schedulingTeams.id, scheduleTeamIds))
        : [];
      const scheduleTeamById = new Map(scheduleTeams.map(team => [team.id, team]));
      const launchTeamIds = Array.from(new Set(jobs.map(job => {
        const assignment = assignmentByJobId.get(job.id);
        const scheduleTeam = assignment?.teamId == null ? null : scheduleTeamById.get(assignment.teamId);
        return scheduleTeam?.launch27TeamId ?? job.teamId;
      }).filter((teamId): teamId is number => teamId !== null)));
      const profiles = launchTeamIds.length
        ? await db.select({ launch27TeamId: cleanerProfiles.launch27TeamId, phone: cleanerProfiles.phone })
          .from(cleanerProfiles)
          .where(inArray(cleanerProfiles.launch27TeamId, launchTeamIds))
        : [];
      const phoneByLaunchTeamId = new Map(profiles
        .filter((profile): profile is { launch27TeamId: number; phone: string | null } => profile.launch27TeamId !== null)
        .map(profile => [profile.launch27TeamId, profile.phone]));
      const photoJobIds = new Set(photoRows.map(photo => photo.leadflowJobId));

      const customers = jobs.map(job => {
        const assignment = assignmentByJobId.get(job.id);
        const teamName = assignment?.teamName ?? job.teamName ?? "Unassigned";
        const status = job.progressStatus ?? (job.bookingStatus === "completed" ? "completed" : "assigned");
        const payment = job.hasStripeCard
          ? [job.paymentBrand, job.paymentLast4 ? `•••• ${job.paymentLast4}` : null].filter(Boolean).join(" ") || "Card on file"
          : "Payment method needed";
        return {
          leadflowJobId: job.id,
          name: job.customerName || "Unknown Customer",
          phone: job.customerPhone,
          meta: [job.serviceName, job.jobAddress].filter(Boolean).join(" · "),
          jobTime: formatTime(job.serviceDateTime),
          eta: etaLabel(status, job.etaTimestamp),
          pay: payment,
          access: job.customerNotes?.slice(0, 60) || "No notes",
          risk: customerRisk(status, job.etaTimestamp),
          assignedTeam: teamName,
        };
      });

      const teams = new Map<string, {
        teamName: string;
        launchTeamId: number | null;
        jobCount: number;
        hasNoCheckIn: boolean;
        hasPhotoMissing: boolean;
        hasRunningLate: boolean;
      }>();
      for (const job of jobs) {
        const assignment = assignmentByJobId.get(job.id);
        const scheduleTeam = assignment?.teamId == null ? null : scheduleTeamById.get(assignment.teamId);
        const teamName = assignment?.teamName ?? job.teamName;
        if (!teamName) continue;
        const launchTeamId = scheduleTeam?.launch27TeamId ?? job.teamId;
        const status = job.progressStatus ?? (job.bookingStatus === "completed" ? "completed" : "assigned");
        const existing = teams.get(teamName);
        const noCheckIn = job.progressStatus === null && job.bookingStatus !== "completed";
        const photoMissing = status === "completed" && !photoJobIds.has(job.id);
        if (existing) {
          existing.jobCount += 1;
          existing.hasNoCheckIn ||= noCheckIn;
          existing.hasPhotoMissing ||= photoMissing;
          existing.hasRunningLate ||= status === "running_late";
        } else {
          teams.set(teamName, {
            teamName,
            launchTeamId,
            jobCount: 1,
            hasNoCheckIn: noCheckIn,
            hasPhotoMissing: photoMissing,
            hasRunningLate: status === "running_late",
          });
        }
      }

      const cleaners = Array.from(teams.values()).map(team => {
        const flags: string[] = [];
        if (team.hasNoCheckIn) flags.push("needs status update");
        if (team.hasPhotoMissing) flags.push("photos missing");
        if (team.hasRunningLate) flags.push("running late");
        return {
          teamName: team.teamName,
          phone: team.launchTeamId == null ? null : phoneByLaunchTeamId.get(team.launchTeamId) ?? null,
          meta: `Assigned: ${team.jobCount} job${team.jobCount !== 1 ? "s" : ""} today${flags.length ? ` · ${flags.join(", ")}` : ""}`,
          jobCount: team.jobCount,
          risk: cleanerRisk(team),
          hasNoCheckIn: team.hasNoCheckIn,
          hasUnconfirmed: false,
          hasPhotoMissing: team.hasPhotoMissing,
        };
      });

      return { customers, cleaners };
    }),

  startCall: agentProcedure
    .input(z.object({
      leadflowJobId: z.number().int().positive().nullable(),
      jobDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      personName: z.string().trim().min(1).max(255),
      phone: z.string().trim().min(7).max(30),
      scenario: z.string().trim().min(1).max(500),
      script: z.string().trim().min(10),
      audience: z.enum(["customer", "cleaner"]),
      language: z.enum(["en", "es"]).optional().default("en"),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const normalizedPhone = normalizePhoneLegacy(input.phone);
      if (normalizedPhone === VAPI_OUTBOUND_PHONE_NUMBER) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Self-call protection: cannot call the VAPI outbound number" });
      }

      if (input.audience === "customer" && input.leadflowJobId === null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A LeadFlow job is required for a customer call" });
      }
      if (input.leadflowJobId !== null) {
        const [job] = await db.select({
          id: leadflowJobs.id,
          jobDate: leadflowJobs.jobDate,
          customerPhone: leadflowJobs.customerPhone,
        }).from(leadflowJobs).where(and(
          eq(leadflowJobs.id, input.leadflowJobId),
          eq(leadflowJobs.jobDate, input.jobDate),
          notInArray(leadflowJobs.bookingStatus, [...activeBookingStatuses]),
        )).limit(1);
        if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "LeadFlow job was not found for the supplied date" });
        if (input.audience === "customer" && normalizePhoneLegacy(job.customerPhone ?? "") !== normalizedPhone) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Customer phone does not match the selected LeadFlow job" });
        }
      }

      const callerName = (ctx as { agent?: { name?: string }; user?: { name?: string } }).agent?.name
        ?? (ctx as { user?: { name?: string } }).user?.name
        ?? "Dispatcher";
      const now = Date.now();
      const step = input.audience === "cleaner" ? "ai_matrix_cleaner" : "ai_matrix_customer";
      const callInsert = await db.execute(sql`
        INSERT INTO call_log (
          leadflowJobId, cleanerJobId, clientName, calledPhone, calledTarget,
          resolvedScript, status, jobDate, firedBy, firedAt, transcriptLanguage
        ) VALUES (
          ${input.leadflowJobId}, NULL, ${input.personName}, ${normalizedPhone},
          ${input.audience === "cleaner" ? "team" : "client"}, ${input.script.slice(0, 1000)},
          'pending', ${input.jobDate}, ${callerName}, ${now}, ${input.language}
        )
      `);
      const callLogId = insertIdFrom(callInsert);

      const isSpanish = input.language === "es";
      let vapiCallId: string | null = null;
      try {
        const systemPrompt = isSpanish
          ? `Eres Ava, coordinadora de operaciones de Maids in Black, una empresa de limpieza premium. Estás llamando a ${input.personName} en relación a: ${input.scenario}. Sé cálida, concisa y profesional. Escucha atentamente para identificar el resultado de la llamada. IMPORTANTE: Debes terminar cada llamada con EXACTAMENTE estas palabras, sin variación: "¡Fue un placer hablar contigo! ¡Que tengas un excelente resto del día, cuídate mucho!" — di esto textualmente antes de terminar la llamada. Si la persona dice que llamará después o que no puede hablar, di EXACTAMENTE: "Por supuesto, absolutamente no hay problema. Tomaré nota y alguien te dará seguimiento pronto. ¡Que tengas un excelente día, cuídate!" y luego termina la llamada. Deja que la conversación fluya — espera a que la persona termine de hablar antes de responder. No te apresures a terminar la llamada. No te repitas. No hagas múltiples preguntas. No hables de precios, otros servicios ni nada fuera del alcance de esta llamada. Habla siempre en español, independientemente del idioma en que te hablen.`
          : `You are Ava, a professional operations coordinator for Maids in Black, a premium cleaning company. You are calling ${input.personName} regarding: ${input.scenario}. Be warm, concise, and professional. Listen carefully for the outcome. IMPORTANT: You MUST end every call with EXACTLY these words, no variation: "It was so great talking with you! Have a wonderful rest of your day, take care!" — say this verbatim before ending the call. If the person says they will call back or cannot talk, say EXACTLY: "Of course, absolutely no problem! I'll make a note and have someone follow up with you soon. You have a great day, take care!" then end the call. Let the conversation breathe — wait for the person to fully finish speaking before responding. Do not rush to end the call. Do not repeat yourself. Do not ask multiple questions. Do not discuss pricing, other services, or anything outside the scope of this call.`;
        const voicemailMessage = isSpanish
          ? `Hola, soy Ava de Maids in Black. Llamaba por ${input.scenario.toLowerCase()}. Por favor llámenos cuando pueda. ¡Gracias!`
          : `Hi, this is Ava from Maids in Black. I was calling about ${input.scenario.toLowerCase()}. Please call us back at your convenience. Thank you!`;
        const result = await vapiPost("/call", {
          phoneNumberId: VAPI_OUTBOUND_PHONE_NUMBER_ID,
          customer: { number: normalizedPhone },
          assistant: {
            name: "Ava",
            firstMessage: input.script,
            model: { provider: "openai", model: "gpt-4o-mini", messages: [{ role: "system", content: systemPrompt }] },
            voice: { provider: "11labs", voiceId: isSpanish ? VOICE_ID_ES : VOICE_ID_EN, stability: 0.5, similarityBoost: 0.75, style: 0.3, useSpeakerBoost: true },
            transcriber: { provider: "deepgram", model: "nova-2", language: isSpanish ? "es" : "en-US" },
            maxDurationSeconds: 180,
            endCallFunctionEnabled: true,
            silenceTimeoutSeconds: 30,
            voicemailDetection: { provider: "twilio", voicemailDetectionTypes: ["machine_end_beep", "machine_end_silence"], enabled: true, machineDetectionTimeout: 8 },
            voicemailMessage,
          },
        });
        vapiCallId = result.id ?? null;
      } catch (error) {
        await markCallFailed(db, callLogId);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `VAPI call failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }

      await db.execute(sql`
        UPDATE call_log
        SET status = 'fired', vapiCallId = ${vapiCallId}
        WHERE id = ${callLogId}
      `);
      let fieldMgmtCallId: number | null = null;
      if (vapiCallId) {
        try {
          const fieldInsert = await db.execute(sql`
            INSERT INTO field_mgmt_calls (
              leadflowJobId, cleanerJobId, step, vapiCallId, calledPhone,
              outcome, durationSeconds, transcript, summary, endedReason, recordingUrl
            ) VALUES (
              ${input.leadflowJobId}, NULL, ${step}, ${vapiCallId}, ${normalizedPhone},
              'no_answer', 0, NULL, NULL, NULL, NULL
            )
          `);
          fieldMgmtCallId = insertIdFrom(fieldInsert);
        } catch (error) {
          console.error("[LeadflowCallMatrix] Failed to insert outbound-call guard:", error);
        }
      }
      return { callLogId, vapiCallId, fieldMgmtCallId };
    }),

  pollCall: agentProcedure
    .input(z.object({ vapiCallId: z.string().min(1) }))
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (db) {
          const [call] = await db.select().from(fieldMgmtCalls)
            .where(eq(fieldMgmtCalls.vapiCallId, input.vapiCallId)).limit(1);
          if (call && (call.endedReason !== null || call.durationSeconds > 0)) {
            const status = call.outcome === "answered" ? "completed" as const
              : call.outcome === "voicemail" ? "voicemail" as const
              : call.outcome === "no_answer" ? "no_answer" as const
              : call.outcome === "failed" ? "failed" as const
              : "completed" as const;
            return {
              status,
              endedReason: call.endedReason ?? null,
              summary: call.summary ?? null,
              transcript: call.transcript ?? null,
              durationSeconds: call.durationSeconds ?? null,
              recordingUrl: call.recordingUrl ?? null,
            };
          }
        }
      } catch (error) {
        console.error("[LeadflowCallMatrix] Field call lookup failed:", error);
      }

      const call = await vapiGet(`/call/${input.vapiCallId}`);
      if (!call) return { status: "queued" as const, endedReason: null, summary: null, durationSeconds: null, transcript: null, recordingUrl: null };
      const vapiStatus = call.status as string | undefined;
      const endedReason = call.endedReason as string | undefined ?? null;
      const artifact = call.artifact as Record<string, unknown> | undefined;
      const summary = artifact?.summary as string | undefined ?? null;
      const transcript = artifact?.transcript as string | undefined ?? null;
      const recordingUrl = artifact?.recordingUrl as string | undefined ?? null;
      const durationSeconds = call.endedAt && call.startedAt
        ? Math.round((new Date(call.endedAt as string).getTime() - new Date(call.startedAt as string).getTime()) / 1000)
        : null;
      let status: "queued" | "ringing" | "in_progress" | "completed" | "voicemail" | "no_answer" | "failed" = "queued";
      if (vapiStatus === "ringing") status = "ringing";
      else if (vapiStatus === "in-progress") status = "in_progress";
      else if (vapiStatus === "ended") {
        if (endedReason === "customer-ended-call" || endedReason === "assistant-ended-call" || endedReason === "exceeded-max-duration") status = "completed";
        else if (endedReason?.includes("voicemail") || endedReason === "machine_end_beep" || endedReason === "machine_end_silence") status = "voicemail";
        else if (endedReason === "no-answer" || endedReason === "silence-timed-out" || endedReason === "customer-did-not-answer") status = "no_answer";
        else if (endedReason === "twilio-failed-to-connect-call" || endedReason === "customer-did-not-give-microphone-permission") status = "failed";
        else if (durationSeconds && durationSeconds > 5) status = "completed";
        else status = "no_answer";
      }
      if (vapiStatus === "ended") {
        const db = await getDb();
        if (db) {
          await db.update(fieldMgmtCalls).set({
            outcome: status === "completed" ? "answered" : status,
            durationSeconds: durationSeconds ?? 0,
            transcript,
            summary,
            endedReason,
            recordingUrl,
          }).where(eq(fieldMgmtCalls.vapiCallId, input.vapiCallId));
        }
      }
      return { status, endedReason, summary, transcript, durationSeconds, recordingUrl };
    }),

  getCallHistory: agentProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select({
        id: fieldMgmtCalls.id,
        step: fieldMgmtCalls.step,
        calledPhone: fieldMgmtCalls.calledPhone,
        outcome: fieldMgmtCalls.outcome,
        durationSeconds: fieldMgmtCalls.durationSeconds,
        transcript: fieldMgmtCalls.transcript,
        summary: fieldMgmtCalls.summary,
        endedReason: fieldMgmtCalls.endedReason,
        recordingUrl: fieldMgmtCalls.recordingUrl,
        createdAt: fieldMgmtCalls.createdAt,
        vapiCallId: fieldMgmtCalls.vapiCallId,
      }).from(fieldMgmtCalls)
        .where(like(fieldMgmtCalls.step, "ai_matrix%"))
        .orderBy(desc(fieldMgmtCalls.createdAt))
        .limit(input.limit);
      return rows.map(row => ({
        ...row,
        createdAt: row.createdAt
          ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" }).format(row.createdAt) + " EST"
          : null,
      }));
    }),

  getTemplates: agentProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(aiCallTemplates).orderBy(aiCallTemplates.audience, aiCallTemplates.scenario);
  }),

  upsertTemplate: agentProcedure
    .input(z.object({
      id: z.number().int().positive().optional(),
      scenario: z.string().trim().min(1).max(64),
      audience: z.enum(["customer", "cleaner"]),
      title: z.string().trim().min(1).max(128),
      body: z.string().trim().min(1),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      if (input.id) {
        await db.update(aiCallTemplates).set({
          scenario: input.scenario,
          audience: input.audience,
          title: input.title,
          body: input.body,
        }).where(eq(aiCallTemplates.id, input.id));
        const [updated] = await db.select().from(aiCallTemplates).where(eq(aiCallTemplates.id, input.id)).limit(1);
        return updated;
      }
      await db.insert(aiCallTemplates).values({
        scenario: input.scenario,
        audience: input.audience,
        title: input.title,
        body: input.body,
      }).$dynamic();
      const [inserted] = await db.select().from(aiCallTemplates)
        .where(and(eq(aiCallTemplates.scenario, input.scenario), eq(aiCallTemplates.audience, input.audience)))
        .limit(1);
      return inserted;
    }),

  deleteTemplate: agentProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await db.delete(aiCallTemplates).where(eq(aiCallTemplates.id, input.id));
      return { success: true };
    }),

  matchScenario: agentProcedure
    .input(z.object({ query: z.string().trim().min(1).max(500) }))
    .mutation(async ({ input }) => {
      const { invokeLLM } = await import("./_core/llm");
      const scenarios = [
        "running_late", "running_significantly_late", "access_needed", "parking_instructions",
        "card_on_file", "payment_failed", "confirm_address", "scope_clarification",
        "client_eta_update", "earlier_arrival", "home_not_ready", "job_paused",
        "eta_request", "schedule_confirmation", "job_status_reminder", "confirm_job_completion",
      ];
      const response = await invokeLLM({
        messages: [
          { role: "system", content: `You are a dispatcher assistant for a cleaning company. Given a free-text description of an issue, return ONLY the single best matching scenario slug from this list: ${scenarios.join(", ")}. Return only the slug, nothing else.` },
          { role: "user", content: input.query },
        ],
      });
      const responseContent = response.choices?.[0]?.message?.content;
      const slug = (typeof responseContent === "string" ? responseContent : "").trim().toLowerCase().replace(/[^a-z_]/g, "");
      return { slug: scenarios.includes(slug) ? slug : null };
    }),
});

export type LeadflowCallMatrixRouter = typeof leadflowCallMatrixRouter;
