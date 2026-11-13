import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminAgentProcedure, router } from "./_core/trpc";
import { isValidBookingRescheduleDate } from "../shared/bookingReschedule";
import type { AuditAnalysis, AuditStatus, DailyActionAuditResult } from "../shared/dailyActionAudit";
import { auditFailureMessage, type AuditFailureStage } from "../shared/dailyActionAudit";
import { readLeadFlowAuditDay, readLeadFlowAuditRecords } from "./dailyActionAuditData";
import { AuditSnapshotError } from "./dailyActionAuditSnapshot";
import { interpretAuditThreads } from "./dailyActionAuditInterpret";
import { verifyAuditCandidates } from "./dailyActionAuditEngine";

const cursorSchema = z.object({
  sessionAfterId: z.number().int().min(0), inboundAfterId: z.number().int().min(0), asOf: z.string().datetime(),
  providerLineIndex: z.number().int().min(0).max(3).optional(),
  providerAfter: z.string().max(2_000).nullable().optional(),
  providerComplete: z.boolean().optional(), localComplete: z.boolean().optional(),
}).strict();
export const dailyAuditInputSchema = z.object({
  auditDate: z.string().refine(isValidBookingRescheduleDate, "Choose a valid message date."),
  timeZone: z.literal("America/New_York").default("America/New_York"), cursor: cursorSchema.optional(),
}).strict();
function dayInZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
export type DailyAuditDependencies = {
  messages: typeof readLeadFlowAuditDay;
  records: typeof readLeadFlowAuditRecords;
  interpret: typeof interpretAuditThreads;
  verify: typeof verifyAuditCandidates;
  now: () => Date;
};
const defaults: DailyAuditDependencies = {
  messages: readLeadFlowAuditDay, records: readLeadFlowAuditRecords,
  interpret: interpretAuditThreads, verify: verifyAuditCandidates, now: () => new Date(),
};
const emptyTotals = (): Record<AuditStatus, number> => ({ matches: 0, needs_action: 0, conflict: 0, superseded: 0, cannot_verify: 0 });

/** Human-initiated captured-message review. No Quo download, persistence or system actions. */
export async function runDailyActionAudit(input: z.infer<typeof dailyAuditInputSchema>, deps: DailyAuditDependencies = defaults): Promise<DailyActionAuditResult> {
  const now = deps.now();
  if (input.auditDate >= dayInZone(now, input.timeZone)) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a previous day to audit." });
  if (input.cursor) throw new TRPCError({ code: "BAD_REQUEST", message: "Start a new captured-conversation audit rather than continuing a legacy sample." });
  const asOf = now.toISOString();
  let failureStage: AuditFailureStage = "MESSAGE_READ";
  try {
    const source = await deps.messages({ auditDate: input.auditDate, timeZone: input.timeZone, asOf });
    failureStage = "PROCESSING";
    // Merge all bounded captured pages before interpreting each person's requests.
    // No DB lease is held while waiting for interpretation; current records are read afterward.
    const interpreted = source.threads.length
      ? await deps.interpret({ auditDate: input.auditDate, timeZone: input.timeZone,
        threads: source.threads, records: [], evidenceMode: "captured" })
      : { candidates: [], warnings: [], threadsAnalyzed: 0, failedThreads: 0, omittedMessages: 0 };
    failureStage = "RECORD_READ";
    let recordFailure = false;
    const records = await (interpreted.candidates.length
      ? deps.records({ threads: source.threads, candidates: interpreted.candidates })
      : Promise.resolve({ records: [], truncated: false, warnings: [], incompleteThreadKeys: [] }))
      .catch(() => {
        recordFailure = true;
        return { records: [], truncated: true, incompleteThreadKeys: source.threads.map(thread => thread.key),
          warnings: ["Current booking/job records could not be read. Captured action summaries remain available, but system fulfillment cannot be verified."] };
      });
    failureStage = "PROCESSING";
    const checkedAt = deps.now().toISOString();
    const threads = source.threads.map(thread => {
      const names = Array.from(new Set(records.records.filter(record => record.customerPhone === thread.customerPhone)
        .map(record => record.customerName).filter((name): name is string => Boolean(name))));
      return { ...thread, customerName: thread.customerName ?? (names.length === 1 ? names[0] : null) };
    });
    const incomplete = new Set(records.incompleteThreadKeys);
    const candidates = interpreted.candidates.map(candidate => incomplete.has(candidate.threadKey) ? { ...candidate, ambiguous: true } : candidate);
    const items = deps.verify({ auditDate: input.auditDate, timeZone: input.timeZone, asOf: checkedAt,
      threads, candidates, records: records.records, evidenceMode: "captured" });
    if (recordFailure) for (const item of items) {
      item.status = "cannot_verify";
      item.verification = "Current records are unavailable. This captured request is not proof of a missed or completed system action.";
    }
    const totals = emptyTotals();
    for (const item of items) totals[item.status]++;
    const failedThreads = interpreted.failedThreads ?? Math.max(0, threads.length - interpreted.threadsAnalyzed);
    const omittedMessages = interpreted.omittedMessages ?? 0;
    const analysis: AuditAnalysis = {
      status: threads.length > 0 && interpreted.threadsAnalyzed === 0 && items.length === 0 ? "failed"
        : failedThreads || omittedMessages || source.coverage.truncated || records.truncated ? "partial" : "complete",
      threadsTotal: threads.length, threadsAnalyzed: interpreted.threadsAnalyzed,
      failedThreads, omittedMessages, unsupportedMessages: 0,
    };
    return {
      auditDate: input.auditDate, timeZone: input.timeZone, asOf, localSource: source.localSource,
      analysis, items, totals, nextCursor: null,
      coverage: {
        ...source.coverage, threadsAnalyzed: interpreted.threadsAnalyzed,
        truncated: source.coverage.truncated || records.truncated || omittedMessages > 0,
        warnings: Array.from(new Set([...source.coverage.warnings, ...records.warnings, ...interpreted.warnings,
          "This review uses messages captured in LeadFlow; missing capture or unverified sent/occurrence evidence is not proof of no action.",
          "Current system matches do not prove when an action was taken. No Quo message download was required.",
        ])),
      },
    };
  } catch (error) {
    const reason = error instanceof AuditSnapshotError ? error.reason : "FAILED";
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: auditFailureMessage(failureStage, reason) });
  }
}
export const dailyActionAuditRouter = router({
  run: adminAgentProcedure.input(dailyAuditInputSchema).mutation(({ input }) => runDailyActionAudit(input)),
});
