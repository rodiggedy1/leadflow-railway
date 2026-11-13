import { TRPCError } from "@trpc/server";
import type {
  LiveTextAction,
  LiveTextCheck,
  LiveTextSyncFailure,
  LiveTextSyncInput,
  LiveTextSyncResult,
  LiveTextSyncSummary,
} from "../shared/liveTextMonitor";
import { auditBusinessDate, isValidAuditDate } from "./dailyActionAuditEngine";
import { checkLiveText } from "./liveTextMonitorService";
import { LIVE_TEXT_PRE_SOURCE_STALE_CAUSE, syncAndCheckLiveText } from "./liveTextMonitorSync";

const TTL_MS = 60_000;
const CACHE_CAP = 100;
const MAX_DATES = 4;
const BUDGET_MS = 45_000;
type CheckInput = { sessionId: number; messageKey: string };
type Sync = (input: LiveTextSyncInput) => Promise<LiveTextSyncResult>;
type Receipt = { sync: LiveTextSyncSummary; refreshedJobIds: number[] };
type CacheEntry = { sync: Sync; promise: Promise<Receipt>; settledAt?: number };
/** Date receipts only: no text, customer, row key, revision, actions or checks. */
export type LiveTextAutoSyncCache = Map<string, CacheEntry>;
export function createLiveTextAutoSyncCache(): LiveTextAutoSyncCache {
  return new Map();
}
export type LiveTextAutoSyncDependencies = {
  check: (input: CheckInput) => Promise<LiveTextCheck>;
  sync: Sync;
  now: () => Date;
  cache: LiveTextAutoSyncCache;
};
const defaults: LiveTextAutoSyncDependencies = {
  check: checkLiveText,
  sync: syncAndCheckLiveText,
  now: () => new Date(),
  cache: createLiveTextAutoSyncCache(),
};
const REASONS: Record<LiveTextSyncFailure, string> = {
  SOURCE_UNAVAILABLE: "Future-date refresh is unavailable. Review this action.",
  SOURCE_INCOMPLETE:
    "The exact visit was not fully refreshed. Review this action.",
  SYNC_UNAVAILABLE:
    "Future-date refresh or fresh verification could not be completed. Review this action.",
  PROTECTED_RECORDS:
    "Date refresh is incomplete because records were protected. Review this action.",
  STALE_TEXT:
    "The text or requested action changed. Check the current text again.",
};
const FAILURE_CODES = new Set<LiveTextSyncFailure>(
  Object.keys(REASONS) as LiveTextSyncFailure[]
);
function failureCode(value: unknown): LiveTextSyncFailure {
  return typeof value === "string" &&
    FAILURE_CODES.has(value as LiveTextSyncFailure)
    ? (value as LiveTextSyncFailure)
    : "SYNC_UNAVAILABLE";
}
function failed(date: string, code: LiveTextSyncFailure, now: Date): Receipt {
  return {
    sync: {
      date,
      complete: false,
      fetched: 0,
      created: 0,
      updated: 0,
      protectedRecords: 0,
      checkedAt: now.toISOString(),
      failure: code,
    },
    refreshedJobIds: [],
  };
}
function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function positiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
/** Whitelist scalar counts/codes: even a failed owner's check/evidence is never retained. */
function receipt(result: LiveTextSyncResult, date: string, now: Date): Receipt {
  const summary = result?.sync;
  if (
    !summary ||
    summary.date !== date ||
    ![
      summary.fetched,
      summary.created,
      summary.updated,
      summary.protectedRecords,
    ].every(count)
  ) {
    return failed(date, "SOURCE_INCOMPLETE", now);
  }
  const sync: LiveTextSyncSummary = {
    date,
    complete: summary.complete === true,
    fetched: summary.fetched,
    created: summary.created,
    updated: summary.updated,
    protectedRecords: summary.protectedRecords,
    checkedAt: now.toISOString(),
  };
  if (!sync.complete || summary.failure || sync.protectedRecords > 0) {
    return {
      sync: {
        ...sync,
        complete: false,
        failure:
          sync.protectedRecords > 0
            ? "PROTECTED_RECORDS"
            : failureCode(summary.failure),
      },
      refreshedJobIds: [],
    };
  }
  const ids = result.refreshedJobIds ?? [];
  if (!Array.isArray(ids) || ids.length > 500 || !ids.every(positiveId))
    return failed(date, "SOURCE_INCOMPLETE", now);
  return { sync, refreshedJobIds: Array.from(new Set(ids)) };
}
function prune(cache: LiveTextAutoSyncCache, now: number): void {
  for (const [date, entry] of Array.from(cache)) {
    // An unsettled side-effecting sync must never be evicted/restarted on a TTL.
    if (entry.settledAt !== undefined && now - entry.settledAt >= TTL_MS)
      cache.delete(date);
  }
}
async function coalesced(
  input: LiveTextSyncInput,
  deps: LiveTextAutoSyncDependencies
): Promise<Receipt> {
  prune(deps.cache, deps.now().getTime());
  const existing = deps.cache.get(input.serviceDate);
  if (existing?.sync === deps.sync) return existing.promise;
  // Dependency changes in tests must not borrow receipts, nor restart an active sync.
  if (existing) {
    if (existing.settledAt === undefined)
      return failed(input.serviceDate, "SYNC_UNAVAILABLE", deps.now());
    deps.cache.delete(input.serviceDate);
  }
  if (deps.cache.size >= CACHE_CAP) {
    const evictable = Array.from(deps.cache).find(
      ([, entry]) => entry.settledAt !== undefined
    );
    if (!evictable)
      return failed(input.serviceDate, "SYNC_UNAVAILABLE", deps.now());
    deps.cache.delete(evictable[0]);
  }
  const entry: CacheEntry = {
    sync: deps.sync,
    promise: Promise.resolve(
      failed(input.serviceDate, "SYNC_UNAVAILABLE", deps.now())
    ),
  };
  // Install before starting so concurrent rows wait on one date receipt.
  entry.promise = Promise.resolve()
    .then(() => deps.sync(input))
    .then(result => receipt(result, input.serviceDate, deps.now()))
    .catch((error: unknown) =>
      failed(
        input.serviceDate,
        error instanceof TRPCError && error.code === "CONFLICT" &&
          error.cause === LIVE_TEXT_PRE_SOURCE_STALE_CAUSE
          ? "STALE_TEXT"
          : failureCode((error as { code?: unknown } | null)?.code),
        deps.now()
      )
    )
    .then(result => {
      entry.settledAt = deps.now().getTime();
      // These codes can describe only the first owner's text or selected job.
      // Without a committed receipt they cannot poison another customer's date.
      if (
        ["STALE_TEXT", "SOURCE_INCOMPLETE"].includes(
          result.sync.failure ?? ""
        ) &&
        deps.cache.get(input.serviceDate) === entry
      ) {
        deps.cache.delete(input.serviceDate);
      }
      return result;
    });
  deps.cache.set(input.serviceDate, entry);
  return entry.promise;
}
function futureDate(action: LiveTextAction, today: string): string | null {
  // The read-only service alone computes the exact confidence/agreement-gated target.
  return isValidAuditDate(action.syncServiceDate) &&
    action.syncServiceDate > today
    ? action.syncServiceDate
    : null;
}
function reviewAction(
  action: LiveTextAction,
  code: LiveTextSyncFailure
): LiveTextAction {
  return {
    ...action,
    verified: "review",
    evidence: REASONS[code],
    records: [],
    links: [],
  };
}
function certified(
  action: LiveTextAction,
  date: string,
  result: Receipt
): boolean {
  if (
    !result.sync.complete ||
    result.sync.failure ||
    result.sync.protectedRecords ||
    !action.records.length
  )
    return false;
  return action.records.every(record => {
    if (record.source === "bookings") return positiveId(record.bookingId);
    return (
      record.source === "leadflow_jobs" &&
      positiveId(record.jobId) &&
      record.date === date &&
      result.refreshedJobIds.includes(record.jobId)
    );
  });
}

/** Foreground monitor only. No cron, timer, retry, provider parsing or cached row verification. */
export async function checkAndSyncLiveText(
  input: CheckInput,
  dependencies: Partial<LiveTextAutoSyncDependencies> = {}
): Promise<LiveTextCheck> {
  if (
    !Number.isSafeInteger(input?.sessionId) ||
    input.sessionId <= 0 ||
    typeof input.messageKey !== "string" ||
    !/^session-text:[a-f0-9]{64}$/.test(input.messageKey) ||
    Object.keys(input).some(key => key !== "sessionId" && key !== "messageKey")
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a valid captured text.",
    });
  }
  const deps = { ...defaults, ...dependencies };
  const start = deps.now().getTime();
  prune(deps.cache, start);
  let initial: LiveTextCheck;
  try {
    initial = await deps.check(input);
  } catch {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Captured text could not be checked.",
    });
  }
  const today = auditBusinessDate(deps.now().toISOString(), "America/New_York");
  if (!today) return initial;
  const targets = initial.actions.filter(
    action =>
      futureDate(action, today) &&
      initial.actions.filter(other => other.id === action.id).length === 1
  );
  if (!targets.length) return initial; // No service-date target means no refresh, writes or extra read.
  const byDate = new Map<string, LiveTextAction[]>();
  for (const action of targets) {
    const date = futureDate(action, today)!;
    byDate.set(date, [...(byDate.get(date) ?? []), action]);
  }
  const receipts = new Map<string, Receipt>();
  let dates = 0;
  for (const [date, actions] of Array.from(byDate)) {
    if (dates >= MAX_DATES || deps.now().getTime() - start >= BUDGET_MS) {
      receipts.set(date, failed(date, "SYNC_UNAVAILABLE", deps.now()));
      continue;
    }
    dates++;
    if (initial.rowKey !== input.messageKey || !initial.revision) {
      receipts.set(date, failed(date, "STALE_TEXT", deps.now()));
      continue;
    }
    receipts.set(
      date,
      await coalesced(
        {
          ...input,
          revision: initial.revision,
          actionId: actions[0].id,
          serviceDate: date,
        },
        deps
      )
    );
  }
  // Cooperative budget: check between calls; never race or detach side-effecting work.
  let fresh: LiveTextCheck | undefined;
  if (deps.now().getTime() - start < BUDGET_MS) {
    try {
      fresh = await deps.check(input);
    } catch {
      /* Fixed target-only Review below; no provider/SQL details escape. */
    }
  }
  const identityValid =
    fresh?.rowKey === input.messageKey && fresh.revision === initial.revision;
  const base = identityValid ? fresh! : initial;
  const failures = new Map<string, LiveTextSyncFailure>();
  for (const action of targets) {
    const date = futureDate(action, today)!;
    const result = receipts.get(date)!;
    const matches = base.actions.filter(other => other.id === action.id);
    const code = !fresh
      ? "SYNC_UNAVAILABLE"
      : !identityValid ||
          matches.length !== 1 ||
          matches[0].syncServiceDate !== date
        ? "STALE_TEXT"
        : !result.sync.complete
          ? (result.sync.failure ?? "SYNC_UNAVAILABLE")
          : !certified(matches[0], date, result)
            ? "SOURCE_INCOMPLETE"
            : null;
    if (code) failures.set(action.id, code);
  }
  if (identityValid) {
    // A changed/new target is not an invitation to recurse or sync another date.
    for (const action of base.actions) {
      if (
        futureDate(action, today) &&
        !targets.some(
          target =>
            target.id === action.id &&
            target.syncServiceDate === action.syncServiceDate
        )
      ) {
        failures.set(action.id, "STALE_TEXT");
      }
    }
  }
  const actions = base.actions.map(action =>
    failures.has(action.id)
      ? reviewAction(action, failures.get(action.id)!)
      : action
  );
  for (const target of targets) {
    if (!actions.some(action => action.id === target.id))
      actions.push(reviewAction(target, "STALE_TEXT"));
  }
  const syncs = Array.from(receipts, ([date, result]) => {
    const localFailure = (byDate.get(date) ?? [])
      .map(action => failures.get(action.id))
      .find(code => code !== undefined);
    return localFailure
      ? { ...result.sync, complete: false, failure: localFailure }
      : { ...result.sync };
  });
  const hasReview = failures.size > 0;
  return {
    ...base,
    actions,
    syncs,
    required:
      identityValid && base.actions.length ? base.required : initial.required,
    verified: hasReview ? "review" : base.verified,
    evidence: hasReview
      ? actions.length === 1
        ? actions[0].evidence
        : "Some future-date actions need review; other actions retain their fresh checks."
      : base.evidence,
    checkedAt: deps.now().toISOString(),
  };
}
