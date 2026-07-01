/**
 * callMatrixRouter.ts
 * Provides data and call-firing for the AI Call Matrix page.
 *
 * Procedures:
 *   getPeople        — returns today's customers and cleaners for the call matrix people list.
 *   startCall        — fires a Vapi outbound call using the script from the UI, writes to field_mgmt_calls.
 *   pollCall         — polls Vapi for a call's current status (called every 5s after firing).
 *   getCallHistory   — returns recent AI matrix calls from field_mgmt_calls.
 *   getTemplates     — returns all templates from ai_call_templates.
 *   upsertTemplate   — insert or update a template (keyed by scenario+audience).
 *   deleteTemplate   — delete a template by id.
 */

import { z } from "zod";
import { eq, and, sql, inArray, desc, like, or } from "drizzle-orm";
import { router, agentProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import {
  cleanerJobs,
  cleanerProfiles,
  scheduleAssignments,
  callLog,
  fieldMgmtCalls,
  aiCallTemplates,
  completedJobs,
  quoteLeads,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

// ── VAPI constants — copied verbatim from confirmationCallsRouter.ts ──────────
const VAPI_API_BASE = "https://api.vapi.ai";
const VAPI_OUTBOUND_PHONE_NUMBER_ID = "61431a3e-8144-4acd-b394-8f600ec3a473";
const VAPI_OUTBOUND_PHONE_NUMBER = "+19347898077";

// ── Voice IDs per language ────────────────────────────────────────────────────
// English: Ava — 11Labs voice used for all English calls
const VOICE_ID_EN = "9FuMHon7Kyk1AGgnR8C2";
// Spanish: Norah — warm Latina voice, neutral Latin American Spanish, designed for conversational agents
const VOICE_ID_ES = "kcQkGnn0HAT2JRDQ4Ljp";

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
   * searchContacts — search completedJobs + quoteLeads + cleanerProfiles by name or phone.
   * Returns up to 10 deduplicated results.
   */
  searchContacts: agentProcedure
    .input(z.object({ query: z.string().min(1).max(100) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const q = `%${input.query.replace(/[%_]/g, "\\$&")}%`;
      const results: Array<{
        id: string;
        source: "customer" | "lead" | "cleaner";
        name: string;
        phone: string | null;
        context: string;
      }> = [];
      const seenPhones = new Set<string>();

      // 1. completedJobs — past customers
      const jobs = await db
        .select({ id: completedJobs.id, name: completedJobs.name, phone: completedJobs.phone, address: completedJobs.address, serviceType: completedJobs.serviceType, jobDate: completedJobs.jobDate })
        .from(completedJobs)
        .where(or(like(completedJobs.name, q), like(completedJobs.phone, q)))
        .orderBy(desc(completedJobs.createdAt))
        .limit(8);
      for (const j of jobs) {
        if (j.phone && seenPhones.has(j.phone)) continue;
        if (j.phone) seenPhones.add(j.phone);
        results.push({ id: `job-${j.id}`, source: "customer", name: j.name ?? "Unknown", phone: j.phone, context: [j.serviceType, j.address, j.jobDate].filter(Boolean).join(" · ") });
      }

      // 2. quoteLeads — recent leads
      const leads = await db
        .select({ id: quoteLeads.id, name: quoteLeads.name, phone: quoteLeads.phone, serviceType: quoteLeads.serviceType })
        .from(quoteLeads)
        .where(or(like(quoteLeads.name, q), like(quoteLeads.phone, q)))
        .orderBy(desc(quoteLeads.createdAt))
        .limit(5);
      for (const l of leads) {
        if (l.phone && seenPhones.has(l.phone)) continue;
        if (l.phone) seenPhones.add(l.phone);
        results.push({ id: `lead-${l.id}`, source: "lead", name: l.name, phone: l.phone, context: `Lead · ${l.serviceType}` });
      }

      // 3. cleanerProfiles
      const cleaners = await db
        .select({ id: cleanerProfiles.id, name: cleanerProfiles.name, phone: cleanerProfiles.phone })
        .from(cleanerProfiles)
        .where(or(like(cleanerProfiles.name, q), like(cleanerProfiles.phone, q)))
        .limit(5);
      for (const c of cleaners) {
        if (c.phone && seenPhones.has(c.phone)) continue;
        if (c.phone) seenPhones.add(c.phone);
        results.push({ id: `cleaner-${c.id}`, source: "cleaner", name: c.name, phone: c.phone, context: "Cleaner" });
      }

      return results.slice(0, 10);
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
      /** Call language — defaults to English. When "es", Spanish voice + prompts are used. */
      language: z.enum(["en", "es"]).optional().default("en"),
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
        transcriptLanguage: input.language ?? "en",
      });
      const callLogId = (logInsert as any).insertId as number;

      if (!ENV.vapiPrivateKey) {
        await db.update(callLog).set({ status: "failed" }).where(eq(callLog.id, callLogId));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "VAPI_PRIVATE_KEY not configured" });
      }

      // ── 2. Vapi POST /call ─────────────────────────────────────────────────
      const isSpanish = input.language === "es";
      let vapiCallId: string | null = null;
      try {
        const systemPrompt = isSpanish
          ? `Eres Ava, coordinadora de operaciones de Maids in Black, una empresa de limpieza premium. ` +
            `Estás llamando a ${input.personName} en relación a: ${input.scenario}. ` +
            `Sé cálida, concisa y profesional. Escucha atentamente para identificar el resultado de la llamada. ` +
            `IMPORTANTE: Debes terminar cada llamada con EXACTAMENTE estas palabras, sin variación: "¡Fue un placer hablar contigo! ¡Que tengas un excelente resto del día, cuídate mucho!" — di esto textualmente antes de terminar la llamada. ` +
            `Si la persona dice que llamará después o que no puede hablar, di EXACTAMENTE: "Por supuesto, absolutamente no hay problema. Tomaré nota y alguien te dará seguimiento pronto. ¡Que tengas un excelente día, cuídate!" y luego termina la llamada. ` +
            `Deja que la conversación fluya — espera a que la persona termine de hablar antes de responder. ` +
            `No te apresures a terminar la llamada. No te repitas. No hagas múltiples preguntas. No hables de precios, otros servicios ni nada fuera del alcance de esta llamada. ` +
            `Habla siempre en español, independientemente del idioma en que te hablen.`
          : `You are Ava, a professional operations coordinator for Maids in Black, a premium cleaning company. ` +
            `You are calling ${input.personName} regarding: ${input.scenario}. ` +
            `Be warm, concise, and professional. Listen carefully for the outcome. ` +
            `IMPORTANT: You MUST end every call with EXACTLY these words, no variation: "It was so great talking with you! Have a wonderful rest of your day, take care!" — say this verbatim before ending the call. ` +
            `If the person says they will call back or cannot talk, say EXACTLY: "Of course, absolutely no problem! I'll make a note and have someone follow up with you soon. You have a great day, take care!" then end the call. ` +
            `Let the conversation breathe — wait for the person to fully finish speaking before responding. ` +
            `Do not rush to end the call. Do not repeat yourself. Do not ask multiple questions. Do not discuss pricing, other services, or anything outside the scope of this call.`;

        const voicemailMessage = isSpanish
          ? `Hola, soy Ava de Maids in Black. Llamaba por ${input.scenario.toLowerCase()}. Por favor llámenos cuando pueda. ¡Gracias!`
          : `Hi, this is Ava from Maids in Black. I was calling about ${input.scenario.toLowerCase()}. Please call us back at your convenience. Thank you!`;

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
              voiceId: isSpanish ? VOICE_ID_ES : VOICE_ID_EN,
              stability: 0.5,
              similarityBoost: 0.75,
              style: 0.3,
              useSpeakerBoost: true,
              // Native Spanish voice — no language override needed
            },
            maxDurationSeconds: 180,
            endCallFunctionEnabled: true,
            silenceTimeoutSeconds: 30,
            voicemailDetection: {
              provider: "twilio",
              voicemailDetectionTypes: ["machine_end_beep", "machine_end_silence"],
              enabled: true,
              machineDetectionTimeout: 8,
            },
            voicemailMessage,
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
   * getTemplates
   * Returns all rows from ai_call_templates ordered by audience + scenario.
   */
  getTemplates: agentProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(aiCallTemplates).orderBy(aiCallTemplates.audience, aiCallTemplates.scenario);
    }),

  /**
   * upsertTemplate
   * Insert a new template or update an existing one (matched by id if provided, else by scenario+audience).
   */
  upsertTemplate: agentProcedure
    .input(z.object({
      id: z.number().optional(),
      scenario: z.string().min(1).max(64),
      audience: z.enum(["customer", "cleaner"]),
      title: z.string().min(1).max(128),
      body: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      if (input.id) {
        await db.update(aiCallTemplates)
          .set({ scenario: input.scenario, audience: input.audience, title: input.title, body: input.body })
          .where(eq(aiCallTemplates.id, input.id));
        const [updated] = await db.select().from(aiCallTemplates).where(eq(aiCallTemplates.id, input.id)).limit(1);
        return updated;
      }

      // Insert — on duplicate key (scenario+audience) update
      await db.insert(aiCallTemplates)
        .values({ scenario: input.scenario, audience: input.audience, title: input.title, body: input.body })
        .$dynamic();

      const [inserted] = await db.select().from(aiCallTemplates)
        .where(and(eq(aiCallTemplates.scenario, input.scenario), eq(aiCallTemplates.audience, input.audience)))
        .limit(1);
      return inserted;
    }),

  /**
   * deleteTemplate
   * Deletes a template by id.
   */
  deleteTemplate: agentProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.delete(aiCallTemplates).where(eq(aiCallTemplates.id, input.id));
      return { success: true };
    }),

  /**
   * matchScenario
   * Uses LLM to match a free-text issue description to the closest scenario slug.
   */
  matchScenario: agentProcedure
    .input(z.object({ query: z.string().min(1).max(500) }))
    .mutation(async ({ input }) => {
      const { invokeLLM } = await import("./_core/llm");
      const scenarioList = [
        "running_late", "running_significantly_late", "access_needed", "parking_instructions",
        "card_on_file", "payment_failed", "confirm_address", "scope_clarification",
        "client_eta_update", "earlier_arrival", "home_not_ready", "job_paused",
        "eta_request", "schedule_confirmation", "job_status_reminder", "confirm_job_completion",
      ];
      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are a dispatcher assistant for a cleaning company. Given a free-text description of an issue, return ONLY the single best matching scenario slug from this list: ${scenarioList.join(", ")}. Return only the slug, nothing else.`,
          },
          { role: "user", content: input.query },
        ],
      });
      const slug = (response.choices?.[0]?.message?.content ?? "").trim().toLowerCase().replace(/[^a-z_]/g, "");
      return { slug: scenarioList.includes(slug) ? slug : null };
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
        createdAt: r.createdAt
          ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" }).format(r.createdAt) + " EST"
          : null,
        vapiCallId: r.vapiCallId,
      }));
    }),
});
