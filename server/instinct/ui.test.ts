import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import ts from "typescript";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as contract from "../../shared/instinct";
import { InstinctController, sourceLabel, visibleGroups, type InstinctEnvironment } from "../../client/src/features/instinct/useInstinct";
import { InstinctPanels } from "../../client/src/features/instinct/InstinctPanels";
import { INSTINCT_CHARACTER } from "../../client/src/features/instinct/character";
import type { ChatAnswer, CheckResult, CoverageReceipt, EvidenceRef, InstinctApi, InstinctFeed, InstinctIssue, Investigation, IssueGroup, SourceInventory, StoredEvidence } from "../../shared/instinct";

const root = resolve(import.meta.dirname, "../..");
const stamp = "2026-11-13T18:00:00.000Z";
const fingerprint = (id: number) => createHash("sha256").update(`synthetic-${id}`).digest("hex");
const caps = contract.STAGE1_CAPABILITIES;
function coverage(read = 1, extra: Partial<CoverageReceipt> = {}): CoverageReceipt {
  return { receiptId: "coverage-fixture", authorizedScope: "fixture-installation", sourceAccountKey: "fixture-account", sourceKinds: ["sms"], boundaries: [], continuation: null,
    read, analyzed: read, unprocessed: 0, unavailable: 0, partial: false, exclusions: [], checkedAtUtc: stamp, ...extra };
}
function ref(id: number, extra: Partial<EvidenceRef> = {}): EvidenceRef {
  return { store: "conversation_sessions", sourceKind: "sms", sourceId: `source-${id}`, providerId: null, sourceRevision: `source-rev-${id}`,
    contextFingerprint: fingerprint(id), sourceAccountKey: "fixture-account", sessionId: String(id), threadId: null, occurredAtUtc: stamp, observedAtUtc: stamp, timeBasis: "history", handlingEvidence: null, ...extra };
}
function evidence(id: number): StoredEvidence {
  return { ref: ref(id), originalText: `Synthetic request ${id}`, originalTurns: [], translatedText: null,
    participants: { from: "+13015550123", to: ["+13015550456"], cc: [], replyTo: null, businessLine: "+13015550456", mailbox: null },
    direction: "inbound", contentBasis: "original_full", availability: "complete", limitations: [] };
}
function issue(id: number, extra: Partial<InstinctIssue> = {}): InstinctIssue {
  return { issueId: `issue-${id}`, revision: `issue-rev-${id}`, identity: { installationScope: "fixture-installation", sourceAccountKey: "fixture-account", phone: "+13015550123", email: null,
    sessionIds: [String(id)], customerPortalAccountId: null, decision: "verified", reasons: [], evidenceRefs: [ref(id)], fingerprint: fingerprint(id), displayName: `Synthetic person ${id}` },
    action: null, expectation: null, target: { bookingId: null, jobId: null, launch27BookingId: null, bookingSeriesId: null, publicBookingNumber: null, scope: "unspecified", localDate: null,
      localTime: null, arrivalWindow: null, timeZone: null, occurredAtUtc: null }, citations: [{ ref: ref(id), start: 0, end: 9, exactQuote: "Synthetic" }],
    outcome: "review", explanation: `Synthetic review ${id}`, priorityReason: null, recordFingerprint: null, checkedAtUtc: stamp, coverage: coverage(),
    analysis: { status: "complete", contextRevision: fingerprint(id), contextFingerprint: fingerprint(id), actions: [], totalSegments: 1, completedSegments: 1, reductionComplete: true, failure: null, limitations: [] },
    verification: null, fulfillment: "unknown", notification: "unknown", delivery: "unknown", supersededBy: null, transient: true, ...extra };
}
function groups(issues: InstinctIssue[]): IssueGroup[] { return issues.map(item => ({ groupId: `group-${item.issueId}`, identity: item.identity, issues: [item], requestCount: item.action === null ? 0 : 1, verifiedCustomer: true })); }
function feed(issues: InstinctIssue[] = [], extra: Partial<InstinctFeed> = {}): InstinctFeed {
  const rows = groups(issues);
  return { binding: { requestId: "feed-request", contextRevision: null, selectedIssueId: null, selectedIssueRevision: null }, coverage: coverage(issues.length), capabilities: caps, limitations: [], groups: rows,
    continuation: null, reviewedUnavailable: true, totals: { requests: rows.reduce((sum, group) => sum + group.requestCount, 0), customerGroups: rows.length, verifiedCustomers: rows.length,
      outcomes: { checking: 0, no_action: 0, matches_current: 0, discrepancy: 0, review: issues.length, analysis_unavailable: 0, record_unavailable: 0 } }, ...extra };
}
function inventory(items: StoredEvidence[], continuation: string | null = null): SourceInventory {
  return { binding: { requestId: "sources-request", contextRevision: null, selectedIssueId: null, selectedIssueRevision: null }, coverage: coverage(items.length, { analyzed: 0, unprocessed: items.length, partial: items.length > 0 || continuation !== null, continuation }),
    capabilities: caps, limitations: [], items, inventory: { inventoryId: "inventory-fixture", sourceAccountKey: "fixture-account", authorizationVersion: "auth-v1", sourceKinds: ["sms"], families: [], capturedAtUtc: stamp }, continuation };
}
function checked(input: contract.CheckInput, extra: Partial<CheckResult> = {}): CheckResult {
  return { binding: { requestId: "check-request", contextRevision: input.expectedContextRevision, selectedIssueId: null, selectedIssueRevision: null }, contextRevision: input.expectedContextRevision,
    analysis: { status: "complete", contextRevision: input.expectedContextRevision, contextFingerprint: input.sourceRefs[0].contextFingerprint, actions: [], totalSegments: 1, completedSegments: 1, reductionComplete: true, failure: null, limitations: [] },
    coverage: coverage(input.sourceRefs.length), capabilities: caps, limitations: [], issues: [], ...extra };
}
function investigation(value: InstinctIssue): Investigation {
  return { binding: { requestId: "evidence-request", contextRevision: value.analysis.contextRevision, selectedIssueId: value.issueId, selectedIssueRevision: value.revision }, coverage: value.coverage,
    capabilities: caps, limitations: [], issue: value, evidence: [{ ...evidence(Number(value.identity.sessionIds[0])), ref: value.identity.evidenceRefs[0] }], citations: value.citations, snapshot: null };
}
function answer(input: contract.AskInput, extra: Partial<ChatAnswer> = {}): ChatAnswer {
  return { binding: { requestId: input.requestId, contextRevision: input.selectedIssueId ? fingerprint(Number(input.selectedIssueId.split("-")[1])) : null, selectedIssueId: input.selectedIssueId ?? null, selectedIssueRevision: input.selectedIssueRevision ?? null },
    threadId: input.threadId, status: "clarification", answer: "Synthetic grounded clarification", citations: [], recordCitations: [], comparison: null, failure: null,
    coverage: coverage(0), capabilities: caps, limitations: ["Synthetic offline evidence only"], ...extra };
}
function deferred<T>() { let yes!: (value: T) => void; let no!: (value: unknown) => void; const promise = new Promise<T>((resolve, reject) => { yes = resolve; no = reject; }); return { promise, resolve: yes, reject: no }; }
function harness(overrides: Partial<InstinctApi> = {}, options: { items?: StoredEvidence[]; issues?: InstinctIssue[]; hidden?: boolean } = {}) {
  let visible = !options.hidden, serial = 0;
  const environment: InstinctEnvironment = { visible: () => visible, later: (callback, delay) => setTimeout(callback, delay), cancel: clearTimeout, requestId: () => `synthetic-request-${++serial}` };
  const api: InstinctApi = {
    sources: vi.fn(async () => inventory(options.items ?? [])), feed: vi.fn(async () => feed(options.issues ?? [])), check: vi.fn(async input => checked(input)),
    evidence: vi.fn(async input => investigation(options.issues?.find(value => value.issueId === input.issueId)!)),
    reverify: vi.fn(async input => { const value = options.issues?.find(value => value.issueId === input.issueId)!; return { binding: investigation(value).binding, coverage: coverage(), capabilities: caps, limitations: [], issue: value }; }),
    ask: vi.fn(async input => answer(input)), dayReview: vi.fn(async input => ({ binding: { requestId: "day-request", contextRevision: null, selectedIssueId: null, selectedIssueRevision: null }, coverage: coverage(0), capabilities: caps, limitations: [], groups: [], localDate: input.localDate, timeZone: input.timeZone, continuation: null })), ...overrides,
  };
  const controller = new InstinctController(api, environment);
  controller.start();
  return { controller, api, visibility(value: boolean) { visible = value; controller.setForeground(value); }, snapshot: controller.getSnapshot,
    settle: async () => { for (let i = 0; i < 1000; i++) await Promise.resolve(); }, dispose: controller.dispose };
}
// Test filename remains .ts: construct JSX through createElement below.
function html(controller: InstinctController) { return renderToStaticMarkup(React.createElement(InstinctPanels, { binding: { state: controller.getSnapshot(), controller } })); }
afterEach(() => vi.useRealTimers());

describe("Instinct actual-source foreground and literal V6 UI", () => {
  it("constructs without reads and stays silent hidden until visible", async () => {
    vi.useFakeTimers(); const work = harness({}, { hidden: true }); await work.settle();
    expect(work.api.feed).not.toHaveBeenCalled(); expect(work.api.sources).not.toHaveBeenCalled(); expect(work.api.check).not.toHaveBeenCalled();
    work.visibility(true); await work.settle(); expect(work.api.feed).toHaveBeenCalledTimes(1); work.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it("traverses every inventory/feed continuation and checks all 137 contexts beyond former cutoffs", async () => {
    vi.useFakeTimers(); const all = Array.from({ length: 137 }, (_, index) => evidence(index + 1));
    const api = { sources: vi.fn(async (input: contract.SourcesInput) => input.cursor ? inventory(all.slice(55)) : inventory(all.slice(0, 55), "page-two")),
      feed: vi.fn(async (input: contract.FeedInput) => input.cursor ? feed([issue(2)]) : feed([issue(1)], { continuation: "feed-two" })) };
    const work = harness(api); await work.settle();
    expect(work.snapshot().sources).toHaveLength(137); expect(work.api.check).toHaveBeenCalledTimes(137);
    expect(work.snapshot().work.every(task => task.state === "done")).toBe(true); expect(work.snapshot().feed?.groups).toHaveLength(2);
    expect(work.api.sources).toHaveBeenCalledWith({ sourceKinds: ["sms", "email", "human_call", "ai_call", "phone_unverified"], cursor: "page-two" }); work.dispose();
  });
  it("collects complete same-context refs across source pages before one analysis", async () => {
    vi.useFakeTimers(); const first = evidence(1), second = { ...evidence(2), ref: ref(2, { contextFingerprint: first.ref.contextFingerprint }) };
    const work = harness({ sources: vi.fn(async input => input.cursor ? inventory([second]) : inventory([first], "next")) }); await work.settle();
    expect(work.api.check).toHaveBeenCalledTimes(1); expect(work.api.check).toHaveBeenCalledWith({ sourceRefs: [first.ref, second.ref], expectedContextRevision: first.ref.contextFingerprint }); work.dispose();
  });
  it("fallback and event bursts refresh stored data but never model-poll unchanged revisions", async () => {
    vi.useFakeTimers(); const work = harness({}, { items: [evidence(1)] }); await work.settle(); expect(work.api.check).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 25; i++) work.controller.requestRefresh(); await vi.advanceTimersByTimeAsync(15_120); await work.settle();
    expect(work.api.check).toHaveBeenCalledTimes(1); expect(work.api.sources).toHaveBeenCalled(); work.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it("fallback freshly re-verifies actionable records without another unchanged-source analysis", async () => {
    vi.useFakeTimers(); const a = issue(1, { action: "notes" }); const work = harness({}, { items: [evidence(1)], issues: [a] });
    await work.settle(); expect(work.api.check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000); await work.settle();
    expect(work.api.reverify).toHaveBeenCalledWith({ issueId: a.issueId, issueRevision: a.revision });
    expect(work.api.check).toHaveBeenCalledTimes(1); work.dispose();
  });
  it("rejects a well-shaped check returned for another context revision", async () => {
    vi.useFakeTimers(); const work = harness({ check: vi.fn(async input => checked({ ...input, expectedContextRevision: fingerprint(99) })) }, { items: [evidence(1)] });
    await work.settle(); expect(work.snapshot().work[0].state).toBe("error"); expect(work.snapshot().feed?.groups).toEqual([]); work.dispose();
  });
  it("pauses new checks, keeps already submitted check pending, resumes retained queue", async () => {
    vi.useFakeTimers(); const pending = deferred<CheckResult>(); const check = vi.fn((input: contract.CheckInput) => check.mock.calls.length === 1 ? pending.promise : Promise.resolve(checked(input)));
    const work = harness({ check }, { items: [evidence(1), evidence(2), evidence(3)] }); await work.settle(); work.controller.togglePause();
    pending.resolve(checked(check.mock.calls[0][0])); await work.settle(); await vi.advanceTimersByTimeAsync(20_000);
    expect(check).toHaveBeenCalledTimes(1); expect(work.snapshot().work.filter(task => task.state === "queued")).toHaveLength(2);
    work.controller.togglePause(); await work.settle(); expect(check).toHaveBeenCalledTimes(3); work.dispose();
  });
  it("retains inventory continuation across pause rather than skipping the next page", async () => {
    vi.useFakeTimers(); const next = deferred<SourceInventory>(); const sources = vi.fn(async (input: contract.SourcesInput) => input.cursor ? next.promise : inventory([evidence(1)], "next-page"));
    const work = harness({ sources }); await work.settle(); work.controller.togglePause(); next.resolve(inventory([evidence(2)])); await work.settle();
    expect(work.api.check).not.toHaveBeenCalled(); work.controller.togglePause(); await work.settle();
    expect(sources.mock.calls.filter(call => call[0].cursor === "next-page")).toHaveLength(2); expect(work.api.check).toHaveBeenCalledTimes(2); work.dispose();
  });
  it("keeps settled true failures unavailable until explicit retry", async () => {
    vi.useFakeTimers(); const check = vi.fn(async (input: contract.CheckInput) => checked(input, { analysis: { ...checked(input).analysis, status: "unavailable", failure: "MODEL_UNAVAILABLE", completedSegments: 0, reductionComplete: false } }));
    const work = harness({ check }, { items: [evidence(1)] }); await work.settle(); expect(work.snapshot().work[0].state).toBe("error");
    await vi.advanceTimersByTimeAsync(10_120); await work.settle(); expect(check).toHaveBeenCalledTimes(1);
    check.mockImplementation(async input => checked(input)); work.controller.retryChecks(); await work.settle(); expect(check).toHaveBeenCalledTimes(2); expect(work.snapshot().work[0].state).toBe("done"); work.dispose();
  });
  it("never installs evidence from customer A after selection changes to B", async () => {
    vi.useFakeTimers(); const pending = deferred<Investigation>(); const a = issue(1), b = issue(2);
    const work = harness({ evidence: vi.fn(input => input.issueId === a.issueId ? pending.promise : Promise.resolve(investigation(b))) }, { items: [evidence(1), evidence(2)], issues: [a, b] });
    await work.settle(); work.controller.select(a); work.controller.select(b); await work.settle(); pending.resolve(investigation(a)); await work.settle();
    expect(work.snapshot().investigation?.issue.issueId).toBe(b.issueId); work.dispose();
  });
  it("rejects forged quotes and stale issue revisions rather than rendering evidence", async () => {
    vi.useFakeTimers(); const a = issue(1); const bad = investigation(a); bad.citations = [{ ...a.citations[0], exactQuote: "Fabricate", end: 9 }];
    const work = harness({ evidence: vi.fn(async () => bad) }, { items: [evidence(1)], issues: [a] }); await work.settle(); work.controller.select(a); await work.settle();
    expect(work.snapshot().investigation).toBeNull(); expect(work.snapshot().error).toContain("unavailable or changed"); expect(html(work.controller)).not.toContain("Fabricate"); work.dispose();
  });
  it("changed source fingerprint queues new work and invalidates selected old proof", async () => {
    vi.useFakeTimers(); const a = issue(1); let stored = evidence(1); const work = harness({ sources: vi.fn(async () => inventory([stored])) }, { issues: [a] });
    await work.settle(); work.controller.select(a); await work.settle(); expect(work.snapshot().investigation).not.toBeNull();
    stored = { ...stored, ref: { ...stored.ref, sourceRevision: "changed", contextFingerprint: fingerprint(99) } };
    work.controller.requestRefresh(); await vi.advanceTimersByTimeAsync(120); await work.settle(); expect(work.api.check).toHaveBeenCalledTimes(2); expect(work.snapshot().selected).toBeNull(); work.dispose();
  });
  it("coalesces duplicate Enter/Send, preserves question on error and supports retry", async () => {
    vi.useFakeTimers(); const pending = deferred<ChatAnswer>(); const ask = vi.fn((_input: contract.AskInput) => pending.promise); const work = harness({ ask }); await work.settle();
    work.controller.setQuestion("What did we miss?"); void work.controller.ask(); void work.controller.ask(); expect(ask).toHaveBeenCalledTimes(1);
    pending.reject(new Error("PRIVATE SQL secret")); await work.settle(); expect(work.snapshot().question).toBe("What did we miss?"); expect(work.snapshot().messages[0].error).toBe(true);
    ask.mockImplementation(async input => answer(input)); await work.controller.ask(); expect(ask).toHaveBeenCalledTimes(2); expect(work.snapshot().question).toBe(""); expect(html(work.controller)).not.toContain("PRIVATE"); work.dispose();
  });
  it("drops stale chat binding and late reset/selection responses without clearing findings", async () => {
    vi.useFakeTimers(); const pending = deferred<ChatAnswer>(); const a = issue(1); const ask = vi.fn((_input: contract.AskInput) => pending.promise);
    const work = harness({ ask }, { issues: [a] }); await work.settle(); work.controller.select(a); await work.settle(); void work.controller.ask("Inspect selected");
    work.controller.resetConversation(); pending.resolve(answer(ask.mock.calls[0][0])); await work.settle();
    expect(work.snapshot().messages).toEqual([]); expect(work.snapshot().selected).toBeNull(); expect(work.snapshot().feed?.groups).toHaveLength(1); work.dispose();
  });
  it("validates question request, thread and selected issue revision binding", async () => {
    vi.useFakeTimers(); const work = harness({ ask: vi.fn(async input => answer(input, { binding: { ...answer(input).binding, requestId: "other-request" } })) });
    await work.settle(); await work.controller.ask("Retain this"); expect(work.snapshot().messages[0].answer).toBeNull(); expect(work.snapshot().question).toBe("Retain this"); work.dispose();
  });
  it("deliberate day review continues all pages and exposes partial receipt", async () => {
    vi.useFakeTimers(); const dayReview = vi.fn(async (input: contract.DayReviewInput) => ({ binding: { requestId: "day-request", contextRevision: null, selectedIssueId: null, selectedIssueRevision: null }, capabilities: caps, limitations: [],
      coverage: coverage(1, { analyzed: 0, unavailable: 1, partial: true }), groups: [groups([issue(input.cursor ? 2 : 1)])[0]], localDate: input.localDate, timeZone: input.timeZone, continuation: input.cursor ? null : "day-next" }));
    const work = harness({ dayReview }); await work.settle(); work.controller.reviewDay({ localDate: "2026-11-13", timeZone: "America/New_York", sourceKinds: ["sms"] }); await work.settle();
    expect(dayReview).toHaveBeenCalledTimes(2); expect(work.snapshot().coverage?.unavailable).toBe(1); expect(work.snapshot().feed?.groups).toHaveLength(2); work.dispose();
  });
  it("disposal stops timers and drops pending callbacks without any publication", async () => {
    vi.useFakeTimers(); const pending = deferred<SourceInventory>(); const work = harness({ sources: vi.fn(() => pending.promise) }); await work.settle();
    const listener = vi.fn(); work.controller.subscribe(listener); work.dispose(); pending.resolve(inventory([evidence(1)])); await work.settle();
    expect(listener).not.toHaveBeenCalled(); expect(work.api.check).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("empty and partial coverage do not pretend all caught up or green Watching", async () => {
    vi.useFakeTimers(); const work = harness(); await work.settle(); const output = html(work.controller);
    expect(output).toContain("Unchecked or unavailable sources are not all caught up"); expect(output).not.toContain("Watching your"); expect(output).not.toContain("Sarah Mitchell");
    work.controller.setFilter("reviewed"); expect(html(work.controller)).toContain("Durable reviewed acknowledgments are unavailable"); work.dispose();
  });
  it("four source filters preserve phone-unverified provenance and counts stay scoped", async () => {
    vi.useFakeTimers(); const a = issue(1); a.identity.evidenceRefs = [ref(1, { store: "openphone_call_recordings", sourceKind: "phone_unverified", sessionId: null })]; a.citations = [];
    const work = harness({}, { issues: [a, issue(2)] }); await work.settle(); work.controller.setSourceFilter("human_call");
    expect(visibleGroups(work.snapshot())).toHaveLength(1); expect(sourceLabel("phone_unverified")).toBe("PHONE — handling type unverified");
    const output = html(work.controller); for (const label of ["SMS", "EMAIL", "HUMAN CALL / unverified", "AI CALL"]) expect(output).toContain(label); work.dispose();
  });
  it("literal original character payload and CSS dimensions/colors/breakpoints are preserved", () => {
    const original = readFileSync("/home/ubuntu/upload/instinct_customer_intelligence_v6_no_scrollbar.html", "utf8");
    const asset = original.match(/data:image\/png;base64,[A-Za-z0-9+/=]+/)![0]; expect(INSTINCT_CHARACTER).toBe(asset);
    expect(createHash("sha256").update(asset.split(",")[1]).digest("hex")).toBe("2c301c54369a050f604fffda56702d393b1447adcd8aeca4022fc55eb7b4e64e");
    const css = readFileSync(resolve(root, "client/src/features/instinct/instinct.css"), "utf8");
    for (const token of ["height:76px", "width:51px;height:51px", "width:28px;height:28px", "background-position:50% 15%", "background-position:50% 12%", "minmax(0,1fr) minmax(0,1fr)", "#111216", "#14151a", "#b8a6ed", "#e8e5e8", "max-width:820px", "scrollbar-width:none", "overflow:auto"]) expect(css).toContain(token);
    const nav = readFileSync(resolve(root, "client/src/components/review-workspace-nav.css"), "utf8"); expect(nav).toContain("max-width:900px"); expect(nav).toContain("--review-nav-width:54px"); expect(nav).toContain("--review-nav-width:48px");
    expect(css).not.toMatch(/(?:^|\})\s*(?:body|html|header|\*)\s*\{/);
  });
  it("adds only a guarded isolated route with the real nav, preserving both monitor aliases", () => {
    const app = readFileSync(resolve(root, "client/src/App.tsx"), "utf8");
    expect(app).toContain('<Route path={"/admin/customer-intelligence"} component={InstinctCustomerIntelligenceRoute} />');
    expect(app).toContain('<Route path={"/admin/live-text-monitor"} component={LiveTextMonitorRoute} />'); expect(app).toContain('<Route path={"/admin/daily-action-audit"} component={LiveTextMonitorRoute} />');
    expect(app).toContain('<AdminPageGuard pageId="ai-actions"><ReviewWorkspaceFrame navActivePath="/admin/live-text-monitor"><InstinctCustomerIntelligence />');
    const nav = readFileSync(resolve(root, "client/src/components/ReviewWorkspaceNav.tsx"), "utf8");
    const defaults = nav.match(/const defaultOpenRoutes = (.*);/)![1]; expect(defaults).not.toContain("/admin/live-text-monitor");
  });
  it("strictly type-checks actual injected controller/panels against shared contracts without application imports", () => {
    const program = ts.createProgram(["useInstinct.ts", "InstinctPanels.tsx", "character.ts"].map(file => resolve(root, "client/src/features/instinct", file)), {
      noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
      baseUrl: root, paths: { "@shared/*": ["shared/*"] }, types: ["node"], lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    });
    const diagnostics = ts.getPreEmitDiagnostics(program).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    expect(diagnostics).toEqual([]);
  });
  it("page admin guard never mounts data transport or Ops before actual admin auth", () => {
    const source = readFileSync(resolve(root, "client/src/pages/InstinctCustomerIntelligence.tsx"), "utf8");
    for (const me of [{ isLoading: true }, { error: new Error("PRIVATE") }, { data: { isAdmin: false } }]) {
      const module = { exports: {} as { default: React.ComponentType } };
      const connected = vi.fn(() => { throw new Error("Unauthorized mount"); });
      const transpiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
      runInNewContext(transpiled, { module, exports: module.exports, require: (id: string) => id === "react" ? React : id === "@/lib/trpc" ? { trpc: { agents: { me: { useQuery: () => me } } } } :
        id.endsWith("InstinctConnectedWorkspace") ? { InstinctConnectedWorkspace: connected } : id.endsWith("InstinctPanels") ? { InstinctPanels } : id.endsWith("useInstinct") ? { useInstinct: () => { throw new Error("Unauthorized hook"); } } : (() => { throw new Error(`Unexpected import ${id}`); })() });
      const output = renderToStaticMarkup(React.createElement(module.exports.default)); expect(output).not.toContain("PRIVATE"); expect(connected).not.toHaveBeenCalled();
    }
  });
});
