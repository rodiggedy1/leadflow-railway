import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import type { AuditItem, AuditMessage, DailyActionAuditResult } from "../shared/dailyActionAudit";
import * as auditFailures from "../shared/dailyActionAudit";
import { BOOKING_WIDGET_PRICED_EXTRAS } from "../shared/bookingWidgetConfig";

// LOCAL ONLY: compile the actual UI source with explicit dependency mocks.
// No app/router imports, DB, provider, browser, network, LLM, or live customer data.
// The bounded hook driver checks source callbacks and cleanup, not React DOM lifecycle.
const root = resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");
const pageSource = read("client/src/pages/DailyActionAudit.tsx");
const calendarSource = read("client/src/components/daily-action-audit/AuditCalendar.tsx");
const icon = (props: any) => React.createElement("svg", props);
const icons = new Proxy({}, { get: () => icon });
const CalendarStub = (props: any) => React.createElement("button", { type: "button", "data-calendar": "approved", ...props }, "Message date");

function compile(source: string, react: any = React, trpc: any = {}, extra: Record<string, any> = {}) {
  const module = { exports: {} as any };
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
  } }).outputText;
  runInNewContext(output, {
    ...extra, module, exports: module.exports, Date, Intl, Error, Map, Set,
    require: (id: string) => {
      if (id === "react") return react;
      if (id === "lucide-react") return icons;
      if (id === "@/lib/trpc") return { trpc };
      if (id === "@shared/dailyActionAudit") return auditFailures;
      if (id === "@shared/bookingWidgetConfig") return { BOOKING_WIDGET_PRICED_EXTRAS };
      if (id === "@/components/daily-action-audit/AuditCalendar") return { __esModule: true, default: CalendarStub };
      if (id.endsWith(".css")) return {};
      throw new Error(`Unexpected actual UI import: ${id}`);
    },
  }, { timeout: 1500 });
  return module.exports;
}
const ui = compile(pageSource);
function message(direction: "inbound" | "outbound", overrides: Partial<AuditMessage> = {}): AuditMessage {
  return { key: direction, sessionId: 1, customerPhone: "+13015550123", businessPhone: "+13015550987", direction,
    text: direction === "inbound" ? "Please move my cleaning to Friday at 10." : "Confirmed, Friday at 10.",
    occurredAt: "2026-11-11T17:00:00Z", observedAt: "2026-11-11T17:01:00Z", timeBasis: "provider",
    delivery: direction === "inbound" ? "received" : "delivered", source: direction === "inbound" ? "inbound_sms" : "madison_sent", ...overrides };
}
function item(id: string, status: AuditItem["status"], overrides: Partial<AuditItem> = {}): AuditItem {
  return { id, action: "reschedule", agreement: "confirmed", status, customerPhone: "+13015550123", customerName: "Synthetic customer",
    affectedDate: "2026-11-13", expected: { bookingReference: "REF-1", date: "2026-11-13", originalDate: "2026-11-12", time: "10:00",
      timeKind: "exact", windowEnd: null, scope: "visit", address: "Synthetic street", serviceName: "Standard", extras: ["Oven"], teamName: "Team A", amountCents: 15000 },
    explanation: "The SMS requests a different service date.", verification: "The current booking is still on the original date.",
    evidence: [message("inbound"), message("outbound")],
    records: [{ key: "booking-1", source: "bookings", bookingId: 1, jobId: null, publicBookingNumber: "TEST-1", seriesId: null,
      customerPhone: "+13015550123", customerName: "Synthetic customer", date: "2026-11-12", time: "09:00", timeZone: "America/New_York", status: "scheduled",
      address: "Synthetic street", serviceName: "Standard", extras: [], teamName: "Team B", recurrence: "weekly", paymentStatus: "paid", paidAmountCents: 15000 }],
    recordLinks: [{ label: "Bookings", href: "/admin/bookings" }, { label: "Schedule", href: "/admin/schedule" }], verifiedAt: "2026-11-12T15:00:00Z", ...overrides };
}
function result(items: AuditItem[] = [], overrides: Partial<DailyActionAuditResult> = {}): DailyActionAuditResult {
  const totals: DailyActionAuditResult["totals"] = { needs_action: 0, conflict: 0, cannot_verify: 0, matches: 0, superseded: 0 };
  for (const entry of items) totals[entry.status]++;
  return { auditDate: "2026-11-11", timeZone: "America/New_York", asOf: "2026-11-12T15:00:00Z", items, totals,
    coverage: { status: "partial", messagesRead: 8, threadsRead: 3, threadsAnalyzed: 2, truncated: false, warnings: [] }, nextCursor: null, ...overrides };
}
const renderResults = (value: DailyActionAuditResult, filter = "all") => renderToStaticMarkup(React.createElement(ui.AuditResults, { result: value, filter }));
function elements(tree: any): any[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!React.isValidElement(tree)) return [];
  return [tree, ...elements((tree.props as any).children)];
}
const find = (tree: any, predicate: (node: any) => boolean) => elements(tree).find(predicate);
const text = (tree: any): string => typeof tree === "string" || typeof tree === "number" ? String(tree) : Array.isArray(tree) ? tree.map(text).join("") : React.isValidElement(tree) ? text((tree.props as any).children) : "";
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function driver(source: string, trpc: any = {}, extra: Record<string, any> = {}) {
  const slots: any[] = [];
  let cursor = 0;
  let jobs: Array<() => void> = [];
  let dead = false;
  let lateWrites = 0;
  const hooks = {
    ...React,
    useId: () => "local-calendar",
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value: any) => {
        if (dead) { lateWrites++; return; }
        slots[index] = typeof value === "function" ? value(slots[index]) : value;
      }];
    },
    useRef(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(effect: () => void | (() => void), deps: any[]) {
      const index = cursor++;
      const old = slots[index];
      if (!old || deps.length !== old.deps.length || deps.some((value, i) => !Object.is(value, old.deps[i]))) {
        slots[index] = { deps, cleanup: old?.cleanup };
        jobs.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); });
      }
    },
  };
  const loaded = compile(source, hooks, trpc, extra);
  return {
    loaded,
    render(name: string, props?: any) {
      cursor = 0;
      const tree = loaded[name](props);
      const pending = jobs; jobs = []; pending.forEach(run => run());
      return tree;
    },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); dead = true; jobs = []; },
    get lateWrites() { return lateWrites; },
  };
}
function workspace(handler: (input: any) => Promise<DailyActionAuditResult>) {
  const mutateAsync = vi.fn(handler);
  const reset = vi.fn();
  const useMutation = vi.fn(() => ({ mutateAsync, reset, isPending: false }));
  const harness = driver(`${pageSource}\nexports.AuditWorkspace = AuditWorkspace;`, { aiActions: { dailyAudit: { run: { useMutation } } } });
  const render = () => harness.render("AuditWorkspace");
  const change = (date: string) => {
    const tree = render();
    find(tree, node => node.props?.min === "1970-01-01").props.onChange(date);
  };
  const submit = () => find(render(), node => node.type === "form").props.onSubmit({ preventDefault: vi.fn() });
  const nextBatch = async () => {
    find(render(), node => node.type === "button" && text(node).includes("Review next batch")).props.onClick({ preventDefault: vi.fn() });
    for (let turn = 0; turn < 12; turn++) await Promise.resolve();
  };
  return { harness, render, change, submit, nextBatch, mutateAsync, reset, useMutation };
}

function parse(source: string) { return ts.createSourceFile("actual.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function all<T extends ts.Node>(node: ts.Node, guard: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  const visit = (child: ts.Node) => { if (guard(child)) found.push(child); ts.forEachChild(child, visit); };
  visit(node); return found;
}

describe("Daily Action Audit actual read-only UI", () => {
  it("SSR exposes all status counts and prioritizes unresolved people over matches across dates", () => {
    const html = renderResults(result([
      item("match", "matches", { customerName: "Synthetic match", customerPhone: "+13015550124", affectedDate: "2026-11-12" }),
      item("conflict", "conflict", { customerName: "Synthetic conflict", customerPhone: "+13015550125" }),
      item("needs", "needs_action", { customerName: "Synthetic needs", customerPhone: "+13015550126" }),
      item("unknown", "cannot_verify", { customerName: "Synthetic unknown", customerPhone: "+13015550127", affectedDate: null, expected: { ...item("base", "matches").expected, date: null } }),
      item("old", "superseded", { customerName: "Synthetic old", customerPhone: "+13015550128" }),
    ]));
    for (const status of ["needs_action", "conflict", "cannot_verify", "matches", "superseded"]) {
      expect(html).toContain(`data-status-count="${status}"><strong>1</strong>`);
    }
    expect(html.indexOf("Synthetic needs")).toBeLessThan(html.indexOf("Synthetic conflict"));
    expect(html.indexOf("Synthetic unknown")).toBeLessThan(html.indexOf("Synthetic match"));
    expect(html).toMatch(/Overall summary/i);
    expect(html).toMatch(/By person/i);
    expect(html).toMatch(/Date not available|date[^<]*(?:undated|unresolved)/i);
    expect(html).toContain("daa-person-summary");
    expect(html).not.toContain("daa-date-group");
  });

  it("keeps partial coverage and server warnings prominent, including all-matched and empty scans", () => {
    for (const entries of [[], [item("match", "matches")]]) {
      const html = renderResults(result(entries, { coverage: { status: "partial", messagesRead: 9, threadsRead: 3, threadsAnalyzed: 1, truncated: true, warnings: ["Synthetic source unavailable", "Synthetic analysis incomplete"] } }));
      expect(html).toContain("Partial coverage · not a complete reconciliation");
      expect(html).toContain("Synthetic source unavailable");
      expect(html).toContain("Synthetic analysis incomplete");
      expect(html).toContain("Scan truncated.");
      expect(html).toContain("9 messages read · 3 threads read · 1 threads analyzed");
      expect(html).toContain("Coverage remains partial");
      expect(html).not.toContain("All messages reviewed");
    }
    expect(renderResults(result())).toContain("An empty scan does not confirm");
  });

  it("shows expected versus actual, request versus confirmation, SMS directions and ET timestamps", () => {
    const html = renderResults(result([item("request", "needs_action", { agreement: "requested" }), item("confirmed", "matches")]));
    for (const label of ["Expected from SMS", "Actual system evidence", "current records", "Requested · not confirmed", "Confirmed in SMS", "Inbound · customer", "Outbound · business", "Provider timestamp", "Nov 11, 2026, 12:00 PM EST", "Current records checked at", "does not establish when an action", "Cited SMS only", "Team A", "Team B", "$150.00", "Paid amount"]) expect(html).toContain(label);
    expect(html).toContain("Message evidence cutoff");
    expect(html).not.toContain("completed yesterday");
    expect(html).toContain("<details");
  });

  it("makes missing record/evidence and malformed dates/timestamps obvious without Intl exceptions", () => {
    const html = renderResults(result([item("missing", "cannot_verify", { evidence: [], records: [], affectedDate: "invalid", verifiedAt: "not-a-date", expected: { ...item("base", "matches").expected, date: "2026-02-31" } }), item("bad-message", "cannot_verify", { evidence: [message("inbound", { occurredAt: "2026-11-11T10:00:00", observedAt: "invalid" })] })]));
    expect(html).toContain("No matching current record was available");
    expect(html).toContain("Source SMS evidence is missing");
    expect(html).toContain("Timestamp unavailable");
    expect(html).toContain("Date not available");
    expect(html).toContain("daa-person-summary");
  });

  it("filters tomorrow using Eastern Time at the fixed cutoff, not browser dates", () => {
    const value = result([item("ET-tomorrow", "needs_action", { customerName: "Synthetic ET-tomorrow", customerPhone: "+13015550124", affectedDate: "2026-11-12" }), item("UTC-tomorrow", "conflict", { customerName: "Synthetic UTC-tomorrow", customerPhone: "+13015550125", affectedDate: "2026-11-13" }), item("undated", "cannot_verify", { customerName: "Synthetic undated", customerPhone: "+13015550126", affectedDate: null })], { asOf: "2026-11-12T02:00:00Z" });
    const html = renderResults(value, "affectsTomorrow");
    expect(html).toContain("Synthetic ET-tomorrow");
    expect(html).not.toContain("Synthetic UTC-tomorrow");
    expect(html).not.toContain("Synthetic undated");
    expect(html).toContain("1 of 3 actions");
    expect(html).toContain("Undated items are excluded");
    expect(renderResults({ ...value, asOf: "invalid" }, "affectsTomorrow")).toContain("snapshot timestamp is invalid");
  });

  it("renders only server fixed local record links and never interprets source SMS as a link or HTML", () => {
    const entry = item("safe", "needs_action", { evidence: [message("inbound", { text: '<script>bad()</script> https://external.invalid/?phone=5550101234' })], recordLinks: [
      { label: "Bookings", href: "/admin/bookings" }, { label: "Schedule", href: "/admin/schedule" },
      ...["javascript:bad()", "//external.invalid", "https://external.invalid", "/admin/bookings?phone=5550101234", "/admin/bookings?jobId=1", "/admin/schedule#5550101234", "/admin/bookings/../settings"].map(href => ({ label: "Unsafe", href })),
    ] });
    const html = renderResults(result([entry]));
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
    expect(hrefs).toEqual(["/admin/bookings", "/admin/schedule"]);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<button");
    expect(html).not.toMatch(/>\s*(Fix|Send|Reschedule)\s*</i);
  });

  it("validates prior message days and business yesterday across midnight, DST, and leap dates", () => {
    expect(ui.previousBusinessDay(new Date("2026-11-12T02:00:00Z"))).toBe("2026-11-10");
    expect(ui.previousBusinessDay(new Date("2026-03-09T04:30:00Z"))).toBe("2026-03-08");
    expect(ui.easternDay(new Date("2026-11-01T05:30:00Z"))).toBe("2026-11-01");
    expect(ui.isValidAuditDate("2024-02-29")).toBe(true);
    for (const date of ["2026-02-29", "2026-02-31", "2026-13-01", "invalid", "1969-12-31"]) expect(ui.isValidAuditDate(date)).toBe(false);
    expect(ui.auditDateError("2026-11-11", new Date("2026-11-12T15:00:00Z"))).toBeNull();
    for (const date of ["", "2026-11-12", "2026-11-13", "bad"]) expect(ui.auditDateError(date, new Date("2026-11-12T15:00:00Z"))).toBeTruthy();
  });

  it("merges manual batches by item ID with newest duplicate, recounts statuses, sums coverage, and deduplicates warnings", () => {
    const previous = result([item("same", "matches"), item("first", "needs_action")], { coverage: { status: "partial", messagesRead: 5, threadsRead: 2, threadsAnalyzed: 1, truncated: true, warnings: ["Shared warning"] }, nextCursor: { sessionAfterId: 20, inboundAfterId: 100, asOf: "2026-11-12T15:00:00Z" } });
    const next = result([item("same", "conflict"), item("second", "cannot_verify")], { coverage: { status: "partial", messagesRead: 6, threadsRead: 2, threadsAnalyzed: 2, truncated: false, warnings: ["Shared warning", "Next warning"] } });
    const merged = ui.mergeAuditBatches(previous, next);
    expect(merged.items).toHaveLength(3);
    expect(merged.items.find((entry: AuditItem) => entry.id === "same").status).toBe("conflict");
    expect(merged.totals).toEqual({ matches: 0, needs_action: 1, conflict: 1, cannot_verify: 1, superseded: 0 });
    expect(merged.coverage).toEqual({ status: "partial", messagesRead: 11, threadsRead: 4, threadsAnalyzed: 3, truncated: true, warnings: ["Shared warning", "Next warning"] });
    expect(merged.nextCursor).toBeNull();
    expect(() => ui.mergeAuditBatches(previous, { ...next, asOf: "2026-11-12T16:00:00Z" })).toThrow();
    expect(() => ui.mergeAuditBatches(previous, { ...next, auditDate: "2026-11-10" })).toThrow();
  });

  it("guards admin access before mounting any audit hook, with retries and background auth refresh disabled", () => {
    const useMutation = vi.fn(() => ({ mutateAsync: vi.fn(), reset: vi.fn(), isPending: false }));
    for (const response of [{ isLoading: true }, { isLoading: false, error: new Error("SECRET") }, { isLoading: false, data: null }, { isLoading: false, data: { isAdmin: false } }]) {
      const useQuery = vi.fn(() => response);
      const local = compile(pageSource, React, { agents: { me: { useQuery } }, aiActions: { dailyAudit: { run: { useMutation } } } });
      const html = renderToStaticMarkup(React.createElement(local.default));
      expect(html).not.toContain("SECRET");
      expect(html).not.toContain("Run audit");
      expect(useMutation).not.toHaveBeenCalled();
      expect(useQuery.mock.calls[0][1]).toMatchObject({ retry: false, refetchInterval: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
    }
    const local = compile(pageSource, React, { agents: { me: { useQuery: () => ({ isLoading: false, data: { isAdmin: true } }) } }, aiActions: { dailyAudit: { run: { useMutation } } } });
    expect(renderToStaticMarkup(React.createElement(local.default))).toContain("Ready when you are");
    expect(useMutation).toHaveBeenCalledTimes(1);
  });

  it("runs only on explicit submit, sends date/timezone only, and rejects duplicate pending submits", async () => {
    const response = deferred<DailyActionAuditResult>();
    const work = workspace(() => response.promise);
    work.render();
    expect(work.mutateAsync).not.toHaveBeenCalled();
    work.change("2026-11-11");
    const promise = work.submit();
    expect(work.mutateAsync).toHaveBeenCalledWith({ auditDate: "2026-11-11", timeZone: "America/New_York" });
    expect(find(work.render(), node => node.type === "button" && text(node).includes("Running audit")).props.disabled).toBe(true);
    await work.submit();
    expect(work.mutateAsync).toHaveBeenCalledTimes(1);
    response.resolve(result([item("done", "matches")])); await promise;
    expect(find(work.render(), node => node.type === work.harness.loaded.AuditResults).props.result.items).toHaveLength(1);
    work.harness.dispose();
  });

  it("does not transport cleared, malformed, or future message dates", async () => {
    const work = workspace(async () => result());
    for (const date of ["", "2026-02-31", "2099-01-01"]) {
      work.change(date);
      await work.submit();
      expect(work.mutateAsync).not.toHaveBeenCalled();
      expect(find(work.render(), node => node.type === "button" && text(node).includes("Run audit")).props.disabled).toBe(true);
    }
    work.harness.dispose();
  });

  it("discards changed-date responses and clears results and cursor when the date changes", async () => {
    const response = deferred<DailyActionAuditResult>();
    const work = workspace(() => response.promise);
    work.change("2026-11-11");
    const promise = work.submit();
    work.change("2026-11-10");
    response.resolve(result([item("old", "matches")], { nextCursor: { sessionAfterId: 20, inboundAfterId: 100, asOf: "2026-11-12T15:00:00Z" } })); await promise;
    expect(find(work.render(), node => node.type === work.harness.loaded.AuditResults)).toBeUndefined();
    expect(text(work.render())).not.toContain("Review next batch");
    expect(text(work.render())).toContain("Ready when you are");
    work.change("");
    expect(text(work.render())).toContain("Choose a message date");
    expect(find(work.render(), node => node.type === "button" && text(node).includes("Run audit")).props.disabled).toBe(true);
    work.harness.dispose();
  });

  it("does not write or render responses after unmount", async () => {
    const response = deferred<DailyActionAuditResult>();
    const work = workspace(() => response.promise);
    work.change("2026-11-11");
    const promise = work.submit();
    work.harness.dispose();
    response.resolve(result([item("late", "matches")])); await promise;
    expect(work.harness.lateWrites).toBe(0);
  });

  it("clears old results on rerun errors without exposing raw error source text", async () => {
    let calls = 0;
    const work = workspace(async () => { if (++calls === 1) return result([item("old", "matches")]); throw new Error("SECRET CUSTOMER TEXT"); });
    work.change("2026-11-11"); await work.submit();
    expect(find(work.render(), node => node.type === work.harness.loaded.AuditResults)).toBeTruthy();
    await work.submit();
    const tree = work.render();
    expect(find(tree, node => node.type === work.harness.loaded.AuditResults)).toBeUndefined();
    const error = find(tree, node => node.type === work.harness.loaded.AuditRunError);
    expect(error).toBeTruthy();
    const html = renderToStaticMarkup(error);
    expect(html).toContain("No results are being shown");
    expect(html).not.toContain("SECRET CUSTOMER TEXT");
    work.harness.dispose();
  });

  it("renders exact safe message-read setup and record-field failures without blaming browser access or connection", async () => {
    for (const [stage, reason, detail] of [
      ["MESSAGE_READ", "DB_UNAVAILABLE", "The audit database connection is unavailable."],
      ["MESSAGE_READ", "DB_UNSUPPORTED", "The database rejected an unsupported operation."],
      ["RECORD_READ", "DB_SCHEMA", "A required audit table or field is unavailable."],
      ["RECORD_READ", "DB_TIMEOUT", "The database read timed out or its connection was interrupted."],
    ] as const) {
      const safeMessage = auditFailures.auditFailureMessage(stage, reason);
      const work = workspace(async () => { throw { message: safeMessage, data: { code: "INTERNAL_SERVER_ERROR" } }; });
      work.change("2026-11-11"); await work.submit();
      const tree = work.render();
      const error = find(tree, node => node.type === work.harness.loaded.AuditRunError);
      expect(error.props.safeMessage).toBe(safeMessage);
      const html = renderToStaticMarkup(error);
      expect(html).toContain(`[DAA:${stage}:${reason}]`);
      expect(html).toContain(stage === "MESSAGE_READ" ? "reading stored message evidence" : "reading current booking and job records");
      expect(html).toContain(detail);
      expect(html).toContain("No changes were made.");
      expect(html).toContain("No results are being shown.");
      expect(html).not.toContain("Check your access and connection");
      expect(find(tree, node => node.type === work.harness.loaded.AuditResults)).toBeUndefined();
      expect(text(tree)).not.toContain("Review next batch");
      work.harness.dispose();
    }
  });

  it("renders only the exact shared failure allowlist, retaining every stage/reason code", () => {
    for (const stage of Object.keys(auditFailures.AUDIT_FAILURE_STAGES) as auditFailures.AuditFailureStage[]) {
      for (const reason of Object.keys(auditFailures.AUDIT_FAILURE_REASONS) as auditFailures.AuditFailureReason[]) {
        const safeMessage = auditFailures.auditFailureMessage(stage, reason);
        const html = renderToStaticMarkup(React.createElement(ui.AuditRunError, { safeMessage }));
        expect(html).toContain(safeMessage);
        expect(html).toContain(`[DAA:${stage}:${reason}]`);
        expect(html).not.toContain("Check your access and connection");
      }
    }
  });

  it("never reflects unknown, prefixed, appended, altered-code, or non-string transport errors", async () => {
    const safeMessage = auditFailures.auditFailureMessage("MESSAGE_READ", "DB_SCHEMA");
    const unsafeMessages = [
      "SECRET SQL customer phone +15550101234",
      `${safeMessage} SECRET SQL customer phone +15550101234`,
      `SECRET ${safeMessage}`,
      "[DAA:MESSAGE_READ:DB_SCHEMA] SECRET SQL",
      safeMessage.replace("MESSAGE_READ", "message_read"),
      safeMessage.replace("DB_SCHEMA", "DB_UNKNOWN"),
      `${safeMessage}\n`,
    ];
    for (const failure of [
      ...unsafeMessages.map(message => ({ message })),
      { message: "SECRET", data: { code: "UNAUTHORIZED" } },
      { message: "SECRET", data: { code: "FORBIDDEN" } },
      { message: { secret: "SECRET" } }, null, undefined, 123, safeMessage,
    ]) {
      const work = workspace(async () => { throw failure; });
      work.change("2026-11-11"); await work.submit();
      const error = find(work.render(), node => node.type === work.harness.loaded.AuditRunError);
      expect(error.props.safeMessage).toBeUndefined();
      const html = renderToStaticMarkup(error);
      expect(html).toContain("No results are being shown. Check your access and connection");
      expect(html).not.toContain("SECRET");
      expect(html).not.toContain("+15550101234");
      expect(html).not.toContain("[DAA:");
      work.harness.dispose();
    }
    for (const safeMessage of unsafeMessages) {
      const html = renderToStaticMarkup(React.createElement(ui.AuditRunError, { safeMessage }));
      expect(html).toContain("Check your access and connection");
      expect(html).not.toContain("SECRET");
      expect(html).not.toContain("[DAA:");
    }
  });

  it("clears stored safe failures on rerun, date changes, and discarded stale failures", async () => {
    const responses = Array.from({ length: 5 }, () => deferred<DailyActionAuditResult>());
    let calls = 0;
    const work = workspace(() => responses[calls++].promise);
    const safeMessage = auditFailures.auditFailureMessage("RECORD_READ", "DB_SCHEMA");
    const error = () => find(work.render(), node => node.type === work.harness.loaded.AuditRunError);
    work.change("2026-11-11");
    let promise = work.submit();
    responses[0].reject(new Error(safeMessage)); await promise;
    expect(error().props.safeMessage).toBe(safeMessage);

    promise = work.submit();
    expect(error()).toBeUndefined();
    expect(text(work.render())).toContain("Running audit");
    responses[1].reject(new Error("SECRET")); await promise;
    expect(error().props.safeMessage).toBeUndefined();
    expect(renderToStaticMarkup(error())).not.toContain("[DAA:");

    promise = work.submit();
    responses[2].reject(new Error(safeMessage)); await promise;
    expect(error().props.safeMessage).toBe(safeMessage);
    work.change("2026-11-10");
    expect(error()).toBeUndefined();
    expect(text(work.render())).toContain("Ready when you are");
    promise = work.submit();
    work.change("2026-11-09");
    responses[3].reject(new Error(safeMessage)); await promise;
    expect(error()).toBeUndefined();
    expect(text(work.render())).toContain("Ready when you are");
    expect(find(work.render(), node => node.type === work.harness.loaded.AuditResults)).toBeUndefined();
    expect(text(work.render())).not.toContain("Review next batch");

    promise = work.submit();
    responses[4].resolve(result()); await promise;
    expect(error().props.safeMessage).toBeUndefined();
    expect(renderToStaticMarkup(error())).not.toContain("[DAA:");
    expect(work.reset).toHaveBeenCalled();
    work.harness.dispose();
  });

  it("does not write safe failures after unmount", async () => {
    const response = deferred<DailyActionAuditResult>();
    const work = workspace(() => response.promise);
    work.change("2026-11-11");
    const promise = work.submit();
    work.harness.dispose();
    response.reject(new Error(auditFailures.auditFailureMessage("MESSAGE_READ", "DB_TIMEOUT"))); await promise;
    expect(work.harness.lateWrites).toBe(0);
  });

  it("reviews the next batch only on click with cursor, then merges and stops without looping", async () => {
    let calls = 0;
    const cursor = { sessionAfterId: 20, inboundAfterId: 100, asOf: "2026-11-12T15:00:00Z" };
    const work = workspace(async () => ++calls === 1 ? result([item("first", "matches")], { nextCursor: cursor }) : result([item("second", "needs_action")]));
    work.change("2026-11-11"); await work.submit();
    work.render(); work.render();
    expect(calls).toBe(1);
    expect(text(work.render())).toContain("Review next batch");
    await work.nextBatch();
    expect(work.mutateAsync.mock.calls[1][0]).toEqual({ auditDate: "2026-11-11", timeZone: "America/New_York", cursor });
    const final = find(work.render(), node => node.type === work.harness.loaded.AuditResults).props.result;
    expect(final.items).toHaveLength(2);
    expect(final.nextCursor).toBeNull();
    expect(text(work.render())).not.toContain("Review next batch");
    expect(calls).toBe(2);
    work.harness.dispose();
  });

  it("clears matches and shows a next-batch failure on continuation errors or stale cutoffs", async () => {
    const safeMessage = auditFailures.auditFailureMessage("RECORD_READ", "DB_READ_FAILED");
    for (const mode of ["error", "safe-error", "stale"]) {
      let calls = 0;
      const work = workspace(async () => {
        if (++calls === 1) return result([item("old-match", "matches")], { nextCursor: { sessionAfterId: 20, inboundAfterId: 100, asOf: "2026-11-12T15:00:00Z" } });
        if (mode === "error") throw new Error("SECRET");
        if (mode === "safe-error") throw new Error(safeMessage);
        return result([item("stale", "matches")], { asOf: "2026-11-12T16:00:00Z" });
      });
      work.change("2026-11-11"); await work.submit(); await work.nextBatch();
      const tree = work.render();
      expect(find(tree, node => node.type === work.harness.loaded.AuditResults)).toBeUndefined();
      const error = find(tree, node => node.type === work.harness.loaded.AuditRunError);
      const html = renderToStaticMarkup(error);
      expect(html).toContain("Next evidence batch could not be completed");
      expect(error.props.safeMessage).toBe(mode === "safe-error" ? safeMessage : undefined);
      expect(html).not.toContain("SECRET");
      expect(text(tree)).not.toContain("Review next batch");
      work.harness.dispose();
    }
  });

  it("contains only the approved calendar and no native date picker or background/customer transports", () => {
    const combined = pageSource + calendarSource;
    for (const file of [parse(pageSource), parse(calendarSource)]) {
      const attributes = all(file, ts.isJsxAttribute).filter(node => node.name.getText(file) === "type");
      expect(attributes.some(node => node.initializer?.getText(file) === '"date"' || node.initializer?.getText(file) === "'date'")).toBe(false);
    }
    for (const forbidden of ["showPicker", "setInterval", "setTimeout", "EventSource", "WebSocket", "localStorage", "sessionStorage", "fetch(", "useCustomers", "download", "cleaner" + "_jobs", "cleaner" + "Jobs"]) expect(combined).not.toContain(forbidden);
    const calls = all(parse(pageSource), ts.isCallExpression).map(node => node.expression.getText());
    expect(calls.filter(call => call.endsWith(".useQuery"))).toEqual(["trpc.agents.me.useQuery"]);
    expect(calls.filter(call => call.endsWith(".useMutation"))).toEqual(["trpc.aiActions.dailyAudit.run.useMutation"]);
    expect(calls.filter(call => call.endsWith(".mutateAsync"))).toEqual(["run.mutateAsync"]);
    expect(pageSource).toContain('min={MIN_DATE}');
    expect(calendarSource).toContain('aria-label="Message date"');
    expect(calendarSource).toContain('aria-haspopup="dialog"');
    expect(calendarSource).toContain("document.removeEventListener('pointerdown', outside)");
    expect(calendarSource).toContain("document.removeEventListener('keydown', escape)");
  });
});

class LocalNode {
  focus = vi.fn();
  contains(node: any) { return node === this; }
}
function calendar(value = "2026-11-11", min = "1970-01-01") {
  const listeners = new Map<string, Set<(event: any) => void>>();
  const document = {
    addEventListener(name: string, callback: (event: any) => void) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(callback); },
    removeEventListener(name: string, callback: (event: any) => void) { listeners.get(name)?.delete(callback); },
  };
  const onChange = vi.fn((next: string) => { value = next; });
  const harness = driver(calendarSource, {}, { document, Node: LocalNode });
  const trigger = new LocalNode();
  function render() {
    const tree = harness.render("default", { value, min, onChange });
    find(tree, node => node.props?.className === "br-calendar-trigger").props.ref.current = trigger;
    const rootElement = find(tree, node => node.props?.className === "br-calendar");
    rootElement.props.ref.current = new LocalNode();
    for (const node of elements(tree).filter(node => node.props?.className?.startsWith("br-calendar-day"))) node.props.ref(new LocalNode());
    return tree;
  }
  const open = () => find(render(), node => node.props?.className === "br-calendar-trigger").props.onClick();
  return { harness, render, open, trigger, onChange, listeners, fire: (name: string, event: any) => listeners.get(name)?.forEach(callback => callback(event)) };
}

describe("isolated approved audit calendar actual interactions", () => {
  it("opens from the full field, disables dates/months below min, and selects with focus return", () => {
    const cal = calendar("2026-11-11", "2026-11-10");
    expect(renderToStaticMarkup(cal.render())).toContain("Message date");
    cal.open();
    let tree = cal.render();
    expect(find(tree, node => node.props?.role === "dialog")).toBeTruthy();
    expect(find(tree, node => node.props?.["aria-label"] === "Previous month").props.disabled).toBe(true);
    expect(find(tree, node => node.props?.["aria-label"] === "Monday, November 9, 2026").props.disabled).toBe(true);
    find(tree, node => node.props?.["aria-label"] === "Thursday, November 12, 2026").props.onClick();
    tree = cal.render();
    expect(cal.onChange).toHaveBeenCalledWith("2026-11-12");
    expect(find(tree, node => node.props?.role === "dialog")).toBeUndefined();
    expect(cal.trigger.focus).toHaveBeenCalled();
    cal.harness.dispose();
  });

  it("supports clear/reselect, keyboard navigation, month boundaries, Escape, and listener cleanup", () => {
    const cal = calendar("2026-12-31", "2026-11-10");
    const trigger = find(cal.render(), node => node.props?.className === "br-calendar-trigger");
    trigger.props.onKeyDown({ key: "ArrowDown", preventDefault: vi.fn() });
    let tree = cal.render();
    const selected = find(tree, node => node.props?.["aria-label"] === "Thursday, December 31, 2026");
    expect(selected.props["aria-pressed"]).toBe(true);
    selected.props.onKeyDown({ key: "ArrowRight", preventDefault: vi.fn() });
    tree = cal.render();
    expect(text(tree)).toContain("January 2027");
    expect(find(tree, node => node.props?.["aria-label"] === "Friday, January 1, 2027").props.tabIndex).toBe(0);
    cal.fire("keydown", { key: "Escape", preventDefault: vi.fn() });
    expect(find(cal.render(), node => node.props?.role === "dialog")).toBeUndefined();
    expect([...cal.listeners.values()].reduce((n, callbacks) => n + callbacks.size, 0)).toBe(0);
    cal.open(); tree = cal.render();
    find(tree, node => node.props?.className === "br-calendar-clear").props.onClick();
    expect(cal.onChange).toHaveBeenCalledWith("");
    cal.open(); tree = cal.render();
    expect(text(tree)).toContain("November 2026");
    find(tree, node => node.props?.["aria-label"] === "Wednesday, November 11, 2026").props.onClick();
    expect(cal.onChange).toHaveBeenCalledWith("2026-11-11");
    cal.harness.dispose();
    expect([...cal.listeners.values()].reduce((n, callbacks) => n + callbacks.size, 0)).toBe(0);
  });

  it("retains arrow/week/month keyboard controls, navigation arrows, Done and focus-leave closure", () => {
    const cal = calendar("2026-11-11", "2026-11-10");
    cal.open();
    function move(label: string, key: string) {
      const current = find(cal.render(), node => node.props?.["aria-label"] === label);
      current.props.onKeyDown({ key, preventDefault: vi.fn() });
    }
    function active(label: string) {
      expect(find(cal.render(), node => node.props?.["aria-label"] === label).props.tabIndex).toBe(0);
    }
    move("Wednesday, November 11, 2026", "Home"); active("Tuesday, November 10, 2026");
    move("Tuesday, November 10, 2026", "End"); active("Saturday, November 14, 2026");
    move("Saturday, November 14, 2026", "ArrowUp"); active("Tuesday, November 10, 2026");
    move("Tuesday, November 10, 2026", "ArrowDown"); active("Tuesday, November 17, 2026");
    move("Tuesday, November 17, 2026", "ArrowLeft"); active("Monday, November 16, 2026");
    move("Monday, November 16, 2026", "PageDown"); active("Wednesday, December 16, 2026");
    move("Wednesday, December 16, 2026", "PageUp"); active("Monday, November 16, 2026");
    find(cal.render(), node => node.props?.["aria-label"] === "Next month").props.onClick();
    expect(text(cal.render())).toContain("December 2026");
    find(cal.render(), node => node.props?.["aria-label"] === "Previous month").props.onClick();
    expect(text(cal.render())).toContain("November 2026");
    find(cal.render(), node => node.props?.className === "br-calendar-done").props.onClick();
    expect(find(cal.render(), node => node.props?.role === "dialog")).toBeUndefined();
    cal.open();
    find(cal.render(), node => node.props?.className === "br-calendar").props.onBlur({ relatedTarget: new LocalNode(), currentTarget: new LocalNode() });
    expect(find(cal.render(), node => node.props?.role === "dialog")).toBeUndefined();
    cal.harness.dispose();
  });

  it("allows approved future selection but boundary validation rejects today/future before transport", () => {
    const cal = calendar("2026-11-11");
    cal.open(); const tree = cal.render();
    const future = find(tree, node => node.props?.["aria-label"] === "Sunday, November 15, 2026");
    expect(future.props.disabled).toBe(false);
    future.props.onClick();
    expect(ui.auditDateError(cal.onChange.mock.calls[0][0], new Date("2026-11-12T15:00:00Z"))).toContain("previous day");
    cal.harness.dispose();
  });

  it("closes outside without stealing focus and cleans listeners on unmount", () => {
    const cal = calendar();
    cal.open(); cal.render();
    const outside = new LocalNode();
    cal.fire("pointerdown", { target: outside });
    expect(find(cal.render(), node => node.props?.role === "dialog")).toBeUndefined();
    expect(cal.trigger.focus).not.toHaveBeenCalled();
    cal.open(); cal.render();
    cal.harness.dispose();
    expect([...cal.listeners.values()].reduce((n, callbacks) => n + callbacks.size, 0)).toBe(0);
  });
});
