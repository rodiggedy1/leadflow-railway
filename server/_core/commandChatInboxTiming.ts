import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { performance } from "node:perf_hooks";

export const COMMAND_CHAT_INBOX_PATH = "commandCenter.listCommandChatInbox";
export const INBOX_TIMING_LIMITS = Object.freeze({
  recordsPerBatch: 160, bytesPerBatch: 96 * 1024, recordBytes: 2048,
  stagesPerBatch: 64, acquisitionsPerStage: 8, invocationsPerBatch: 8,
  retentionMs: 120_000, responseBytes: Number.MAX_SAFE_INTEGER,
  snapshotRecords: 512, snapshotBytes: 1024 * 1024,
});
const labels = new Set([
  "context", "optional_auth", "procedure", "agent_auth", "handler", "get_db_handle",
  "sessions", "latest_voice", "retained_outbound", "team_profiles", "projection",
  "voice_cohort", "voice_map", "called_cohort", "called_map", "grouping",
  "team_cohort", "team_map", "classification", "sort", "serialize",
]);
type Label = "context" | "optional_auth" | "procedure" | "agent_auth" | "handler" |
  "get_db_handle" | "sessions" | "latest_voice" | "retained_outbound" | "team_profiles" |
  "projection" | "voice_cohort" | "voice_map" | "called_cohort" | "called_map" |
  "grouping" | "team_cohort" | "team_map" | "classification" | "sort" | "serialize";
const databaseLabels = new Set<Label>(["sessions", "latest_voice", "retained_outbound", "team_profiles"]);
type Outcome = "ok" | "error" | "skipped";
type Batch = {
  readonly requestId: string; readonly started: number;
  records: number; bytes: number; stages: number; invocations: number; closed: boolean;
  bytesWritten: number; endAt: number | null; lastSerializeAt: number | null;
};
type Scope = Readonly<{ batch: Batch; invocationId: string | null; stageId: string | null; label: Label | null }>;
type Stage = { readonly scope: Scope; readonly started: number; ended: number | null; count: number; acquisition: Acquisition | null; overflow: boolean };
type Acquisition = { readonly stage: Stage; readonly id: string; readonly started: number; ended: number | null; successful: boolean };
const scopes = new AsyncLocalStorage<Scope>();
const requests = new WeakMap<object, Batch>();
const outputs = new WeakMap<object, Scope>();
const stages = new WeakMap<Scope, Stage>();

type TimingRecord = Record<string, number | string | boolean | null>;
type RetainedRecord = { record: TimingRecord; retainedAt: number; bytes: number };
// Only private emit's already-fixed primitive records enter this process-local ring.
// No request/scope/payload references, timers, persistence or background I/O.
const retained = new Array<RetainedRecord | undefined>(INBOX_TIMING_LIMITS.snapshotRecords);
let retainedHead = 0;
let retainedCount = 0;
let retainedBytes = 0;
function evictRetained(): void {
  retainedBytes -= retained[retainedHead]!.bytes;
  retained[retainedHead] = undefined;
  retainedHead = (retainedHead + 1) % INBOX_TIMING_LIMITS.snapshotRecords;
  retainedCount--;
}
function expireRetained(now: number): void {
  while (retainedCount && now - retained[retainedHead]!.retainedAt >= INBOX_TIMING_LIMITS.retentionMs) evictRetained();
}
function retainRecord(record: TimingRecord, size: number): void {
  const now = performance.now();
  expireRetained(now);
  // Charge the serialized record plus fixed entry bookkeeping against the byte cap.
  const bytes = size + 32;
  if (bytes > INBOX_TIMING_LIMITS.snapshotBytes) return;
  while (retainedCount && (retainedCount >= INBOX_TIMING_LIMITS.snapshotRecords || retainedBytes + bytes > INBOX_TIMING_LIMITS.snapshotBytes)) evictRetained();
  retained[(retainedHead + retainedCount) % INBOX_TIMING_LIMITS.snapshotRecords] = { record: { ...record }, retainedAt: now, bytes };
  retainedCount++; retainedBytes += bytes;
}
export function getCommandChatInboxTimingSnapshot(): TimingRecord[] {
  return safe(() => {
    expireRetained(performance.now());
    return Array.from({ length: retainedCount }, (_, i) => ({ ...retained[(retainedHead + i) % INBOX_TIMING_LIMITS.snapshotRecords]!.record }));
  }) ?? [];
}
export function commandChatInboxTimingEnabled(): boolean {
  return process.env.COMMAND_CHAT_INBOX_TIMING_ENABLED !== "false" &&
    (process.env.COMMAND_CHAT_INBOX_TIMING_ENABLED === "true" || process.env.COMMAND_CHAT_API_DEBUG_ENABLED === "true") &&
    process.env.RAILWAY_ENVIRONMENT_NAME === "preview" && process.env.PREVIEW_MODE === "true";
}
export function commandChatInboxTimingReadAllowed(header: unknown): boolean {
  return safe(() => {
    if (!commandChatInboxTimingEnabled()) return false;
    const secret = process.env.CRON_SECRET;
    if (!secret || typeof header !== "string" || !header) return false;
    const expected = Buffer.from(secret);
    const supplied = Buffer.from(header);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }) === true;
}
function safe<T>(fn: () => T): T | undefined { try { return fn(); } catch { return undefined; } }
function active(batch: Batch): boolean {
  return safe(() => commandChatInboxTimingEnabled() && !batch.closed && performance.now() - batch.started <= INBOX_TIMING_LIMITS.retentionMs) === true;
}
function runScoped<T>(scope: Scope, work: () => T): T {
  let entered = false;
  try {
    return scopes.run(scope, () => { entered = true; return work(); });
  } catch (error) {
    // Only a failure before application entry is an observer setup failure.
    // Never swallow/replay a synchronous application error or a started promise.
    if (entered) throw error;
    return work();
  }
}
function current(): Scope | undefined {
  return safe(() => { const scope = scopes.getStore(); return scope && active(scope.batch) ? scope : undefined; });
}
function duration(start: number, end = performance.now()): number { return Math.max(0, end - start); }
function emit(scope: Scope, event: string, fields: Record<string, number | string | boolean | null> = {}): void {
  safe(() => {
    const b = scope.batch;
    const terminal = event === "response_end" || event === "response_terminal";
    const recordLimit = INBOX_TIMING_LIMITS.recordsPerBatch - (terminal ? 0 : 2);
    const byteLimit = INBOX_TIMING_LIMITS.bytesPerBatch - (terminal ? 0 : 2 * INBOX_TIMING_LIMITS.recordBytes);
    if (!active(b) || b.records >= recordLimit) return;
    const record: TimingRecord = { version: 1, procedure: COMMAND_CHAT_INBOX_PATH,
      request_id: b.requestId, invocation_id: scope.invocationId, stage_id: scope.stageId,
      stage: scope.label, event, ...fields };
    const line = JSON.stringify(record);
    const prefixed = "[CommandChatInboxTiming] " + line;
    const size = Buffer.byteLength(prefixed) + 1;
    if (size > INBOX_TIMING_LIMITS.recordBytes || b.bytes + size > byteLimit) return;
    b.records++; b.bytes += size;
    safe(() => retainRecord(record, size));
    console.log(prefixed);
  });
}
function root(batch: Batch): Scope { return Object.freeze({ batch, invocationId: null, stageId: null, label: null }); }
function begin(label: Label, parent = current()): Stage | undefined {
  return safe(() => {
    if (!parent || !active(parent.batch) || !labels.has(label) || parent.batch.stages >= INBOX_TIMING_LIMITS.stagesPerBatch) return;
    parent.batch.stages++;
    const scope = Object.freeze({ batch: parent.batch, invocationId: parent.invocationId, stageId: randomUUID(), label });
    const stage: Stage = { scope, started: performance.now(), ended: null, count: 0, acquisition: null, overflow: false };
    stages.set(scope, stage);
    emit(scope, "stage_start");
    return stage;
  });
}
function end(stage: Stage | undefined, outcome: Outcome): void {
  safe(() => {
    if (!stage || stage.ended !== null) return;
    stage.ended = performance.now();
    const fields: Record<string, number | string | boolean | null> = { outcome, wall_ms: outcome === "skipped" ? null : duration(stage.started, stage.ended) };
    if (databaseLabels.has(stage.scope.label!)) {
      const a = stage.acquisition;
      const covered = !stage.overflow && stage.count === 1 && a !== null && a.successful &&
        a.ended !== null && a.started >= stage.started && a.ended <= stage.ended;
      fields.acquisitions = stage.count;
      fields.acquisition_coverage = outcome === "skipped" ? "skipped" : covered ? "exactly_one_contained" : stage.count === 0 ? "unavailable" : "partial";
      fields.post_acquisition_db_wall_ms = covered ? Math.max(0, duration(stage.started, stage.ended) - duration(a!.started, a!.ended!)) : null;
    }
    emit(stage.scope, "stage_end", fields);
  });
}

// Execute lazy Drizzle thenables *inside* the immutable stage scope. Never retry work.
export async function inboxTimingStage<T>(label: Label, work: () => T | PromiseLike<T>): Promise<T> {
  const stage = begin(label);
  if (!stage) return await work();
  const run = async () => {
    try { const result = await work(); end(stage, "ok"); return result; }
    catch (error) { end(stage, "error"); throw error; }
  };
  return runScoped(stage.scope, run);
}
export function inboxTimingLocal<T>(label: Label, work: () => T): T {
  const stage = begin(label);
  if (!stage) return work();
  return runScoped(stage.scope, () => {
    try { const result = work(); end(stage, "ok"); return result; }
    catch (error) { end(stage, "error"); throw error; }
  });
}
export function inboxTimingSkipped(label: "latest_voice" | "retained_outbound" | "team_profiles"): void {
  end(begin(label), "skipped");
}

// Capture at corePool dispatch, never read ALS in a queued completion callback.
// The ticket contains no SQL, parameters, driver connection or application error.
export function captureInboxAcquisition(): Acquisition | undefined {
  return safe(() => {
    const scope = current();
    if (!scope || !scope.label || !databaseLabels.has(scope.label)) return;
    const stage = stages.get(scope);
    if (!stage || stage.ended !== null) return;
    stage.count++;
    if (stage.count > INBOX_TIMING_LIMITS.acquisitionsPerStage) { stage.overflow = true; return; }
    const ticket: Acquisition = { stage, id: randomUUID(), started: performance.now(), ended: null, successful: false };
    if (stage.count === 1) stage.acquisition = ticket;
    emit(scope, "acquisition_start", { acquisition_id: ticket.id });
    return ticket;
  });
}
export function completeInboxAcquisition(ticket: Acquisition | undefined, successful: boolean): void {
  safe(() => {
    if (!ticket || ticket.ended !== null) return;
    ticket.ended = performance.now(); ticket.successful = successful;
    emit(ticket.stage.scope, "acquisition_end", { acquisition_id: ticket.id,
      outcome: successful ? "ok" : "error", wall_ms: duration(ticket.started, ticket.ended),
      late: ticket.stage.ended !== null });
  });
}

export function beginInboxTimingRequest(req: { path?: string }, res: any): Batch | undefined {
  return safe(() => {
    if (!commandChatInboxTimingEnabled()) return;
    // Eligibility only: never retain or log pathname, URL, body or caller headers.
    const path = req.path;
    if (typeof path !== "string" || path.length > 8192 || !path.split("/").pop()?.split(",").includes(COMMAND_CHAT_INBOX_PATH)) return;
    const existing = requests.get(req);
    if (existing) return existing;
    const batch: Batch = { requestId: randomUUID(), started: performance.now(), records: 0,
      bytes: 0, stages: 0, invocations: 0, closed: false, bytesWritten: 0, endAt: null, lastSerializeAt: null };
    requests.set(req, batch);
    const scope = root(batch);
    emit(scope, "batch_start");
    safe(() => { if (!res.headersSent) res.setHeader("X-Command-Chat-Inbox-Trace", batch.requestId); });
    observeResponse(batch, res);
    return batch;
  });
}
export async function observeInboxContext<T>(batch: Batch | undefined, work: () => Promise<T>): Promise<T> {
  if (!batch || !active(batch)) return work();
  return runScoped(root(batch), () => inboxTimingStage("context", work));
}
export async function observeInboxProcedure<T extends { ok: boolean }>(req: object, path: string, work: () => Promise<T>): Promise<T> {
  const parent = safe(() => {
    if (path !== COMMAND_CHAT_INBOX_PATH || !commandChatInboxTimingEnabled()) return;
    const batch = requests.get(req);
    if (!batch || !active(batch) || batch.invocations >= INBOX_TIMING_LIMITS.invocationsPerBatch) return;
    batch.invocations++;
    return Object.freeze({ batch, invocationId: randomUUID(), stageId: null, label: null });
  });
  if (!parent) return work();
  const stage = begin("procedure", parent);
  if (!stage) return work();
  return runScoped(stage.scope, async () => {
    try { const result = await work(); end(stage, result.ok ? "ok" : "error"); return result; }
    catch (error) { end(stage, "error"); throw error; }
  });
}
export async function observeInboxHandler<T extends { ok: boolean; data?: unknown }>(path: string, work: () => Promise<T>): Promise<T> {
  const scope = current();
  if (path !== COMMAND_CHAT_INBOX_PATH || !scope?.invocationId) return work();
  const stage = begin("handler", scope);
  if (!stage) return work();
  return runScoped(stage.scope, async () => {
    try {
      const result = await work();
      end(stage, result.ok ? "ok" : "error");
      safe(() => { if (result.ok && result.data !== null && typeof result.data === "object") outputs.set(result.data, stage.scope); });
      return result;
    } catch (error) { end(stage, "error"); throw error; }
  });
}
export function serializeInboxTiming<T>(data: unknown, serialize: (data: any) => T): T {
  const scope = safe(() => commandChatInboxTimingEnabled() && data !== null && typeof data === "object" ? outputs.get(data) : undefined);
  if (!scope || !active(scope.batch)) return serialize(data);
  // Only the exact returned inbox object is weakly marked; no payload decoration.
  return runScoped(scope, () => {
    try { return inboxTimingLocal("serialize", () => serialize(data)); }
    finally { safe(() => { scope.batch.lastSerializeAt = performance.now(); }); }
  });
}

function observeResponse(batch: Batch, res: any): void {
  safe(() => {
    const scope = root(batch);
    const originalWrite = res.write;
    const originalEnd = res.end;
    let inEnd = false;
    let terminal = false;
    const count = (args: any[]) => safe(() => {
      if (!active(batch)) return;
      const chunk = args[0];
      const bytes = typeof chunk === "string" ? Buffer.byteLength(chunk, typeof args[1] === "string" ? args[1] as BufferEncoding : undefined) :
        Buffer.isBuffer(chunk) || chunk instanceof Uint8Array ? chunk.byteLength : 0;
      batch.bytesWritten = Math.min(INBOX_TIMING_LIMITS.responseBytes, batch.bytesWritten + bytes);
    });
    const write = function (this: any, ...args: any[]) {
      if (!inEnd) count(args);
      return originalWrite.apply(this, args);
    };
    const responseEnd = function (this: any, ...args: any[]) {
      const first = batch.endAt === null;
      if (first) safe(() => { batch.endAt = performance.now(); count(args); emit(scope, "response_end", {
        shared_batch: true, context_entry_to_end_ms: duration(batch.started, batch.endAt!),
        last_inbox_serialize_to_end_shared_ms: batch.lastSerializeAt === null ? null : duration(batch.lastSerializeAt, batch.endAt!),
        response_bytes: batch.bytesWritten }); });
      const previous = inEnd; inEnd = true;
      try { return originalEnd.apply(this, args); }
      finally { inEnd = previous; }
    };
    const restore = () => safe(() => {
      if (res.write === write) res.write = originalWrite;
      if (res.end === responseEnd) res.end = originalEnd;
      res.removeListener("finish", finish); res.removeListener("close", close);
    });
    const finishOnce = (outcome: "finish" | "close") => safe(() => {
      if (terminal) return;
      terminal = true;
      emit(scope, "response_terminal", { outcome, shared_batch: true,
        context_entry_to_terminal_ms: duration(batch.started), response_bytes: batch.bytesWritten,
        end_to_terminal_ms: batch.endAt === null ? null : duration(batch.endAt) });
      batch.closed = true; restore();
    });
    const finish = () => finishOnce("finish");
    const close = () => finishOnce("close");
    try {
      res.write = write; res.end = responseEnd;
      res.once("finish", finish); res.once("close", close);
    } catch { restore(); }
  });
}
