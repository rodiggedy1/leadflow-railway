import { getCompletedBookingsForDate, type Launch27SyncResult } from "./launch27";
import type { LiveTextSyncFailure } from "../shared/liveTextMonitor";

export type { Launch27SyncResult } from "./launch27";
export type LiveTextSyncSourceFailure = Extract<LiveTextSyncFailure, "SOURCE_UNAVAILABLE" | "SOURCE_INCOMPLETE">;

/** Only a fixed code leaves the source boundary; never attach upstream errors/bodies. */
export class LiveTextSyncSourceError extends Error {
  readonly code: LiveTextSyncSourceFailure;

  constructor(code: LiveTextSyncSourceFailure) {
    super(code);
    this.name = "LiveTextSyncSourceError";
    this.code = code;
  }
}

/**
 * A single service-day read: at most 500 rows, 26 pages (including a terminal
 * empty page after 25 full pages), 1 MiB/page, 8 MiB total, 5 seconds/page and
 * 15 seconds total. No retries, redirects, writes or concurrent source reads.
 * Exceeding any completeness bound discards the entire result.
 */
export const LIVE_TEXT_SYNC_SOURCE_LIMITS = Object.freeze({
  maxPages: 26,
  maxRows: 500,
  maxPageBytes: 1_048_576,
  maxTotalBytes: 8_388_608,
  pageTimeoutMs: 5_000,
  totalTimeoutMs: 15_000,
});

type SourceLimits = { -readonly [K in keyof typeof LIVE_TEXT_SYNC_SOURCE_LIMITS]: number };
export interface LiveTextSyncSourceDependencies {
  /** Per-call transport injection for offline tests; the mapper itself is real. */
  request?: typeof fetch;
  /** May only lower production limits, never disable or increase them. */
  limits?: Partial<SourceLimits>;
}

const STATUSES = new Set(["new", "unassigned", "assigned", "completed", "cancelled", "canceled", "rescheduled"]);
const EASTERN = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});
let sourceBusy = false;

function incomplete(): never {
  throw new LiveTextSyncSourceError("SOURCE_INCOMPLETE");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) incomplete();
  return value;
}

function positiveId(value: unknown): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) incomplete();
}

function optionalString(value: unknown): void {
  if (value != null && typeof value !== "string") incomplete();
}

function finiteNumber(value: unknown): void {
  if (typeof value !== "number" || !Number.isFinite(value)) incomplete();
}

function optionalNumber(value: unknown): void {
  if (value != null) finiteNumber(value);
}

function optionalBoolean(value: unknown): void {
  if (value != null && typeof value !== "boolean") incomplete();
}

function optionalRecord(value: unknown, check: (value: Record<string, unknown>) => void): void {
  if (value != null) check(record(value));
}

function optionalArray(value: unknown, check: (entry: unknown) => void): void {
  if (value == null) return;
  if (!Array.isArray(value)) incomplete();
  for (const entry of value) check(entry);
}

function strings(value: Record<string, unknown>, keys: string[]): void {
  for (const key of keys) optionalString(value[key]);
}

function amounts(value: Record<string, unknown>, keys: string[]): void {
  for (const key of keys) optionalNumber(value[key]);
}

function validCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateServiceDate(value: unknown, target: string): void {
  if (typeof value !== "string") incomplete();
  // Existing serviceDateTime consumers accept date-only/local wall-clock values.
  // Keep their explicit Eastern calendar day and exact source text, never guess
  // an offset or fabricate a time. Date.parse alone normalizes impossible dates.
  if (validCalendarDate(value)) {
    if (value !== target) incomplete();
    return;
  }
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match || !validCalendarDate(match[1])) incomplete();
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || (match[4] !== undefined && Number(match[4]) > 59)) incomplete();
  if (!match[5]) {
    if (match[1] !== target) incomplete();
    return;
  }
  if (match[5] !== "Z") {
    const hour = Number(match[5].slice(1, 3));
    const minute = Number(match[5].slice(4, 6));
    if (hour > 14 || minute > 59 || (hour === 14 && minute !== 0)) incomplete();
  }
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) incomplete();
  const parts = EASTERN.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value;
  if (`${part("year")?.padStart(4, "0")}-${part("month")}-${part("day")}` !== target) incomplete();
}

function validateExtra(entry: unknown): void {
  if (typeof entry === "string") {
    if (!entry.trim()) incomplete();
    return;
  }
  const item = record(entry);
  if (item.id != null) positiveId(item.id);
  strings(item, ["name", "label", "title"]);
  if (item.id == null && ![item.name, item.label, item.title].some(v => typeof v === "string" && v.trim())) incomplete();
}

function validateExtras(value: unknown): void {
  if (value == null) return;
  let parsed: unknown = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      validateExtra(parsed); // The existing mapper also accepts a plain extra label.
      return;
    }
  }
  if (Array.isArray(parsed)) {
    for (const item of parsed) validateExtra(item);
  } else if (isRecord(parsed)) {
    for (const item of Object.values(parsed)) validateExtra(item);
  } else {
    incomplete();
  }
}

function validateBooking(value: unknown, target: string, ids: Set<number>): void {
  const b = record(value);
  positiveId(b.id);
  if (ids.has(b.id as number)) incomplete();
  ids.add(b.id as number);
  validateServiceDate(b.service_date, target);
  if (typeof b.booking_status !== "string" || !STATUSES.has(b.booking_status)) incomplete();
  strings(b, ["phone", "customer_notes", "staff_notes"]);
  optionalBoolean(b.completed);
  optionalRecord(b.user, user => {
    if (user.id != null) positiveId(user.id);
    strings(user, ["first_name", "last_name", "name", "email", "stripe_customer_id"]);
    optionalBoolean(user.is_stripe_card);
  });
  optionalRecord(b.frequency, frequency => {
    if (frequency.id != null) positiveId(frequency.id);
    strings(frequency, ["name"]);
  });
  optionalRecord(b.address, address => strings(address, ["full_address", "street", "city", "state", "zip"]));
  optionalRecord(b.summary, summary => amounts(summary, ["services", "pricing_parameters", "extras", "discount", "adjustment", "revenue", "tip", "total"]));
  optionalRecord(b.preferred_cleaner, cleaner => {
    if (cleaner.id != null) positiveId(cleaner.id);
    strings(cleaner, ["name"]);
  });
  optionalArray(b.teams, value => {
    const team = record(value);
    positiveId(team.id);
    if (typeof team.title !== "string") incomplete();
    optionalNumber(team.share);
    strings(team, ["bg_color", "fg_color", "image"]);
  });
  let bathroomTotal = 0;
  optionalArray(b.services, value => {
    const service = record(value);
    positiveId(service.id);
    if (typeof service.name !== "string") incomplete();
    const bedrooms = service.name.match(/(\d+)\s*bedroom/i);
    if (bedrooms && !Number.isSafeInteger(Number(bedrooms[1]))) incomplete();
    optionalNumber(service.price);
    validateExtras(service.extras);
    optionalArray(service.pricing_parameters, value => {
      const pp = record(value);
      if (pp.id != null) positiveId(pp.id);
      if (typeof pp.name !== "string") incomplete();
      strings(pp, ["type", "label", "title"]);
      amounts(pp, ["quantity", "price", "total"]);
      if (pp.name.toLowerCase().includes("bathroom")) {
        bathroomTotal += (pp.quantity as number | null | undefined) ?? 0;
        finiteNumber(bathroomTotal);
      }
    });
  });
  optionalRecord(b.payment_method_info, payment => {
    strings(payment, ["brand", "last4"]);
    if (payment.last4 != null && !/^\d{4}$/.test(payment.last4 as string)) incomplete();
  });
  optionalRecord(b.charges, charges => {
    optionalNumber(charges.outstanding);
    let held = 0;
    optionalArray(charges.onhold, value => {
      const charge = record(value);
      if (charge.id != null) positiveId(charge.id);
      optionalNumber(charge.amount);
      held += (charge.amount as number | null | undefined) ?? 0;
      if (!Number.isSafeInteger(Math.round(held * 100))) incomplete();
    });
    if (!Number.isSafeInteger(Math.round(((charges.outstanding as number | null | undefined) ?? 0) * 100))) incomplete();
  });
}

function limitsFor(overrides: Partial<SourceLimits> | undefined): SourceLimits {
  const limits: SourceLimits = { ...LIVE_TEXT_SYNC_SOURCE_LIMITS };
  if (overrides) {
    for (const key of Object.keys(overrides) as Array<keyof SourceLimits>) {
      const value = overrides[key];
      if (!(key in limits) || typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > limits[key]) incomplete();
      limits[key] = value;
    }
  }
  return limits;
}

/** Read/parse a clone with a byte bound before exposing the exact body to the mapper. */
async function readBoundedClone(response: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
  const clone = response.clone();
  if (!clone.body) incomplete();
  const reader = clone.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) throw new LiveTextSyncSourceError("SOURCE_UNAVAILABLE");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new LiveTextSyncSourceError("SOURCE_UNAVAILABLE");
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) incomplete();
      chunks.push(value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(body);
    } catch {
      return incomplete();
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    // Cancel both tee branches without awaiting cancellation of a stalled stream.
    void response.body?.cancel().catch(() => undefined);
  }
}

/**
 * All-or-nothing source boundary. Orchestration must catch LiveTextSyncSourceError
 * and stop before persistence; no partial bookings or provider diagnostics escape.
 * The optional second argument exists only for explicit offline dependency injection.
 */
export async function readLiveTextSyncSource(
  date: string,
  dependencies: LiveTextSyncSourceDependencies = {},
): Promise<Launch27SyncResult> {
  if (!validCalendarDate(date)) incomplete();
  const limits = limitsFor(dependencies.limits);
  if (sourceBusy) throw new LiveTextSyncSourceError("SOURCE_UNAVAILABLE");
  sourceBusy = true;
  const controller = new AbortController();
  const pending = new Set<Promise<unknown>>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let failure: LiveTextSyncSourceError | undefined;
  let validatedPages = 0;
  let rows = 0;
  let bytes = 0;
  const ids = new Set<number>();

  function track<T>(promise: Promise<T>): Promise<T> {
    pending.add(promise);
    void promise.then(() => pending.delete(promise), () => pending.delete(promise));
    return promise;
  }

  function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          failure = new LiveTextSyncSourceError("SOURCE_UNAVAILABLE");
          reject(failure);
          controller.abort();
        }, milliseconds);
        timers.add(timer);
        void promise.then(() => { clearTimeout(timer); timers.delete(timer); }, () => { clearTimeout(timer); timers.delete(timer); });
      }),
    ]);
  }

  const validatedFetch: typeof fetch = async (input, init) => {
    try {
      if (controller.signal.aborted) throw new LiveTextSyncSourceError("SOURCE_UNAVAILABLE");
      if (validatedPages >= limits.maxPages) incomplete();
      if (typeof input !== "string") incomplete();
      const url = new URL(input);
      if (url.protocol !== "https:" || !/^[a-z0-9-]+\.launch27\.com$/.test(url.hostname) || url.port || url.username || url.password || url.pathname !== "/v1/staff/bookings") incomplete();
      const expected = new URLSearchParams({ from: date, to: date, limit: "20", offset: String(validatedPages * 20), sort: "asc" });
      if (url.searchParams.toString() !== expected.toString() || (init?.method && init.method !== "GET") || init?.body != null) incomplete();
      const page = track((async () => {
        const response = await (dependencies.request ?? fetch)(input, {
          ...init, method: "GET", body: undefined, redirect: "error", signal: controller.signal,
        });
        if (!response.ok) {
          void response.body?.cancel().catch(() => undefined);
          throw new LiveTextSyncSourceError("SOURCE_UNAVAILABLE");
        }
        const text = await readBoundedClone(response, Math.min(limits.maxPageBytes, limits.maxTotalBytes - bytes), controller.signal);
        bytes += new TextEncoder().encode(text).byteLength;
        let raw: unknown;
        try { raw = JSON.parse(text) as unknown; } catch { incomplete(); }
        if (!Array.isArray(raw) || raw.length > 20 || rows + raw.length > limits.maxRows) incomplete();
        for (const booking of raw) validateBooking(booking, date, ids);
        rows += raw.length;
        validatedPages += 1;
        // No rewriting/defaults: use the exact validated serialized body with the existing mapper.
        return new Response(text, { status: 200, headers: { "Content-Type": "application/json" } });
      })());
      return await bounded(page, limits.pageTimeoutMs);
    } catch (error) {
      failure = error instanceof LiveTextSyncSourceError ? error : new LiveTextSyncSourceError("SOURCE_UNAVAILABLE");
      controller.abort();
      throw failure;
    }
  };

  try {
    const result = await bounded(track(getCompletedBookingsForDate(date, { includeAll: true, request: validatedFetch })), limits.totalTimeoutMs);
    if (failure) throw failure;
    if (result.error) throw new LiveTextSyncSourceError("SOURCE_UNAVAILABLE");
    if (!validatedPages || result.date !== date || result.fetched !== rows || result.bookings.length !== rows) incomplete();
    return result;
  } catch (error) {
    if (failure) throw failure;
    if (error instanceof LiveTextSyncSourceError) throw error;
    throw new LiveTextSyncSourceError(validatedPages ? "SOURCE_INCOMPLETE" : "SOURCE_UNAVAILABLE");
  } finally {
    controller.abort();
    for (const timer of Array.from(timers)) clearTimeout(timer);
    // An injected transport that ignores abort must settle before another read
    // can begin. The caller still receives its deadline failure promptly.
    if (!pending.size) sourceBusy = false;
    else void Promise.allSettled(Array.from(pending)).then(() => { sourceBusy = false; });
  }
}
