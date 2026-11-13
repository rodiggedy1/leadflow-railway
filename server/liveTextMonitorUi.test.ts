import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuditMessage, AuditRecord } from "../shared/dailyActionAudit";
import type { LiveTextCheck, LiveTextFeed, LiveTextRow, LiveTextSyncSummary } from "../shared/liveTextMonitor";
import { BOOKING_WIDGET_PRICED_EXTRAS } from "../shared/bookingWidgetConfig";

// LOCAL ONLY: execute the actual TSX with explicit transport/SSE mocks, then render
// its output. The bounded hook driver exercises callbacks/effects, not a browser DOM.
// No application/router, network, DB, provider, model, or real customer data is loaded.
const root = resolve(import.meta.dirname, "..");
const source = readFileSync(resolve(root, "client/src/pages/LiveTextMonitor.tsx"), "utf8");
const css = readFileSync(resolve(root, "client/src/pages/live-text-monitor.css"), "utf8");
const icon = (props: any) => React.createElement("svg", props);
const icons = new Proxy({}, { get: () => icon });
function compile(react: any = React, trpc: any = {}, stream: any = () => {}, extra: Record<string, any> = {}) {
  const module = { exports: {} as any };
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
  } }).outputText;
  runInNewContext(output, { module, exports: module.exports, Date, Intl, Error, Map, Set, setTimeout, clearTimeout, ...extra,
    require: (id: string) => {
      if (id === "react") return react;
      if (id === "lucide-react") return icons;
      if (id === "@/lib/trpc") return { trpc };
      if (id === "@/hooks/useOpsStream") return { useOpsStream: stream };
      if (id === "@shared/bookingWidgetConfig") return { BOOKING_WIDGET_PRICED_EXTRAS };
      if (id.endsWith(".css")) return {};
      throw new Error(`Unexpected UI import: ${id}`);
    },
  }, { timeout: 1500 });
  return module.exports;
}
function driver(trpc: any, stream: any, extra: Record<string, any>) {
  const slots: any[] = [];
  let cursor = 0;
  let jobs: Array<() => void> = [];
  let dead = false;
  let lateWrites = 0;
  let dirty = false;
  const hooks = { ...React,
    useId() { const index = cursor++; return `synthetic-detail-${index}`; },
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value: any) => {
        if (dead) { lateWrites++; return; }
        const next = typeof value === "function" ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) dirty = true;
        slots[index] = next;
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
  const ui = compile(hooks, trpc, stream, extra);
  return { ui,
    render(name: string, props?: any) {
      cursor = 0; dirty = false;
      const tree = ui[name](props);
      const pending = jobs; jobs = []; pending.forEach(run => run());
      return tree;
    },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); dead = true; jobs = []; },
    get lateWrites() { return lateWrites; },
    get dirty() { return dirty; },
  };
}
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
function message(id: number, overrides: Partial<AuditMessage> = {}): AuditMessage {
  return { key: `text-${id}`, sessionId: id, customerPhone: "+13015550123", businessPhone: "+13015550987", direction: "inbound",
    text: `Synthetic text ${id}: please move my cleaning to Friday at 10.`, occurredAt: new Date(Date.UTC(2026, 10, 13, 15, 0, id)).toISOString(),
    observedAt: null, timeBasis: "received", delivery: "received", source: "inbound_sms", ...overrides };
}
function row(id: number, overrides: Partial<LiveTextRow> = {}): LiveTextRow {
  return { key: `session-text:${id.toString(16).padStart(64, "0")}`, sessionId: id, revision: `rev-${id}`, customerName: "Synthetic customer", message: message(id), identityAmbiguous: false, ...overrides };
}
function feed(rows: LiveTextRow[], overrides: Partial<LiveTextFeed> = {}): LiveTextFeed {
  return { rows, checkedAt: "2026-11-13T16:00:00Z", partial: false, unavailable: false, ...overrides };
}
function record(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return { key: "record-private-321", source: "bookings", bookingId: 321, jobId: null, seriesId: "private-series", publicBookingNumber: null,
    customerPhone: "+13015550123", customerName: "Synthetic customer", date: "2026-11-13", time: "09:00", timeZone: "America/New_York", status: "scheduled",
    address: "Synthetic address", serviceName: "Standard", extras: [], teamName: "Synthetic team", recurrence: "weekly", paymentStatus: "paid", paidAmountCents: 15000, ...overrides };
}
function checked(value: LiveTextRow, overrides: Partial<LiveTextCheck> = {}): LiveTextCheck {
  return { rowKey: value.key, revision: value.revision, required: "yes", verified: "no", summary: "Move cleaning to Friday at 10.",
    evidence: "Booking still shows Friday at 9.", actions: [{ id: "private-action-id", type: "reschedule", summary: "Move to Friday at 10.", verified: "no",
      evidence: "Booking still shows Friday at 9.", records: [record()], links: [{ label: "Bookings", href: "/admin/bookings" }] }],
    conversation: [value.message], checkedAt: "2026-11-13T16:00:00Z", ...overrides };
}
function syncSummary(overrides: Partial<LiveTextSyncSummary> = {}): LiveTextSyncSummary {
  return { date: "2026-11-20", complete: true, fetched: 3, created: 1, updated: 1, protectedRecords: 0, checkedAt: "2026-11-13T16:01:00Z", ...overrides };
}
function automaticCheck(value: LiveTextRow, overrides: Partial<LiveTextCheck> = {}): LiveTextCheck {
  return checked(value, { verified: "yes", evidence: "Fresh post-sync record proof.", syncs: [syncSummary()], ...overrides });
}
function workspace(options: { rows?: LiveTextRow[]; feedHandler?: () => Promise<any>; checkHandler?: (input: { sessionId: number; messageKey: string }) => Promise<LiveTextCheck>; hidden?: boolean } = {}) {
  let currentFeed = feed(options.rows ?? []);
  const listeners = new Map<string, () => void>();
  const document = { visibilityState: options.hidden ? "hidden" : "visible",
    addEventListener: vi.fn((event: string, callback: () => void) => listeners.set(event, callback)),
    removeEventListener: vi.fn((event: string) => listeners.delete(event)),
  };
  const refetch = vi.fn((_options?: any) => options.feedHandler ? options.feedHandler() : Promise.resolve({ data: currentFeed }));
  const mutateAsync = vi.fn(options.checkHandler ?? (async input => checked(currentFeed.rows.find(value => value.sessionId === input.sessionId && value.message.key === input.messageKey)!)));
  const useQuery = vi.fn((_input?: any, _options?: any) => ({ refetch }));
  const useMutation = vi.fn((_options?: any) => ({ mutateAsync }));
  const plainCheck = { useMutation: vi.fn(() => { throw new Error("Plain read-only check must not be mounted by the monitor"); }) };
  const mock = { check: { useMutation } };
  const liveText = { feed: { useQuery }, check: plainCheck, checkAndSync: mock.check };
  let callbacks: any = {};
  let streamEnabled = false;
  const stream = vi.fn((next: any, state: any) => { callbacks = next; streamEnabled = state.enabled; });
  const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
  const console = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const harness = driver({ aiActions: { liveText } }, stream, { document, localStorage: storage, sessionStorage: storage, console });
  const detailDrivers = new Map<string, ReturnType<typeof driver>>();
  let tree: any;
  const render = () => tree = harness.render("LiveTextWorkspace");
  const settle = async () => {
    for (let turn = 0; turn < 40; turn++) { await Promise.resolve(); if (harness.dirty || !tree) render(); }
    return render();
  };
  const entryNodes = () => elements(render()).filter(node => node.type === harness.ui.LiveTextMessageRow);
  const entries = () => entryNodes().map(node => node.props.entry);
  const html = () => renderToStaticMarkup(render());
  const event = (name: string) => { if (streamEnabled) callbacks[name]?.(); };
  const pause = () => { find(render(), node => node.props?.className === "ltm-pause").props.onClick(); render(); };
  const visibility = (state: string) => { document.visibilityState = state; listeners.get("visibilitychange")?.(); render(); };
  const manual = (key: string) => { const node = entryNodes().find(node => node.props.entry.row.key === key); node.props.onCheck(key); render(); };
  const retry = () => { find(render(), node => node.props?.className === "ltm-check ltm-retry").props.onClick(); render(); };
  const detail = (key: string) => {
    const node = entryNodes().find(node => node.props.entry.row.key === key);
    if (!detailDrivers.has(key)) {
      const detailDriver = driver({}, () => {}, {});
      detailDrivers.set(key, detailDriver);
      find(detailDriver.render("LiveTextMessageRow", node.props), element => element.props?.className === "ltm-expand").props.onClick();
    }
    return detailDrivers.get(key)!.render("LiveTextMessageRow", node.props);
  };
  render();
  return { harness, render, settle, entries, entryNodes, html, event, pause, visibility, manual, retry, detail, plainCheck, document, refetch, mutateAsync, useQuery, useMutation, stream, storage, console,
    setFeed(value: LiveTextFeed) { currentFeed = value; }, get streamEnabled() { return streamEnabled; },
    dispose() { harness.dispose(); detailDrivers.forEach(value => value.dispose()); },
  };
}
afterEach(() => { vi.useRealTimers(); });

describe("Live Text Monitor actual-source UI safeguards", () => {
  it("mounts no feed, check, or SSE before authenticated admin access is known", () => {
    for (const response of [{ isLoading: true }, { error: new Error("PRIVATE") }, { data: null }, { data: { isAdmin: false } }]) {
      const feedQuery = vi.fn(); const checkMutation = vi.fn(); const automaticMutation = vi.fn(); const stream = vi.fn();
      const me = vi.fn((_input?: any, _options?: any) => response);
      const ui = compile(React, { agents: { me: { useQuery: me } }, aiActions: { liveText: { feed: { useQuery: feedQuery }, check: { useMutation: checkMutation }, checkAndSync: { useMutation: automaticMutation } } } }, stream);
      const html = renderToStaticMarkup(React.createElement(ui.default));
      expect(html).not.toContain("PRIVATE");
      expect(feedQuery).not.toHaveBeenCalled(); expect(checkMutation).not.toHaveBeenCalled(); expect(stream).not.toHaveBeenCalled();
      expect(automaticMutation).not.toHaveBeenCalled(); expect(html).not.toContain("Synced ");
      expect(me.mock.calls[0][1]).toMatchObject({ retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchInterval: false, gcTime: 0 });
    }
    const me = vi.fn(() => ({ data: { isAdmin: true } }));
    const harness = driver({ agents: { me: { useQuery: me } } }, vi.fn(), {});
    expect(harness.render("default").type).toBe(harness.ui.LiveTextWorkspace);
    harness.dispose();
  });

  it("shows the four compact columns, pending then Yes/No, actual text, and bounded summary counts", async () => {
    const response = deferred<LiveTextCheck>();
    const work = workspace({ rows: [row(1)], checkHandler: () => response.promise });
    await work.settle();
    const html = work.html();
    for (const label of ["Name / phone", "Text conversation", "Action required", "Action verified", "Synthetic text 1", "Checking…", "Live", "Latest 10 checked automatically"]) expect(html).toContain(label);
    expect(work.mutateAsync).toHaveBeenCalledWith({ sessionId: 1, messageKey: "text-1" });
    response.resolve(checked(row(1))); await work.settle();
    expect(work.html()).toContain("Move cleaning to Friday at 10.");
    expect(work.html()).toContain("Booking still shows Friday at 9.");
    expect(work.entries()[0].check).toMatchObject({ required: "yes", verified: "no" });
    expect(work.html()).toMatch(/<strong>1<\/strong> Needs action/);
    expect(work.html()).toMatch(/<strong>0<\/strong> Verified/);
    work.dispose();
  });

  it("keeps greeting No separate from unknown Review and never treats missing proof as No", async () => {
    const greeting = row(1, { message: message(1, { text: "Hello!" }) });
    const work = workspace({ rows: [greeting, row(2)], checkHandler: async input => input.sessionId === 1
      ? checked(greeting, { required: "no", verified: "not_applicable", summary: "Greeting only.", evidence: "No record change needed.", actions: [] })
      : checked(row(2), { required: "review", verified: "review", summary: "Requested time needs review.", evidence: "No matching record available.", actions: [] }) });
    await work.settle();
    expect(work.html()).toContain("Greeting only."); expect(work.html()).toContain("Not needed"); expect(work.html()).toContain("Review");
    expect(work.entries().find(entry => entry.row.sessionId === 1).check.required).toBe("no");
    expect(work.entries().find(entry => entry.row.sessionId === 2).check.verified).toBe("review");
    expect(work.html()).toMatch(/<strong>0<\/strong> Needs action/);
    work.dispose();
  });
  it.each(["unknown", "failed"] as const)("shows %s recorded outgoing informational No separately from scheduling Yes and current mismatch No", async delivery => {
    const info = ["Please leave us a review after your cleaning.", "I'm on my way.", "Thanks!"].map((value, index) => row(index + 1, {
      message: message(index + 1, { direction: "outbound", delivery, source: "conversation_history", timeBasis: "history", text: value }),
    }));
    const schedule = [4, 5].map(id => row(id, { message: message(id, { direction: "outbound", delivery, source: "conversation_history",
      timeBasis: "history", text: "LF-TEST is confirmed at 9 AM on November 16, 2026." }) }));
    const work = workspace({ rows: [...info, ...schedule], checkHandler: async input => {
      const value = [...info, ...schedule].find(value => value.sessionId === input.sessionId)!;
      return input.sessionId <= 3 ? checked(value, { required: "no", verified: "not_applicable", summary: "No action required.", evidence: "No operational request or commitment was found in this text.", actions: [], analysis: { status: "complete" } })
        : checked(value, { required: "yes", verified: input.sessionId === 4 ? "yes" : "no", summary: "Reschedule cleaning to Nov 16, 2026 at 9:00 AM",
          evidence: input.sessionId === 4 ? "Current records show 9:00 AM." : "Current records show 11:00 AM; scheduled time differs.", analysis: { status: "complete" } });
    } });
    await work.settle();
    for (const value of info) {
      const html = renderToStaticMarkup(work.detail(value.key));
      expect(html).toMatch(/ltm-status-no">No<\/strong>/); expect(html).toContain("Not needed"); expect(html).not.toContain("Current record");
      expect(work.entries().find(entry => entry.row.key === value.key).row.message.delivery).toBe(delivery);
    }
    const matched = renderToStaticMarkup(work.detail(schedule[0].key)); const mismatch = renderToStaticMarkup(work.detail(schedule[1].key));
    expect(matched.match(/ltm-status-yes">Yes<\/strong>/g)).toHaveLength(2);
    expect(mismatch).toMatch(/ltm-status-yes">Yes<\/strong>/); expect(mismatch).toMatch(/ltm-status-no">No<\/strong>/);
    expect(matched).toContain("9:00 AM"); expect(mismatch).toContain("11:00 AM"); expect(work.html()).not.toContain("Check unavailable");
    expect(work.html()).toMatch(/<strong>1<\/strong> Needs action/); expect(work.html()).toMatch(/<strong>1<\/strong> Verified/);
    work.dispose();
  });

  it.each([
    ["MODEL_TIMEOUT", "Text analysis timed out."],
    ["MODEL_UNAVAILABLE", "Text analysis is unavailable."],
    ["INVALID_MODEL_RESPONSE", "The AI returned an unreadable analysis."],
    ["INVALID_ACTION", "An AI action result could not be validated."],
    ["INVALID_SOURCE_REFERENCE", "The AI referenced a text outside this conversation."],
    ["INPUT_TOO_LARGE", "Some text exceeds the analysis limit."],
    ["PARTIAL_CONTEXT", "Some conversation context is unavailable."],
    [undefined, "Text analysis is unavailable."],
    ["PRIVATE SQL provider response", "Text analysis is unavailable."],
  ])("renders unavailable %s as fixed reason and Not checked, never private errors or a false No", async (failure, reason) => {
    const value = row(1);
    const work = workspace({ rows: [value], checkHandler: async () => checked(value, { required: "review", verified: "review", actions: [],
      summary: "PRIVATE SQL model response", evidence: "PRIVATE backend credentials", analysis: { status: "unavailable", failure: failure as any } }) });
    await work.settle();
    const html = renderToStaticMarkup(work.detail(value.key));
    expect(html).toContain("Unavailable"); expect(html).toContain("Not checked"); expect(html).toContain(reason);
    expect(html).toContain("Current records were not checked."); expect(html).not.toContain("PRIVATE");
    expect(html).not.toMatch(/ltm-status-(?:yes|no)/); expect(html).not.toContain("Current record</h3>");
    expect(work.html()).toMatch(/<strong>0<\/strong> Needs action/); expect(work.html()).toMatch(/<strong>0<\/strong> Verified/);
    expect(work.entries()[0].state).toBe("done"); expect(work.mutateAsync).toHaveBeenCalledTimes(1); work.dispose();
  });

  it("partial analysis with no determined action stays Review/Not checked, while a valid explicit action stays Yes/Yes", async () => {
    for (const actionable of [false, true]) {
      const value = row(1, { message: message(1, { direction: "outbound", delivery: "unknown", text: "LF-TEST is confirmed at 9 AM on November 16, 2026." }) });
      const result = checked(value, { required: actionable ? "yes" : "review", verified: actionable ? "yes" : "review",
        summary: actionable ? "Reschedule cleaning to Nov 16, 2026 at 9:00 AM" : "PRIVATE partial model prose",
        evidence: actionable ? "Current records show 9:00 AM." : "PRIVATE partial backend error",
        ...(actionable ? {} : { actions: [] }), analysis: { status: "partial", failure: "PARTIAL_CONTEXT" } });
      const work = workspace({ rows: [value], checkHandler: async () => result }); await work.settle();
      const html = renderToStaticMarkup(work.detail(value.key));
      expect(html).not.toContain("Unavailable</strong>"); expect(html).not.toContain("PRIVATE");
      if (actionable) {
        expect(html.match(/ltm-status-yes">Yes<\/strong>/g)).toHaveLength(2); expect(html).not.toContain("Not checked");
        expect(html).toContain("9:00 AM"); expect(html).toContain("Current record</h3>");
      } else {
        expect(html).toMatch(/ltm-status-review">Review<\/strong>/); expect(html).toContain("Not checked");
        expect(html).toContain("Some conversation context is unavailable."); expect(html).not.toContain("Current record</h3>");
      }
      expect(work.entries()[0].check).toEqual(result); work.dispose();
    }
  });

  it("settled unavailable analysis is not automatically rechecked, but explicit Check can replace it with fresh Yes", async () => {
    vi.useFakeTimers(); const value = row(1);
    const work = workspace({ rows: [value], checkHandler: async () => checked(value, { required: "review", verified: "review", actions: [],
      analysis: { status: "unavailable", failure: "MODEL_UNAVAILABLE" } }) }); await work.settle();
    expect(work.html()).toContain("Text analysis is unavailable."); expect(work.html()).toContain("Not checked");
    for (const event of ["onConnected", "onNewMessage", "onJobUpdate", "onBookingFunnelUpdate"]) work.event(event);
    await vi.advanceTimersByTimeAsync(20_120); await work.settle(); expect(work.mutateAsync).toHaveBeenCalledTimes(1);
    work.mutateAsync.mockResolvedValue(checked(value, { verified: "yes", evidence: "Fresh current records match.", analysis: { status: "complete" } }));
    work.manual(value.key); await work.settle();
    expect(work.mutateAsync).toHaveBeenCalledTimes(2); expect(work.html()).toContain("Fresh current records match.");
    expect(work.html()).not.toContain("Text analysis is unavailable."); expect(work.html()).not.toContain("Not checked");
    expect(work.html()).toMatch(/<strong>1<\/strong> Verified/); work.dispose(); expect(vi.getTimerCount()).toBe(0);
  });

  it("expands via an accessible native button into chronological same-customer texts and relevant current fields only", () => {
    const newest = row(3, { message: message(3, { text: '<script>unsafe()</script> https://bad.invalid' }) });
    const other = row(2, { message: message(2, { customerPhone: "+13015550124", text: "Different customer private context" }) });
    const first = row(1, { sessionId: 3, message: message(1, { sessionId: 3, text: "First request" }) });
    const check = checked(newest, { conversation: [newest.message, other.message, message(2, { sessionId: 3, direction: "outbound", text: "Business confirmation" }), first.message] });
    check.actions[0].links.push({ label: "Bad", href: "javascript:bad()" }, { label: "Private", href: "/admin/bookings?phone=private" });
    const entry = { row: newest, state: "done", check, automatic: true };
    const harness = driver({}, () => {}, {});
    const render = () => harness.render("LiveTextMessageRow", { entry, entries: [entry, { row: first }, { row: other }], enabled: true, onCheck: vi.fn() });
    let tree = render();
    const button = find(tree, node => node.props?.className === "ltm-expand");
    expect(button.type).toBe("button"); expect(button.props.type).toBe("button"); expect(button.props["aria-expanded"]).toBe(false);
    expect(text(tree)).not.toContain("Current record");
    button.props.onClick(); tree = render();
    expect(find(tree, node => node.props?.className === "ltm-expand").props["aria-expanded"]).toBe(true);
    const detail = find(tree, node => node.props?.className === "ltm-details");
    expect(detail.props.id).toBe(button.props["aria-controls"]);
    const html = renderToStaticMarkup(tree);
    expect(html.indexOf("First request")).toBeLessThan(html.indexOf("Business confirmation"));
    expect(html.indexOf("Business confirmation")).toBeLessThan(html.lastIndexOf("&lt;script&gt;"));
    expect(html).not.toContain("Different customer private context"); expect(html).not.toContain("<script>");
    for (const label of ["Recent conversation (last 20 stored entries)", "Requested action", "Current record", "Service date", "Arrival", "scheduled"]) expect(html).toContain(label);
    for (const privateValue of ["record-private-321", "private-series", "private-action-id", "Synthetic address", "Synthetic team", "Payment", "javascript:", "?phone="]) expect(html).not.toContain(privateValue);
    expect(html.match(/href="[^"]+"/g)).toEqual(['href="/admin/bookings"']);
    find(tree, node => node.props?.className === "ltm-expand").props.onClick();
    expect(text(render())).not.toContain("Current record");
    harness.dispose();
  });

  it("isolates the same customer on different business lines and resolves names only from exact record phones", () => {
    const current = row(3, { customerName: null });
    const otherLine = row(2, { message: message(2, { businessPhone: "+13015550988", text: "Other business line private text" }) });
    const check = checked(current, { conversation: [current.message, otherLine.message] });
    const entry = { row: current, state: "done", check, automatic: true };
    const harness = driver({}, () => {}, {});
    const render = () => harness.render("LiveTextMessageRow", { entry, entries: [entry, { row: otherLine }], enabled: true, onCheck: vi.fn() });
    find(render(), node => node.props?.className === "ltm-expand").props.onClick();
    expect(renderToStaticMarkup(render())).not.toContain("Other business line private text");
    expect(renderToStaticMarkup(render())).toContain("Synthetic customer");
    check.actions[0].records = [record({ customerPhone: "+13015550124", customerName: "Wrong customer name" })];
    const noName = renderToStaticMarkup(render());
    expect(noName).not.toContain("Wrong customer name"); expect(noName).toContain("Name unavailable");
    current.message.businessPhone = null;
    const unknownLine = row(4, { message: message(4, { businessPhone: null, text: "Unknown endpoint must not merge" }) });
    check.conversation = [current.message, unknownLine.message];
    expect(renderToStaticMarkup(render())).not.toContain("Unknown endpoint must not merge");
    harness.dispose();
  });

  it("includes stored null-line context only from the exact session and excludes same-phone session siblings", () => {
    const current = row(3, { sessionId: 99, message: message(3, { sessionId: 99, businessPhone: null, text: "Latest stored request" }) });
    const first = row(1, { sessionId: 99, message: message(1, { sessionId: 99, businessPhone: null, text: "Same session earlier request" }) });
    const sibling = row(2, { sessionId: 100, message: message(2, { sessionId: 100, businessPhone: null, text: "Other session private request" }) });
    const reply = message(4, { sessionId: 99, businessPhone: null, direction: "outbound", text: "Same session stored answer" });
    const otherReply = message(5, { sessionId: 100, businessPhone: null, direction: "outbound", text: "Other session private answer" });
    const check = checked(current, { conversation: [current.message, reply, sibling.message, otherReply] });
    const entry = { row: current, state: "done", check, automatic: true };
    const harness = driver({}, () => {}, {});
    const render = () => harness.render("LiveTextMessageRow", { entry, entries: [entry, { row: first }, { row: sibling }], enabled: true, onCheck: vi.fn() });
    find(render(), node => node.props?.className === "ltm-expand").props.onClick();
    const html = renderToStaticMarkup(render());
    expect(html).toContain("Same session earlier request"); expect(html).toContain("Same session stored answer");
    expect(html).not.toContain("Other session private request"); expect(html).not.toContain("Other session private answer");
    expect(html.indexOf("Same session earlier request")).toBeLessThan(html.lastIndexOf("Latest stored request"));
    expect(html.match(/Same session stored answer/g)).toHaveLength(1);
    harness.dispose();
  });

  it("excludes known-line texts from other sessions in both feed rows and returned check context", () => {
    const current = row(3, { sessionId: 99, message: message(3, { sessionId: 99, text: "Selected session request" }) });
    const earlier = row(1, { sessionId: 99, message: message(1, { sessionId: 99, text: "Selected session earlier text" }) });
    const sibling = row(2, { sessionId: 100, message: message(2, { sessionId: 100, text: "Same phone and line foreign session text" }) });
    const reply = message(4, { sessionId: 99, direction: "outbound", text: "Selected session answer" });
    const foreignReply = message(5, { sessionId: 100, direction: "outbound", text: "Same phone and line foreign session answer" });
    const check = checked(current, { conversation: [current.message, reply, sibling.message, foreignReply] });
    const entry = { row: current, state: "done", check, automatic: true };
    const harness = driver({}, () => {}, {});
    const render = () => harness.render("LiveTextMessageRow", { entry, entries: [entry, { row: earlier }, { row: sibling }], enabled: true, onCheck: vi.fn() });
    find(render(), node => node.props?.className === "ltm-expand").props.onClick();
    const html = renderToStaticMarkup(render());
    expect(html).toContain("Selected session earlier text"); expect(html).toContain("Selected session answer");
    expect(html).not.toContain("Same phone and line foreign session text");
    expect(html).not.toContain("Same phone and line foreign session answer");
    harness.dispose();
  });

  it("does not merge known-line context when the feed row and message session identity disagree", () => {
    const current = row(1, { sessionId: 99, message: message(1, { sessionId: 100, text: "Original visible text" }) });
    const context = message(2, { sessionId: 99, text: "Misbound context must not display" });
    const entry = { row: current, state: "done", check: checked(current, { conversation: [context] }), automatic: true };
    const harness = driver({}, () => {}, {});
    const render = () => harness.render("LiveTextMessageRow", { entry, entries: [entry], enabled: true, onCheck: vi.fn() });
    find(render(), node => node.props?.className === "ltm-expand").props.onClick();
    const html = renderToStaticMarkup(render());
    expect(html).toContain("Original visible text"); expect(html).not.toContain("Misbound context must not display");
    harness.dispose();
  });

  it("keeps ambiguous identities apart and does not invent context for missing phones", () => {
    for (const current of [row(2, { identityAmbiguous: true }), row(2, { message: message(2, { customerPhone: "" }) })]) {
      const harness = driver({}, () => {}, {});
      const entry = { row: current, state: "unchecked" };
      const render = () => harness.render("LiveTextMessageRow", { entry, entries: [entry, { row: row(1, { message: message(1, { text: "Must not merge" }) }) }], enabled: false, onCheck: vi.fn() });
      find(render(), node => node.props?.className === "ltm-expand").props.onClick();
      expect(renderToStaticMarkup(render())).not.toContain("Must not merge");
      harness.dispose();
    }
  });

  it("keeps first-read loading distinct from failure and explicit successful-empty history", async () => {
    vi.useFakeTimers();
    const first = deferred<any>();
    const work = workspace({ feedHandler: () => first.promise });
    const loading = work.html();
    expect(loading).toContain("Loading stored text messages…"); expect(loading).not.toContain("No stored text messages found");
    expect(loading).not.toContain("Text messages could not be loaded"); expect(loading).not.toContain("ltm-live-on");
    expect(loading).not.toMatch(/<strong>0<\/strong>/); expect(loading).not.toContain("Waiting");
    first.resolve({ data: feed([], { unavailable: true, failure: "DB_TIMEOUT" }) }); await work.settle();
    const failed = work.html();
    expect(failed).toContain("Text messages could not be loaded"); expect(failed).toContain("Reading stored conversation history timed out.");
    expect(failed).toContain('role="alert"'); expect(failed).toContain("Retry"); expect(failed).toContain("Unavailable");
    expect(failed).not.toContain("ltm-live-on"); expect(failed).not.toMatch(/<strong>0<\/strong>/);
    expect(failed).not.toContain("Loading stored text messages"); expect(failed).not.toContain("No stored text messages found"); expect(failed).not.toContain("Waiting");
    expect(work.mutateAsync).not.toHaveBeenCalled();
    work.refetch.mockImplementation(async () => ({ data: feed([]) })); work.retry(); await vi.advanceTimersByTimeAsync(120); await work.settle();
    const empty = work.html();
    expect(empty).toContain("No stored text messages found"); expect(empty).toContain("ltm-live-on");
    expect(empty).toMatch(/<strong>0<\/strong> Texts/); expect(empty).not.toContain("Text messages could not be loaded");
    expect(empty).toContain("Latest 100 stored texts · last 20 entries per recent conversation");
    work.setFeed(feed([], { unavailable: true })); work.refetch.mockImplementation(async () => ({ data: feed([], { unavailable: true }) }));
    work.event("onConnected"); await vi.advanceTimersByTimeAsync(120); await work.settle();
    expect(work.html()).toContain("Text messages could not be loaded"); expect(work.html()).not.toMatch(/<strong>0<\/strong>/);
    expect(work.html()).not.toContain("No stored text messages found");
    work.dispose();
  });

  it("shows only fixed safe feed failure reasons, never transport or backend exception details", async () => {
    const cases = [
      ["DB_UNAVAILABLE", "Stored conversation history is temporarily unavailable."],
      ["DB_SCHEMA", "Stored conversation history could not be read in its current format."],
      ["DB_TIMEOUT", "Reading stored conversation history timed out."],
      ["DB_READ_FAILED", "Stored conversation history could not be read. Please try again."],
      [undefined, "Stored conversation history could not be read. Please try again."],
      ["PRIVATE SQL +13015550123", "Stored conversation history could not be read. Please try again."],
    ];
    for (const [failure, reason] of cases) {
      const work = workspace({ feedHandler: async () => ({ data: feed([], { unavailable: true, failure: failure as any }) }) });
      await work.settle();
      expect(work.html()).toContain(reason); expect(work.html()).not.toContain("PRIVATE SQL");
      expect(work.html()).not.toContain("ltm-live-on"); expect(work.html()).not.toMatch(/<strong>0<\/strong>/);
      expect(work.entries()).toHaveLength(0); expect(work.mutateAsync).not.toHaveBeenCalled(); work.dispose();
    }
    for (const feedHandler of [async () => { throw new Error("PRIVATE SQL and phone"); }, async () => ({ error: new Error("PRIVATE SQL and phone"), data: feed([row(1)]) }), async () => ({})]) {
      const work = workspace({ feedHandler }); await work.settle();
      expect(work.html()).toContain("Text messages could not be loaded"); expect(work.html()).not.toContain("PRIVATE SQL");
      expect(work.html()).not.toContain("Synthetic text"); expect(work.html()).not.toContain("ltm-live-on"); work.dispose();
    }
  });

  it("manual feed retry respects pause/foreground gates and coalesces with the existing busy refresh", async () => {
    vi.useFakeTimers();
    const work = workspace({ feedHandler: async () => ({ data: feed([], { unavailable: true, failure: "DB_UNAVAILABLE" }) }) }); await work.settle();
    work.pause();
    expect(find(work.render(), node => node.props?.className === "ltm-check ltm-retry").props.disabled).toBe(true);
    work.retry(); await vi.advanceTimersByTimeAsync(1_000); await work.settle(); expect(work.refetch).toHaveBeenCalledTimes(1);
    work.pause(); await work.settle(); expect(work.refetch).toHaveBeenCalledTimes(2);
    work.visibility("hidden"); work.retry(); await vi.advanceTimersByTimeAsync(10_000); await work.settle(); expect(work.refetch).toHaveBeenCalledTimes(2);
    work.visibility("visible"); await work.settle(); expect(work.refetch).toHaveBeenCalledTimes(3);
    const pending = deferred<any>(); work.refetch.mockImplementation(() => pending.promise);
    for (let i = 0; i < 20; i++) work.retry();
    await vi.advanceTimersByTimeAsync(120); await work.settle(); expect(work.refetch).toHaveBeenCalledTimes(4);
    for (let i = 0; i < 20; i++) { work.retry(); work.event("onConnected"); }
    await vi.advanceTimersByTimeAsync(120); expect(work.refetch).toHaveBeenCalledTimes(4);
    work.refetch.mockImplementation(async () => ({ data: feed([]) })); pending.resolve({ data: feed([], { unavailable: true }) });
    await work.settle(); await vi.advanceTimersByTimeAsync(120); await work.settle();
    expect(work.refetch).toHaveBeenCalledTimes(5); expect(work.html()).toContain("No stored text messages found");
    expect(work.mutateAsync).not.toHaveBeenCalled(); work.dispose(); expect(vi.getTimerCount()).toBe(0);
  });

  it("marks cached counts and updates stale on failure without clearing prior texts or checks", async () => {
    vi.useFakeTimers();
    const work = workspace(); await work.settle();
    expect(work.html()).toContain("No stored text messages found");
    work.setFeed(feed([row(1)])); work.event("onNewMessage"); await vi.advanceTimersByTimeAsync(120); await work.settle();
    const prior = work.entries()[0].check;
    work.refetch.mockRejectedValueOnce(new Error("PRIVATE SQL and phone")); work.event("onConnected"); await vi.advanceTimersByTimeAsync(120); await work.settle();
    expect(work.html()).toContain("Updates unavailable"); expect(work.html()).not.toContain("PRIVATE SQL"); expect(work.entries()[0].check).toEqual(prior);
    expect(work.html()).toContain("showing cached texts"); expect(work.html()).toContain("Synthetic text 1"); expect(work.html()).not.toContain("ltm-live-on");
    expect(work.html()).toMatch(/<strong>1<\/strong> Cached texts/); expect(work.html()).toMatch(/<strong>1<\/strong> Cached needs action/);
    expect(work.html()).toMatch(/<strong>0<\/strong> Cached verified/);
    work.setFeed(feed([], { unavailable: true, failure: "DB_SCHEMA" })); work.event("onLeadUpdate"); await vi.advanceTimersByTimeAsync(120); await work.settle();
    expect(work.entries()).toHaveLength(1);
    expect(work.html()).toContain("Stored conversation history could not be read in its current format.");
    work.setFeed(feed([row(1)])); work.event("onConnected"); await vi.advanceTimersByTimeAsync(120); await work.settle();
    expect(work.html()).not.toContain("Updates unavailable"); expect(work.mutateAsync).toHaveBeenCalledTimes(1);
    expect(work.html()).not.toContain("Cached texts"); expect(work.html()).toContain("ltm-live-on");
    work.dispose();
  });

  it("checks distinct stored messages from one session using their message keys", async () => {
    const first = row(1, { sessionId: 99, message: message(1, { sessionId: 99, businessPhone: null }) });
    const second = row(2, { sessionId: 99, message: message(2, { sessionId: 99, businessPhone: null, direction: "outbound", text: "Stored business answer" }) });
    const work = workspace({ rows: [first, second] }); await work.settle();
    expect(work.mutateAsync.mock.calls.map(call => call[0])).toEqual([{ sessionId: 99, messageKey: "text-2" }, { sessionId: 99, messageKey: "text-1" }]);
    expect(work.entries().map(entry => entry.check.rowKey)).toEqual([second.key, first.key]);
    expect(work.html()).toContain("Stored business answer"); expect(work.html()).not.toContain("captured"); work.dispose();
  });

  it("auto-checks only the newest ten initial stored texts, bounds visible rows at 100, then checks all new texts serially", async () => {
    vi.useFakeTimers();
    let active = 0; let maxActive = 0;
    const initial = Array.from({ length: 110 }, (_, index) => row(index + 1));
    const work = workspace({ rows: initial, checkHandler: async input => { active++; maxActive = Math.max(active, maxActive); await Promise.resolve(); active--; return checked(row(input.sessionId)); } });
    await work.settle();
    expect(work.entries()).toHaveLength(100);
    expect(work.mutateAsync.mock.calls.map(call => call[0].sessionId)).toEqual(Array.from({ length: 10 }, (_, index) => 110 - index));
    expect(work.entries().filter(entry => entry.state === "unchecked")).toHaveLength(90);
    expect(work.html()).toContain("Not checked");
    work.setFeed(feed([...initial, row(111), row(112)])); work.event("onNewMessage"); await vi.advanceTimersByTimeAsync(120); await work.settle();
    expect(work.mutateAsync.mock.calls.slice(-2).map(call => call[0].sessionId)).toEqual([112, 111]);
    expect(work.entries()).toHaveLength(100); expect(maxActive).toBe(1);
    work.manual(row(100).key); await work.settle(); expect(work.mutateAsync.mock.calls.at(-1)?.[0]).toEqual({ sessionId: 100, messageKey: "text-100" });
    work.dispose();
  });

  it("coalesces SSE storms, never overlaps feeds, deduplicates reconnects/status revisions, and fallback covers insert-after-SSE", async () => {
    vi.useFakeTimers();
    const first = deferred<any>();
    const work = workspace({ feedHandler: () => first.promise });
    for (let i = 0; i < 20; i++) { work.event("onNewMessage"); work.event("onLeadUpdate"); work.event("onConnected"); }
    await vi.advanceTimersByTimeAsync(120);
    expect(work.refetch).toHaveBeenCalledTimes(1);
    work.refetch.mockImplementation(async () => ({ data: feed([row(1), row(1)]) }));
    first.resolve({ data: feed([]) }); await work.settle(); await vi.advanceTimersByTimeAsync(120); await work.settle();
    expect(work.refetch).toHaveBeenCalledTimes(2); expect(work.entries()).toHaveLength(1); expect(work.mutateAsync).toHaveBeenCalledTimes(1);
    work.event("onConnected"); await vi.advanceTimersByTimeAsync(120); await work.settle();
    expect(work.entries()).toHaveLength(1); expect(work.mutateAsync).toHaveBeenCalledTimes(1);
    work.refetch.mockImplementation(async () => ({ data: feed([row(1, { revision: "delivered", message: message(1, { delivery: "delivered" }) })]) }));
    work.event("onNewMessage"); await vi.advanceTimersByTimeAsync(120); await work.settle();
    // The synthetic default check still has the old revision, so it cannot install stale proof.
    expect(work.entries()).toHaveLength(1); expect(work.entries()[0].row.message.delivery).toBe("delivered");
    work.dispose();

    const race = workspace(); await race.settle();
    race.event("onNewMessage"); await vi.advanceTimersByTimeAsync(120); await race.settle();
    race.setFeed(feed([row(4)]));
    await vi.advanceTimersByTimeAsync(5_120); await race.settle();
    expect(race.entries()).toHaveLength(1); expect(race.mutateAsync).toHaveBeenCalledWith({ sessionId: 4, messageKey: "text-4" });
    await vi.advanceTimersByTimeAsync(5_120); await race.settle(); expect(race.mutateAsync).toHaveBeenCalledTimes(1);
    race.dispose();
  });

  it("job and booking events reverify only known actionable visible rows, capped at ten and concurrency one, retaining context", async () => {
    vi.useFakeTimers();
    const captures = Array.from({ length: 14 }, (_, index) => row(index + 1));
    let rechecking = false; let active = 0; let maxActive = 0;
    const hold = deferred<void>();
    const work = workspace({ rows: captures, checkHandler: async input => {
      active++; maxActive = Math.max(maxActive, active);
      if (rechecking) await hold.promise;
      active--;
      return checked(row(input.sessionId), input.sessionId === 5 ? { required: "no", verified: "not_applicable", summary: "Greeting only.", actions: [] }
        : rechecking ? { verified: "yes", evidence: "Booking now shows Friday at 10." } : {});
    } });
    await work.settle();
    for (const key of [row(4).key, row(3).key, row(2).key]) { work.manual(key); await work.settle(); }
    expect(work.entries().find(entry => entry.row.sessionId === 1).state).toBe("unchecked");
    const beforeFeed = work.refetch.mock.calls.length; const beforeChecks = work.mutateAsync.mock.calls.length;
    rechecking = true;
    work.event("onJobUpdate"); work.render(); work.event("onBookingFunnelUpdate");
    expect(work.entries()[0].check.conversation).toHaveLength(1);
    expect(work.entries()[0].state).toBe("pending");
    expect(work.mutateAsync).toHaveBeenCalledTimes(beforeChecks + 1);
    hold.resolve(); await work.settle();
    const reverified = work.mutateAsync.mock.calls.slice(beforeChecks).map(call => call[0].sessionId);
    expect(reverified).toHaveLength(10); expect(reverified).not.toContain(5); expect(reverified).not.toContain(1);
    expect(maxActive).toBe(1); expect(work.refetch).toHaveBeenCalledTimes(beforeFeed);
    expect(work.html()).toContain("Booking now shows Friday at 10.");
    expect(work.html()).toMatch(/<strong>10<\/strong> Verified/);
    work.dispose();
  });

  it("pause stops new checks, SSE, and fallback while allowing one already-sent check to finish", async () => {
    vi.useFakeTimers();
    const response = deferred<LiveTextCheck>();
    const work = workspace({ rows: [row(1), row(2)], checkHandler: () => response.promise }); await work.settle();
    expect(work.mutateAsync).toHaveBeenCalledTimes(1);
    work.pause(); expect(work.streamEnabled).toBe(false);
    work.event("onNewMessage"); work.event("onJobUpdate"); work.manual(row(1).key);
    await vi.advanceTimersByTimeAsync(20_000); await work.settle();
    expect(work.refetch).toHaveBeenCalledTimes(1); expect(work.mutateAsync).toHaveBeenCalledTimes(1);
    response.resolve(checked(row(2))); await work.settle();
    expect(work.entries()[0].state).toBe("done"); expect(work.mutateAsync).toHaveBeenCalledTimes(1); expect(work.html()).toContain("Paused");
    work.mutateAsync.mockImplementation(async input => checked(row(input.sessionId)));
    work.pause(); await work.settle(); expect(work.streamEnabled).toBe(true); expect(work.mutateAsync).toHaveBeenCalledTimes(2);
    work.dispose(); expect(vi.getTimerCount()).toBe(0);
  });

  it("hidden/unmounted pages stop fallback and SSE, discard late feed writes, and resume safely", async () => {
    vi.useFakeTimers();
    const late = deferred<any>();
    const work = workspace({ feedHandler: () => late.promise });
    work.visibility("hidden"); expect(work.streamEnabled).toBe(false);
    late.resolve({ data: feed([row(1)]) }); await work.settle();
    await vi.advanceTimersByTimeAsync(20_000); await work.settle();
    expect(work.entries()).toHaveLength(0); expect(work.refetch).toHaveBeenCalledTimes(1); expect(work.mutateAsync).not.toHaveBeenCalled();
    work.refetch.mockImplementation(async () => ({ data: feed([row(1)]) }));
    work.visibility("visible"); await work.settle(); expect(work.entries()).toHaveLength(1); expect(work.streamEnabled).toBe(true);
    work.dispose(); const count = work.refetch.mock.calls.length; await vi.advanceTimersByTimeAsync(20_000);
    expect(work.refetch).toHaveBeenCalledTimes(count); expect(vi.getTimerCount()).toBe(0); expect(work.harness.lateWrites).toBe(0);
    expect(work.document.removeEventListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));

    const hidden = workspace({ hidden: true, rows: [row(1)] }); await hidden.settle();
    await vi.advanceTimersByTimeAsync(10_000); expect(hidden.refetch).not.toHaveBeenCalled(); expect(hidden.mutateAsync).not.toHaveBeenCalled(); expect(hidden.streamEnabled).toBe(false); hidden.dispose();
    const checkLate = deferred<LiveTextCheck>();
    const unmounted = workspace({ rows: [row(1), row(2)], checkHandler: () => checkLate.promise }); await unmounted.settle(); unmounted.dispose();
    checkLate.resolve(checked(row(2))); await unmounted.settle();
    expect(unmounted.mutateAsync).toHaveBeenCalledTimes(1); expect(unmounted.harness.lateWrites).toBe(0);
  });

  it("ignores stale revision responses and serially requeues the changed row instead of keeping old proof", async () => {
    vi.useFakeTimers();
    const old = deferred<LiveTextCheck>(); const next = deferred<LiveTextCheck>();
    const work = workspace({ rows: [row(1)], checkHandler: () => old.promise }); await work.settle();
    const changed = row(1, { revision: "revised", message: message(1, { text: "Actually, move to Saturday." }) });
    work.setFeed(feed([changed])); work.event("onNewMessage"); await vi.advanceTimersByTimeAsync(120); await work.settle();
    expect(work.entries()).toHaveLength(1); expect(work.entries()[0].check).toBeUndefined(); expect(work.mutateAsync).toHaveBeenCalledTimes(1);
    work.mutateAsync.mockImplementation(() => next.promise);
    old.resolve(checked(row(1), { verified: "yes", evidence: "STALE PROOF" })); await work.settle();
    expect(work.html()).not.toContain("STALE PROOF"); expect(work.mutateAsync).toHaveBeenCalledTimes(2); expect(work.html()).toContain("Checking…");
    next.resolve(checked(changed, { evidence: "Current Saturday record checked." })); await work.settle();
    expect(work.entries()[0].check.revision).toBe("revised"); expect(work.html()).toContain("Current Saturday record checked.");
    work.dispose();
  });

  it("check failures show Review with manual Check, never expose errors or auto-retry unchanged failed stored texts", async () => {
    vi.useFakeTimers();
    const work = workspace({ rows: [row(1)], checkHandler: async () => { throw new Error("PRIVATE TEXT SQL +13015550123"); } }); await work.settle();
    expect(work.entries()[0].state).toBe("error"); expect(work.html()).toContain("Review"); expect(work.html()).toContain("Check unavailable"); expect(work.html()).not.toContain("PRIVATE TEXT");
    await vi.advanceTimersByTimeAsync(20_120); await work.settle(); work.event("onConnected"); work.event("onJobUpdate"); await vi.advanceTimersByTimeAsync(120); await work.settle();
    expect(work.mutateAsync).toHaveBeenCalledTimes(1);
    work.mutateAsync.mockImplementation(async () => checked(row(1), { verified: "yes" })); work.manual(row(1).key); await work.settle();
    expect(work.mutateAsync).toHaveBeenCalledTimes(2); expect(work.entries()[0].state).toBe("done");
    work.dispose();
  });

  it("fills the existing review-nav flex slot in every page state without changing global navigation or the content cap", () => {
    // Source/CSS contract only; actual browser width measurements are a separate regression.
    expect(css).toMatch(/\.review-nav-host\s*>\s*\.live-text-monitor-page\s*\{\s*flex:\s*1\s+1\s+0;\s*\}/);
    expect(css).toMatch(/\.live-text-monitor-page\s*\{[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.ltm-content\s*\{[^}]*max-width:\s*1180px;/);
    expect(css).not.toMatch(/\.review-nav-host\s*\{/);
    expect(source.match(/<main className="live-text-monitor-page"/g)).toHaveLength(4);
  });

  it("never persists/logs customer data, disables query/model retries, and contains no date scanner or wall of warning copy", async () => {
    const work = workspace({ rows: [row(1)] }); await work.settle();
    for (const spy of Object.values(work.storage)) expect(spy).not.toHaveBeenCalled();
    for (const spy of Object.values(work.console)) expect(spy).not.toHaveBeenCalled();
    expect(work.useQuery.mock.calls[0][1]).toMatchObject({ enabled: false, retry: false, gcTime: 0, refetchInterval: false, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchOnMount: false });
    expect(work.useMutation.mock.calls[0][0]).toMatchObject({ retry: false, gcTime: 0 });
    expect(work.refetch.mock.calls[0][0]).toEqual({ cancelRefetch: false });
    expect(source).not.toMatch(/\bfetch\s*\(/);
    for (const forbidden of ["localStorage", "sessionStorage", "console.", "EventSource", "WebSocket", "AuditCalendar", "type=\"date\"", "dailyAudit", "Run audit", "providerMessageId", "bookingId", "jobId", "cleaner" + "_jobs", "cleaner" + "Jobs"]) expect(source).not.toContain(forbidden);
    const html = work.html();
    for (const forbidden of ["warning", "complete reconciliation", "provider", "selected message day", "Quo", "Twilio", "OpenPhone", "Run audit", "private-action-id"]) expect(html).not.toContain(forbidden);
    const pageTree = work.render();
    const paragraphTexts = elements(pageTree).filter(node => node.type === "p").map(text);
    expect(paragraphTexts.every(value => value.length < 150)).toBe(true);
    expect(css).toContain("@media (max-width: 760px)"); expect(css).toContain("@media (max-width: 390px)"); expect(css).toContain("minmax(0, 1fr)");
    expect(css).toContain("overflow-wrap: anywhere"); expect(css).toContain(":focus-visible"); expect(css).not.toMatch(/min-width:\s*(?:360|390|700|800)px/);
    work.dispose();
  });
});


describe("Live Text Monitor actual-source automatic future-date sync", () => {
  it("uses checkAndSync for the initial ten, new texts, and manual Check with no sync button or extra input", async () => {
    vi.useFakeTimers();
    const initial = Array.from({ length: 12 }, (_, index) => row(index + 1));
    const work = workspace({ rows: initial, checkHandler: async input => automaticCheck(row(input.sessionId)) }); await work.settle();
    expect(work.mutateAsync.mock.calls.map(call => call[0].sessionId)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    expect(work.html()).toContain("Reads stored texts · future service dates sync automatically while open");
    expect(work.html()).toContain("Future service dates sync before verification");
    expect(work.html()).toContain("Synced 2026-11-20");
    work.setFeed(feed([...initial, row(13)])); work.event("onNewMessage"); await vi.advanceTimersByTimeAsync(120); await work.settle();
    work.manual(row(1).key); await work.settle();
    expect(work.mutateAsync.mock.calls.slice(-2).map(call => call[0])).toEqual([{ sessionId: 13, messageKey: "text-13" }, { sessionId: 1, messageKey: "text-1" }]);
    for (const call of work.mutateAsync.mock.calls) expect(Object.keys(call[0]).sort()).toEqual(["messageKey", "sessionId"]);
    const expanded = work.detail(row(1).key);
    expect(elements(expanded).filter(node => node.type === "button").map(text)).toEqual([row(1).message.text, "Check"]);
    expect(text(expanded)).not.toContain("& recheck"); expect(text(expanded)).not.toContain("Optional:");
    expect(work.plainCheck.useMutation).not.toHaveBeenCalled(); work.dispose();
  });

  it("has one mutation and the existing feed timers only, with no client date parser, sync queue, or separate source retry", () => {
    expect(source.match(/liveText\.checkAndSync\.useMutation/g)).toHaveLength(1);
    expect(source).not.toMatch(/liveText\.check\.useMutation|liveText\.syncAndCheck|liveText\.sync\b/);
    expect(source.match(/\.useMutation\(/g)).toHaveLength(1);
    expect(source.match(/setTimeout\(/g)).toHaveLength(2);
    for (const forbidden of ["manualSync", "syncClick", "runManualSync", "stopQueuedSync", "SyncTask", "syncBusy", "syncAsync", "onSync", "validSyncDate", "syncServiceDate", "ltm-sync-control", "date sync is manual", "Check stays read-only"]) expect(source).not.toContain(forbidden);
    expect(source).not.toMatch(/\bfetch\s*\(|setInterval\(|toISOString\(|getDate\(|getDay\(|getUTCDate\(/);
    expect(css).not.toContain(".ltm-sync-control"); expect(css).not.toMatch(/\.ltm-sync\s*\{/);
  });

  it("displays every server-returned date status compactly and keeps the exact fresh Review decision after a complete sync", async () => {
    const value = row(1);
    const result = automaticCheck(value, { required: "review", verified: "review", evidence: "Fresh record still needs human review.",
      syncs: [syncSummary(), syncSummary({ date: "2026-11-21" })] });
    const work = workspace({ rows: [value], checkHandler: async () => result }); await work.settle();
    expect(work.entries()[0].check).toEqual(result); expect(work.entries()[0].state).toBe("done");
    expect(work.html()).toContain("Synced 2026-11-20"); expect(work.html()).toContain("Synced 2026-11-21");
    expect(work.html()).toContain("Fresh record still needs human review."); expect(work.html()).toContain("Review");
    expect(work.html()).not.toMatch(/ltm-status-(?:yes|no)/); expect(work.html()).toMatch(/<strong>0<\/strong> Verified/);
    const statuses = elements(work.detail(value.key)).filter(node => node.props?.className === "ltm-sync-status ltm-sync-synced");
    expect(statuses.map(text)).toEqual(["Synced 2026-11-20", "Synced 2026-11-21"]);
    expect(statuses.every(node => node.props.role === "status")).toBe(true); work.dispose();
  });

  it("shows incomplete dates and the server's Review result without provider diagnostics or previous Yes proof", async () => {
    const value = row(1);
    const cases: Partial<LiveTextSyncSummary>[] = [{ complete: false },
      ...["SOURCE_UNAVAILABLE", "SOURCE_INCOMPLETE", "SYNC_UNAVAILABLE", "PROTECTED_RECORDS", "STALE_TEXT"].map(failure => ({ complete: false, failure: failure as LiveTextSyncSummary["failure"] })),
      { complete: true, failure: "SOURCE_INCOMPLETE" }];
    for (const summary of cases) {
      const work = workspace({ rows: [value], checkHandler: async () => automaticCheck(value, { evidence: "OLD YES PROOF" }) }); await work.settle();
      const result = automaticCheck(value, { required: "review", verified: "review", summary: "Future service date needs review.", evidence: "Current record could not be verified.", actions: [],
        syncs: [syncSummary({ date: "2026-11-22", ...summary })] });
      work.mutateAsync.mockResolvedValue(result); work.manual(value.key); await work.settle();
      expect(work.entries()[0].check).toEqual(result);
      expect(work.html()).toContain("Incomplete · 2026-11-22 · Review"); expect(work.html()).toContain("Current record could not be verified.");
      expect(work.html()).toMatch(/<strong>0<\/strong> Verified/); expect(work.html()).not.toMatch(/ltm-status-(?:yes|no)/);
      for (const forbidden of ["OLD YES PROOF", "Synced 2026-11-20", "Synced 2026-11-22", "SOURCE_", "PROTECTED_RECORDS", "provider", "fetched", "created", "updated", "checkedAt"]) expect(work.html()).not.toContain(forbidden);
      expect(renderToStaticMarkup(work.detail(value.key))).not.toContain("scheduled"); work.dispose();
    }
  });

  it("hides previous proof and date status throughout pending automatic reverification, retaining the exact-session conversation", async () => {
    const value = row(1, { sessionId: 99, customerName: null, message: message(1, { sessionId: 99, businessPhone: null }) });
    const reply = message(2, { sessionId: 99, businessPhone: null, direction: "outbound", text: "Exact session stored reply" });
    const work = workspace({ rows: [value], checkHandler: async () => automaticCheck(value, { summary: "OLD REQUIRED PROOF", evidence: "OLD VERIFIED PROOF", conversation: [value.message, reply] }) }); await work.settle();
    const pending = deferred<LiveTextCheck>(); work.mutateAsync.mockImplementation(() => pending.promise);
    work.event("onJobUpdate"); work.render(); work.event("onBookingFunnelUpdate"); work.manual(value.key); await work.settle();
    expect(work.mutateAsync).toHaveBeenCalledTimes(2); expect(work.entries()[0].state).toBe("pending");
    const html = renderToStaticMarkup(work.detail(value.key));
    expect(html).toContain("Checking…"); expect(html).toContain("Exact session stored reply"); expect(html).toContain("Synthetic customer");
    for (const forbidden of ["OLD REQUIRED PROOF", "OLD VERIFIED PROOF", "Synced 2026-11-20", "Booking still shows Friday at 9.", "scheduled", "Current record", 'href="/admin/bookings"']) expect(html).not.toContain(forbidden);
    expect(work.html()).toMatch(/<strong>0<\/strong> Verified/);
    const result = automaticCheck(value, { evidence: "Only the fresh result is current.", syncs: [syncSummary({ date: "2026-11-23" })] });
    pending.resolve(result); await work.settle();
    expect(work.entries()[0].check).toEqual(result); expect(work.html()).toContain("Synced 2026-11-23"); expect(work.html()).toContain("Only the fresh result is current.");
    work.dispose();
  });

  it("rejected automatic rechecks show Review, hide old Yes and private errors, and never retry unchanged texts on feed polling or events", async () => {
    vi.useFakeTimers();
    const value = row(1);
    const work = workspace({ rows: [value], checkHandler: async () => automaticCheck(value, { evidence: "OLD VERIFIED PROOF" }) }); await work.settle();
    work.mutateAsync.mockRejectedValue(new Error("PRIVATE SQL provider +13015550123")); work.manual(value.key); await work.settle();
    expect(work.entries()[0].state).toBe("error"); expect(work.html()).toContain("Review"); expect(work.html()).toContain("Check unavailable");
    const html = renderToStaticMarkup(work.detail(value.key));
    for (const forbidden of ["OLD VERIFIED PROOF", "PRIVATE SQL", "Synced 2026-11-20", "scheduled", "Current record"]) expect(html).not.toContain(forbidden);
    expect(html).not.toMatch(/ltm-status-(?:yes|no)/); expect(work.html()).toMatch(/<strong>0<\/strong> Verified/);
    for (const event of ["onNewMessage", "onConnected", "onJobUpdate", "onBookingFunnelUpdate"]) work.event(event);
    await vi.advanceTimersByTimeAsync(20_120); await work.settle(); expect(work.mutateAsync).toHaveBeenCalledTimes(2);
    work.mutateAsync.mockResolvedValue(automaticCheck(value)); work.manual(value.key); await work.settle();
    expect(work.mutateAsync).toHaveBeenCalledTimes(3); expect(work.html()).toContain("Synced 2026-11-20"); work.dispose();
  });

  it("rejects foreign row/revision results and serializes revised texts without installing stale proof or date receipts", async () => {
    vi.useFakeTimers();
    const value = row(1);
    for (const foreign of [row(2), row(1, { revision: "foreign-revision" })]) {
      const work = workspace({ rows: [value], checkHandler: async () => automaticCheck(foreign, { evidence: "FOREIGN PROOF" }) }); await work.settle();
      expect(work.entries()[0].state).toBe("error"); expect(work.entries()[0].check).toBeUndefined();
      expect(work.html()).toContain("Review"); expect(work.html()).not.toContain("FOREIGN PROOF"); expect(work.html()).not.toContain("Synced 2026-11-20");
      await vi.advanceTimersByTimeAsync(120); await work.settle(); expect(work.mutateAsync).toHaveBeenCalledTimes(1); work.dispose();
    }
    const old = deferred<LiveTextCheck>(); const fresh = deferred<LiveTextCheck>();
    const work = workspace({ rows: [value], checkHandler: () => old.promise }); await work.settle();
    const changed = row(1, { revision: "next-revision", message: message(1, { text: "New exact service request" }) });
    work.setFeed(feed([changed])); work.event("onNewMessage"); await vi.advanceTimersByTimeAsync(120); await work.settle();
    expect(work.mutateAsync).toHaveBeenCalledTimes(1); expect(work.entries()[0].check).toBeUndefined();
    work.mutateAsync.mockImplementation(() => fresh.promise); old.resolve(automaticCheck(value, { evidence: "STALE SYNC PROOF" })); await work.settle();
    expect(work.mutateAsync).toHaveBeenCalledTimes(2); expect(work.html()).not.toContain("STALE SYNC PROOF"); expect(work.html()).not.toContain("Synced 2026-11-20");
    const result = automaticCheck(changed, { syncs: [syncSummary({ date: "2026-11-24" })] }); fresh.resolve(result); await work.settle();
    expect(work.entries()[0].check).toEqual(result); expect(work.html()).toContain("Synced 2026-11-24"); work.dispose();
  });

  it("rejects late automatic results after eviction/reinsertion at the same revision and after unmount", async () => {
    vi.useFakeTimers();
    const value = row(1); const old = deferred<LiveTextCheck>(); const fresh = deferred<LiveTextCheck>();
    const work = workspace({ rows: [value], checkHandler: () => old.promise }); await work.settle();
    const initialEpoch = work.entries()[0].epoch;
    work.setFeed(feed([])); work.event("onNewMessage"); await vi.advanceTimersByTimeAsync(120); await work.settle(); expect(work.entries()).toHaveLength(0);
    work.setFeed(feed([value])); work.event("onNewMessage"); await vi.advanceTimersByTimeAsync(120); await work.settle();
    expect(work.entries()[0].epoch).not.toBe(initialEpoch); expect(work.entries()[0].check).toBeUndefined(); expect(work.mutateAsync).toHaveBeenCalledTimes(1);
    work.mutateAsync.mockImplementation(() => fresh.promise); old.resolve(automaticCheck(value, { evidence: "EVICTED PROOF" })); await work.settle();
    expect(work.mutateAsync).toHaveBeenCalledTimes(2); expect(work.html()).not.toContain("EVICTED PROOF"); expect(work.html()).not.toContain("Synced 2026-11-20");
    fresh.resolve(automaticCheck(value)); await work.settle(); work.dispose();
    const late = deferred<LiveTextCheck>();
    const dead = workspace({ rows: [row(1), row(2)], checkHandler: () => late.promise }); await dead.settle(); dead.dispose();
    late.resolve(automaticCheck(row(2))); await Promise.resolve(); await Promise.resolve(); await vi.advanceTimersByTimeAsync(20_000);
    expect(dead.harness.lateWrites).toBe(0); expect(dead.mutateAsync).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });

  it("starts no automatic checks in paused/hidden pages, allows the one sent result to finish, and resumes the same bounded queue", async () => {
    vi.useFakeTimers();
    for (const hide of [false, true]) {
      const pending = deferred<LiveTextCheck>();
      const work = workspace({ rows: [row(1), row(2)], checkHandler: () => pending.promise }); await work.settle();
      expect(work.mutateAsync).toHaveBeenCalledTimes(1);
      const staleCheck = find(work.detail(row(1).key), node => node.props?.className === "ltm-check");
      if (hide) work.visibility("hidden"); else work.pause();
      staleCheck.props.onClick(); work.manual(row(1).key); work.event("onJobUpdate"); work.event("onNewMessage");
      await vi.advanceTimersByTimeAsync(20_000); await work.settle(); expect(work.mutateAsync).toHaveBeenCalledTimes(1); expect(work.refetch).toHaveBeenCalledTimes(1);
      expect(find(work.detail(row(1).key), node => node.props?.className === "ltm-check").props.disabled).toBe(true);
      pending.resolve(automaticCheck(row(2))); await work.settle(); expect(work.html()).toContain("Synced 2026-11-20"); expect(work.mutateAsync).toHaveBeenCalledTimes(1);
      work.mutateAsync.mockImplementation(async input => automaticCheck(row(input.sessionId)));
      if (hide) work.visibility("visible"); else work.pause();
      await work.settle(); expect(work.mutateAsync).toHaveBeenCalledTimes(2); expect(work.mutateAsync.mock.calls.at(-1)?.[0]).toEqual({ sessionId: 1, messageKey: "text-1" });
      work.dispose(); staleCheck.props.onClick(); await Promise.resolve(); expect(work.harness.lateWrites).toBe(0); expect(work.mutateAsync).toHaveBeenCalledTimes(2);
    }
    const hidden = workspace({ hidden: true, rows: [row(1)], checkHandler: async () => automaticCheck(row(1)) }); await hidden.settle();
    await vi.advanceTimersByTimeAsync(20_000); expect(hidden.refetch).not.toHaveBeenCalled(); expect(hidden.mutateAsync).not.toHaveBeenCalled(); expect(hidden.streamEnabled).toBe(false); hidden.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps unchanged automatic receipts through feed polling and cached-history failures without a new sync loop", async () => {
    vi.useFakeTimers();
    const work = workspace({ rows: [row(1)], checkHandler: async () => automaticCheck(row(1)) }); await work.settle();
    const result = work.entries()[0].check;
    await vi.advanceTimersByTimeAsync(15_120); await work.settle(); expect(work.refetch.mock.calls.length).toBeGreaterThan(1); expect(work.mutateAsync).toHaveBeenCalledTimes(1);
    work.setFeed(feed([], { unavailable: true, failure: "DB_TIMEOUT" })); work.event("onConnected"); await vi.advanceTimersByTimeAsync(120); await work.settle();
    expect(work.entries()[0].check).toEqual(result); expect(work.html()).toContain("Synced 2026-11-20"); expect(work.html()).toContain("showing cached texts");
    expect(work.html()).toMatch(/<strong>1<\/strong> Cached verified/); expect(work.html()).not.toContain("ltm-live-on"); expect(work.mutateAsync).toHaveBeenCalledTimes(1);
    work.setFeed(feed([row(1)])); work.retry(); await vi.advanceTimersByTimeAsync(120); await work.settle();
    work.visibility("hidden"); work.visibility("visible"); await work.settle(); work.pause(); work.pause(); await work.settle();
    expect(work.mutateAsync).toHaveBeenCalledTimes(1); expect(work.plainCheck.useMutation).not.toHaveBeenCalled(); work.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
});
