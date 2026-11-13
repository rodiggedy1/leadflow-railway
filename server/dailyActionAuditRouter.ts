import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminAgentProcedure, router } from "./_core/trpc";
import { isValidBookingRescheduleDate } from "../shared/bookingReschedule";
import type { AuditAnalysis, AuditStatus, DailyActionAuditResult } from "../shared/dailyActionAudit";
import { AUDIT_COLLECTION_FAILURES, auditFailureMessage, type AuditFailureStage } from "../shared/dailyActionAudit";
import { auditDayWindow, readAuditRecords } from "./dailyActionAuditData";
import { AuditSnapshotError } from "./dailyActionAuditSnapshot";
import { interpretAuditThreads } from "./dailyActionAuditInterpret";
import { verifyAuditCandidates } from "./dailyActionAuditEngine";
import { collectAuditDaySms, prepareAuditDayThreads } from "./dailyActionAuditCollection";

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
  collect: typeof collectAuditDaySms; prepare: typeof prepareAuditDayThreads;
  records: typeof readAuditRecords; interpret: typeof interpretAuditThreads;
  verify: typeof verifyAuditCandidates; now: () => Date;
};
const defaults: DailyAuditDependencies = {
  collect: collectAuditDaySms, prepare: prepareAuditDayThreads,
  records: readAuditRecords, interpret: interpretAuditThreads, verify: verifyAuditCandidates,
  now: () => new Date(),
};
const emptyTotals = (): Record<AuditStatus, number> => ({ matches: 0, needs_action: 0, conflict: 0, superseded: 0, cannot_verify: 0 });

/** Collect every provider page first. No persistence, sending, approval or booking edits. */
export async function runDailyActionAudit(input: z.infer<typeof dailyAuditInputSchema>, deps: DailyAuditDependencies = defaults): Promise<DailyActionAuditResult> {
  const now = deps.now();
  if (input.auditDate >= dayInZone(now, input.timeZone)) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a previous day to audit." });
  if (input.cursor) throw new TRPCError({ code: "BAD_REQUEST", message: "This audit collects the full day before analysis. Start a new day scan instead of continuing an old sample." });
  const asOf = now.toISOString();
  let failureStage: AuditFailureStage = "MESSAGE_READ";
  try {
    const collection = await deps.collect(auditDayWindow(input.auditDate, input.timeZone));
    if (collection.status !== "complete") {
      return {
        auditDate: input.auditDate, timeZone: input.timeZone, asOf, collection,
        items: [], totals: emptyTotals(), nextCursor: null,
        analysis: { status: "not_run", threadsTotal: 0, threadsAnalyzed: 0, failedThreads: 0, omittedMessages: 0, unsupportedMessages: 0 },
        coverage: { status: "partial", messagesRead: collection.messages.length, threadsRead: 0, threadsAnalyzed: 0, truncated: true,
          warnings: [AUDIT_COLLECTION_FAILURES[collection.failure ?? "FAILED"]] },
      };
    }
    failureStage = "PROCESSING";
    const prepared = deps.prepare(collection);
    // Only source-complete days may reach database/model work. Keep the DB snapshot
    // released before waiting for the unchanged model transport.
    failureStage = "RECORD_READ";
    const records = prepared.threads.length ? await deps.records({ threads: prepared.threads, candidates: [] }) : { records: [], truncated: false, warnings: [] };
    failureStage = "PROCESSING";
    const checkedAt = deps.now().toISOString();
    const threads = prepared.threads.map(thread => {
      const names = Array.from(new Set(records.records.filter(record => record.customerPhone === thread.customerPhone).map(record => record.customerName).filter((name): name is string => Boolean(name))));
      return { ...thread, customerName: thread.customerName ?? (names.length === 1 ? names[0] : null) };
    });
    const interpreted = threads.length
      ? await deps.interpret({ auditDate: input.auditDate, timeZone: input.timeZone, threads, records: records.records })
      : { candidates: [], warnings: [], threadsAnalyzed: 0, failedThreads: 0, omittedMessages: 0 };
    const failedThreads = interpreted.failedThreads ?? Math.max(0, threads.length - interpreted.threadsAnalyzed);
    const omittedMessages = interpreted.omittedMessages ?? 0;
    const analysis: AuditAnalysis = {
      status: threads.length > 0 && interpreted.threadsAnalyzed === 0 && interpreted.candidates.length === 0 ? "failed"
        : failedThreads || omittedMessages || prepared.unsupportedMessages || records.truncated ? "partial" : "complete",
      threadsTotal: threads.length, threadsAnalyzed: interpreted.threadsAnalyzed,
      failedThreads, omittedMessages, unsupportedMessages: prepared.unsupportedMessages,
    };
    const candidates = records.truncated ? interpreted.candidates.map(candidate => ({ ...candidate, ambiguous: true })) : interpreted.candidates;
    const items = deps.verify({ auditDate: input.auditDate, timeZone: input.timeZone, asOf: checkedAt, threads, candidates, records: records.records });
    const totals = emptyTotals();
    for (const item of items) totals[item.status]++;
    return {
      auditDate: input.auditDate, timeZone: input.timeZone, asOf, collection, analysis, items, totals, nextCursor: null,
      coverage: {
        status: "partial", messagesRead: collection.messages.length,
        threadsRead: threads.length, threadsAnalyzed: interpreted.threadsAnalyzed,
        truncated: records.truncated || omittedMessages > 0,
        warnings: Array.from(new Set([
          ...prepared.warnings, ...records.warnings, ...interpreted.warnings,
          "All provider pages for the selected message day were collected. This is not proof of historical action completion.",
          "This audit compares the selected day's SMS with current records. Later-day corrections and unsupported group/media evidence require separate review.",
        ])),
      },
    };
  } catch (error) {
    // Source errors may contain SMS, SQL or credentials. Return fixed codes only.
    const reason = error instanceof AuditSnapshotError ? error.reason : "FAILED";
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: auditFailureMessage(failureStage, reason) });
  }
}
export const dailyActionAuditRouter = router({
  // Mutation is a human-initiated computation, not a database mutation.
  run: adminAgentProcedure.input(dailyAuditInputSchema).mutation(({ input }) => runDailyActionAudit(input)),
});
