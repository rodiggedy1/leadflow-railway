import { TRPCError } from "@trpc/server";
import type { LiveTextCheck, LiveTextContext, LiveTextSyncFailure, LiveTextSyncInput, LiveTextSyncResult, LiveTextSyncSummary } from "../shared/liveTextMonitor";
import { isValidAuditDate } from "./dailyActionAuditEngine";
import { checkLiveText } from "./liveTextMonitorService";
import { readLiveTextContext } from "./liveTextMonitorData";
import { readLiveTextSyncSource } from "./liveTextMonitorSyncSource";
import { persistLiveTextSyncDate } from "./liveTextMonitorSyncRepository";

/** Fixed internal marker: only the stale check before any date lock/source work. */
export const LIVE_TEXT_PRE_SOURCE_STALE_CAUSE = Object.freeze(new Error("LIVE_TEXT_PRE_SOURCE_STALE"));

export type LiveTextSyncDependencies = {
  check: typeof checkLiveText;
  context: (sessionId: number, messageKey: string) => Promise<LiveTextContext | null>;
  source: typeof readLiveTextSyncSource;
  persist: typeof persistLiveTextSyncDate;
  now: () => Date;
  locks: Set<string>;
};
const dateLocks = new Set<string>();
const defaults: LiveTextSyncDependencies = { check: checkLiveText, context: readLiveTextContext,
  source: readLiveTextSyncSource, persist: persistLiveTextSyncDate, now: () => new Date(), locks: dateLocks };

function incompleteCheck(check: LiveTextCheck, reason: string, checkedAt: string): LiveTextCheck {
  return { ...check, verified: "review", evidence: reason, checkedAt,
    actions: check.actions.map(action => ({ ...action, verified: "review", evidence: reason, records: [], links: [] })) };
}
function failure(check: LiveTextCheck, sync: LiveTextSyncSummary, code: LiveTextSyncFailure, reason: string, at: string): LiveTextSyncResult {
  return { sync: { ...sync, complete: false, failure: code, checkedAt: at }, check: incompleteCheck(check, reason, at) };
}
function sourceFailure(error: unknown): LiveTextSyncFailure {
  const value = error as { code?: unknown; failure?: unknown } | null;
  return value?.code === "SOURCE_INCOMPLETE" || value?.failure === "SOURCE_INCOMPLETE" ? "SOURCE_INCOMPLETE" : "SOURCE_UNAVAILABLE";
}

/** Internal exact-action sync. Only the approved foreground automatic wrapper calls this. */
export async function syncAndCheckLiveText(input: LiveTextSyncInput, dependencies: Partial<LiveTextSyncDependencies> = {}): Promise<LiveTextSyncResult> {
  if (!input || !Number.isSafeInteger(input.sessionId) || input.sessionId <= 0 || !/^session-text:[a-f0-9]{64}$/.test(input.messageKey)
    || typeof input.revision !== "string" || !input.revision || input.revision.length > 256
    || typeof input.actionId !== "string" || !input.actionId || input.actionId.length > 160 || !isValidAuditDate(input.serviceDate)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a valid text action and explicit service date." });
  }
  const deps = { ...defaults, ...dependencies };
  // Resolve the action again on the server; no caller-supplied phone, job, amount or status is trusted.
  const initial = await deps.check({ sessionId: input.sessionId, messageKey: input.messageKey });
  if (initial.rowKey !== input.messageKey || initial.revision !== input.revision) {
    throw new TRPCError({ code: "CONFLICT", message: "The stored text changed. Check it again before syncing.", cause: LIVE_TEXT_PRE_SOURCE_STALE_CAUSE });
  }
  const matching = initial.actions.filter(action => action.id === input.actionId);
  if (matching.length !== 1 || matching[0].syncServiceDate !== input.serviceDate) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The selected action has no exact service-date sync target." });
  }
  // One exact date import at a time per process. Shared-date coalescing is outside this function.
  if (deps.locks.has(input.serviceDate) || deps.locks.size >= 20) {
    throw new TRPCError({ code: "CONFLICT", message: "A date sync is already running. Try again after it finishes." });
  }
  deps.locks.add(input.serviceDate);
  let summary: LiveTextSyncSummary = { date: input.serviceDate, complete: false, fetched: 0, created: 0,
    updated: 0, protectedRecords: 0, checkedAt: deps.now().toISOString() };
  try {
    let source: Awaited<ReturnType<typeof readLiveTextSyncSource>>;
    try { source = await deps.source(input.serviceDate); }
    catch (error) { return failure(initial, summary, sourceFailure(error), "Service-date refresh is unavailable or incomplete. No fresh verification is available.", deps.now().toISOString()); }
    if (!source || source.error || source.date !== input.serviceDate || !Array.isArray(source.bookings) || !Number.isSafeInteger(source.fetched) || source.fetched < 0 || source.fetched !== source.bookings.length) {
      return failure(initial, summary, "SOURCE_INCOMPLETE", "Service-date retrieval was incomplete. No job changes or fresh verification were performed.", deps.now().toISOString());
    }
    summary.fetched = source.bookings.length;
    // Do not import using an action whose exact stored message/context changed while retrieval was running.
    let current: LiveTextContext | null;
    try { current = await deps.context(input.sessionId, input.messageKey); }
    catch { return failure(initial, summary, "STALE_TEXT", "The text could not be checked again before sync. No jobs were changed.", deps.now().toISOString()); }
    if (!current || current.row.key !== input.messageKey || current.row.sessionId !== input.sessionId || current.row.revision !== input.revision
      || current.row.identityAmbiguous) {
      return failure(initial, summary, "STALE_TEXT", "The text or customer identity changed before sync. Check the current text again.", deps.now().toISOString());
    }
    let persisted: Awaited<ReturnType<typeof persistLiveTextSyncDate>>;
    try { persisted = await deps.persist(input.serviceDate, source.bookings); }
    catch { return failure(initial, summary, "SYNC_UNAVAILABLE", "Service-date job refresh could not be committed. No fresh verification is available.", deps.now().toISOString()); }
    summary = { ...summary, complete: persisted.complete, created: persisted.created, updated: persisted.updated,
      protectedRecords: persisted.protectedRecords, checkedAt: deps.now().toISOString() };
    if (!persisted.complete || persisted.protectedRecords > 0) {
      return failure(initial, summary, "PROTECTED_RECORDS", "Some records were protected and not overwritten. Date refresh is incomplete; check the specific booking manually.", deps.now().toISOString());
    }
    let fresh: LiveTextCheck;
    try { fresh = await deps.check({ sessionId: input.sessionId, messageKey: input.messageKey }); }
    catch { return failure(initial, summary, "SYNC_UNAVAILABLE", "The date was refreshed, but fresh record verification is unavailable. Check again manually.", deps.now().toISOString()); }
    if (fresh.rowKey !== input.messageKey || fresh.revision !== input.revision) {
      return failure(initial, summary, "STALE_TEXT", "The text changed during sync. No old verification result will be used.", deps.now().toISOString());
    }
    const target = fresh.actions.filter(action => action.id === input.actionId);
    if (target.length !== 1 || target[0].syncServiceDate !== input.serviceDate) {
      return failure(fresh, summary, "STALE_TEXT", "The requested action changed during sync. Check the current text again.", deps.now().toISOString());
    }
    // A successful empty source response cannot turn an untouched stale local job into fresh proof.
    const jobIds = target[0].records.filter(record => record.source === "leadflow_jobs").map(record => record.jobId);
    if (jobIds.some(id => id === null || !persisted.refreshedJobIds.includes(id))) {
      return failure(fresh, summary, "SOURCE_INCOMPLETE", "The selected local job was not refreshed from this date's source response. Its old state is not fresh verification.", deps.now().toISOString());
    }
    return { sync: { ...summary, complete: true, checkedAt: deps.now().toISOString() }, check: fresh, refreshedJobIds: persisted.refreshedJobIds };
  } finally { deps.locks.delete(input.serviceDate); }
}
