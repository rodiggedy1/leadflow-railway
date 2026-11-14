import { useEffect, useMemo, useState } from "react";
import {
  chatAnswerSchema, checkResultSchema, dayReviewResultSchema, feedSchema, investigationSchema,
  reverifyResultSchema, sourceInventorySchema, sameEvidenceRef,
  type ChatAnswer, type CoverageReceipt, type DayReviewInput, type EvidenceRef, type InstinctApi,
  type InstinctFeed, type InstinctIssue, type Investigation, type IssueGroup, type SourceKind,
  type StoredEvidence,
} from "@shared/instinct";

export const INSTINCT_ALL_SOURCES: SourceKind[] = ["sms", "email", "human_call", "ai_call", "phone_unverified"];
export type InstinctFilter = "all" | "urgent" | "reviewed";
export type WorkState = "queued" | "pending" | "done" | "error";
export type InstinctWork = { key: string; revision: string; refs: EvidenceRef[]; state: WorkState };
export type InstinctChatMessage = { id: string; question: string; answer: ChatAnswer | null; error: boolean };
export interface InstinctState {
  feed: InstinctFeed | null;
  coverage: CoverageReceipt | null;
  sources: StoredEvidence[];
  work: InstinctWork[];
  loading: boolean;
  scanning: boolean;
  scanComplete: boolean;
  error: string | null;
  paused: boolean;
  foreground: boolean;
  filter: InstinctFilter;
  sourceFilter: SourceKind | "all";
  selected: InstinctIssue | null;
  investigation: Investigation | null;
  investigating: boolean;
  evidenceVisible: boolean;
  question: string;
  messages: InstinctChatMessage[];
  asking: boolean;
  dayReviewing: boolean;
}
export interface InstinctEnvironment {
  visible: () => boolean;
  later: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  cancel: (timer: ReturnType<typeof setTimeout>) => void;
  requestId: () => string;
}
const browserEnvironment: InstinctEnvironment = {
  visible: () => typeof document !== "undefined" && document.visibilityState === "visible",
  later: (callback, milliseconds) => setTimeout(callback, milliseconds),
  cancel: timer => clearTimeout(timer),
  requestId: () => `instinct-${globalThis.crypto.randomUUID()}`,
};
function refKey(ref: EvidenceRef): string { return `${ref.sourceAccountKey}:${ref.store}:${ref.sourceId}`; }
export function sourceLabel(kind: SourceKind): string {
  return ({ sms: "SMS", email: "EMAIL", human_call: "HUMAN CALL", ai_call: "AI CALL", phone_unverified: "PHONE — handling type unverified" })[kind];
}
export function needsAttention(issue: InstinctIssue): boolean {
  return issue.supersededBy === null && !["no_action", "matches_current"].includes(issue.outcome);
}
export function issueMatchesSource(issue: InstinctIssue, kind: SourceKind | "all"): boolean {
  return kind === "all" || [...issue.citations.map(value => value.ref), ...issue.identity.evidenceRefs].some(ref =>
    kind === "human_call" ? ["human_call", "phone_unverified"].includes(ref.sourceKind) : ref.sourceKind === kind);
}
export function visibleGroups(state: InstinctState): IssueGroup[] {
  if (state.filter === "reviewed") return [];
  return (state.feed?.groups ?? []).map(group => ({ ...group, issues: group.issues.filter(issue =>
    needsAttention(issue) && issueMatchesSource(issue, state.sourceFilter) && (state.filter !== "urgent" || issue.priorityReason !== null)),
  })).filter(group => group.issues.length > 0);
}
function withGroups(feed: InstinctFeed, groups: IssueGroup[]): InstinctFeed {
  const outcomes = { checking: 0, no_action: 0, matches_current: 0, discrepancy: 0, review: 0, analysis_unavailable: 0, record_unavailable: 0 };
  for (const group of groups) for (const issue of group.issues) if (issue.supersededBy === null) outcomes[issue.outcome]++;
  return { ...feed, groups, totals: { requests: groups.reduce((sum, group) => sum + group.requestCount, 0),
    customerGroups: groups.length, verifiedCustomers: groups.filter(group => group.verifiedCustomer).length, outcomes } };
}
function mergeGroups(left: IssueGroup[], right: IssueGroup[]): IssueGroup[] {
  const result = new Map(left.map(group => [group.groupId, group]));
  for (const group of right) {
    const old = result.get(group.groupId);
    const issues = Array.from(new Map([...(old?.issues ?? []), ...group.issues].map(issue => [issue.issueId, issue])).values());
    result.set(group.groupId, { ...group, issues, requestCount: issues.filter(issue => issue.action !== null && issue.supersededBy === null).length });
  }
  return Array.from(result.values());
}

/** Foreground-only, injected read transport. Construction performs no reads, timers,
 * model calls or writes. Cursor pages preserve the entire corpus; submitted calls
 * finish on Pause, while no new work starts hidden, paused or after disposal. */
export class InstinctController {
  private state: InstinctState;
  private listeners = new Set<() => void>();
  private active = false;
  private disposed = false;
  private queue: string[] = [];
  private work = new Map<string, InstinctWork>();
  private refs = new Map<string, StoredEvidence>();
  private pendingCheck: string | null = null;
  private refreshBusy = false;
  private refreshDirty = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private inventoryCursor: string | undefined;
  private inventoryPages: StoredEvidence[] = [];
  private inventoryInProgress = false;
  private selectionEpoch = 0;
  private conversationEpoch = 0;
  private investigationKey: string | null = null;
  private askKey: string | null = null;
  private threadId: string;
  private dayInput: DayReviewInput | null = null;
  private dayGroups: IssueGroup[] = [];
  private recordDirty = false;
  private reverifying = false;
  constructor(private readonly api: InstinctApi, private readonly env: InstinctEnvironment = browserEnvironment) {
    this.threadId = env.requestId();
    this.state = { feed: null, coverage: null, sources: [], work: [], loading: true, scanning: false, scanComplete: false,
      error: null, paused: false, foreground: env.visible(), filter: "all", sourceFilter: "all", selected: null,
      investigation: null, investigating: false, evidenceVisible: false, question: "", messages: [], asking: false, dayReviewing: false };
  }
  getSnapshot = (): InstinctState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(update: Partial<InstinctState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...update };
    this.listeners.forEach(listener => listener());
  }
  private canRun(): boolean { return this.active && !this.disposed && !this.state.paused && this.state.foreground && this.env.visible(); }
  start = () => { if (this.disposed) return; this.active = true; this.resumeForeground(); };
  stop = () => { this.active = false; this.clearTimers(); };
  dispose = () => { this.stop(); this.disposed = true; this.listeners.clear(); this.queue = []; };
  private clearTimers() {
    if (this.refreshTimer !== null) this.env.cancel(this.refreshTimer);
    if (this.fallbackTimer !== null) this.env.cancel(this.fallbackTimer);
    this.refreshTimer = this.fallbackTimer = null;
  }
  private resumeForeground() {
    if (!this.canRun()) return;
    void this.refresh(); void this.drain(); void this.drainDay(); void this.reverifyRecords();
    if (this.fallbackTimer === null) this.fallbackTimer = this.env.later(() => {
      this.fallbackTimer = null;
      if (this.canRun()) { this.recordHint(); this.resumeFallback(); }
    }, 5_000);
  }
  private resumeFallback() {
    if (!this.canRun() || this.fallbackTimer !== null) return;
    this.fallbackTimer = this.env.later(() => { this.fallbackTimer = null; if (this.canRun()) { this.recordHint(); this.resumeFallback(); } }, 5_000);
  }
  setForeground = (foreground: boolean) => { this.publish({ foreground }); if (!foreground) this.clearTimers(); else this.resumeForeground(); };
  togglePause = () => { this.publish({ paused: !this.state.paused }); if (this.state.paused) this.clearTimers(); else this.resumeForeground(); };
  setFilter = (filter: InstinctFilter) => this.publish({ filter });
  setSourceFilter = (sourceFilter: SourceKind | "all") => this.publish({ sourceFilter });
  setQuestion = (question: string) => this.publish({ question });
  requestRefresh = () => {
    if (!this.canRun()) return;
    if (this.refreshBusy) { this.refreshDirty = true; return; }
    if (this.refreshTimer !== null) return;
    this.refreshTimer = this.env.later(() => { this.refreshTimer = null; void this.refresh(); }, 120);
  };
  recordHint = () => { if (!this.canRun()) return; this.recordDirty = true; this.requestRefresh(); void this.reverifyRecords(); };
  private selectedMatches(issue: InstinctIssue | null): boolean {
    return this.state.selected?.issueId === issue?.issueId && this.state.selected?.revision === issue?.revision;
  }
  private acceptFeed(feed: InstinctFeed) {
    const selected = this.state.selected;
    const current = selected ? feed.groups.flatMap(group => group.issues).find(issue => issue.issueId === selected.issueId) ?? null : null;
    if (selected && (current?.revision !== selected.revision || current?.recordFingerprint !== selected.recordFingerprint)) {
      this.selectionEpoch++;
      this.publish({ selected: current, investigation: null, investigating: false, evidenceVisible: false, messages: [], asking: false });
    } else if (current) this.publish({ selected: current });
    this.publish({ feed, coverage: feed.coverage });
  }
  private async refresh() {
    if (!this.canRun()) return;
    if (this.refreshBusy) { this.refreshDirty = true; return; }
    this.refreshBusy = true;
    try {
      let cursor: string | undefined;
      let accumulated: IssueGroup[] = [];
      const seen = new Set<string>();
      do {
        if (!this.canRun()) return;
        const feed = feedSchema.parse(await this.api.feed({ filter: "all", ...(cursor ? { cursor } : {}) }));
        if (!this.canRun()) return;
        accumulated = mergeGroups(accumulated, feed.groups);
        this.acceptFeed(withGroups(feed, accumulated));
        cursor = feed.continuation ?? undefined;
        if (cursor && seen.has(cursor)) throw new Error("STALE_CONTEXT");
        if (cursor) seen.add(cursor);
      } while (cursor);
      this.publish({ loading: false, error: null });
      await this.scan();
    } catch {
      if (this.active && !this.disposed) this.publish({ loading: false, scanning: false, error: "Stored updates unavailable. Retry to resume; prior results are cached." });
    } finally {
      this.refreshBusy = false;
      if (this.refreshDirty) { this.refreshDirty = false; this.requestRefresh(); }
    }
  }
  private async scan() {
    this.publish({ scanning: true });
    if (!this.inventoryInProgress) { this.inventoryCursor = undefined; this.inventoryPages = []; this.inventoryInProgress = true; }
    const seen = new Set<string>();
    do {
      if (!this.canRun()) { this.publish({ scanning: false }); return; }
      const inventory = sourceInventorySchema.parse(await this.api.sources({ sourceKinds: INSTINCT_ALL_SOURCES,
        ...(this.inventoryCursor ? { cursor: this.inventoryCursor } : {}) }));
      if (!this.canRun()) { this.publish({ scanning: false }); return; }
      this.inventoryPages.push(...inventory.items);
      this.inventoryCursor = inventory.continuation ?? undefined;
      this.publish({ sources: Array.from(new Map(this.inventoryPages.map(item => [refKey(item.ref), item])).values()), coverage: inventory.coverage });
      if (this.inventoryCursor && seen.has(this.inventoryCursor)) throw new Error("STALE_CONTEXT");
      if (this.inventoryCursor) seen.add(this.inventoryCursor);
    } while (this.inventoryCursor);
    this.inventoryInProgress = false;
    const originals = Array.from(new Map(this.inventoryPages.map(item => [refKey(item.ref), item])).values());
    this.refs = new Map(originals.map(item => [refKey(item.ref), item]));
    const contexts = new Map<string, EvidenceRef[]>();
    for (const item of originals) {
      const key = `${item.ref.sourceAccountKey}:${item.ref.contextFingerprint}`;
      contexts.set(key, [...(contexts.get(key) ?? []), item.ref]);
    }
    // New/changed contexts only. A fallback never invokes analysis for unchanged
    // sources, including settled failures, which require an explicit Retry.
    for (const [key, refs] of Array.from(contexts)) if (!this.work.has(key)) {
      this.work.set(key, { key, refs, revision: refs[0].contextFingerprint, state: "queued" });
      this.queue.push(key);
    }
    for (const [key] of Array.from(this.work)) if (!contexts.has(key) && key !== this.pendingCheck) this.work.delete(key);
    this.queue = this.queue.filter(key => contexts.has(key));
    const selected = this.state.selected;
    if (selected && !this.issueFresh(selected)) {
      this.selectionEpoch++;
      this.publish({ selected: null, investigation: null, evidenceVisible: false, investigating: false, messages: [], asking: false });
    }
    this.publish({ sources: originals, scanning: false, scanComplete: true, work: Array.from(this.work.values()) });
    void this.drain();
  }
  private workFresh(task: InstinctWork): boolean {
    return task.refs.every(ref => { const latest = this.refs.get(refKey(ref))?.ref;
      return latest?.sourceRevision === ref.sourceRevision && latest.contextFingerprint === ref.contextFingerprint; });
  }
  private issueFresh(issue: InstinctIssue): boolean {
    const refs = [...issue.identity.evidenceRefs, ...issue.citations.map(value => value.ref)];
    return refs.every(ref => { const latest = this.refs.get(refKey(ref))?.ref;
      return !latest ? !this.state.scanComplete : latest.sourceRevision === ref.sourceRevision && latest.contextFingerprint === ref.contextFingerprint; });
  }
  private publishWork() { this.publish({ work: Array.from(this.work.values()) }); }
  private async drain() {
    if (!this.canRun() || this.pendingCheck !== null) return;
    let task: InstinctWork | undefined;
    while (this.queue.length && !task) {
      const candidate = this.work.get(this.queue.shift()!);
      if (candidate && candidate.state === "queued" && this.workFresh(candidate)) task = candidate;
    }
    if (!task) return;
    const submitted = task;
    this.pendingCheck = submitted.key;
    submitted.state = "pending"; this.publishWork();
    try {
      const result = checkResultSchema.parse(await this.api.check({ sourceRefs: submitted.refs, expectedContextRevision: submitted.revision }));
      if (this.disposed || !this.active) return;
      if (!this.workFresh(submitted) || result.contextRevision !== submitted.revision || result.binding.contextRevision !== submitted.revision) {
        submitted.state = "error"; this.requestRefresh();
      } else {
        submitted.state = result.analysis.status === "unavailable" ? "error" : "done";
        // The server remains the grouping authority; refresh does not re-analyze.
        this.requestRefresh();
      }
    } catch { if (!this.disposed) submitted.state = "error"; }
    finally {
      this.pendingCheck = null;
      if (!this.active && !this.disposed && submitted.state === "pending") {
        submitted.state = "queued";
        if (!this.queue.includes(submitted.key)) this.queue.push(submitted.key);
      }
      if (!this.disposed && this.active) { this.publishWork(); void this.drain(); }
    }
  }
  retryChecks = () => {
    if (!this.canRun()) return;
    for (const task of Array.from(this.work.values())) if (task.state === "error" && this.workFresh(task)) {
      task.state = "queued"; if (!this.queue.includes(task.key)) this.queue.push(task.key);
    }
    this.publishWork(); this.requestRefresh(); void this.drain();
  };
  select = (issue: InstinctIssue) => {
    if (!this.canRun()) return;
    if (!this.selectedMatches(issue)) {
      this.selectionEpoch++;
      this.publish({ selected: issue, investigation: null, evidenceVisible: false, investigating: false, messages: [], asking: false });
    }
    void this.investigate();
  };
  investigate = async () => {
    const issue = this.state.selected;
    if (!this.canRun() || !issue) return;
    const key = `${issue.issueId}:${issue.revision}`;
    if (this.investigationKey === key) return;
    const epoch = this.selectionEpoch;
    this.investigationKey = key; this.publish({ investigating: true });
    try {
      const result = investigationSchema.parse(await this.api.evidence({ issueId: issue.issueId, issueRevision: issue.revision }));
      if (!this.active || this.disposed || epoch !== this.selectionEpoch || !this.selectedMatches(issue)) return;
      if (result.binding.selectedIssueId !== issue.issueId || result.binding.selectedIssueRevision !== issue.revision ||
        result.issue.analysis.contextRevision !== issue.analysis.contextRevision || !this.issueFresh(result.issue)) throw new Error("STALE_CONTEXT");
      // Reject even well-shaped fabricated quotes before rendering evidence.
      for (const citation of result.citations) {
        const original = result.evidence.find(value => sameEvidenceRef(value.ref, citation.ref));
        if (original?.originalText?.slice(citation.start, citation.end) !== citation.exactQuote) throw new Error("INVALID_CITATION");
      }
      this.publish({ investigation: result, error: null });
    } catch {
      if (this.active && !this.disposed && epoch === this.selectionEpoch) this.publish({ investigation: null, error: "Selected evidence unavailable or changed. Retry this exact issue." });
    } finally {
      if (this.investigationKey === key) this.investigationKey = null;
      if (!this.disposed && epoch === this.selectionEpoch) this.publish({ investigating: false });
    }
  };
  showEvidence = () => { this.publish({ evidenceVisible: true }); void this.investigate(); };
  reverify = async () => {
    const issue = this.state.selected;
    if (!this.canRun() || !issue) return;
    await this.verifyIssue(issue); this.requestRefresh();
  };
  private async verifyIssue(issue: InstinctIssue) {
    const epoch = this.selectionEpoch;
    try {
      const result = reverifyResultSchema.parse(await this.api.reverify({ issueId: issue.issueId, issueRevision: issue.revision }));
      if (!this.active || this.disposed) return;
      if (result.binding.selectedIssueId !== issue.issueId || result.binding.selectedIssueRevision !== issue.revision || !this.issueFresh(result.issue)) throw new Error("STALE_ISSUE");
      if (this.selectedMatches(issue) && epoch === this.selectionEpoch) {
        // Any fresh record proof invalidates previously displayed investigation/chat.
        this.selectionEpoch++;
        this.publish({ selected: result.issue, investigation: null, messages: [], asking: false });
      }
    } catch { if (this.active && !this.disposed) this.publish({ error: "Fresh record comparison unavailable. Retry; no booking was changed." }); }
  }
  private async reverifyRecords() {
    if (!this.canRun() || !this.recordDirty || this.reverifying) return;
    this.reverifying = true; this.recordDirty = false;
    try {
      for (const issue of this.state.feed?.groups.flatMap(group => group.issues) ?? []) {
        if (!this.canRun()) { this.recordDirty = true; break; }
        if (issue.action !== null && issue.supersededBy === null && issue.analysis.status !== "unavailable") await this.verifyIssue(issue);
      }
      this.requestRefresh();
    } finally { this.reverifying = false; if (this.recordDirty && this.canRun()) void this.reverifyRecords(); }
  }
  ask = async (question = this.state.question) => {
    const value = question.trim();
    if (!this.canRun() || !value || this.askKey !== null) return;
    const selected = this.state.selected;
    const epoch = this.selectionEpoch, conversation = this.conversationEpoch;
    const threadId = this.threadId, requestId = this.env.requestId();
    const key = `${threadId}:${requestId}`;
    this.askKey = key;
    const message: InstinctChatMessage = { id: requestId, question: value, answer: null, error: false };
    this.publish({ question: value, asking: true, messages: [...this.state.messages, message] });
    try {
      const answer = chatAnswerSchema.parse(await this.api.ask({ threadId, requestId, question: value,
        ...(selected ? { selectedIssueId: selected.issueId, selectedIssueRevision: selected.revision } : {}) }));
      if (!this.active || this.disposed || epoch !== this.selectionEpoch || conversation !== this.conversationEpoch) return;
      if (answer.threadId !== threadId || answer.binding.requestId !== requestId || answer.binding.selectedIssueId !== (selected?.issueId ?? null) ||
        answer.binding.selectedIssueRevision !== (selected?.revision ?? null) || selected && answer.binding.contextRevision !== selected.analysis.contextRevision) throw new Error("STALE_RESPONSE");
      this.publish({ messages: this.state.messages.map(item => item.id === requestId ? { ...item, answer, error: answer.status === "unavailable" } : item),
        question: answer.status === "unavailable" || this.state.question !== value ? this.state.question : "" });
    } catch {
      if (this.active && !this.disposed && epoch === this.selectionEpoch && conversation === this.conversationEpoch)
        this.publish({ messages: this.state.messages.map(item => item.id === requestId ? { ...item, error: true } : item) });
    } finally {
      if (this.askKey === key) this.askKey = null;
      if (!this.disposed && epoch === this.selectionEpoch && conversation === this.conversationEpoch) this.publish({ asking: false });
    }
  };
  resetConversation = () => {
    this.selectionEpoch++; this.conversationEpoch++; this.threadId = this.env.requestId();
    this.publish({ selected: null, investigation: null, messages: [], question: "", asking: false, investigating: false, evidenceVisible: false });
  };
  reviewDay = (input: DayReviewInput) => { if (!this.canRun() || this.dayInput) return; this.dayInput = input; this.dayGroups = []; void this.drainDay(); };
  private dayBusy = false;
  private async drainDay() {
    if (!this.canRun() || !this.dayInput || this.dayBusy) return;
    this.dayBusy = true; this.publish({ dayReviewing: true });
    const seen = new Set<string>();
    try {
      while (this.dayInput && this.canRun()) {
        const input: DayReviewInput = this.dayInput;
        const result = dayReviewResultSchema.parse(await this.api.dayReview(input));
        if (!this.active || this.disposed) return;
        if (result.localDate !== input.localDate || result.timeZone !== input.timeZone) throw new Error("STALE_CONTEXT");
        this.dayGroups = mergeGroups(this.dayGroups, result.groups);
        const feed = this.state.feed;
        this.publish({ coverage: result.coverage, ...(feed ? { feed: withGroups(feed, mergeGroups(feed.groups, this.dayGroups)) } : {}) });
        this.dayInput = result.continuation ? { ...input, cursor: result.continuation } : null;
        if (result.continuation && seen.has(result.continuation)) throw new Error("STALE_CONTEXT");
        if (result.continuation) seen.add(result.continuation);
      }
    } catch { if (!this.disposed) this.publish({ error: "Stored-day review unavailable. Retry to resume the retained continuation." }); }
    finally { this.dayBusy = false; if (!this.disposed) this.publish({ dayReviewing: false }); }
  }
  retryDay = () => { void this.drainDay(); };
}
export function useInstinct(api: InstinctApi, environment?: InstinctEnvironment) {
  const controller = useMemo(() => new InstinctController(api, environment), [api, environment]);
  const [state, setState] = useState(controller.getSnapshot);
  useEffect(() => {
    const unsubscribe = controller.subscribe(() => setState(controller.getSnapshot()));
    setState(controller.getSnapshot()); controller.start();
    const visibility = () => controller.setForeground(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", visibility);
    return () => { unsubscribe(); controller.stop(); document.removeEventListener("visibilitychange", visibility); };
  }, [controller]);
  return { state, controller };
}
export type InstinctWorkspaceBinding = ReturnType<typeof useInstinct>;
