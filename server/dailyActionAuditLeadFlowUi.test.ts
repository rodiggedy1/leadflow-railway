import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import type { AuditAnalysis, AuditItem, AuditMessage, AuditStatus, DailyActionAuditResult } from "../shared/dailyActionAudit";
import * as auditContract from "../shared/dailyActionAudit";
import { BOOKING_WIDGET_PRICED_EXTRAS } from "../shared/bookingWidgetConfig";

// LOCAL ONLY: actual UI source, isolated imports, synthetic evidence. No router,
// database, provider, model, live application, browser, or network execution.
const source = readFileSync(resolve(import.meta.dirname, "../client/src/pages/DailyActionAudit.tsx"), "utf8");
const PHONE = "+13015550123";
const clock = class extends Date {
  constructor(value?: string | number) { super(value ?? "2026-11-13T15:00:00Z"); }
  static now() { return Date.parse("2026-11-13T15:00:00Z"); }
} as typeof Date;
const icon = (props: any) => React.createElement("svg", props);
const icons = new Proxy({}, { get: () => icon });
const Calendar = (props: any) => React.createElement("button", { type: "button", ...props }, "Approved message date");
function load(react: any = React, trpc: any = {}, log = vi.fn()) {
  const module = { exports: {} as any };
  const output = ts.transpileModule(`${source}\nexports.AuditWorkspace = AuditWorkspace;`, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
  } }).outputText;
  runInNewContext(output, {
    module, exports: module.exports, Date: clock, Intl, Error, Map, Set,
    console: { log, warn: log, error: log },
    require: (id: string) => {
      if (id === "react") return react;
      if (id === "lucide-react") return icons;
      if (id === "@/lib/trpc") return { trpc };
      if (id === "@shared/dailyActionAudit") return auditContract;
      if (id === "@shared/bookingWidgetConfig") return { BOOKING_WIDGET_PRICED_EXTRAS };
      if (id === "@/components/daily-action-audit/AuditCalendar") return { __esModule: true, default: Calendar };
      if (id.endsWith(".css")) return {};
      throw new Error(`Unexpected actual LeadFlow UI import: ${id}`);
    },
  }, { timeout: 1500 });
  return module.exports;
}
const ui = load();
function message(key = "captured-in", change: Partial<AuditMessage> = {}): AuditMessage {
  return { key, sessionId: 1, customerPhone: PHONE, businessPhone: null, direction: "inbound",
    text: "Please move tomorrow's cleaning from 9am to 11am.", occurredAt: "2026-11-11T17:00:00Z",
    observedAt: "2026-11-11T17:01:00Z", timeBasis: "history", delivery: "received", source: "conversation_history", ...change };
}
function item(id = "captured-move", change: Partial<AuditItem> = {}): AuditItem {
  return { id, action: "reschedule", agreement: "confirmed", status: "needs_action", customerPhone: PHONE,
    customerName: "Synthetic customer", affectedDate: "2026-11-13",
    expected: { bookingReference: null, date: "2026-11-13", originalDate: null, time: "11:00", timeKind: "exact",
      windowEnd: null, scope: "visit", address: null, serviceName: null, extras: null, extrasMode: "unspecified", teamName: null, amountCents: null },
    explanation: "The captured customer request asks for 11am.", verification: "The current record still shows 9am, not the requested 11am.",
    evidence: [message(), message("captured-out", { direction: "outbound", delivery: "unknown", text: "Sure, confirmed at 11am." })],
    records: [{ key: "synthetic-booking", source: "bookings", bookingId: 1, jobId: null, publicBookingNumber: "TEST-1", seriesId: null,
      customerPhone: PHONE, customerName: "Synthetic customer", date: "2026-11-13", time: "09:00", timeZone: "America/New_York",
      status: "scheduled", address: null, serviceName: "Standard", extras: [], teamName: null, recurrence: null, paymentStatus: null, paidAmountCents: null }],
    recordLinks: [{ label: "Bookings", href: "/admin/bookings" }], verifiedAt: "2026-11-12T15:00:00Z", evidenceBasis: "captured",
    evidenceWarnings: ["Outbound assistant text has no actual sent evidence; it is not confirmation proof."], ...change };
}
function analysis(change: Partial<AuditAnalysis> = {}): AuditAnalysis {
  return { status: "complete", threadsTotal: 2, threadsAnalyzed: 2, failedThreads: 0, omittedMessages: 0, unsupportedMessages: 0, ...change };
}
function result(items: AuditItem[] = [item()], change: Partial<DailyActionAuditResult> = {}): DailyActionAuditResult {
  const totals: Record<AuditStatus, number> = { needs_action: 0, conflict: 0, cannot_verify: 0, matches: 0, superseded: 0 };
  for (const entry of items) totals[entry.status]++;
  return { auditDate: "2026-11-11", timeZone: "America/New_York", asOf: "2026-11-12T15:00:00Z", items, totals,
    localSource: { status: "captured", sessionsRead: 90, inboundRead: 8, messagesRead: 57, threadsRead: 2, providerRequests: 0 },
    coverage: { status: "partial", messagesRead: 57, threadsRead: 2, threadsAnalyzed: 2, truncated: false, warnings: [] },
    analysis: analysis(), nextCursor: null, ...change };
}
const htmlFor = (value: DailyActionAuditResult, filter = "all", loaded = ui) => renderToStaticMarkup(React.createElement(loaded.AuditResults, { result: value, filter }));
type Node = { type: string; props: any; children: Node[]; text: string };
function nodes(value: any): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (typeof value === "string" || typeof value === "number") return [{ type: "#text", props: {}, children: [], text: String(value) }];
  if (!React.isValidElement(value)) return [];
  const props = value.props as any;
  if (typeof value.type === "function") return nodes((value.type as any)(props));
  if (typeof value.type !== "string") return nodes(props.children);
  const children = nodes(props.children);
  return [{ type: value.type, props, children, text: children.map(child => child.text).join("") }];
}
const flatten = (values: Node[]): Node[] => values.flatMap(node => [node, ...flatten(node.children)]);
const hasClass = (node: Node, name: string) => String(node.props.className ?? "").split(/\s+/).includes(name);
const treeFor = (value: DailyActionAuditResult) => flatten(nodes(React.createElement(ui.AuditResults, { result: value })));
const withoutDetails = (node: Node): string => node.type === "details" ? "" : node.type === "#text" ? node.text : node.children.map(withoutDetails).join("");

function elements(value: any): any[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!React.isValidElement(value)) return [];
  return [value, ...elements((value.props as any).children)];
}
const text = (value: any): string => typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(text).join("") : React.isValidElement(value) ? text((value.props as any).children) : "";
const find = (value: any, match: (value: any) => boolean) => elements(value).find(match);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function workspace(handler: (input: any) => Promise<DailyActionAuditResult>) {
  const slots: any[] = [];
  let cursor = 0;
  let effects: Array<() => void> = [];
  let dead = false;
  let lateWrites = 0;
  const log = vi.fn();
  const hooks = {
    ...React,
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
        effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); });
      }
    },
  };
  const mutateAsync = vi.fn(handler);
  const reset = vi.fn();
  const useMutation = vi.fn((_options: unknown) => ({ mutateAsync, reset, isPending: false }));
  const loaded = load(hooks, { aiActions: { dailyAudit: { run: { useMutation } } } }, log);
  const render = () => {
    cursor = 0;
    const tree = loaded.AuditWorkspace();
    const pending = effects; effects = []; pending.forEach(run => run());
    return tree;
  };
  const change = (date: string) => find(render(), node => node.props?.min === "1970-01-01").props.onChange(date);
  const submit = () => find(render(), node => node.type === "form").props.onSubmit({ preventDefault: vi.fn() });
  const value = () => find(render(), node => node.type === loaded.AuditResults)?.props.result;
  const dispose = () => { slots.forEach(slot => slot?.cleanup?.()); dead = true; };
  return { loaded, render, change, submit, value, dispose, mutateAsync, reset, useMutation, log, lateWrites: () => lateWrites };
}

describe("Daily Action Audit LeadFlow captured actual-source UI", () => {
  it("shows captured source counts without mistaking sessions or action people for captured people", () => {
    const value = result();
    const html = htmlFor(value);
    expect(html).toContain("LeadFlow captured conversations · 57 messages · 2 people · No Quo message download");
    expect(html).toContain("Saved records may have gaps; this is not provider-wide complete coverage.");
    expect(html).not.toContain("90 people");
    expect(html).toContain("90 saved sessions read · 8 inbound records read · 2 captured people");
    expect(html).toContain("Sessions are not people");
    expect(html).toContain('<strong>1</strong><span>People with actions</span>');
    expect(html).toContain("Action analysis complete · captured conversations");
    expect(html).not.toContain("SMS collection completeness not established");
    expect(html).not.toContain("Day’s SMS");
    expect(html).not.toContain("SMS collection complete");
    expect(value.collection).toBeUndefined();
    expect(value.localSource?.providerRequests).toBe(0);
  });

  it("keeps summaries and compact people before closed diagnostic details without a provider corpus", () => {
    const tree = treeFor(result());
    const overview = tree.find(node => hasClass(node, "daa-overview"))!;
    const person = tree.find(node => hasClass(node, "daa-person"))!;
    const coverage = tree.find(node => hasClass(node, "daa-coverage-details"))!;
    expect(tree.indexOf(overview)).toBeLessThan(tree.indexOf(person));
    expect(tree.indexOf(person)).toBeLessThan(tree.indexOf(coverage));
    for (const detail of tree.filter(node => node.type === "details")) expect(detail.props.open).toBeUndefined();
    expect(tree.filter(node => hasClass(node, "daa-person"))).toHaveLength(1);
    expect(tree.filter(node => hasClass(node, "daa-day-sms"))).toHaveLength(0);
    expect(person.children[0].type).toBe("summary");
    expect(person.children[0].text).toContain("11:00");
  });

  it("shows the 9am current record versus 11am captured request and warnings directly inside the person", () => {
    const tree = treeFor(result());
    const body = tree.find(node => hasClass(node, "daa-person-body"))!;
    const visible = withoutDetails(body);
    for (const label of ["Captured request", "confirmation not verified", "Arrival: 11:00", "Arrival: 09:00", "Actual service date:", "not the requested 11am", "Outbound assistant text has no actual sent evidence", "Current records checked at"]) expect(visible).toContain(label);
    expect(visible).not.toContain("Confirmed in SMS");
    expect(tree.find(node => hasClass(node, "daa-evidence-warnings"))?.props["aria-label"]).toBe("Captured evidence warnings");
    expect(htmlFor(result())).toContain("Cited captured messages only");
  });

  it("retains partial chunk findings even when no whole captured thread succeeded", () => {
    const html = htmlFor(result([item()], { analysis: analysis({ status: "partial", threadsAnalyzed: 0, failedThreads: 1, omittedMessages: 2 }) }));
    expect(html).toContain("Partial action analysis · returned findings only");
    expect(html).toContain("0 of 2 captured threads analyzed · 1 failed · 2 omitted messages");
    expect(html).toContain("Successfully processed findings are retained");
    expect(html).toContain("Unanalyzed captured messages may still contain actions");
    expect(html).toContain("Overall summary");
    expect(html).toContain('data-audit-status="needs_action"');
    expect(html).not.toContain("No actionable items");
    expect(html).not.toContain("Action analysis complete");
  });

  it("shows bounded partial capture and valid actions without claiming full capture or full analysis", () => {
    const base = result();
    const html = htmlFor({ ...base, localSource: { ...base.localSource!, status: "partial" }, coverage: { ...base.coverage, truncated: true, warnings: ["Synthetic bounded capture gap"] } });
    expect(html).toContain("Partial saved-record read");
    expect(html).toContain("Partial action analysis");
    expect(html).toContain('data-audit-status="needs_action"');
    expect(html).toContain("Synthetic bounded capture gap");
    expect(html).toContain("Scan truncated.");
    expect(html).not.toContain("Action analysis complete");
  });

  it("loaded captured messages with failed, missing, not-run, or zero-usable analysis are not zero-action findings", () => {
    for (const state of [undefined, analysis({ status: "failed", threadsAnalyzed: 0, failedThreads: 2 }), analysis({ status: "not_run", threadsAnalyzed: 0 }), analysis({ status: "partial", threadsAnalyzed: 0 }), analysis({ status: "complete", threadsAnalyzed: 0 })]) {
      const html = htmlFor(result([], { analysis: state }));
      expect(html).toContain("Captured messages loaded; analysis unavailable");
      expect(html).toContain("No action finding or zero-action conclusion is available");
      expect(html).not.toContain("Overall summary");
      expect(html).not.toContain("No actionable items");
      expect(html).not.toContain('data-status-count=');
      expect(html).toContain("57 messages · 2 people");
    }
    expect(htmlFor(result([], { analysis: analysis({ status: "failed", threadsAnalyzed: 0 }) }))).toContain("Analysis failed.");
  });

  it("explicit analysis failure hides inconsistent stale items instead of surfacing matches", () => {
    const html = htmlFor(result([item("stale", { status: "matches" })], { analysis: analysis({ status: "failed", threadsAnalyzed: 2 }) }));
    expect(html).toContain("analysis unavailable");
    expect(html).not.toContain("Overall summary");
    expect(html).not.toContain('data-audit-status="matches"');
    expect(html).not.toContain("No actionable items");
  });

  it("valid complete and partial empty analyses keep their captured-only caveat", () => {
    for (const state of [analysis(), analysis({ status: "partial", threadsAnalyzed: 1, failedThreads: 1 })]) {
      const html = htmlFor(result([], { analysis: state }));
      expect(html).toContain("Overall summary");
      expect(html).toContain("An empty scan does not confirm that every customer agreement was fulfilled");
      expect(html).not.toContain("No actionable items found in analyzed SMS");
      if (state.status === "partial") {
        expect(html).toContain("No actionable items returned from analyzed threads");
        expect(html).toContain("unanalyzed captured messages may contain actions");
      } else expect(html).toContain("No actionable items found in analyzed captured conversations");
    }
  });

  it("never labels captured assistant history as an SMS confirmation or sent receipt", () => {
    for (const outbound of [
      message("out", { direction: "outbound", delivery: "unknown" }),
      message("out", { direction: "outbound", delivery: "sent", source: "conversation_history" }),
      message("out", { direction: "outbound", delivery: "unknown", source: "madison_sent" }),
    ]) {
      const html = htmlFor(result([item("unverified", { evidence: [message(), outbound], evidenceWarnings: [] })]));
      expect(html).toContain("Captured request · confirmation not verified");
      expect(html).toContain("Outbound · captured business text");
      expect(html).toContain("Sent status unverified");
      expect(html).toContain("Captured outbound text · not proof of sending");
      expect(html).not.toContain("Confirmed in SMS");
      expect(html).not.toContain("Madison sent SMS");
    }
  });

  it("actual sent receipts preserve agreement labels but do not establish historical completion", () => {
    for (const receipt of [
      message("receipt", { direction: "outbound", delivery: "sent", source: "madison_sent" }),
      message("receipt", { direction: "outbound", delivery: "delivered", source: "provider", timeBasis: "provider" }),
    ]) {
      const html = htmlFor(result([item("verified", { status: "matches", evidence: [message(), receipt], evidenceWarnings: [] })]));
      expect(html).toContain("Confirmed in SMS");
      expect(html).toContain("Matches now");
      expect(html).toContain("A match now does not establish when an action happened");
      expect(html).not.toContain("Captured request · confirmation not verified");
      expect(html).not.toMatch(/>\s*(Done|Completed|All done)\s*</i);
      expect(html).not.toContain("completed yesterday");
    }
  });

  it("supports mixed captured and provider-verified items without upgrading other requests", () => {
    const captured = item();
    const verified = item("provider", { evidenceBasis: "provider", status: "matches", affectedDate: "2026-11-20", evidenceWarnings: [],
      evidence: [message("receipt", { direction: "outbound", delivery: "delivered", source: "provider", timeBasis: "provider" })] });
    const html = htmlFor(result([captured, verified]));
    expect(html).toContain("Captured request · confirmation not verified");
    expect(html).toContain("Confirmed in SMS");
    expect(html).toContain("Verified SMS provider evidence");
    expect(html).toContain('data-status-count="matches"><strong>1</strong>');
    expect(html).toContain('data-status-count="needs_action"><strong>1</strong>');
    expect(html).not.toContain("SMS collection complete");
    expect(html).not.toContain("completed yesterday");
  });

  it("local-source optional item metadata can be absent without claiming SMS confirmation", () => {
    const html = htmlFor(result([item("optional", { evidenceBasis: undefined, evidenceWarnings: undefined })]));
    expect(html).toContain("Captured request");
    expect(html).not.toContain("Confirmed in SMS");
    expect(html).not.toContain("undefined");
  });

  it("preserves full-result name conflicts, status, source counts and summary when tomorrow filters actions", () => {
    const value = result([item("tomorrow", { status: "matches", customerName: "Synthetic Alpha" }), item("later", { customerName: "Synthetic Beta", affectedDate: "2026-11-20" })]);
    const before = JSON.stringify(value);
    const html = htmlFor(value, "affectsTomorrow");
    const row = html.match(/<summary class="daa-person-summary">([\s\S]*?)<\/summary>/)?.[1];
    expect(row).toContain("Name needs review");
    expect(row).toContain("Matches now");
    expect(row).toContain("1 action");
    expect(row).not.toContain("Synthetic Alpha");
    expect(row).not.toContain("Synthetic Beta");
    expect(html).toContain("Different names appear for this phone");
    expect(html).toContain("1 of 2 actions");
    expect(html).toContain("57 messages · 2 people");
    expect(html).toContain('data-status-count="needs_action"><strong>1</strong>');
    expect(html).not.toContain('data-audit-status="needs_action"');
    expect(JSON.stringify(value)).toBe(before);
  });

  it("an out-of-filter result says no dated actions, not no actions for the day", () => {
    const html = htmlFor(result([item("later", { affectedDate: "2026-11-20" }), item("undated", { affectedDate: null })]), "affectsTomorrow");
    expect(html).toContain("No dated actions affect tomorrow in this scan");
    expect(html).toContain("Other service dates and undated actions remain in all actions");
    expect(html).toContain("0 of 2 actions");
    expect(html).toContain("57 messages · 2 people");
    expect(html).not.toContain("No actionable items found");
  });

  it("escapes captured warnings and text and retains only safe existing record destinations", () => {
    const unsafe = '<script>synthetic()</script> https://external.invalid/';
    const html = htmlFor(result([item("escape", { evidenceWarnings: [unsafe], evidence: [message("escape", { text: unsafe })],
      recordLinks: [{ label: "Bookings", href: "/admin/bookings" }, { label: "Unsafe", href: "javascript:bad()" }] })]));
    expect(html).toContain("&lt;script&gt;synthetic()&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect([...html.matchAll(/href="([^"]+)"/g)].map(match => match[1])).toEqual(["/admin/bookings"]);
  });

  it("ignores contradictory legacy provider corpus metadata in local mode", () => {
    const html = htmlFor(result([item()], { collection: { status: "failed", scope: "organization", start: "2026-11-11T05:00:00Z", end: "2026-11-12T05:00:00Z",
      messages: [{ id: "RAW-PROVIDER-METADATA", from: PHONE, to: ["+13015550987"], text: "PROVIDER CORPUS SHOULD NOT RENDER", phoneNumberId: "RAW-LINE-ID", conversationId: "RAW-CONVERSATION-ID", direction: "incoming", status: "received", createdAt: "2026-11-11T17:00:00Z", updatedAt: "2026-11-11T17:01:00Z", media: [] }],
      pagesRead: 1, incoming: 1, outgoing: 0, duplicates: 0, outOfWindow: 0, failure: "ACCESS" } }));
    expect(html).toContain('data-audit-status="needs_action"');
    for (const raw of ["Day’s SMS", "RAW-PROVIDER-METADATA", "RAW-LINE-ID", "RAW-CONVERSATION-ID", "PROVIDER CORPUS SHOULD NOT RENDER", "SMS collection failed"]) expect(html).not.toContain(raw);
  });

  it("legacy mocks without localSource still use existing provider and manual-batch behavior", () => {
    const value = result([item("legacy", { evidenceBasis: undefined, evidenceWarnings: undefined })], { localSource: undefined, analysis: undefined,
      nextCursor: { sessionAfterId: 1, inboundAfterId: 2, asOf: "2026-11-12T15:00:00Z" } });
    const html = htmlFor(value);
    expect(html).toContain("SMS collection completeness not established");
    expect(html).toContain("Confirmed in SMS");
    expect(html).toContain("More evidence batches are available");
    expect(html).not.toContain("LeadFlow captured conversations ·");
  });

  it("pure local result rendering adds no hooks, timers, network transports, or executable download operation", () => {
    const forbidden = vi.fn(() => { throw new Error("Unexpected hook in captured result rendering"); });
    const loaded = load({ ...React, useState: forbidden, useEffect: forbidden, useRef: forbidden });
    expect(() => htmlFor(result(), "all", loaded)).not.toThrow();
    expect(forbidden).not.toHaveBeenCalled();
    const ast = ts.createSourceFile("actual.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const calls: string[] = [];
    const visit = (node: ts.Node) => { if (ts.isCallExpression(node)) calls.push(node.expression.getText(ast)); ts.forEachChild(node, visit); };
    visit(ast);
    expect(calls.filter(call => call.endsWith(".useQuery"))).toEqual(["trpc.agents.me.useQuery"]);
    expect(calls.filter(call => call.endsWith(".useMutation"))).toEqual(["trpc.aiActions.dailyAudit.run.useMutation"]);
    expect(calls.filter(call => call.endsWith(".mutateAsync"))).toEqual(["run.mutateAsync"]);
    expect(calls.some(call => /download|fetch|setInterval|setTimeout/.test(call))).toBe(false);
    for (const token of ["dangerouslySetInnerHTML", "console.", "cleaner" + "_jobs", "cleaner" + "Jobs"]) expect(source).not.toContain(token);
  });
});

describe("LeadFlow captured source request admission", () => {
  it("runs once explicitly, blocks rapid duplicate submits, and offers no local continuation even with an inconsistent cursor", async () => {
    const pending = deferred<DailyActionAuditResult>();
    const work = workspace(() => pending.promise);
    work.change("2026-11-11");
    expect(work.mutateAsync).not.toHaveBeenCalled();
    const submit = work.submit();
    expect(text(work.render())).toContain("Reading LeadFlow captured conversations, then checking actions…");
    await work.submit();
    expect(work.mutateAsync).toHaveBeenCalledTimes(1);
    expect(work.mutateAsync).toHaveBeenCalledWith({ auditDate: "2026-11-11", timeZone: "America/New_York" });
    pending.resolve(result([item()], { nextCursor: { sessionAfterId: 1, inboundAfterId: 2, asOf: "2026-11-12T15:00:00Z" } }));
    await submit;
    work.render(); work.render();
    expect(work.value().localSource).toMatchObject({ providerRequests: 0, messagesRead: 57 });
    expect(text(work.render())).not.toContain("Review next batch");
    expect(work.mutateAsync).toHaveBeenCalledTimes(1);
    expect(work.useMutation.mock.calls[0][0]).toMatchObject({ retry: false, gcTime: 0 });
    work.dispose();
  });

  it("discards local changed-date responses, keeps admission blocked until settlement, and resets filters", async () => {
    const pending = deferred<DailyActionAuditResult>();
    let calls = 0;
    const work = workspace(() => ++calls === 1 ? pending.promise : Promise.resolve(result()));
    work.change("2026-11-11");
    const submit = work.submit();
    work.change("2026-11-10");
    work.change("2026-11-11");
    await work.submit();
    expect(work.mutateAsync).toHaveBeenCalledTimes(1);
    pending.resolve(result()); await submit;
    expect(work.value()).toBeUndefined();
    await work.submit();
    find(work.render(), node => node.type === "button" && text(node).includes("Affects tomorrow")).props.onClick();
    expect(find(work.render(), node => node.type === work.loaded.AuditResults).props.filter).toBe("affectsTomorrow");
    work.change("2026-11-10");
    expect(work.value()).toBeUndefined();
    expect(text(work.render())).toContain("Ready when you are");
    work.dispose();
  });

  it("safe read failures clear local findings and never log or render raw SQL or PII", async () => {
    for (const error of [new Error("SELECT synthetic_secret +13015550123"), new Error(auditContract.auditFailureMessage("MESSAGE_READ", "DB_UNAVAILABLE"))]) {
      let calls = 0;
      const work = workspace(async () => { if (++calls === 1) return result(); throw error; });
      work.change("2026-11-11"); await work.submit();
      expect(work.value()).toBeTruthy();
      await work.submit();
      expect(work.value()).toBeUndefined();
      const failure = find(work.render(), node => node.type === work.loaded.AuditRunError);
      const html = renderToStaticMarkup(failure);
      expect(html).toContain("Audit could not be completed");
      expect(html).toContain("No results are being shown");
      expect(html).not.toContain("SELECT");
      expect(html).not.toContain("synthetic_secret");
      expect(html).not.toContain(PHONE);
      expect(html).not.toContain("No actionable items");
      expect(work.log).not.toHaveBeenCalled();
      work.dispose();
    }
  });

  it("local failed-analysis results remain analysis-unavailable, not a successful empty audit", async () => {
    const work = workspace(async () => result([], { analysis: analysis({ status: "failed", threadsAnalyzed: 0, failedThreads: 2 }) }));
    work.change("2026-11-11"); await work.submit();
    const html = htmlFor(work.value());
    expect(html).toContain("Captured messages loaded; analysis unavailable");
    expect(html).not.toContain("Overall summary");
    expect(html).not.toContain("No actionable items");
    expect(work.mutateAsync).toHaveBeenCalledTimes(1);
    work.dispose();
  });

  it("does not write local results or raw errors after unmount", async () => {
    for (const reject of [false, true]) {
      const pending = deferred<DailyActionAuditResult>();
      const work = workspace(() => pending.promise);
      work.change("2026-11-11");
      const submit = work.submit();
      work.dispose();
      if (reject) pending.reject(new Error("synthetic raw SQL")); else pending.resolve(result());
      await submit;
      expect(work.lateWrites()).toBe(0);
      expect(work.log).not.toHaveBeenCalled();
    }
  });
});
