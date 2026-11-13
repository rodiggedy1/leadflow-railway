import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuditMessage, AuditRecord } from "../shared/dailyActionAudit";
import type { LiveTextCheck, LiveTextFeed, LiveTextRow } from "../shared/liveTextMonitor";
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
  return { key: `text-${id}`, sessionId: 99, customerPhone: "+13015550123", businessPhone: "+13015550987", direction: "inbound",
    text: `Synthetic text ${id}: please move my cleaning to Friday at 10.`, occurredAt: new Date(Date.UTC(2026, 10, 13, 15, 0, id)).toISOString(),
    observedAt: null, timeBasis: "received", delivery: "received", source: "inbound_sms", ...overrides };
}
function row(id: number, overrides: Partial<LiveTextRow> = {}): LiveTextRow {
  return { key: `capture-${id}`, captureId: id, revision: `rev-${id}`, customerName: "Synthetic customer", message: message(id), identityAmbiguous: false, ...overrides };
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
function workspace(options: { rows?: LiveTextRow[]; feedHandler?: () => Promise<any>; checkHandler?: (input: { captureId: number }) => Promise<LiveTextCheck>; hidden?: boolean } = {}) {
  let currentFeed = feed(options.rows ?? []);
  const listeners = new Map<string, () => void>();
  const document = { visibilityState: options.hidden ? "hidden" : "visible",
    addEventListener: vi.fn((event: string, callback: () => void) => listeners.set(event, callback)),
    removeEventListener: vi.fn((event: string) => listeners.delete(event)),
  };
  const refetch = vi.fn((_options?: any) => options.feedHandler ? options.feedHandler() : Promise.resolve({ data: currentFeed }));
  const mutateAsync = vi.fn(options.checkHandler ?? (async input => checked(currentFeed.rows.find(value => value.captureId === input.captureId)!)));
  const useQuery = vi.fn((_input?: any, _options?: any) => ({ refetch }));
  const useMutation = vi.fn((_options?: any) => ({ mutateAsync }));
  let callbacks: any = {};
  let streamEnabled = false;
  const stream = vi.fn((next: any, state: any) => { callbacks = next; streamEnabled = state.enabled; });
  const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
  const console = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const harness = driver({ aiActions: { liveText: { feed: { useQuery }, check: { useMutation } } } }, stream, { document, localStorage: storage, sessionStorage: storage, console });
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
  render();
  return { harness, render, settle, entries, entryNodes, html, event, pause, visibility, manual, document, refetch, mutateAsync, useQuery, useMutation, stream, storage, console,
    setFeed(value: LiveTextFeed) { currentFeed = value; }, get streamEnabled() { return streamEnabled; },
    dispose() { harness.dispose(); },
  };
}
afterEach(() => { vi.useRealTimers(); });

describe("Live Text Monitor actual-source read-only UI", () => {
  it("mounts no feed, check, or SSE before authenticated admin access is known", () => {
    for (const response of [{ isLoading: true }, { error: new Error("PRIVATE") }, { data: null }, { data: { isAdmin: false } }]) {
      const feedQuery = vi.fn(); const checkMutation = vi.fn(); const stream = vi.fn();
      const me = vi.fn((_input?: any, _options?: any) => response);
      const ui = compile(React, { agents: { me: { useQuery: me } }, aiActions: { liveText: { feed: { useQuery: feedQuery }, check: { useMutation: checkMutation } } } }, stream);
      const html = renderToStaticMarkup(React.createElement(ui.default));
      expect(html).not.toContain("PRIVATE");
      expect(feedQuery).not.toHaveBeenCalled(); expect(checkMutation).not.toHaveBeenCalled(); expect(stream).not.toHaveBeenCalled();
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
    expect(work.mutateAsync).toHaveBeenCalledWith({ captureId: 1 });
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
    const work = workspace({ rows: [greeting, row(2)], checkHandler: async input => input.captureId === 1
      ? checked(greeting, { required: "no", verified: "not_applicable", summary: "Greeting only.", evidence: "No record change needed.", actions: [] })
      : checked(row(2), { required: "review", verified: "review", summary: "Requested time needs review.", evidence: "No matching record available.", actions: [] }) });
    await work.settle();
    expect(work.html()).toContain("Greeting only."); expect(work.html()).toContain("Not needed"); expect(work.html()).toContain("Review");
    expect(work.entries().find(entry => entry.row.captureId === 1).check.required).toBe("no");
    expect(work.entries().find(entry => entry.row.captureId === 2).check.verified).toBe("review");
    expect(work.html()).toMatch(/<strong>0<\/strong> Needs action/);
    work.dispose();
  });

  it("expands via an accessible native button into chronological same-customer texts and relevant current fields only", () => {
    const newest = row(3, { message: message(3, { text: '<script>unsafe()</script> https://bad.invalid' }) });
    const other = row(2, { message: message(2, { customerPhone: "+13015550124", text: "Different customer private context" }) });
    const first = row(1, { message: message(1, { text: "First request" }) });
    const check = checked(newest, { conversation: [newest.message, other.message, message(2, { direction: "outbound", text: "Business confirmation" }), first.message] });
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
    for (const label of ["Requested action", "Current record", "Service date", "Arrival", "scheduled"]) expect(html).toContain(label);
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

  it("renders a clear waiting state and small unavailable state without clearing prior results", async () => {
    vi.useFakeTimers();
    const work = workspace(); await work.settle();
    expect(work.html()).toContain("Waiting for texts captured in LeadFlow");
    work.setFeed(feed([row(1)])); work.event("onNewMessage"); await vi.advanceTimersByTimeAsync(120); await work.settle();
    const prior = work.entries()[0].check;
    work.refetch.mockRejectedValueOnce(new Error("PRIVATE SQL and phone")); work.event("onConnected"); await vi.advanceTimersByTimeAsync(120); await work.settle();
    expect(work.html()).toContain("Updates unavailable"); expect(work.html()).not.toContain("PRIVATE SQL"); expect(work.entries()[0].check).toEqual(prior);
    work.setFeed(feed([], { unavailable: true })); work.event("onLeadUpdate"); await vi.advanceTimersByTimeAsync(120); await work.settle();
    expect(work.entries()).toHaveLength(1);
    work.setFeed(feed([row(1)])); work.event("onConnected"); await vi.advanceTimersByTimeAsync(120); await work.settle();
    expect(work.html()).not.toContain("Updates unavailable"); expect(work.mutateAsync).toHaveBeenCalledTimes(1);
    work.dispose();
  });

  it("auto-checks only the newest ten initial captures, bounds visible rows at 100, then checks all new texts serially", async () => {
    vi.useFakeTimers();
    let active = 0; let maxActive = 0;
    const initial = Array.from({ length: 110 }, (_, index) => row(index + 1));
    const work = workspace({ rows: initial, checkHandler: async input => { active++; maxActive = Math.max(active, maxActive); await Promise.resolve(); active--; return checked(row(input.captureId)); } });
    await work.settle();
    expect(work.entries()).toHaveLength(100);
    expect(work.mutateAsync.mock.calls.map(call => call[0].captureId)).toEqual(Array.from({ length: 10 }, (_, index) => 110 - index));
    expect(work.entries().filter(entry => entry.state === "unchecked")).toHaveLength(90);
    expect(work.html()).toContain("Not checked");
    work.setFeed(feed([...initial, row(111), row(112)])); work.event("onNewMessage"); await vi.advanceTimersByTimeAsync(120); await work.settle();
    expect(work.mutateAsync.mock.calls.slice(-2).map(call => call[0].captureId)).toEqual([112, 111]);
    expect(work.entries()).toHaveLength(100); expect(maxActive).toBe(1);
    work.manual("capture-100"); await work.settle(); expect(work.mutateAsync.mock.calls.at(-1)?.[0]).toEqual({ captureId: 100 });
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
    expect(race.entries()).toHaveLength(1); expect(race.mutateAsync).toHaveBeenCalledWith({ captureId: 4 });
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
      return checked(row(input.captureId), input.captureId === 5 ? { required: "no", verified: "not_applicable", summary: "Greeting only.", actions: [] }
        : rechecking ? { verified: "yes", evidence: "Booking now shows Friday at 10." } : {});
    } });
    await work.settle();
    for (const key of ["capture-4", "capture-3", "capture-2"]) { work.manual(key); await work.settle(); }
    expect(work.entries().find(entry => entry.row.captureId === 1).state).toBe("unchecked");
    const beforeFeed = work.refetch.mock.calls.length; const beforeChecks = work.mutateAsync.mock.calls.length;
    rechecking = true;
    work.event("onJobUpdate"); work.render(); work.event("onBookingFunnelUpdate");
    expect(work.entries()[0].check.conversation).toHaveLength(1);
    expect(work.entries()[0].state).toBe("pending");
    expect(work.mutateAsync).toHaveBeenCalledTimes(beforeChecks + 1);
    hold.resolve(); await work.settle();
    const reverified = work.mutateAsync.mock.calls.slice(beforeChecks).map(call => call[0].captureId);
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
    work.event("onNewMessage"); work.event("onJobUpdate"); work.manual("capture-1");
    await vi.advanceTimersByTimeAsync(20_000); await work.settle();
    expect(work.refetch).toHaveBeenCalledTimes(1); expect(work.mutateAsync).toHaveBeenCalledTimes(1);
    response.resolve(checked(row(2))); await work.settle();
    expect(work.entries()[0].state).toBe("done"); expect(work.mutateAsync).toHaveBeenCalledTimes(1); expect(work.html()).toContain("Paused");
    work.mutateAsync.mockImplementation(async input => checked(row(input.captureId)));
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

  it("check failures show Review with manual Check, never expose errors or auto-retry unchanged failed captures", async () => {
    vi.useFakeTimers();
    const work = workspace({ rows: [row(1)], checkHandler: async () => { throw new Error("PRIVATE TEXT SQL +13015550123"); } }); await work.settle();
    expect(work.entries()[0].state).toBe("error"); expect(work.html()).toContain("Review"); expect(work.html()).toContain("Check unavailable"); expect(work.html()).not.toContain("PRIVATE TEXT");
    await vi.advanceTimersByTimeAsync(20_120); await work.settle(); work.event("onConnected"); work.event("onJobUpdate"); await vi.advanceTimersByTimeAsync(120); await work.settle();
    expect(work.mutateAsync).toHaveBeenCalledTimes(1);
    work.mutateAsync.mockImplementation(async () => checked(row(1), { verified: "yes" })); work.manual("capture-1"); await work.settle();
    expect(work.mutateAsync).toHaveBeenCalledTimes(2); expect(work.entries()[0].state).toBe("done");
    work.dispose();
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
