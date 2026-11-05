import React, { createContext, useContext, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "../../../server/routers";

export const COMMAND_CHAT_DEBUG_ENDPOINTS = [
  "commandCenter.listCommandChatInbox",
  "opsChat.getLeadSessionStatuses",
  "opsChat.getPendingSuperAlerts",
  "opsChat.listActiveThreads",
  "opsChat.listEmailInboxThreads",
  "voice.listCalls",
  "commandCenter.listInboundTeamSmsEvents",
] as const;
export type CommandChatDebugEndpoint = (typeof COMMAND_CHAT_DEBUG_ENDPOINTS)[number];
export const COMMAND_CHAT_API_DEBUG_SUPPRESSED = "COMMAND_CHAT_API_DEBUG_SUPPRESSED";
const VERSION = "v1";
let serverEligibility = false;
const eligibilityListeners = new Set<() => void>();
const eligibilitySnapshot = () => serverEligibility;
const eligibilitySubscribe = (listener: () => void) => { eligibilityListeners.add(listener); return () => { eligibilityListeners.delete(listener); }; };
export function captureCommandChatApiDebugEligibility(response: Response, input: RequestInfo | URL): void {
  // Only the existing agents.me response owns this capability. No body, request input or credentials are read.
  let ownsCapability = false;
  try {
    const address = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(address, currentOrigin() || "https://offline.invalid");
    if (!url.pathname.startsWith("/api/trpc/") || url.pathname.slice("/api/trpc/".length).includes("/")) return;
    const members = url.pathname.slice("/api/trpc/".length).split(",");
    if (!members.includes("agents.me")) return;
    ownsCapability = true;
    const eligible = response.ok && response.headers.get("X-Command-Chat-API-Debug") === "1";
    if (serverEligibility !== eligible) { serverEligibility = eligible; Array.from(eligibilityListeners).forEach(listener => listener()); }
  } catch {
    if (ownsCapability && serverEligibility) { serverEligibility = false; Array.from(eligibilityListeners).forEach(listener => listener()); }
  }
}
export function useCommandChatApiDebugServerEligibility(): boolean {
  return useSyncExternalStore(eligibilitySubscribe, eligibilitySnapshot, () => false);
}
type EndpointRecord<T> = Record<CommandChatDebugEndpoint, T>;
type Status = "idle" | "success" | "error" | "suppressed";
export interface CommandChatApiDebugEndpointMetrics {
  attempts: number;
  inFlight: number;
  errors: number;
  suppressed: number;
  lastDurationMs: number | null;
  lastStatus: Status;
  lastErrorCode: string | null;
  lastHttpStatus: number | null;
  lastSuccessAt: number | null;
}
type Totals = { attempts: number; inFlight: number; errors: number };
export interface CommandChatApiDebugBaseline {
  totals: Totals;
  endpoints: EndpointRecord<Pick<CommandChatApiDebugEndpointMetrics, "attempts" | "errors" | "lastDurationMs" | "lastStatus">>;
  durationMs: number;
  mixedInFlight?: boolean;
}
export interface CommandChatApiDebugSnapshot {
  eligible: boolean;
  enabled: EndpointRecord<boolean>;
  endpoints: EndpointRecord<CommandChatApiDebugEndpointMetrics>;
  totals: Totals;
  baseline: CommandChatApiDebugBaseline | null;
  measurement: { kind: "baseline" | "single-off" | "custom"; startedAt: number; endpoint: CommandChatDebugEndpoint | null; mixedInFlight?: boolean };
}
type StorageLike = Pick<Storage, "getItem" | "setItem">;
export interface CommandChatApiDebugOptions {
  eligible: boolean;
  agentId: number | string | null | undefined;
  storage?: StorageLike | null;
  baselineStorage?: StorageLike | null;
  origin?: string;
  now?: () => number;
  schedule?: (notify: () => void, delayMs: number) => (() => void) | void;
}
function records<T>(make: (endpoint: CommandChatDebugEndpoint) => T): EndpointRecord<T> {
  return Object.fromEntries(COMMAND_CHAT_DEBUG_ENDPOINTS.map(endpoint => [endpoint, make(endpoint)])) as EndpointRecord<T>;
}
function endpointOf(value: unknown): CommandChatDebugEndpoint | null {
  return typeof value === "string" && (COMMAND_CHAT_DEBUG_ENDPOINTS as readonly string[]).includes(value) ? value as CommandChatDebugEndpoint : null;
}
function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}
function getBrowserStorage(name: "localStorage" | "sessionStorage"): StorageLike | null {
  try { return typeof window === "undefined" ? null : window[name]; } catch { return null; }
}
function currentOrigin(): string {
  try { return typeof window === "undefined" ? "" : window.location.origin; } catch { return ""; }
}
function namespace(origin: string, agentId: CommandChatApiDebugOptions["agentId"]): string | null {
  const id = typeof agentId === "number" ? agentId : typeof agentId === "string" && /^[1-9]\d*$/.test(agentId) ? Number(agentId) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  try {
    const url = new URL(origin);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.origin !== origin) return null;
    return `command-chat-api-debug:${VERSION}:${encodeURIComponent(origin)}:${id}`;
  } catch { return null; }
}
function readMask(storage: StorageLike | null, key: string | null): EndpointRecord<boolean> {
  const defaults = () => records(() => true);
  if (!storage || !key) return defaults();
  try {
    const raw = storage.getItem(key);
    if (!raw) return defaults();
    const parsed = object(JSON.parse(raw));
    if (!parsed || !exactKeys(parsed, COMMAND_CHAT_DEBUG_ENDPOINTS) || !COMMAND_CHAT_DEBUG_ENDPOINTS.every(endpoint => typeof parsed[endpoint] === "boolean")) return defaults();
    return records(endpoint => parsed[endpoint] as boolean);
  } catch { return defaults(); }
}
function writeSafe(storage: StorageLike | null, key: string | null, value: unknown) {
  if (!storage || !key) return;
  try { storage.setItem(key, JSON.stringify(value)); } catch { /* Diagnostic storage is optional. */ }
}
const safeCodes = ["PARSE_ERROR", "BAD_REQUEST", "INTERNAL_SERVER_ERROR", "NOT_IMPLEMENTED", "BAD_GATEWAY", "SERVICE_UNAVAILABLE", "GATEWAY_TIMEOUT", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "METHOD_NOT_SUPPORTED", "TIMEOUT", "CONFLICT", "PRECONDITION_FAILED", "PAYLOAD_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE", "UNPROCESSABLE_CONTENT", "TOO_MANY_REQUESTS", "CLIENT_CLOSED_REQUEST"];
function safeError(error: unknown): { code: string | null; httpStatus: number | null } {
  try {
    const data = object(object(error)?.data);
    const code = data?.code;
    const status = data?.httpStatus;
    return { code: typeof code === "string" && safeCodes.includes(code) ? code : null, httpStatus: typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null };
  } catch { return { code: null, httpStatus: null }; }
}
export function isCommandChatApiDebugSuppressed(error: unknown): boolean {
  // tRPC may wrap a thrown error in `cause`. Never inspect/persist payloads or stringify errors.
  let current = error;
  const visited = new Set<unknown>();
  for (let index = 0; index < 8; index++) {
    if (current === COMMAND_CHAT_API_DEBUG_SUPPRESSED) return true;
    const value = object(current);
    if (!value || visited.has(current)) return false;
    visited.add(current);
    try {
      if (value.message === COMMAND_CHAT_API_DEBUG_SUPPRESSED) return true;
      current = value.cause;
    } catch { return false; }
  }
  return false;
}
function freshMetrics(): CommandChatApiDebugEndpointMetrics {
  return { attempts: 0, inFlight: 0, errors: 0, suppressed: 0, lastDurationMs: null, lastStatus: "idle", lastErrorCode: null, lastHttpStatus: null, lastSuccessAt: null };
}
function nonnegative(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function readBaseline(storage: StorageLike | null, key: string | null): CommandChatApiDebugBaseline | null {
  if (!storage || !key) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const value = object(JSON.parse(raw));
    if (!value || !exactKeys(value, ["totals", "endpoints", "durationMs", "mixedInFlight"]) || !nonnegative(value.durationMs) || typeof value.mixedInFlight !== "boolean") return null;
    const totals = object(value.totals), endpoints = object(value.endpoints);
    if (!totals || !exactKeys(totals, ["attempts", "inFlight", "errors"]) || !Object.values(totals).every(nonnegative) || !endpoints || !exactKeys(endpoints, COMMAND_CHAT_DEBUG_ENDPOINTS)) return null;
    if (!COMMAND_CHAT_DEBUG_ENDPOINTS.every(endpoint => {
      const metric = object(endpoints[endpoint]);
      return metric && exactKeys(metric, ["attempts", "errors", "lastDurationMs", "lastStatus"]) && nonnegative(metric.attempts) && nonnegative(metric.errors) && (metric.lastDurationMs === null || nonnegative(metric.lastDurationMs)) && ["idle", "success", "error", "suppressed"].includes(String(metric.lastStatus));
    })) return null;
    return value as unknown as CommandChatApiDebugBaseline;
  } catch { return null; }
}

export class CommandChatApiDebugController {
  private readonly capable: boolean;
  private active = true;
  private retired = false;
  private readonly storage: StorageLike | null;
  private readonly baselineStorage: StorageLike | null;
  private readonly storageKey: string | null;
  private readonly baselineKey: string | null;
  private readonly now: () => number;
  private readonly schedule: NonNullable<CommandChatApiDebugOptions["schedule"]>;
  private readonly listeners = new Set<() => void>();
  private mask: EndpointRecord<boolean>;
  private metrics = records(() => freshMetrics());
  private baseline: CommandChatApiDebugBaseline | null;
  private measurement: CommandChatApiDebugSnapshot["measurement"];
  private measurementStart = records(() => ({ attempts: 0, errors: 0 }));
  private pending = false;
  private cancelNotify: (() => void) | void = undefined;
  private snapshot!: CommandChatApiDebugSnapshot;
  private controlSnapshot!: CommandChatApiDebugSnapshot;
  readonly context: { commandChatApiDebug: CommandChatApiDebugController };

  constructor(options: CommandChatApiDebugOptions) {
    // Only the server-capability AND actual-admin predicate may be passed as eligible by the owner.
    const key = namespace(options.origin ?? currentOrigin(), options.agentId);
    const id = typeof options.agentId === "number" ? options.agentId : typeof options.agentId === "string" && /^[1-9]\d*$/.test(options.agentId) ? Number(options.agentId) : NaN;
    this.capable = options.eligible === true && Number.isSafeInteger(id) && id > 0;
    this.storageKey = this.capable ? key : null;
    this.baselineKey = this.storageKey ? `${this.storageKey}:baseline` : null;
    this.storage = options.storage === undefined ? getBrowserStorage("localStorage") : options.storage;
    this.baselineStorage = options.baselineStorage === undefined ? getBrowserStorage("sessionStorage") : options.baselineStorage;
    this.now = options.now ?? (() => typeof performance === "undefined" ? Date.now() : performance.now());
    this.schedule = options.schedule ?? ((notify, delay) => { const timer = setTimeout(notify, delay); return () => clearTimeout(timer); });
    this.mask = readMask(this.storage, this.storageKey);
    this.baseline = readBaseline(this.baselineStorage, this.baselineKey);
    this.measurement = { kind: "custom", startedAt: this.now(), endpoint: null, mixedInFlight: false };
    this.context = Object.freeze({ commandChatApiDebug: this });
    this.publish(false);
  }
  get eligible() { return this.capable && this.active && !this.retired; }
  isEnabled(endpoint: CommandChatDebugEndpoint): boolean { return !this.eligible || this.mask[endpoint] !== false; }
  allowsQueryKey(key: unknown): boolean {
    if (!Array.isArray(key)) return true;
    const path = key[0];
    const endpoint = endpointOf(Array.isArray(path) && path.every(part => typeof part === "string") ? path.join(".") : path);
    return !endpoint || this.isEnabled(endpoint);
  }
  retry(endpoint: CommandChatDebugEndpoint, failureCount: number, error: unknown): boolean {
    if (!this.isEnabled(endpoint) || isCommandChatApiDebugSuppressed(error)) return false;
    if (error instanceof TRPCClientError) {
      if (error.message === "Rate exceeded." || [429, 401, 403].includes(error.data?.httpStatus)) return false;
    }
    return failureCount < 1;
  }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = (): CommandChatApiDebugSnapshot => this.snapshot;
  getControlSnapshot = (): CommandChatApiDebugSnapshot => this.controlSnapshot;
  private publish(notify = true) {
    const previousEnabled = this.snapshot?.enabled;
    const enabled = previousEnabled && COMMAND_CHAT_DEBUG_ENDPOINTS.every(endpoint => previousEnabled[endpoint] === this.isEnabled(endpoint))
      ? previousEnabled : Object.freeze(records(endpoint => this.isEnabled(endpoint)));
    this.snapshot = Object.freeze({
      eligible: this.eligible,
      enabled,
      endpoints: Object.freeze(records(endpoint => Object.freeze({ ...this.metrics[endpoint] }))),
      totals: Object.freeze(COMMAND_CHAT_DEBUG_ENDPOINTS.reduce((totals, endpoint) => ({ attempts: totals.attempts + this.metrics[endpoint].attempts, inFlight: totals.inFlight + this.metrics[endpoint].inFlight, errors: totals.errors + this.metrics[endpoint].errors }), { attempts: 0, inFlight: 0, errors: 0 })),
      baseline: this.baseline,
      measurement: Object.freeze({ ...this.measurement }),
    });
    if (!this.controlSnapshot || this.controlSnapshot.eligible !== this.snapshot.eligible || this.controlSnapshot.enabled !== enabled) this.controlSnapshot = this.snapshot;
    if (notify) Array.from(this.listeners).forEach(listener => listener());
  }
  private flush() {
    this.cancelNotify?.(); this.cancelNotify = undefined; this.pending = false;
    this.publish();
  }
  private changed() {
    if (this.pending || !this.active || this.retired) return;
    this.pending = true;
    const cancel = this.schedule(() => { this.pending = false; this.cancelNotify = undefined; if (this.active && !this.retired) this.publish(); }, 100);
    if (this.pending) this.cancelNotify = cancel;
  }
  private measure(kind: CommandChatApiDebugSnapshot["measurement"]["kind"], endpoint: CommandChatDebugEndpoint | null) {
    this.measurement = { kind, endpoint, startedAt: this.now(), mixedInFlight: COMMAND_CHAT_DEBUG_ENDPOINTS.some(name => this.metrics[name].inFlight > 0) };
    this.measurementStart = records(name => ({ attempts: this.metrics[name].attempts, errors: this.metrics[name].errors }));
  }
  private commitMask() { writeSafe(this.storage, this.storageKey, records(endpoint => this.mask[endpoint])); this.flush(); }
  setEnabled(endpoint: CommandChatDebugEndpoint, enabled: boolean) {
    if (!this.eligible || !endpointOf(endpoint) || typeof enabled !== "boolean" || this.mask[endpoint] === enabled) return;
    this.mask[endpoint] = enabled; this.measure("custom", null); this.commitMask();
  }
  resetAll() {
    if (!this.eligible) return;
    this.mask = records(() => true); this.measure("custom", null); this.commitMask();
  }
  startBaseline() {
    if (!this.eligible) return;
    this.mask = records(() => true); this.measure("baseline", null); this.commitMask();
  }
  testOnly(endpoint: CommandChatDebugEndpoint) {
    if (!this.eligible || !endpointOf(endpoint)) return;
    this.mask = records(name => name !== endpoint); this.measure("single-off", endpoint); this.commitMask();
  }
  saveBaseline() {
    if (!this.eligible || this.measurement.kind !== "baseline") return;
    const endpoints = records(endpoint => {
      const metric = this.metrics[endpoint], start = this.measurementStart[endpoint];
      return { attempts: metric.attempts - start.attempts, errors: metric.errors - start.errors, lastDurationMs: metric.lastDurationMs, lastStatus: metric.lastStatus };
    });
    this.baseline = Object.freeze({
      totals: Object.freeze(COMMAND_CHAT_DEBUG_ENDPOINTS.reduce((total, endpoint) => ({ attempts: total.attempts + endpoints[endpoint].attempts, errors: total.errors + endpoints[endpoint].errors, inFlight: total.inFlight + this.metrics[endpoint].inFlight }), { attempts: 0, errors: 0, inFlight: 0 })),
      endpoints: Object.freeze(records(endpoint => Object.freeze(endpoints[endpoint]))),
      durationMs: Math.max(0, this.now() - this.measurement.startedAt), mixedInFlight: this.measurement.mixedInFlight === true,
    });
    writeSafe(this.baselineStorage, this.baselineKey, this.baseline); this.flush();
  }
  // Reversible layout-effect lifecycle supports React StrictMode's setup/cleanup/setup.
  activate() { if (!this.retired && !this.active) { this.active = true; this.publish(); } }
  deactivate() {
    if (!this.active) return;
    this.active = false; this.cancelNotify?.(); this.cancelNotify = undefined; this.pending = false; this.publish();
  }
  dispose() { if (this.retired) return; this.retired = true; this.deactivate(); }
  /** Internal transport accounting: only fixed allowlisted metadata enters this store. */
  admit(endpoint: CommandChatDebugEndpoint): (status: "success" | "error" | "detached", error?: unknown) => void {
    const startedAt = this.now();
    const metric = this.metrics[endpoint];
    metric.attempts++; metric.inFlight++; this.changed();
    let finished = false;
    return (status, error) => {
      if (finished) return;
      finished = true; metric.inFlight = Math.max(0, metric.inFlight - 1);
      if (status !== "detached") {
        metric.lastDurationMs = Math.max(0, this.now() - startedAt);
        if (status === "error" && isCommandChatApiDebugSuppressed(error)) { metric.suppressed++; metric.lastStatus = "suppressed"; metric.lastErrorCode = null; metric.lastHttpStatus = null; }
        else if (status === "error") { const safe = safeError(error); metric.errors++; metric.lastStatus = "error"; metric.lastErrorCode = safe.code; metric.lastHttpStatus = safe.httpStatus; }
        else { metric.lastStatus = "success"; metric.lastSuccessAt = Date.now(); metric.lastErrorCode = null; metric.lastHttpStatus = null; }
      }
      this.changed();
    };
  }
  suppress(endpoint: CommandChatDebugEndpoint) {
    this.metrics[endpoint].suppressed++; this.metrics[endpoint].lastStatus = "suppressed"; this.metrics[endpoint].lastErrorCode = null; this.metrics[endpoint].lastHttpStatus = null; this.changed();
  }
}
export function createCommandChatApiDebugController(options: CommandChatApiDebugOptions) { return new CommandChatApiDebugController(options); }
const defaultController = createCommandChatApiDebugController({ eligible: false, agentId: null, storage: null, baselineStorage: null });
const DebugContext = createContext(defaultController);
export function CommandChatApiDebugProvider({ controller, children }: { controller: CommandChatApiDebugController; children: React.ReactNode }) {
  return <DebugContext.Provider value={controller}>{children}</DebugContext.Provider>;
}
export function useCommandChatApiDebug() {
  const controller = useContext(DebugContext);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getControlSnapshot, controller.getControlSnapshot);
  return { controller, snapshot };
}
export function useCommandChatApiDebugScope({ eligible, agentId }: Pick<CommandChatApiDebugOptions, "eligible" | "agentId">) {
  const controller = useMemo(() => createCommandChatApiDebugController({ eligible, agentId }), [eligible, agentId]);
  useLayoutEffect(() => { controller.activate(); return () => controller.deactivate(); }, [controller]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getControlSnapshot, controller.getControlSnapshot);
  return { controller, snapshot };
}

export function createCommandChatApiDebugLink(): TRPCLink<AppRouter> {
  return () => ({ op, next }) => {
    const controller = op.context.commandChatApiDebug;
    const endpoint = endpointOf(op.path);
    if (op.type !== "query" || !endpoint || !(controller instanceof CommandChatApiDebugController) || !controller.eligible) return next(op);
    // Check admission on subscription as well: a lazy observable may outlive a toggle.
    return observable(observer => {
      if (!controller.eligible) return next(op).subscribe(observer);
      if (!controller.isEnabled(endpoint)) {
        controller.suppress(endpoint);
        observer.error(new TRPCClientError<AppRouter>(COMMAND_CHAT_API_DEBUG_SUPPRESSED));
        return;
      }
      const finish = controller.admit(endpoint);
      let attached = true;
      try {
        next(op).subscribe({
          next(value) { finish("success"); if (attached) observer.next(value); },
          error(error) { finish("error", error); if (attached) observer.error(error); },
          complete() { finish("success"); if (attached) observer.complete(); },
        });
      } catch (error) {
        finish("error", error);
        observer.error(TRPCClientError.from<AppRouter>(error instanceof Error ? error : new Error("Unknown error")));
      }
      // Intentionally do NOT forward unsubscribe. Started backend work may finish naturally.
      // Keep detached operations in flight until a real terminal result arrives.
      return () => { attached = false; };
    });
  };
}
