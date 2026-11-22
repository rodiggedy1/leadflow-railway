import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { claudeSmsAlternativeGenerateInputSchema, claudeSmsAlternativeResultSchema, type ClaudeSmsAlternativeGenerateInput, type ClaudeSmsAlternativeResult } from "../shared/claudeSmsAlternative";
import { THUMBTACK_FIRST_RESPONSE_PROMPT, buildThumbtackLeadDraftContext, claudeInitialLeadInputSchema, claudeInitialLeadResultSchema, type ClaudeInitialLeadFacts, type ClaudeInitialLeadInput, type ClaudeInitialLeadResult } from "../shared/claudeInitialLead";
import { getCsInboxReplyPhoneNumberIdForSelectedConversation } from "../shared/csInboxPhoneNumberRouting";
import { claudeDraftSourceSchema, reviewedClaudeSmsProvenance, smsSenderLabel, smsSenderProvenanceSchema } from "../shared/smsSenderProvenance";
import { actualSmsTaskMessageAnchors, expandSmsTaskTimeline } from "./smsTaskTimelineUiHarness";

// Local actual-source controller/render gate. No router, DB, authentication,
// provider, model, network, or real customer data is imported or invoked.
const source = readFileSync(new URL("../client/src/pages/CommandChatExactLive.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("CommandChatExactLive.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const drawerNode = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "SmsConversationDrawer")!;
const drawerSource = drawerNode.getText(ast);
const compiled = ts.transpileModule(`${drawerSource}\nexports.Drawer = SmsConversationDrawer;`, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
} }).outputText;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const between = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end));
const icon = () => React.createElement("svg");
const iconNames = ["Users", "Eye", "X", "CalendarClock", "Sparkles", "ChevronRight", "Loader2", "RefreshCw", "ChevronDown", "Pencil", "Send"];

type Conversation = {
  id: number; leadName: string | null; leadPhone: string | null; leadSource: string | null;
  lastMessageText: string | null; lastMessageTs: number | null; lastMsgTs: number | null;
  lastSenderRole: string | null; hasUnanswered: boolean; aiSummary: string | null;
  personType: "customer" | "team"; lastInboundPhoneNumberId: string | null; receivedAt: number; calledAt: number | null;
};
type Detail = { sessionId: number; leadPhone: string | null; messageHistory: string };
type LeadSnapshot = ClaudeInitialLeadFacts & { id: number; sessionId: number | null; phone: string; sourceLabel: string; detail: string };
type Props = { conversation: Conversation; conversations: Conversation[]; callerName: string; callerPhotoUrl: null;
  photoMap: Record<string, string>; businessDate: string; leadCardPhone?: string; lead: LeadSnapshot | null;
  leadCardSnapshot?: LeadSnapshot | null; leadDraft?: { scenario: string; jobContext: string } | null;
  onNotice: (message: string) => void; onOpenLeadDetails: () => void; onSessionResolved: () => void; onClose: () => void };
type Element = React.ReactElement<Record<string, unknown>>;
type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
const conversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: 42, leadName: "Synthetic customer", leadPhone: "+13015550123", leadSource: "cs-inbound",
  lastMessageText: "Please confirm Friday.", lastMessageTs: 1800000000000, lastMsgTs: 1800000000000,
  lastSenderRole: "user", hasUnanswered: true, aiSummary: null, personType: "customer",
  lastInboundPhoneNumberId: "PN_SYNTHETIC_LINE", receivedAt: 1800000000000, calledAt: null, ...overrides,
});
const history = (providerMessageId: string | null = "OM_SYNTHETIC_INBOUND") => JSON.stringify([
  { role: "assistant", content: "Earlier reply", ts: 1800000000001, opMsgId: "OM_OUTBOUND" },
  { role: "user", content: "Please confirm Friday.", ts: 1800000000000, ...(providerMessageId ? { opMsgId: providerMessageId } : {}) },
]);
const result = (request: ClaudeSmsAlternativeGenerateInput, overrides: Partial<ClaudeSmsAlternativeResult> = {}): ClaudeSmsAlternativeResult => ({
  ...request, receivingPhoneNumber: "+13015550987", replyText: "Synthetic Claude reply for review.", contextHash: "a".repeat(64),
  mode: "review_only", smsSent: false, actionsExecuted: false, agentId: "synthetic-agent", agentSessionId: "synthetic-agent-session", ...overrides,
});
const leadFacts = (overrides: Partial<ClaudeInitialLeadFacts> = {}): ClaudeInitialLeadFacts => ({
  name: "Synthetic clicked lead", serviceType: "Move in deep cleaning", category: "House cleaning", address: "Synthetic address",
  location: "Frederick", requestedDates: "Oct 30 or 31", bedrooms: "5", bathrooms: "4", homeSize: "4,300 sq ft",
  rooms: "All three levels", propertyType: "House", frequency: "Every 2 weeks", extras: ["inside cabinets", "fridge", "oven", "laundry"],
  pets: "Two cats", description: "Skip builder-restricted room; confirm conflicting four bedroom note.", summary: "Retained summary",
  travelPreferences: ["Professional travels to me"], proposedTimes: [{ start: "2026-10-30T10:00:00Z", end: "2026-10-30T12:00:00Z" }],
  nativeDetails: [{ question: "Special requests", answer: "Baseboards and window tracks" }, { answer: "Please confirm hourly pricing" }, { question: "Empty answer" }],
  ...overrides,
});
const leadSnapshot = (overrides: Partial<LeadSnapshot> = {}): LeadSnapshot => ({ ...leadFacts(), id: 501, sessionId: null,
  phone: "(301) 555-0123", sourceLabel: "Thumbtack", detail: "Clicked card details", ...overrides });
const initialResult = (request: ClaudeInitialLeadInput, overrides: Partial<ClaudeInitialLeadResult> = {}): ClaudeInitialLeadResult => ({
  kind: "initial_lead", requestId: request.requestId, sessionId: request.sessionId, customerPhone: "+13015550123",
  replyText: "Synthetic Claude first lead reply.", contextHash: "b".repeat(64), mode: "review_only", smsSent: false,
  actionsExecuted: false, agentId: "synthetic-agent", agentSessionId: "synthetic-agent-session", ...overrides,
});
const normalizedLeadPhone = (value: string | null) => value?.replace(/\D/g, "").slice(-10) || "";
function clickedLeadDraft(lead: LeadSnapshot, inbox: Conversation[] = []): { draft: Props["leadDraft"]; snapshot: LeadSnapshot | null; selected: Conversation | null } {
  let draft: Props["leadDraft"] = null;
  let snapshot: LeadSnapshot | null = null;
  let selected: Conversation | null = null;
  const script = ts.transpileModule(`${between("  const openSmsDrawerFromLead =", "  const addPendingOutgoingMessage =")}\nopenSmsDrawerFromLead(lead);`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  runInNewContext(script, { lead, useCallback: (callback: unknown) => callback, smsInbox: inbox, showNotice: vi.fn(),
    setSelectedLeadCardPhone: vi.fn(), setSelectedSmsConversation: (value: Conversation) => { selected = value; },
    setSelectedLeadCardDraft: (value: Props["leadDraft"]) => { draft = value; },
    setSelectedLeadCardSnapshot: (value: LeadSnapshot) => { snapshot = value; }, normalizedLeadPhone,
    THUMBTACK_FIRST_RESPONSE_PROMPT, buildThumbtackLeadDraftContext }, { timeout: 1500 });
  return { draft, snapshot, selected };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const elements = (tree: unknown): Element[] => Array.isArray(tree) ? tree.flatMap(elements) : React.isValidElement<Record<string, unknown>>(tree)
  ? [tree, ...elements(tree.props.children)] : [];
const text = (tree: unknown): string => typeof tree === "string" || typeof tree === "number" ? String(tree) : Array.isArray(tree)
  ? tree.map(text).join("") : React.isValidElement<Record<string, unknown>>(tree) ? text(tree.props.children) : "";
const findButton = (tree: unknown, label: string) => elements(tree).find((node) => node.type === "button" && text(node) === label);
const click = (node: Element | undefined) => { expect(node).toBeDefined(); (node!.props.onClick as () => void)(); };
const textarea = (tree: unknown) => elements(tree).find((node) => node.type === "textarea")!;

function workspace(options: { selected?: Partial<Conversation>; leadCardPhone?: string; history?: string;
  lead?: LeadSnapshot | null; snapshot?: LeadSnapshot | null; leadDraft?: Props["leadDraft"]; noDetail?: boolean; taskRows?: Record<string, string[]> } = {}) {
  let selected = conversation(options.selected);
  let detail: Detail | undefined = options.noDetail ? undefined : { sessionId: selected.id, leadPhone: selected.leadPhone, messageHistory: options.history ?? history() };
  let snapshot = options.snapshot;
  let leadCardPhone = options.leadCardPhone;
  let leadDraft = options.leadDraft;
  let live = [selected];
  const fallback = { isPending: true, mutate: vi.fn(() => { throw new Error("Forbidden OpenAI World-class fallback"); }) };
  const fallbackUseMutation = vi.fn(() => fallback);
  const fetchMock = vi.fn(() => { throw new Error("Forbidden Gemini World-class stream/network request"); });
  const claudeResponse = deferred<ClaudeSmsAlternativeResult>();
  const generate = vi.fn((_input: ClaudeSmsAlternativeGenerateInput) => claudeResponse.promise);
  const initialResponse = deferred<ClaudeInitialLeadResult>();
  const generateInitial = vi.fn((_input: ClaudeInitialLeadInput) => initialResponse.promise);
  const send = vi.fn();
  const workspaceSend = vi.fn();
  const notice = vi.fn();
  const noopMutation = { isPending: false, mutate: vi.fn() };
  const useUtils = () => ({ commandCenter: { listCommandChatInbox: { invalidate: vi.fn() } }, leads: { getCsConversation: { invalidate: vi.fn() } } });
  const trpc = {
    useUtils,
    leads: { getCsConversation: { useQuery: vi.fn(() => ({ data: detail })) }, sendMessage: { useMutation: () => ({ isPending: false, mutate: send }) }, sendWorkspaceMessage: { useMutation: () => ({ isPending: false, mutate: workspaceSend }) } },
    leadflowJobs: { customerProfile: { useQuery: () => ({ data: null }) }, teamIdentityByPhone: { useQuery: () => ({ data: null }) } },
    leadflowSchedule: { getSchedule: { useQuery: () => ({ data: null }) } },
    opsChat: { csReply: { useMutation: fallbackUseMutation } },
    madison: { claudeAlternative: { generate: { useMutation: () => ({ mutateAsync: generate }) }, generateInitialLead: { useMutation: () => ({ mutateAsync: generateInitial }) } } },
    commandCenter: { prepareQuoteAssistant: { useMutation: () => noopMutation } },
    bookingFunnel: { createCustomerLink: { useMutation: () => noopMutation } },
  };
  const slots: Slot[] = [];
  let cursor = 0;
  let dirty = false;
  let dead = false;
  let lateWrites = 0;
  let jobs: (() => void)[] = [];
  const changed = (slot: Slot | undefined, deps: readonly unknown[]) => !slot?.deps || deps.length !== slot.deps.length || deps.some((value, index) => !Object.is(value, slot.deps![index]));
  const hooks = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === "function" ? (initial as () => unknown)() : initial };
      return [slots[index].value, (next: unknown) => {
        if (dead) { lateWrites++; return; }
        const value = typeof next === "function" ? (next as (prior: unknown) => unknown)(slots[index].value) : next;
        if (!Object.is(value, slots[index].value)) dirty = true;
        slots[index].value = value;
      }];
    },
    useRef(initial: unknown) { const index = cursor++; if (!slots[index]) slots[index] = { value: { current: initial } }; return slots[index].value; },
    useMemo(factory: () => unknown, deps: readonly unknown[]) {
      const index = cursor++;
      if (changed(slots[index], deps)) slots[index] = { value: factory(), deps };
      return slots[index].value;
    },
    useCallback(callback: unknown, deps: readonly unknown[]) { return hooks.useMemo(() => callback, deps); },
    useEffect(effect: () => void | (() => void), deps: readonly unknown[]) {
      const index = cursor++;
      if (changed(slots[index], deps)) {
        const oldCleanup = slots[index]?.cleanup;
        slots[index] = { deps, cleanup: oldCleanup };
        jobs.push(() => { oldCleanup?.(); const cleanup = effect(); slots[index].cleanup = typeof cleanup === "function" ? cleanup : undefined; });
      }
    },
  };
  const module = { exports: {} as { Drawer: (props: Props) => React.ReactElement } };
  const uuid = vi.fn();
  uuid.mockReturnValueOnce("00000000-0000-4000-8000-000000000001").mockReturnValue("00000000-0000-4000-8000-000000000002");
  const timeline = ({ children }: any) => children((id: string) => (options.taskRows?.[id] ?? []).map((title, index) =>
    React.createElement("button", { key: index, "data-synthetic-task-source": id }, title)));
  runInNewContext(compiled, { module, exports: module.exports, React, ...hooks, trpc,
    ...Object.fromEntries(iconNames.map((name) => [name, icon])), Avatar: icon,
    ClaudeSmsConversationTasks: timeline, customerSmsTaskMessageAnchors: actualSmsTaskMessageAnchors, Fragment: React.Fragment,
    claudeSmsAlternativeGenerateInputSchema, claudeSmsAlternativeResultSchema, getCsInboxReplyPhoneNumberIdForSelectedConversation,
    claudeInitialLeadInputSchema, claudeInitialLeadResultSchema, normalizedLeadPhone,
    claudeDraftSourceSchema, reviewedClaudeSmsProvenance, smsSenderLabel, smsSenderProvenanceSchema,
    smsConversationName: (value: Conversation) => value.leadName ?? "Customer", customerPortraitFor: () => "/synthetic.png",
    displayLeadSource: () => "CS", renderMessageBody: (value: string) => value, formatTime: () => "10:00 AM",
    fetch: fetchMock, crypto: { randomUUID: uuid }, console: { warn: vi.fn() }, AbortController, TextDecoder,
    requestAnimationFrame: () => 1, cancelAnimationFrame: vi.fn(),
  }, { timeout: 1500 });
  let tree: React.ReactElement;
  const render = () => {
    for (let pass = 0; pass < 12; pass++) {
      dirty = false; cursor = 0;
      tree = expandSmsTaskTimeline(module.exports.Drawer({ conversation: selected, conversations: live, callerName: "Synthetic office", callerPhotoUrl: null,
        photoMap: {}, businessDate: "2026-11-15", leadCardPhone, lead: options.lead ?? null, leadCardSnapshot: snapshot, leadDraft,
        onNotice: notice, onOpenLeadDetails: vi.fn(), onSessionResolved: vi.fn(), onClose: vi.fn() }), timeline);
      const pending = jobs; jobs = []; pending.forEach((run) => run());
      // Check every lifecycle render, including late replies, scope changes and
      // manual sends. Shared Claude card CSS must not be mistaken for World-class UI.
      expect(fetchMock).not.toHaveBeenCalled();
      expect(fallbackUseMutation).not.toHaveBeenCalled();
      expect(fallback.mutate).not.toHaveBeenCalled();
      expect(text(tree)).not.toMatch(/World-class draft|AI is drafting a reply…|Insert into reply|Regenerate/);
      expect(elements(tree).some(node => node.props.className === "ccc-live-sms-ai-draft-status")).toBe(false);
      expect(elements(tree).filter(node => node.type === "article" && typeof node.props.className === "string"
        && node.props.className.startsWith("ccc-live-sms-ai-draft-card")).every(node => node.props["aria-label"] === "Optional Claude draft")).toBe(true);
      if (!dirty) return tree;
    }
    throw new Error("Synthetic drawer did not settle");
  };
  const settle = async () => { for (let turn = 0; turn < 20; turn++) { await Promise.resolve(); if (dirty) render(); } return render(); };
  const edit = (value: string) => (textarea(render()).props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
  render();
  return { render, settle, html: () => renderToStaticMarkup(render()), edit, generate, claudeResponse, generateInitial, initialResponse, uuid, fetchMock, fallbackUseMutation, fallback, send, workspaceSend,
    setDetail: (value: Detail | undefined) => { detail = value; }, setLive: (value: Conversation[]) => { live = value; }, setSelected: (value: Conversation) => { selected = value; },
    setSnapshot: (value: LeadSnapshot | null) => { snapshot = value; }, setPhone: (value: string | undefined) => { leadCardPhone = value; },
    setLeadDraft: (value: Props["leadDraft"]) => { leadDraft = value; },
    dispose: () => { slots.forEach((slot) => slot.cleanup?.()); dead = true; }, get lateWrites() { return lateWrites; },
  };
}

describe("optional Claude alternative actual SMS drawer", () => {
  it("removes the entire World-class transport/lifecycle/UI and hash-binds the original provenance send/composer seams", () => {
    expect(drawerSource).not.toMatch(/smsAutoDraft|setSmsAutoDraft|autoDraftedForConversationRef|streamSmsAutoDraft|regenerateSmsDraft|insertSmsAutoDraft/);
    expect(drawerSource).not.toMatch(/fetch\(|opsChat\.csReply|\/api\/cs-reply-stream|AbortController|World-class draft|AI is drafting a reply…|Insert into reply|>Regenerate</);
    expect(drawerSource).not.toContain('className="ccc-live-sms-ai-draft-status"');
    expect(drawerSource).not.toContain("ccc-live-sms-ai-draft-toggle");
    expect(drawerSource).toContain('aria-label="Optional Claude draft"');
    expect(hash(between("  const sendReply = trpc.leads.sendMessage.useMutation", '  return <div className="ccc-live-sms-backdrop"'))).toBe("489f0ebb858b6f609a900911679158d3b22202047fd1783293e3350e1848c3eb");
    const composer = source.split(/(?<=\n)/).find((line) => line.includes('<div className="ccc-live-sms-composer"><textarea'))!;
    expect(composer).toContain('placeholder="Write a text reply…"');
    expect(composer).not.toContain("smsAutoDraftLoading");
    expect(hash(composer.replace('placeholder="Write a text reply…"', 'placeholder={smsAutoDraftLoading ? "" : "Write a text reply…"}')))
      .toBe("9408525778f9b572916a792f7de5e48c3b0091fe204428473d3e8c2dc19b8c07");
  });

  it("keeps Claude optional and off team/lead-only drawers, with no Gemini or OpenAI hook/fallback on open", async () => {
    const work = workspace(); await work.settle();
    expect(work.html()).toContain("Get Claude draft"); expect(work.html()).not.toContain("World-class draft");
    expect(work.fetchMock).not.toHaveBeenCalled(); expect(work.fallbackUseMutation).not.toHaveBeenCalled(); expect(work.fallback.mutate).not.toHaveBeenCalled();
    expect(work.generate).not.toHaveBeenCalled(); expect(work.generateInitial).not.toHaveBeenCalled(); expect(work.uuid).not.toHaveBeenCalled();
    for (const options of [{ selected: { personType: "team" as const } }, { selected: { id: -42 } }, { leadCardPhone: "+13015550123" }]) {
      const hidden = workspace(options); await hidden.settle(); expect(hidden.html()).not.toContain("Get Claude draft"); expect(hidden.generate).not.toHaveBeenCalled(); hidden.dispose();
    }
    expect(drawerSource).not.toMatch(/claudeAlternative\.(?:current|ownership|status)/);
    expect(drawerSource.match(/claudeAlternative\.mutateAsync\(/g)).toHaveLength(1);
    const effects = drawerNode.body!.statements.filter((node) => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === "useEffect");
    for (const effect of effects) expect(effect.getText(ast)).not.toMatch(/generateClaudeDraft|mutateAsync/);
    work.dispose();
  });

  it("Get Claude draft renders a verified alternative, never edits human text, Use reply copies only and existing Send remains manual", async () => {
    const work = workspace(); await work.settle(); work.edit("Human-edited reply");
    const get = findButton(work.render(), "Get Claude draft")!;
    click(get); click(get); click(get);
    expect(work.generate).toHaveBeenCalledTimes(1); expect(work.uuid).toHaveBeenCalledTimes(1);
    const request = work.generate.mock.calls[0][0];
    expect(request).toEqual({ sessionId: 42, providerMessageId: "OM_SYNTHETIC_INBOUND", receivingPhoneNumberId: "PN_SYNTHETIC_LINE", requestId: "00000000-0000-4000-8000-000000000001" });
    expect(findButton(work.render(), "Getting Claude draft…")!.props.disabled).toBe(true);
    work.edit("Human edited while pending");
    work.claudeResponse.resolve(result(request)); await work.settle();
    expect(work.html()).toContain("Synthetic Claude reply for review."); expect(work.html()).toContain("+13015550987");
    expect(textarea(work.render()).props.value).toBe("Human edited while pending");
    expect(work.send).not.toHaveBeenCalled(); expect(work.workspaceSend).not.toHaveBeenCalled();
    click(findButton(work.render(), "Use reply"));
    expect(textarea(work.render()).props.value).toBe("Synthetic Claude reply for review.");
    expect(work.send).not.toHaveBeenCalled(); expect(work.workspaceSend).not.toHaveBeenCalled(); expect(work.html()).not.toContain("Use reply");
    work.edit("Reviewed and edited Claude text");
    click(elements(work.render()).find((node) => node.props["aria-label"] === "Send text reply"));
    expect(work.send).toHaveBeenCalledWith({ sessionId: 42, message: "Reviewed and edited Claude text", fromNumberId: "PN_SYNTHETIC_LINE", source: "cs_inbox",
      claudeDraftSource: { requestId: request.requestId, kind: "sms_reply" } });
    expect(work.workspaceSend).not.toHaveBeenCalled(); work.dispose();
  });

  it("Discard only hides the alternative and a deliberate next generation gets a fresh UUID", async () => {
    const work = workspace(); await work.settle(); work.edit("Human reply"); click(findButton(work.render(), "Get Claude draft"));
    work.claudeResponse.resolve(result(work.generate.mock.calls[0][0])); await work.settle();
    click(findButton(work.render(), "Discard")); expect(work.html()).not.toContain("Use reply"); expect(textarea(work.render()).props.value).toBe("Human reply");
    click(findButton(work.render(), "Get Claude draft")); await work.settle();
    expect(work.generate).toHaveBeenCalledTimes(2); expect(work.generate.mock.calls[1][0].requestId).not.toBe(work.generate.mock.calls[0][0].requestId);
    expect(work.send).not.toHaveBeenCalled(); work.dispose();
  });

  it("coalesces explicit Claude requests without a World-class Regenerate control or provider dependency", async () => {
    const work = workspace(); await work.settle();
    const get = findButton(work.render(), "Get Claude draft")!;
    expect(get.props.disabled).toBe(false); expect(work.fallback.isPending).toBe(true);
    click(get); click(get); click(get);
    expect(work.generate).toHaveBeenCalledTimes(1); expect(work.uuid).toHaveBeenCalledTimes(1);
    expect(findButton(work.render(), "Getting Claude draft…")!.props.disabled).toBe(true);
    expect(findButton(work.render(), "Regenerate")).toBeUndefined();
    expect(textarea(work.render()).props.placeholder).toBe("Write a text reply…");
    work.claudeResponse.resolve(result(work.generate.mock.calls[0][0])); await work.settle();
    expect(findButton(work.render(), "Get Claude draft")!.props.disabled).toBe(false);
    expect(findButton(work.render(), "Use reply")).toBeDefined(); expect(findButton(work.render(), "Regenerate")).toBeUndefined();
    expect(work.fetchMock).not.toHaveBeenCalled(); expect(work.fallbackUseMutation).not.toHaveBeenCalled(); expect(work.fallback.mutate).not.toHaveBeenCalled(); work.dispose();
  });

  it("never auto-generates on incoming/history/selected changes or loading-to-loaded transitions, and preserves human-only manual send", async () => {
    for (const change of ["incoming", "history", "selected", "loaded"] as const) {
      const work = workspace({ noDetail: change === "loaded" }); await work.settle(); work.edit("Human reply");
      if (change === "incoming") work.setLive([conversation({ lastMessageText: "New incoming request", lastMessageTs: 1800000000100 })]);
      else if (change === "history") work.setDetail({ sessionId: 42, leadPhone: "+13015550123", messageHistory: history("OM_NEW_INBOUND") });
      else if (change === "selected") {
        work.setSelected(conversation({ id: 43, leadPhone: "+13015550124" }));
        work.setDetail({ sessionId: 43, leadPhone: "+13015550124", messageHistory: history() });
      } else work.setDetail({ sessionId: 42, leadPhone: "+13015550123", messageHistory: history() });
      await work.settle();
      expect(work.generate).not.toHaveBeenCalled(); expect(work.generateInitial).not.toHaveBeenCalled(); expect(work.uuid).not.toHaveBeenCalled();
      expect(work.fetchMock).not.toHaveBeenCalled(); expect(work.fallbackUseMutation).not.toHaveBeenCalled(); expect(work.fallback.mutate).not.toHaveBeenCalled();
      expect(textarea(work.render()).props.value).toBe(change === "selected" ? "" : "Human reply");
      expect(textarea(work.render()).props.placeholder).toBe("Write a text reply…");
      work.edit("Human-only manual reply");
      expect(work.send).not.toHaveBeenCalled(); expect(work.workspaceSend).not.toHaveBeenCalled();
      click(elements(work.render()).find(node => node.props["aria-label"] === "Send text reply"));
      expect(work.send).toHaveBeenCalledWith({ sessionId: change === "selected" ? 43 : 42, message: "Human-only manual reply", fromNumberId: "PN_SYNTHETIC_LINE", source: "cs_inbox" });
      expect(work.workspaceSend).not.toHaveBeenCalled(); work.render(); work.dispose();
    }
  });

  it("never invents an inbound ID or line and binds the original history ID rather than sorted display timestamps", async () => {
    for (const options of [{ history: history(null) }, { selected: { lastInboundPhoneNumberId: null } }, { selected: { lastInboundPhoneNumberId: " " } }, { history: "not JSON" }]) {
      const work = workspace(options); await work.settle(); const get = findButton(work.render(), "Get Claude draft")!;
      expect(get.props.disabled).toBe(true); click(get); expect(work.generate).not.toHaveBeenCalled(); expect(work.uuid).not.toHaveBeenCalled(); work.dispose();
    }
    const work = workspace(); await work.settle(); click(findButton(work.render(), "Get Claude draft"));
    expect(work.generate.mock.calls[0][0].providerMessageId).toBe("OM_SYNTHETIC_INBOUND"); work.claudeResponse.resolve(result(work.generate.mock.calls[0][0])); await work.settle(); work.dispose();
  });

  it("uses original provider metadata without losing it and rejects contradictory provider IDs", async () => {
    const metadataHistory = JSON.stringify([{ role: "user", content: "Please confirm Friday.", ts: 1800000000000,
      metadata: { openPhoneMessageId: "OM_SYNTHETIC_INBOUND" } }]);
    const work = workspace({ history: metadataHistory }); await work.settle(); click(findButton(work.render(), "Get Claude draft"));
    expect(work.generate.mock.calls[0][0].providerMessageId).toBe("OM_SYNTHETIC_INBOUND");
    work.claudeResponse.resolve(result(work.generate.mock.calls[0][0])); await work.settle(); expect(work.html()).toContain("Use reply"); work.dispose();
    const conflict = workspace({ history: JSON.stringify([{ role: "user", content: "Please confirm Friday.", ts: 1800000000000,
      opMsgId: "OM_SYNTHETIC_INBOUND", metadata: { providerMessageId: "OM_CONFLICT" } }]) });
    await conflict.settle(); expect(findButton(conflict.render(), "Get Claude draft")!.props.disabled).toBe(true);
    click(findButton(conflict.render(), "Get Claude draft")); expect(conflict.generate).not.toHaveBeenCalled(); conflict.dispose();
  });

  it("rejects pending results after customer/line/history/new-live-incoming switches, even if switched away and back", async () => {
    for (const change of ["customer", "line", "history", "incoming", "away-and-back"] as const) {
      const work = workspace(); await work.settle(); work.edit("Human reply"); click(findButton(work.render(), "Get Claude draft"));
      const request = work.generate.mock.calls[0][0];
      if (change === "customer" || change === "away-and-back") {
        work.setSelected(conversation({ id: 43, leadPhone: "+13015550124" })); work.render();
        if (change === "away-and-back") { work.setSelected(conversation()); work.render(); }
      } else if (change === "line") { work.setLive([conversation({ lastInboundPhoneNumberId: "PN_OTHER_LINE" })]); work.render(); }
      else if (change === "history") { work.setDetail({ sessionId: 42, leadPhone: "+13015550123", messageHistory: history("OM_NEW_INBOUND") }); work.render(); }
      else { work.setLive([conversation({ lastMessageText: "New incoming request", lastMessageTs: 1800000000100 })]); work.render(); }
      expect(findButton(work.render(), "Getting Claude draft…")).toBeUndefined();
      expect(work.html()).toContain("Get Claude draft again to retry.");
      work.claudeResponse.resolve(result(request)); await work.settle();
      expect(work.html()).not.toContain("Synthetic Claude reply for review."); expect(work.html()).not.toContain("Use reply");
      expect(work.send).not.toHaveBeenCalled(); expect(work.workspaceSend).not.toHaveBeenCalled();
      if (change === "incoming") expect(findButton(work.render(), "Get Claude draft")!.props.disabled).toBe(true);
      work.dispose();
    }
  });

  it("invalidates an already-visible alternate and old Use callback when the live sender line changes", async () => {
    const work = workspace(); await work.settle(); work.edit("Human reply"); click(findButton(work.render(), "Get Claude draft"));
    work.claudeResponse.resolve(result(work.generate.mock.calls[0][0])); await work.settle(); const use = findButton(work.render(), "Use reply");
    work.setLive([conversation({ lastInboundPhoneNumberId: "PN_OTHER_LINE" })]); work.render(); click(use);
    expect(textarea(work.render()).props.value).toBe("Human reply"); expect(work.html()).not.toContain("Use reply"); expect(work.send).not.toHaveBeenCalled(); work.dispose();
  });

  it.each(["success", "error"] as const)("retains pending %s through incidental polling and older sibling-history additions", async outcome => {
    const work = workspace(); work.edit("Human reply"); click(findButton(work.render(), "Get Claude draft"));
    const request = work.generate.mock.calls[0][0];
    const returned = JSON.parse(history());
    returned.unshift({ role: "assistant", content: "Older sibling turn", ts: 1 });
    work.setDetail({ sessionId: 42, leadPhone: "+13015550123", messageHistory: JSON.stringify(returned, null, 2) });
    work.setLive([conversation({ lastMsgTs: 1800000009999 })]);
    expect(findButton(work.render(), "Getting Claude draft…")).toBeDefined();
    if (outcome === "success") work.claudeResponse.resolve(result(request));
    else work.claudeResponse.reject(new Error("PRIVATE provider failure"));
    await work.settle();
    expect(work.html()).toContain(outcome === "success" ? "Synthetic Claude reply for review." : "Claude draft is unavailable");
    expect(work.html()).not.toContain("PRIVATE"); expect(textarea(work.render()).props.value).toBe("Human reply");
    expect(work.send).not.toHaveBeenCalled(); work.dispose();
  });

  it.each(["success", "error"] as const)("releases pending scope changes and never lets an old %s overwrite a newer retry", async outcome => {
    const work = workspace(); click(findButton(work.render(), "Get Claude draft"));
    const oldRequest = work.generate.mock.calls[0][0];
    const next = deferred<ClaudeSmsAlternativeResult>(); work.generate.mockImplementationOnce(() => next.promise);
    work.setDetail({ sessionId: 42, leadPhone: "+13015550123", messageHistory: history("OM_NEW_INBOUND") });
    expect(work.html()).toContain("Get Claude draft again to retry.");
    expect(findButton(work.render(), "Getting Claude draft…")).toBeUndefined();
    click(findButton(work.render(), "Get Claude draft"));
    const newRequest = work.generate.mock.calls[1][0];
    if (outcome === "success") work.claudeResponse.resolve(result(oldRequest, { replyText: "Obsolete reply" }));
    else work.claudeResponse.reject(new Error("Obsolete error"));
    await work.settle(); expect(findButton(work.render(), "Getting Claude draft…")).toBeDefined();
    next.resolve(result(newRequest, { replyText: "New verified reply" })); await work.settle();
    expect(work.html()).toContain("New verified reply"); expect(work.html()).not.toContain("Obsolete");
    expect(work.html()).not.toContain("Claude draft is unavailable"); expect(work.send).not.toHaveBeenCalled(); work.dispose();
  });

  it("unavailable or mismatched provider results never affect composer or manual sending, and never activate World-class fallback", async () => {
    const unavailable = workspace(); await unavailable.settle(); unavailable.edit("Human reply"); click(findButton(unavailable.render(), "Get Claude draft"));
    unavailable.claudeResponse.reject(new Error("PRIVATE backend credential")); await unavailable.settle();
    expect(unavailable.html()).toContain("Claude draft is unavailable"); expect(unavailable.html()).not.toContain("PRIVATE");
    expect(unavailable.html()).not.toContain("World-class draft"); expect(textarea(unavailable.render()).props.value).toBe("Human reply");
    expect(findButton(unavailable.render(), "Regenerate")).toBeUndefined();
    click(elements(unavailable.render()).find(node => node.props["aria-label"] === "Send text reply"));
    expect(unavailable.send).toHaveBeenCalledWith({ sessionId: 42, message: "Human reply", fromNumberId: "PN_SYNTHETIC_LINE", source: "cs_inbox" });
    expect(unavailable.fallbackUseMutation).not.toHaveBeenCalled(); expect(unavailable.fallback.mutate).not.toHaveBeenCalled(); unavailable.dispose();
    const mismatch = workspace(); await mismatch.settle(); mismatch.edit("Human reply"); click(findButton(mismatch.render(), "Get Claude draft"));
    mismatch.claudeResponse.resolve(result(mismatch.generate.mock.calls[0][0], { providerMessageId: "OM_OTHER_INBOUND" })); await mismatch.settle();
    expect(mismatch.html()).toContain("could not be verified"); expect(mismatch.html()).not.toContain("Use reply"); expect(textarea(mismatch.render()).props.value).toBe("Human reply"); expect(mismatch.send).not.toHaveBeenCalled(); mismatch.dispose();
  });

  it("unmount drops late replies without state writes and adds no new timers, ownership calls, or send path", async () => {
    const work = workspace(); await work.settle(); click(findButton(work.render(), "Get Claude draft")); work.dispose();
    work.claudeResponse.resolve(result(work.generate.mock.calls[0][0])); for (let turn = 0; turn < 20; turn++) await Promise.resolve();
    expect(work.lateWrites).toBe(0); expect(work.send).not.toHaveBeenCalled();
    const generation = between("  const generateClaudeDraft =", "  const currentClaudeDraft =");
    const use = between("  const useClaudeReply =", "  const prepareQuoteAssistant =");
    expect(generation).not.toMatch(/setDraft\(|sendReply|sendWorkspaceMessage|setTimeout|setInterval/);
    expect(use).not.toMatch(/\.mutate|submit\(/); expect(use).toContain("setDraft(currentClaudeDraft.replyText)");
    expect(source).not.toMatch(new RegExp(["cleaner" + "_jobs", "cleaner" + "Jobs"].join("|")));
  });
});

describe("optional Claude first lead draft in the existing workspace", () => {
  it("opens by canonical phone rather than the misleading session id, and leaves unmatched native cards on session zero", () => {
    const clicked = leadSnapshot({ sessionId: 99 });
    const wrong = conversation({ id: 99, leadPhone: "email-session14220455" });
    const real = conversation({ id: 42, leadPhone: "+13015550123" });
    expect(clickedLeadDraft(clicked, [wrong, real]).selected).toBe(real);
    expect(clickedLeadDraft(clicked, [wrong]).selected).toMatchObject({ id: 0, leadPhone: clicked.phone, leadName: clicked.name });
  });

  it.each(["mismatch", "unavailable", "wrong-detail", "bad-history"] as const)("drafts from card phone and facts despite %s linked detail, without consuming an unrelated history", async mode => {
    const clicked = leadSnapshot();
    const work = workspace({ snapshot: clicked, leadCardPhone: clicked.phone, noDetail: mode === "unavailable" });
    if (mode !== "unavailable") work.setDetail({ sessionId: mode === "wrong-detail" ? 99 : 42,
      leadPhone: mode === "mismatch" ? "email-session14220455" : "+13015550123",
      messageHistory: mode === "bad-history" ? "invalid JSON" : '[{"role":"user","content":"Unrelated email content"}]' });
    work.edit("Human card reply");
    expect(findButton(work.render(), "Get Claude draft")!.props.disabled).toBe(false);
    if (mode === "mismatch") expect(work.html()).toContain("The linked conversation has a different phone.");
    click(findButton(work.render(), "Get Claude draft"));
    const request = work.generateInitial.mock.calls[0][0];
    expect(request).toMatchObject({ sessionId: mode === "bad-history" ? 42 : 0, customerPhone: clicked.phone, leadDetails: leadFacts(), originalConversation: [] });
    expect(request.draftRequest?.conversationContext).toBe("");
    work.initialResponse.resolve(initialResult(request)); await work.settle();
    click(findButton(work.render(), "Use reply"));
    click(elements(work.render()).find(node => node.props["aria-label"] === "Send text reply"));
    expect(work.workspaceSend).toHaveBeenCalledWith({ phone: clicked.phone, message: "Synthetic Claude first lead reply.", name: "Synthetic customer",
      claudeDraftSource: { requestId: request.requestId, kind: "initial_lead" } });
    expect(work.send).not.toHaveBeenCalled(); work.dispose();
  });

  it.each(["success", "error"] as const)("retains initial %s on polling-only card status and history formatting changes", async outcome => {
    const clicked = leadSnapshot();
    const work = workspace({ snapshot: clicked, leadCardPhone: clicked.phone });
    click(findButton(work.render(), "Get Claude draft")); const request = work.generateInitial.mock.calls[0][0];
    work.setSnapshot({ ...clicked, claimedBy: "New claimer", isBooked: true } as LeadSnapshot);
    work.setDetail({ sessionId: 42, leadPhone: "301-555-0123", messageHistory: JSON.stringify(JSON.parse(history()), null, 2) });
    work.setLive([conversation({ lastMsgTs: 1800000009999 })]);
    expect(findButton(work.render(), "Getting Claude draft…")).toBeDefined();
    if (outcome === "success") work.initialResponse.resolve(initialResult(request));
    else work.initialResponse.reject(new Error("PRIVATE"));
    await work.settle(); expect(work.html()).toContain(outcome === "success" ? "Synthetic Claude first lead reply." : "Claude draft is unavailable");
    work.dispose();
  });

  it.each(["success", "error"] as const)("allows an explicit initial retry and ignores the previous call's late %s", async outcome => {
    const clicked = leadSnapshot();
    const work = workspace({ selected: { id: 0 }, snapshot: clicked, leadCardPhone: clicked.phone, noDetail: true });
    work.edit("Human reply"); click(findButton(work.render(), "Get Claude draft"));
    const oldRequest = work.generateInitial.mock.calls[0][0];
    const next = deferred<ClaudeInitialLeadResult>(); work.generateInitial.mockImplementationOnce(() => next.promise);
    work.setSnapshot(leadSnapshot({ description: "Updated notes on the same card" }));
    expect(work.html()).toContain("Get Claude draft again to retry.");
    expect(findButton(work.render(), "Get Claude draft")!.props.disabled).toBe(false);
    click(findButton(work.render(), "Get Claude draft")); const newRequest = work.generateInitial.mock.calls[1][0];
    if (outcome === "success") work.initialResponse.resolve(initialResult(oldRequest, { replyText: "Old initial reply" }));
    else work.initialResponse.reject(new Error("Old private error"));
    await work.settle(); expect(findButton(work.render(), "Getting Claude draft…")).toBeDefined();
    next.resolve(initialResult(newRequest, { replyText: "New initial reply" })); await work.settle();
    expect(work.html()).toContain("New initial reply"); expect(work.html()).not.toContain("Old initial reply");
    expect(work.html()).not.toContain("Claude draft is unavailable"); expect(textarea(work.render()).props.value).toBe("Human reply");
    expect(work.workspaceSend).not.toHaveBeenCalled(); work.dispose();
  });

  it("clears a selected Claude composer draft when switching same-session-zero cards, preventing cross-lead send", async () => {
    const clicked = leadSnapshot();
    const work = workspace({ selected: { id: 0 }, snapshot: clicked, leadCardPhone: clicked.phone, noDetail: true });
    click(findButton(work.render(), "Get Claude draft")); work.initialResponse.resolve(initialResult(work.generateInitial.mock.calls[0][0])); await work.settle();
    const oldUse = findButton(work.render(), "Use reply"); click(oldUse);
    work.setSnapshot(leadSnapshot({ id: 502, phone: "3015550124" })); work.setPhone("3015550124"); work.render(); click(oldUse);
    expect(textarea(work.render()).props.value).toBe("");
    click(elements(work.render()).find(node => node.props["aria-label"] === "Send text reply"));
    expect(work.workspaceSend).not.toHaveBeenCalled(); expect(work.send).not.toHaveBeenCalled(); work.dispose();
  });

  it("preserves prompt, builder body, exact Claude draftRequest payload, and quote-assistant callbacks/JSX bytes", async () => {
    expect(hash(THUMBTACK_FIRST_RESPONSE_PROMPT)).toBe("aa2665b8f0c82ba8daae49e7f0d0d66fe5234b8ba653d6fa4eb36c3bdadc2ed4");
    const sharedSource = readFileSync(new URL("../shared/claudeInitialLead.ts", import.meta.url), "utf8");
    expect(hash(sharedSource.slice(sharedSource.indexOf("  const details = lead.nativeDetails"), sharedSource.indexOf("\n}", sharedSource.indexOf("  const details = lead.nativeDetails")))))
      .toBe("4f156c33795eff623fb0124030a04ed0505825529196e76b98f62fc4c1fdebcd");
    // Linkage is now phone-first; the approved prompt construction stays literal.
    expect(between("  const openSmsDrawerFromLead =", "  const addPendingOutgoingMessage ="))
      .toContain('scenario: `${THUMBTACK_FIRST_RESPONSE_PROMPT}\\n\\nThumbtack lead:\\n${buildThumbtackLeadDraftContext(lead)}`');
    expect(hash(between("  const prepareQuoteAssistant =", "  const resizeSmsComposer ="))).toBe("1b2512e0130449642679f7a74807105f30650510ac0aba0437b62b6bfb7db0cc");
    expect(hash(between("    {quoteAssistantOpen && quoteAssistantFields && <QuoteAssistantModal", "function QuoteAssistantModal")))
      .toBe("02adc581431e0792109bacff678dfc5633fc2057a528a84e8f28c96ce90901fd");
    const clicked = leadSnapshot();
    const { draft, snapshot } = clickedLeadDraft(clicked);
    expect(snapshot).toBe(clicked);
    expect(draft).toEqual({ scenario: `${THUMBTACK_FIRST_RESPONSE_PROMPT}\n\nThumbtack lead:\n${buildThumbtackLeadDraftContext(clicked)}`,
      jobContext: buildThumbtackLeadDraftContext(clicked) });
    const work = workspace({ selected: { id: 0, lastInboundPhoneNumberId: null }, snapshot: clicked, leadCardPhone: clicked.phone, leadDraft: draft, noDetail: true });
    await work.settle();
    expect(work.generateInitial).not.toHaveBeenCalled(); expect(work.generate).not.toHaveBeenCalled(); expect(work.uuid).not.toHaveBeenCalled();
    expect(work.fetchMock).not.toHaveBeenCalled(); expect(work.fallbackUseMutation).not.toHaveBeenCalled(); expect(work.fallback.mutate).not.toHaveBeenCalled();
    click(findButton(work.render(), "Get Claude draft"));
    expect(work.generateInitial).toHaveBeenCalledTimes(1);
    expect(work.generateInitial.mock.calls[0][0].draftRequest).toEqual({
      conversationContext: "", customerName: "Synthetic customer", jobContext: draft!.jobContext, scenario: draft!.scenario,
    });
    work.dispose();
  });

  it("accepts the actual native Thumbtack card shape without rooms, propertyType or summary, with exactly the existing prompt context", async () => {
    const { rooms, propertyType, summary, ...native } = leadSnapshot();
    const clicked = native as LeadSnapshot;
    expect(Object.prototype.hasOwnProperty.call(clicked, "rooms")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(clicked, "propertyType")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(clicked, "summary")).toBe(false);
    const { draft, snapshot } = clickedLeadDraft(clicked);
    expect(snapshot).toBe(clicked);
    const expectedFacts = leadFacts({ rooms: null, propertyType: null, summary: null });
    expect(buildThumbtackLeadDraftContext(clicked)).toBe(buildThumbtackLeadDraftContext(expectedFacts));
    const saved = [{ role: "user", content: "Original lead request", metadata: { retained: [null, "detail"] } },
      { role: "assistant", content: "Original outgoing message" }];
    for (const sessionId of [0, 42]) {
      const work = workspace({ selected: { id: sessionId, lastInboundPhoneNumberId: null }, snapshot: clicked,
        leadCardPhone: clicked.phone, leadDraft: draft, history: JSON.stringify(saved), noDetail: sessionId === 0 });
      await work.settle(); work.edit("Human reply stays here");
      expect(findButton(work.render(), "Get Claude draft")!.props.disabled).toBe(false);
      click(findButton(work.render(), "Get Claude draft"));
      expect(work.generateInitial).toHaveBeenCalledTimes(1);
      const request = work.generateInitial.mock.calls[0][0];
      expect(request.leadDetails).toEqual(expectedFacts);
      expect(request.draftRequest).toEqual({ conversationContext: sessionId === 0 ? "" : "Customer: Original lead request\nAgent: Original outgoing message",
        customerName: "Synthetic customer", jobContext: draft!.jobContext, scenario: draft!.scenario });
      expect(request.draftRequest?.jobContext).toBe(draft!.jobContext);
      expect(request.draftRequest?.scenario).toBe(draft!.scenario);
      expect(claudeInitialLeadInputSchema.safeParse(request).success).toBe(true);
      expect(buildThumbtackLeadDraftContext(request.leadDetails)).toBe(draft!.jobContext);
      expect(request.originalConversation).toEqual(sessionId === 0 ? [] : saved);
      expect(work.generate).not.toHaveBeenCalled();
      expect(textarea(work.render()).props.value).toBe("Human reply stays here");
      work.initialResponse.resolve(initialResult(request)); await work.settle();
      expect(work.html()).toContain("Synthetic Claude first lead reply.");
      expect(work.html()).toContain("Use reply");
      expect(work.send).not.toHaveBeenCalled(); expect(work.workspaceSend).not.toHaveBeenCalled();
      work.dispose();
    }
  });

  it("shows an input failure instead of silently ignoring the initial Claude click, without changing the reply or calling either sender", async () => {
    const clicked = leadSnapshot({ pets: 5 as unknown as string });
    const work = workspace({ selected: { id: 42, lastInboundPhoneNumberId: null }, snapshot: clicked,
      leadCardPhone: clicked.phone, leadDraft: clickedLeadDraft(clicked).draft, history: "[]" });
    await work.settle(); work.edit("Human reply stays here");
    click(findButton(work.render(), "Get Claude draft")); await work.settle();
    expect(work.html()).toContain("Claude could not read this lead&#x27;s details. Your reply is unchanged.");
    expect(work.html()).not.toContain("World-class draft");
    expect(work.generateInitial).not.toHaveBeenCalled(); expect(work.generate).not.toHaveBeenCalled();
    expect(textarea(work.render()).props.value).toBe("Human reply stays here");
    expect(findButton(work.render(), "Get Claude draft")!.props.disabled).toBe(false);
    expect(work.send).not.toHaveBeenCalled(); expect(work.workspaceSend).not.toHaveBeenCalled();
    work.dispose();
  });

  it("drafts for session 0 and positive sessions with no incoming metadata, copies only, and uses the unchanged manual workspace sender", async () => {
    for (const sessionId of [0, 42]) {
      const clicked = leadSnapshot();
      const { draft } = clickedLeadDraft(clicked);
      const work = workspace({ selected: { id: sessionId, lastInboundPhoneNumberId: null, lastMessageText: null, lastSenderRole: null },
        leadCardPhone: clicked.phone, snapshot: clicked, leadDraft: draft, history: "[]", noDetail: sessionId === 0 });
      await work.settle(); work.edit("Human first response");
      const get = findButton(work.render(), "Get Claude draft")!; expect(get.props.disabled).toBe(false);
      click(get); click(get); click(get);
      expect(work.generateInitial).toHaveBeenCalledTimes(1); expect(work.generate).not.toHaveBeenCalled(); expect(work.uuid).toHaveBeenCalledTimes(1);
      const request = work.generateInitial.mock.calls[0][0];
      expect(request).toEqual({ sessionId, customerPhone: clicked.phone, requestId: "00000000-0000-4000-8000-000000000001", leadDetails: leadFacts(), originalConversation: [],
        draftRequest: { conversationContext: "", customerName: "Synthetic customer", jobContext: draft!.jobContext, scenario: draft!.scenario } });
      work.initialResponse.resolve(initialResult(request)); await work.settle();
      expect(work.html()).toContain("First lead reply"); expect(work.html()).not.toContain("Reply on");
      expect(textarea(work.render()).props.value).toBe("Human first response");
      expect(work.workspaceSend).not.toHaveBeenCalled(); expect(work.send).not.toHaveBeenCalled();
      click(findButton(work.render(), "Use reply")); expect(textarea(work.render()).props.value).toBe("Synthetic Claude first lead reply.");
      expect(work.workspaceSend).not.toHaveBeenCalled(); expect(work.send).not.toHaveBeenCalled();
      work.edit("Reviewed first reply"); click(elements(work.render()).find((node) => node.props["aria-label"] === "Send text reply"));
      expect(work.workspaceSend).toHaveBeenCalledWith({ phone: clicked.phone, message: "Reviewed first reply", name: "Synthetic customer",
        claudeDraftSource: { requestId: request.requestId, kind: "initial_lead" } });
      expect(work.send).not.toHaveBeenCalled(); work.dispose();
    }
    const clicked = leadSnapshot();
    const loading = workspace({ selected: { id: 42, lastInboundPhoneNumberId: null }, snapshot: clicked, leadCardPhone: clicked.phone, noDetail: true });
    await loading.settle(); const get = findButton(loading.render(), "Get Claude draft")!;
    expect(get.props.disabled).toBe(false); click(get);
    expect(loading.generateInitial.mock.calls[0][0]).toMatchObject({ sessionId: 0, customerPhone: clicked.phone, originalConversation: [] });
    loading.dispose();
  });

  it("uses exact clicked facts rather than a same-phone matched lead and retains the full original saved history for web and Thumbtack cards", async () => {
    const saved = Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `Retained turn ${index}`,
      ...(index === 2 ? { metadata: { nested: [null, false, { fact: "old saved detail" }] } } : {}) }));
    saved.push({ role: "assistant", content: "" });
    for (const sourceLabel of ["Thumbtack", "Quote form"]) {
      const clicked = leadSnapshot({ sourceLabel, name: "Clicked B", category: "Move out", description: "B notes", bedrooms: "2" });
      const matched = leadSnapshot({ id: 500, name: "Heuristic A", description: "A notes", bedrooms: "6" });
      const { draft } = clickedLeadDraft(clicked);
      if (sourceLabel === "Quote form") expect(draft).toBeNull();
      const work = workspace({ lead: matched, snapshot: clicked, leadCardPhone: clicked.phone, leadDraft: draft,
        history: JSON.stringify(saved), selected: { lastInboundPhoneNumberId: null } });
      await work.settle(); click(findButton(work.render(), "Get Claude draft"));
      const request = work.generateInitial.mock.calls[0][0];
      expect(request.leadDetails).toEqual(leadFacts({ name: "Clicked B", category: "Move out", description: "B notes", bedrooms: "2" }));
      expect(request.originalConversation).toEqual(saved); expect(request.originalConversation).toHaveLength(13);
      expect(request.draftRequest).toEqual({ conversationContext: saved.filter(turn => turn.content.trim()).slice(-5)
        .map(turn => `${turn.role === "user" ? "Customer" : "Agent"}: ${turn.content}`).join("\n"),
        customerName: "Synthetic customer", jobContext: draft?.jobContext ?? "", scenario: draft?.scenario ?? "" });
      expect(request.draftRequest?.conversationContext).toBe(saved.filter(turn => turn.content.trim()).slice(-5)
        .map(turn => `${turn.role === "user" ? "Customer" : "Agent"}: ${turn.content}`).join("\n"));
      expect(work.generate).not.toHaveBeenCalled(); work.initialResponse.resolve(initialResult(request)); await work.settle(); work.dispose();
    }
  });

  it("drops late results and old Use callbacks on same-session clicked card/facts/notes/phone/mode/history/line changes", async () => {
    for (const change of ["card", "category", "notes", "phone", "mode", "history", "line", "away-and-back"] as const) {
      const clicked = leadSnapshot();
      const work = workspace({ selected: { id: 42, lastInboundPhoneNumberId: null }, snapshot: clicked, leadCardPhone: clicked.phone, history: "[]" });
      await work.settle(); work.edit("Human response"); click(findButton(work.render(), "Get Claude draft"));
      const request = work.generateInitial.mock.calls[0][0];
      const mutate = () => {
        if (change === "card" || change === "away-and-back") work.setSnapshot(leadSnapshot({ id: 502, name: "Other clicked card" }));
        else if (change === "category") work.setSnapshot(leadSnapshot({ category: "Different category" }));
        else if (change === "notes") work.setSnapshot(leadSnapshot({ description: "Changed notes", nativeDetails: [{ answer: "Changed retained detail" }] }));
        else if (change === "phone") work.setPhone("(301) 555-0124");
        else if (change === "mode") { work.setSnapshot(null); work.setPhone(undefined); }
        else if (change === "history") work.setDetail({ sessionId: 42, leadPhone: "+13015550123", messageHistory: '[{"role":"assistant","content":"Saved new turn"}]' });
        else work.setLive([conversation({ id: 42, lastInboundPhoneNumberId: "PN_NEW_LINE" })]);
        work.render();
        if (change === "away-and-back") { work.setSnapshot(clicked); work.render(); }
      };
      mutate(); work.initialResponse.resolve(initialResult(request)); await work.settle();
      expect(work.html()).not.toContain("Synthetic Claude first lead reply."); expect(work.html()).not.toContain("Use reply");
      expect(textarea(work.render()).props.value).toBe(["card", "phone", "mode", "away-and-back"].includes(change) ? "" : "Human response");
      expect(work.workspaceSend).not.toHaveBeenCalled(); expect(work.send).not.toHaveBeenCalled();
      work.dispose();
    }
    const clicked = leadSnapshot();
    const work = workspace({ selected: { id: 0, lastInboundPhoneNumberId: null }, snapshot: clicked, leadCardPhone: clicked.phone, history: "[]" });
    await work.settle(); work.edit("Human response"); click(findButton(work.render(), "Get Claude draft"));
    work.initialResponse.resolve(initialResult(work.generateInitial.mock.calls[0][0])); await work.settle();
    const oldUse = findButton(work.render(), "Use reply"); work.setSnapshot(leadSnapshot({ id: 502, description: "Other clicked card notes" })); work.render(); click(oldUse);
    expect(textarea(work.render()).props.value).toBe(""); expect(work.workspaceSend).not.toHaveBeenCalled(); work.dispose();
  });

  it("keeps composer untouched and World-class disabled on initial failures and result identity mismatches, and drops unmounted replies", async () => {
    for (const failure of ["unavailable", "request", "session", "phone", "hash"] as const) {
      const clicked = leadSnapshot();
      const work = workspace({ selected: { id: 0, lastInboundPhoneNumberId: null }, snapshot: clicked, leadCardPhone: clicked.phone,
        leadDraft: clickedLeadDraft(clicked).draft, history: "[]" });
      await work.settle(); work.edit("Human response"); click(findButton(work.render(), "Get Claude draft"));
      const request = work.generateInitial.mock.calls[0][0];
      if (failure === "unavailable") work.initialResponse.reject(new Error("PRIVATE credential"));
      else work.initialResponse.resolve(initialResult(request, failure === "request" ? { requestId: "00000000-0000-4000-8000-000000000009" }
        : failure === "session" ? { sessionId: 1 } : failure === "phone" ? { customerPhone: "+13015550124" } : { contextHash: "invalid" }));
      await work.settle(); expect(textarea(work.render()).props.value).toBe("Human response");
      expect(work.html()).not.toContain("World-class draft"); expect(work.html()).not.toContain("PRIVATE"); expect(work.html()).not.toContain("Use reply");
      expect(work.workspaceSend).not.toHaveBeenCalled(); expect(work.send).not.toHaveBeenCalled(); work.dispose();
    }
    const clicked = leadSnapshot();
    const work = workspace({ selected: { id: 0, lastInboundPhoneNumberId: null }, snapshot: clicked, leadCardPhone: clicked.phone, history: "[]" });
    await work.settle(); click(findButton(work.render(), "Get Claude draft")); work.dispose();
    work.initialResponse.resolve(initialResult(work.generateInitial.mock.calls[0][0])); for (let turn = 0; turn < 20; turn++) await Promise.resolve();
    expect(work.lateWrites).toBe(0); expect(work.workspaceSend).not.toHaveBeenCalled();
  });
});

describe("SMS tasks in the actual conversation timeline — offline", () => {
  const flow = (tree: unknown) => {
    const scroller = elements(tree).find(node => node.props.className === "ccc-live-sms-messages")!;
    return elements(scroller).filter(node => (typeof node.props.className === "string" && node.props.className.startsWith("ccc-live-sms-message "))
      || Boolean(node.props["data-synthetic-task-source"])).map(node => node.props["data-synthetic-task-source"]
        ? text(node) : text(elements(node).find(child => child.type === "p")));
  };
  it("places multiple tasks after their own request, before subsequent real replies, using display order rather than task status", () => {
    const original = [
      { role: "assistant", content: "Second actual reply", ts: 40, opMsgId: "OUT_2" },
      { role: "user", content: "Same customer wording", ts: 30, metadata: { providerMessageId: "B" } },
      { role: "assistant", content: "First actual reply", ts: 20, opMsgId: "OUT_1" },
      { role: "user", content: "Same customer wording", ts: 10, openPhoneMessageId: "A" },
    ];
    const taskRows = { A: ["First task — Done", "Second task — Open"], B: ["Third task — Open"], OUT_1: ["Must never attach to a reply"] };
    const w = workspace({ history: JSON.stringify(original), taskRows });
    expect(flow(w.render())).toEqual(["Same customer wording", "First task — Done", "Second task — Open", "First actual reply",
      "Same customer wording", "Third task — Open", "Second actual reply"]);
    expect(elements(w.render()).filter(node => node.props.className === "ccc-live-sms-messages")).toHaveLength(1);
    expect(w.send).not.toHaveBeenCalled(); expect(w.workspaceSend).not.toHaveBeenCalled();
    taskRows.A[1] = "Second task — Done";
    expect(flow(w.render())).toEqual(["Same customer wording", "First task — Done", "Second task — Done", "First actual reply",
      "Same customer wording", "Third task — Open", "Second actual reply"]);
    expect(original.map(message => message.content)).toEqual(["Second actual reply", "Same customer wording", "First actual reply", "Same customer wording"]);
    w.dispose();
  });
  it.each([
    [{ role: "user", content: "Request", ts: 10 }],
    [{ role: "user", content: "Request", ts: 10, opMsgId: "A", metadata: { providerMessageId: "OTHER" } }],
    [{ role: "user", content: "Request", ts: 10, opMsgId: "A" }, { role: "user", content: "Duplicate", ts: 11, opMsgId: "A" }],
    [{ role: "user", content: "Request", ts: 10, opMsgId: "A" }, { role: "user", content: " ", ts: 11, opMsgId: "A" }],
    [{ role: "user", content: "Request", ts: 10, opMsgId: "A" }, { role: "assistant", content: "Outbound collision", ts: 11, opMsgId: "A" }],
  ].map(messages => ({ messages })))("does not manufacture an anchor from missing, conflicting, duplicate, hidden or outbound-colliding saved IDs %#", ({ messages }) => {
    const w = workspace({ history: JSON.stringify(messages), taskRows: { A: ["Unsafe task"] } });
    expect(elements(w.render()).filter(node => node.props["data-synthetic-task-source"])).toHaveLength(0);
    expect(text(w.render())).not.toContain("Unsafe task");
    expect(flow(w.render())[0]).toBe("Request");
    w.dispose();
  });
  it("requires the loaded detail to belong to the selected exact session and does not hide normal history while loading", () => {
    const messages = [{ role: "user", content: "Request", ts: 10, opMsgId: "A" }];
    const w = workspace({ history: JSON.stringify(messages), taskRows: { A: ["Bound task"] } });
    expect(flow(w.render())).toEqual(["Request", "Bound task"]);
    w.setDetail({ sessionId: 43, leadPhone: "+13015550123", messageHistory: JSON.stringify(messages) });
    expect(flow(w.render())).toEqual(["Request"]);
    w.setDetail(undefined); expect(text(w.render())).toContain("Loading text history…");
    expect(elements(w.render()).filter(node => node.props["data-synthetic-task-source"])).toHaveLength(0);
    w.dispose();
  });
});
