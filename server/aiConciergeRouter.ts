/**
 * aiConciergeRouter.ts
 * Powers the AI Concierge slide-in panel in Command Chat.
 *
 * Current commands: ETA update
 * Expansion path: add more intents to the LLM classifier and add handlers below.
 *
 * Design principle: this router ONLY orchestrates existing procedures.
 * It does NOT re-implement any logic that already exists elsewhere.
 * - Team data  → fieldMgmtRouter.getTeamEtaSummary (already used by TeamEtaModal)
 * - ETA call   → fieldMgmtRouter.requestEta (already used by TeamEtaModal footer button)
 */
import { z } from "zod";
import { router, agentProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { invokeLLM } from "./_core/llm";
import { cleanerJobs, cleanerProfiles, opsChatMessages } from "../drizzle/schema";
import { eq, ne, and, desc, inArray } from "drizzle-orm";
import { parseServiceDateTime, formatTimeET, placeEtaCall } from "./fieldMgmtEngine";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTodayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// ── Step types (mirrors AiConcierge.tsx WorkflowStep) ────────────────────────
type StepStatus = "done" | "pending" | "running" | "failed";

interface WorkflowStep {
  id: string;
  label: string;
  status: StepStatus;
  ts?: string;
}

interface WorkflowResult {
  type: "workflow";
  summary: string;
  steps: WorkflowStep[];
  expandable?: { label: string; content: string };
}

interface CompletedResult {
  type: "completed";
  message: string;
}

interface ErrorResult {
  type: "error";
  message: string;
}

interface ClarifyResult {
  type: "clarify";
  message: string;
  /** Teams the agent can pick from */
  teams: Array<{ name: string; currentJobId: number; address: string; scheduled: string; etaStatus: string }>;
}

type ConciergeResult = WorkflowResult | CompletedResult | ErrorResult | ClarifyResult;

// ── Intent classifier ─────────────────────────────────────────────────────────
type Intent =
  | { action: "eta_update"; teamHint: string | null }
  | { action: "unknown" };

async function classifyIntent(message: string): Promise<Intent> {
  const result = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are an intent classifier for a cleaning operations AI assistant.
Classify the user's message into one of these actions:
- eta_update: user wants to request an ETA call for a team (e.g. "send ETA for Team 8", "call team 3 for ETA", "get ETA update", "ETA for Maria")
- unknown: anything else

Return JSON only: { "action": "eta_update" | "unknown", "teamHint": "<team name or null>" }
teamHint: extract the team name or cleaner name if mentioned, otherwise null.`,
      },
      { role: "user", content: message },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "intent",
        strict: true,
        schema: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["eta_update", "unknown"] },
            teamHint: { type: ["string", "null"] },
          },
          required: ["action", "teamHint"],
          additionalProperties: false,
        },
      },
    },
  });
  try {
    const parsed = JSON.parse(result.choices[0].message.content as string);
    return parsed as Intent;
  } catch {
    return { action: "unknown" };
  }
}

// ── Fetch today's teams (same data getTeamEtaSummary returns, but inline) ────
async function getTodayTeams(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  const today = getTodayET();

  const jobs = await db
    .select({
      id: cleanerJobs.id,
      cleanerName: cleanerJobs.cleanerName,
      teamName: cleanerJobs.teamName,
      customerName: cleanerJobs.customerName,
      jobAddress: cleanerJobs.jobAddress,
      serviceDateTime: cleanerJobs.serviceDateTime,
      jobStatus: cleanerJobs.jobStatus,
      cleanerPhone: cleanerProfiles.phone,
      cleanerProfileId: cleanerJobs.cleanerProfileId,
    })
    .from(cleanerJobs)
    .leftJoin(cleanerProfiles, eq(cleanerJobs.cleanerProfileId, cleanerProfiles.id))
    .where(
      and(
        eq(cleanerJobs.jobDate, today),
        ne(cleanerJobs.bookingStatus, "cancelled"),
        ne(cleanerJobs.bookingStatus, "rescheduled")
      )
    )
    .orderBy(cleanerJobs.serviceDateTime);

  // Group by team
  const teamMap = new Map<string, {
    teamName: string;
    cleanerName: string;
    cleanerPhone: string | null;
    jobs: typeof jobs;
  }>();

  for (const job of jobs) {
    const key = job.teamName ?? job.cleanerName;
    if (!teamMap.has(key)) {
      teamMap.set(key, { teamName: key, cleanerName: job.cleanerName, cleanerPhone: job.cleanerPhone ?? null, jobs: [] });
    }
    teamMap.get(key)!.jobs.push(job);
  }

  return Array.from(teamMap.values()).map(team => {
    const currentJob = team.jobs.find(j =>
      j.jobStatus !== "completed" && j.jobStatus !== "cancelled"
    ) ?? team.jobs[team.jobs.length - 1];
    return {
      teamName: team.teamName,
      cleanerName: team.cleanerName,
      cleanerPhone: team.cleanerPhone,
      currentJobId: currentJob?.id ?? null,
      currentJobAddress: currentJob?.jobAddress ?? null,
      currentJobServiceDateTime: currentJob?.serviceDateTime ?? null,
      currentJobStatus: currentJob?.jobStatus ?? null,
    };
  });
}

// ── ETA update handler ────────────────────────────────────────────────────────
async function handleEtaUpdate(
  teamHint: string | null,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<ConciergeResult> {
  const teams = await getTodayTeams(db);

  if (teams.length === 0) {
    return { type: "error", message: "No active jobs found for today." };
  }

  // Match team by hint
  let matched = teams.find(t => {
    if (!teamHint) return false;
    const hint = teamHint.toLowerCase();
    return (
      t.teamName.toLowerCase().includes(hint) ||
      t.cleanerName.toLowerCase().includes(hint)
    );
  });

  // If no match and only one team, use it
  if (!matched && teams.length === 1) {
    matched = teams[0];
  }

  // If still no match, ask for clarification
  if (!matched) {
    return {
      type: "clarify",
      message: teamHint
        ? `I couldn't find a team matching "${teamHint}". Which team do you want the ETA for?`
        : "Which team do you want the ETA for?",
      teams: teams
        .filter(t => t.currentJobId !== null)
        .map(t => ({
          name: t.teamName,
          currentJobId: t.currentJobId!,
          address: t.currentJobAddress ?? "—",
          scheduled: t.currentJobServiceDateTime ?? "—",
          etaStatus: t.currentJobStatus ?? "pending",
        })),
    };
  }

  if (!matched.currentJobId) {
    return { type: "error", message: `No active job found for ${matched.teamName} today.` };
  }

  if (!matched.cleanerPhone) {
    return { type: "error", message: `No phone number on file for ${matched.cleanerName}.` };
  }

  // Fetch job details for the ETA call (same as requestEta does)
  const [row] = await db
    .select({
      id: cleanerJobs.id,
      customerName: cleanerJobs.customerName,
      serviceDateTime: cleanerJobs.serviceDateTime,
      cleanerPhone: cleanerProfiles.phone,
      cleanerName: cleanerJobs.cleanerName,
    })
    .from(cleanerJobs)
    .leftJoin(cleanerProfiles, eq(cleanerJobs.cleanerProfileId, cleanerProfiles.id))
    .where(eq(cleanerJobs.id, matched.currentJobId))
    .limit(1);

  if (!row) {
    return { type: "error", message: "Job not found." };
  }

  const cleanerFirstName = (row.cleanerName ?? "there").split(" ")[0];
  const customerFirstName = (row.customerName ?? "your customer").split(" ")[0];

  if (!row.serviceDateTime) {
    return { type: "error", message: `Job for ${matched.teamName} has no service time set.` };
  }

  const serviceTime = parseServiceDateTime(row.serviceDateTime);
  if (!serviceTime) {
    return { type: "error", message: "Could not parse service date/time for this job." };
  }

  const scheduledTimeET = formatTimeET(serviceTime);

  // Fire the ETA call — same as requestEta mutation
  const result = await placeEtaCall({
    cleanerJobId: matched.currentJobId,
    step: "eta_call_1",
    cleanerPhone: row.cleanerPhone ?? matched.cleanerPhone,
    cleanerFirstName,
    customerFirstName,
    scheduledTimeET,
    bypassStepLock: true,
  });

  if (!result.success) {
    return {
      type: "error",
      message: result.reason ?? "ETA call failed. Please try again or use the ETA modal.",
    };
  }

  return {
    type: "completed",
    message: `ETA call placed for ${matched.teamName} (${cleanerFirstName}). The client will be notified once the call completes.`,
  };
}

// ── Router ────────────────────────────────────────────────────────────────────
export const aiConciergeRouter = router({
  /**
   * Main chat endpoint for the AI Concierge panel.
   * Receives the agent's message, classifies intent, executes the action,
   * and returns a structured result the UI renders as a workflow card or completed card.
   */
  chat: agentProcedure
    .input(
      z.object({
        message: z.string().min(1).max(2000),
        /** If the agent already picked a team from a clarify response, pass the jobId directly */
        resolvedJobId: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // If agent already resolved the team (clicked a clarify chip), skip classification
      if (input.resolvedJobId) {
        const result = await handleEtaUpdateByJobId(input.resolvedJobId, db);
        return result;
      }

      const intent = await classifyIntent(input.message);

      if (intent.action === "eta_update") {
        return await handleEtaUpdate(intent.teamHint, db);
      }

      // Unknown intent — friendly fallback
      return {
        type: "error" as const,
        message: "I can handle ETA updates right now. Try: \"Send ETA for Team 8\" or just \"ETA update\".",
      };
    }),
});

// ── ETA by resolved job ID (when agent picks from clarify list) ───────────────
async function handleEtaUpdateByJobId(
  jobId: number,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<ConciergeResult> {
  const [row] = await db
    .select({
      id: cleanerJobs.id,
      customerName: cleanerJobs.customerName,
      serviceDateTime: cleanerJobs.serviceDateTime,
      cleanerPhone: cleanerProfiles.phone,
      cleanerName: cleanerJobs.cleanerName,
      teamName: cleanerJobs.teamName,
    })
    .from(cleanerJobs)
    .leftJoin(cleanerProfiles, eq(cleanerJobs.cleanerProfileId, cleanerProfiles.id))
    .where(eq(cleanerJobs.id, jobId))
    .limit(1);

  if (!row) return { type: "error", message: "Job not found." };
  if (!row.cleanerPhone) return { type: "error", message: `No phone number on file for ${row.cleanerName}.` };
  if (!row.serviceDateTime) return { type: "error", message: "Job has no service time set." };

  const serviceTime = parseServiceDateTime(row.serviceDateTime);
  if (!serviceTime) return { type: "error", message: "Could not parse service date/time." };

  const cleanerFirstName = (row.cleanerName ?? "there").split(" ")[0];
  const customerFirstName = (row.customerName ?? "your customer").split(" ")[0];
  const scheduledTimeET = formatTimeET(serviceTime);
  const teamName = row.teamName ?? row.cleanerName;

  const result = await placeEtaCall({
    cleanerJobId: jobId,
    step: "eta_call_1",
    cleanerPhone: row.cleanerPhone,
    cleanerFirstName,
    customerFirstName,
    scheduledTimeET,
    bypassStepLock: true,
  });

  if (!result.success) {
    return { type: "error", message: result.reason ?? "ETA call failed." };
  }

  return {
    type: "completed",
    message: `ETA call placed for ${teamName} (${cleanerFirstName}). The client will be notified once the call completes.`,
  };
}
