import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminAgentProcedure, router } from "./_core/trpc";
import { isValidBookingRescheduleDate } from "../shared/bookingReschedule";
import type { AuditCoverage, AuditCursor, AuditStatus, DailyActionAuditResult } from "../shared/dailyActionAudit";
import { auditDayWindow, readAuditMessages, readAuditRecords } from "./dailyActionAuditData";
import { interpretAuditThreads } from "./dailyActionAuditInterpret";
import { verifyAuditCandidates } from "./dailyActionAuditEngine";
import { hydrateAuditEvidence, mergeAuditEvidence, readAuditProviderPage } from "./dailyActionAuditEvidence";

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
const emptyCoverage = (): AuditCoverage => ({ status: "partial", messagesRead: 0, threadsRead: 0, threadsAnalyzed: 0, truncated: false, warnings: [] });
export type DailyAuditDependencies = {
  messages: typeof readAuditMessages; records: typeof readAuditRecords;
  interpret: typeof interpretAuditThreads; verify: typeof verifyAuditCandidates;
  provider: typeof readAuditProviderPage; hydrate: typeof hydrateAuditEvidence;
  now: () => Date;
};
const defaults: DailyAuditDependencies = {
  messages: readAuditMessages, records: readAuditRecords, interpret: interpretAuditThreads, verify: verifyAuditCandidates,
  provider: readAuditProviderPage, hydrate: hydrateAuditEvidence, now: () => new Date(),
};

/** Explicit computation only: no persistence, sending, approval or booking edits. */
export async function runDailyActionAudit(input: z.infer<typeof dailyAuditInputSchema>, deps: DailyAuditDependencies = defaults): Promise<DailyActionAuditResult> {
  const now = deps.now();
  if (input.auditDate >= dayInZone(now, input.timeZone)) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a previous day to audit." });
  const asOf = input.cursor?.asOf ?? now.toISOString();
  if (!Number.isFinite(Date.parse(asOf)) || Date.parse(asOf) > now.getTime() || Date.parse(asOf) < Date.parse(`${input.auditDate}T00:00:00.000Z`)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The audit continuation is invalid. Start this day again." });
  }
  try {
    const window = auditDayWindow(input.auditDate, input.timeZone);
    const provider = await deps.provider({ ...window, cursor: input.cursor });
    const cursor: AuditCursor | undefined = input.cursor?.localComplete ? { ...input.cursor, sessionAfterId: 2_147_483_647, inboundAfterId: 2_147_483_647 } : input.cursor;
    const messages = input.cursor?.localComplete && !provider.messages.length
      ? { threads: [], coverage: emptyCoverage(), nextCursor: null }
      : await deps.messages({ auditDate: input.auditDate, timeZone: input.timeZone, asOf, cursor, extraPhones: provider.messages.map(message => message.customerPhone) });
    const merged = mergeAuditEvidence(messages.threads, provider.messages);
    const evidence = !provider.available && provider.warnings.length
      ? { threads: merged, warnings: [] }
      : await deps.hydrate(merged, input.auditDate, input.timeZone);
    // One current-state snapshot is read/released before model computation.
    // No DB transaction is held open while waiting for the model or provider.
    const records = evidence.threads.length ? await deps.records({ threads: evidence.threads, candidates: [] }) : { records: [], truncated: false, warnings: [] };
    const checkedAt = deps.now().toISOString();
    // Display names are never matching inputs. Only exact-phone records provide them.
    const threads = evidence.threads.map(thread => {
      const names = Array.from(new Set(records.records.filter(record => record.customerPhone === thread.customerPhone).map(record => record.customerName).filter((name): name is string => Boolean(name))));
      return { ...thread, customerName: thread.customerName ?? (names.length === 1 ? names[0] : null) };
    });
    const interpreted = threads.length
      ? await deps.interpret({ auditDate: input.auditDate, timeZone: input.timeZone, threads, records: records.records })
      : { candidates: [], warnings: [], threadsAnalyzed: 0 };
    const candidates = records.truncated ? interpreted.candidates.map(candidate => ({ ...candidate, ambiguous: true })) : interpreted.candidates;
    const items = deps.verify({ auditDate: input.auditDate, timeZone: input.timeZone, asOf: checkedAt, threads, candidates, records: records.records });
    const totals: Record<AuditStatus, number> = { matches: 0, needs_action: 0, conflict: 0, superseded: 0, cannot_verify: 0 };
    for (const item of items) totals[item.status]++;
    const localComplete = Boolean(input.cursor?.localComplete || !messages.nextCursor);
    const nextCursor: AuditCursor | null = !localComplete || !provider.complete ? {
      sessionAfterId: messages.nextCursor?.sessionAfterId ?? input.cursor?.sessionAfterId ?? 0,
      inboundAfterId: messages.nextCursor?.inboundAfterId ?? input.cursor?.inboundAfterId ?? 0,
      asOf, localComplete, providerComplete: provider.complete, providerLineIndex: provider.lineIndex, providerAfter: provider.after,
    } : null;
    return {
      auditDate: input.auditDate, timeZone: input.timeZone, asOf, items, totals, nextCursor,
      coverage: {
        ...messages.coverage, status: "partial",
        messagesRead: threads.reduce((sum, thread) => sum + thread.messages.length, 0), threadsRead: threads.length, threadsAnalyzed: interpreted.threadsAnalyzed,
        truncated: messages.coverage.truncated || records.truncated || Boolean(nextCursor),
        warnings: Array.from(new Set([
          ...messages.coverage.warnings, ...provider.warnings, ...evidence.warnings, ...records.warnings, ...interpreted.warnings,
          "This audit verifies the current recorded state. It does not prove when a change was made or which text caused it.",
          "Coverage remains partial until all batches and uncertain or unsupported message evidence have been reviewed. Media-only and group SMS are not automatically interpreted.",
        ])),
      },
    };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The audit could not read its required evidence. No changes were made. Try again or review the conversations manually." });
  }
}
export const dailyActionAuditRouter = router({
  // Mutation means a human-initiated computation, NOT a database mutation.
  run: adminAgentProcedure.input(dailyAuditInputSchema).mutation(({ input }) => runDailyActionAudit(input)),
});
