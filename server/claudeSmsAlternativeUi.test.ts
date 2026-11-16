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
type PrimaryInput = { conversationContext: string; customerName: string; jobContext: string; scenario: string };
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
function clickedLeadDraft(lead: LeadSnapshot): { draft: Props["leadDraft"]; snapshot: LeadSnapshot | null } {
  let draft: Props["leadDraft"] = null;
  let snapshot: LeadSnapshot | null = null;
  const script = ts.transpileModule(`${between("  const openSmsDrawerFromLead =", "  const addPendingOutgoingMessage =")}\nopenSmsDrawerFromLead(lead);`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  runInNewContext(script, { lead, useCallback: (callback: unknown) => callback, smsInbox: [], showNotice: vi.fn(),
    setSelectedLeadCardPhone: vi.fn(), setSelectedSmsConversation: vi.fn(),
    setSelectedLeadCardDraft: (value: Props["leadDraft"]) => { draft = value; },
    setSelectedLeadCardSnapshot: (value: LeadSnapshot) => { snapshot = value; }, normalizedLeadPhone,
    THUMBTACK_FIRST_RESPONSE_PROMPT, buildThumbtackLeadDraftContext }, { timeout: 1500 });
  return { draft, snapshot };
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

function workspace(options: { selected?: Partial<Conversation>; leadCardPhone?: string; history?: string; primary?: "pending" | "fallback";
  lead?: LeadSnapshot | null; snapshot?: LeadSnapshot | null; leadDraft?: Props["leadDraft"]; noDetail?: boolean } = {}) {
  let selected = conversation(options.selected);
  let detail: Detail | undefined = options.noDetail ? undefined : { sessionId: selected.id, leadPhone: selected.leadPhone, messageHistory: options.history ?? history() };
  let snapshot = options.snapshot;
  let leadCardPhone = options.leadCardPhone;
  let leadDraft = options.leadDraft;
  let live = [selected];
  let primaryCallbacks: { onSuccess: (data: { reply: string }) => void; onError: () => void };
  const fallback = { isPending: false, mutate: vi.fn((_request: PrimaryInput) => { fallback.isPending = true; }) };
  const primaryResponse = deferred<{ ok: boolean; body: { getReader: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }>; cancel: () => Promise<void> } } | null }>();
  let tokenRead = false;
  const successResponse = () => ({ ok: true, body: { getReader: () => ({
    read: async () => { if (tokenRead) return { done: true }; tokenRead = true; return { done: false, value: new TextEncoder().encode('data: {"token":"Existing primary draft."}\n') }; },
    cancel: async () => {},
  }) } });
  const fetchMock = vi.fn(() => options.primary === "pending" ? primaryResponse.promise : Promise.resolve(options.primary === "fallback" ? { ok: false, body: null } : successResponse()));
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
    opsChat: { csReply: { useMutation: (callbacks: typeof primaryCallbacks) => { primaryCallbacks = callbacks; return fallback; } } },
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
  runInNewContext(compiled, { module, exports: module.exports, React, ...hooks, trpc,
    ...Object.fromEntries(iconNames.map((name) => [name, icon])), Avatar: icon,
    claudeSmsAlternativeGenerateInputSchema, claudeSmsAlternativeResultSchema, getCsInboxReplyPhoneNumberIdForSelectedConversation,
    claudeInitialLeadInputSchema, claudeInitialLeadResultSchema, normalizedLeadPhone,
    smsConversationName: (value: Conversation) => value.leadName ?? "Customer", customerPortraitFor: () => "/synthetic.png",
    displayLeadSource: () => "CS", renderMessageBody: (value: string) => value, formatTime: () => "10:00 AM",
    fetch: fetchMock, crypto: { randomUUID: uuid }, console: { warn: vi.fn() }, AbortController, TextDecoder,
    requestAnimationFrame: () => 1, cancelAnimationFrame: vi.fn(),
  }, { timeout: 1500 });
  let tree: React.ReactElement;
  const render = () => {
    for (let pass = 0; pass < 12; pass++) {
      dirty = false; cursor = 0;
      tree = module.exports.Drawer({ conversation: selected, conversations: live, callerName: "Synthetic office", callerPhotoUrl: null,
        photoMap: {}, businessDate: "2026-11-15", leadCardPhone, lead: options.lead ?? null, leadCardSnapshot: snapshot, leadDraft,
        onNotice: notice, onOpenLeadDetails: vi.fn(), onSessionResolved: vi.fn(), onClose: vi.fn() });
      const pending = jobs; jobs = []; pending.forEach((run) => run());
      if (!dirty) return tree;
    }
    throw new Error("Synthetic drawer did not settle");
  };
  const settle = async () => { for (let turn = 0; turn < 20; turn++) { await Promise.resolve(); if (dirty) render(); } return render(); };
  const edit = (value: string) => (textarea(render()).props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
  render();
  return { render, settle, html: () => renderToStaticMarkup(render()), edit, generate, claudeResponse, generateInitial, initialResponse, uuid, fetchMock, fallback, send, workspaceSend,
    setDetail: (value: Detail | undefined) => { detail = value; }, setLive: (value: Conversation[]) => { live = value; }, setSelected: (value: Conversation) => { selected = value; },
    setSnapshot: (value: LeadSnapshot | null) => { snapshot = value; }, setPhone: (value: string | undefined) => { leadCardPhone = value; },
    setLeadDraft: (value: Props["leadDraft"]) => { leadDraft = value; },
    primaryDone: () => primaryResponse.resolve(successResponse()),
    fallbackDone: () => { fallback.isPending = false; primaryCallbacks.onSuccess({ reply: "Existing fallback draft." }); },
    dispose: () => { slots.forEach((slot) => slot.cleanup?.()); dead = true; }, get lateWrites() { return lateWrites; },
  };
}

describe("optional Claude alternative actual SMS drawer", () => {
  it("hash-binds the exact primary stream, fallback, on-open generation, manual mutations, and editable composer to b717f778", () => {
    expect(hash(between("  const smsAutoDraft = trpc.opsChat.csReply.useMutation", "  const streamSmsAutoDraft ="))).toBe("6753f185565120b1277efae066473d385095f19f26715aeea6b147f07c4147af");
    expect(hash(between("  const streamSmsAutoDraft =", "  const regenerateSmsDraft ="))).toBe("40381e33976dbd16c581aae585c3a41675b33639df988e43b1bddc0b1a43fd63");
    expect(hash(between("  useEffect(() => {\n    if (conversation.id > 0 && !detail", "  useEffect(() => {\n    if (!detail || (initialBottomScrollDone"))).toBe("e923f10f91c8b832f97e974c7729289d88a4c69be176f8b82a059b7c80b73dee");
    expect(hash(between("  const sendReply = trpc.leads.sendMessage.useMutation", '  return <div className="ccc-live-sms-backdrop"'))).toBe("b7f876f173d31c4d7a8e79e63ff3a88bb415f0bd44a193518d1fbab74474bcb5");
    expect(hash(source.split(/(?<=\n)/).find((line) => line.includes('<div className="ccc-live-sms-composer"><textarea'))!)).toBe("448317cc6e5dc5b29936620f242b077656dff3306282637263e22eced7eec27e");
    expect(between("  const regenerateSmsDraft =", "  const insertSmsAutoDraft =").replace("    if (claudeDraftBusyRef.current) return;\n", "")).toBe("  const regenerateSmsDraft = useCallback(() => {\n    autoDraftedForConversationRef.current = null;\n    void streamSmsAutoDraft();\n  }, [streamSmsAutoDraft]);\n");
  });

  it("keeps Claude optional and off team/lead-only drawers, invokes only the existing primary path on open", async () => {
    const work = workspace(); await work.settle();
    expect(work.html()).toContain("Get Claude draft"); expect(work.html()).toContain("World-class draft");
    expect(work.fetchMock).toHaveBeenCalledTimes(1); expect(work.generate).not.toHaveBeenCalled(); expect(work.uuid).not.toHaveBeenCalled();
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
    expect(work.send).toHaveBeenCalledWith({ sessionId: 42, message: "Reviewed and edited Claude text", fromNumberId: "PN_SYNTHETIC_LINE", source: "cs_inbox" });
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

  it("coalesces explicit requests and gates Regenerate only until Claude finishes, preserving normal primary regeneration", async () => {
    const work = workspace(); await work.settle();
    const regenerate = findButton(work.render(), "Regenerate")!;
    expect(regenerate.props.disabled).toBe(false); click(findButton(work.render(), "Get Claude draft"));
    expect(findButton(work.render(), "Regenerate")!.props.disabled).toBe(true); click(regenerate);
    expect(work.fetchMock).toHaveBeenCalledTimes(1);
    work.claudeResponse.resolve(result(work.generate.mock.calls[0][0])); await work.settle();
    expect(findButton(work.render(), "Regenerate")!.props.disabled).toBe(false); click(findButton(work.render(), "Regenerate"));
    expect(work.fetchMock).toHaveBeenCalledTimes(2); work.dispose();
  });

  it("blocks Claude during the unchanged primary stream and during the unchanged tRPC fallback", async () => {
    const streaming = workspace({ primary: "pending" }); await streaming.settle();
    const disabled = findButton(streaming.render(), "Get Claude draft")!; expect(disabled.props.disabled).toBe(true); click(disabled);
    expect(streaming.generate).not.toHaveBeenCalled(); streaming.primaryDone(); await streaming.settle(); expect(findButton(streaming.render(), "Get Claude draft")!.props.disabled).toBe(false); streaming.dispose();
    const fallback = workspace({ primary: "fallback" }); await fallback.settle();
    expect(fallback.fallback.mutate).toHaveBeenCalledTimes(1); expect(findButton(fallback.render(), "Get Claude draft")!.props.disabled).toBe(true);
    click(findButton(fallback.render(), "Get Claude draft")); expect(fallback.generate).not.toHaveBeenCalled();
    fallback.fallbackDone(); await fallback.settle(); expect(fallback.html()).toContain("Existing fallback draft."); expect(findButton(fallback.render(), "Get Claude draft")!.props.disabled).toBe(false); fallback.dispose();
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
      expect(findButton(work.render(), "Getting Claude draft…")!.props.disabled).toBe(true);
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

  it("unavailable or mismatched provider results never affect composer, primary draft, or manual sending", async () => {
    const unavailable = workspace(); await unavailable.settle(); unavailable.edit("Human reply"); click(findButton(unavailable.render(), "Get Claude draft"));
    unavailable.claudeResponse.reject(new Error("PRIVATE backend credential")); await unavailable.settle();
    expect(unavailable.html()).toContain("Claude draft is unavailable"); expect(unavailable.html()).not.toContain("PRIVATE");
    expect(unavailable.html()).toContain("World-class draft"); expect(textarea(unavailable.render()).props.value).toBe("Human reply");
    expect(findButton(unavailable.render(), "Regenerate")!.props.disabled).toBe(false); unavailable.dispose();
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
  it("preserves prompt, builder body, primary payload, and quote-assistant callbacks/JSX bytes", async () => {
    expect(hash(THUMBTACK_FIRST_RESPONSE_PROMPT)).toBe("aa2665b8f0c82ba8daae49e7f0d0d66fe5234b8ba653d6fa4eb36c3bdadc2ed4");
    const sharedSource = readFileSync(new URL("../shared/claudeInitialLead.ts", import.meta.url), "utf8");
    expect(hash(sharedSource.slice(sharedSource.indexOf("  const details = lead.nativeDetails"), sharedSource.indexOf("\n}", sharedSource.indexOf("  const details = lead.nativeDetails")))))
      .toBe("4f156c33795eff623fb0124030a04ed0505825529196e76b98f62fc4c1fdebcd");
    expect(hash(between("  const openSmsDrawerFromLead =", "  const addPendingOutgoingMessage =").replace("    setSelectedLeadCardSnapshot(lead);\n", "")))
      .toBe("2d778c081dea57587a62e47d140ea7fb89581832a7702804c5e1bbba04f1c3bf");
    expect(hash(between("  const prepareQuoteAssistant =", "  const resizeSmsComposer ="))).toBe("e7f83223340dda78f19130f60ce258990f8bde58f88c0f08075aefacbaa9a775");
    expect(hash(between("    {quoteAssistantOpen && quoteAssistantFields && <QuoteAssistantModal", "function QuoteAssistantModal")))
      .toBe("02adc581431e0792109bacff678dfc5633fc2057a528a84e8f28c96ce90901fd");
    const clicked = leadSnapshot();
    const { draft, snapshot } = clickedLeadDraft(clicked);
    expect(snapshot).toBe(clicked);
    expect(draft).toEqual({ scenario: `${THUMBTACK_FIRST_RESPONSE_PROMPT}\n\nThumbtack lead:\n${buildThumbtackLeadDraftContext(clicked)}`,
      jobContext: buildThumbtackLeadDraftContext(clicked) });
    const work = workspace({ selected: { id: 0, lastInboundPhoneNumberId: null }, snapshot: clicked, leadCardPhone: clicked.phone, leadDraft: draft, noDetail: true });
    await work.settle();
    expect((work.fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body).toBe(JSON.stringify({
      conversationContext: "", customerName: "Synthetic customer", jobContext: draft!.jobContext, scenario: draft!.scenario,
    }));
    expect(work.generateInitial).not.toHaveBeenCalled(); expect(work.generate).not.toHaveBeenCalled(); expect(work.uuid).not.toHaveBeenCalled();
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
      expect(request).toEqual({ sessionId, customerPhone: clicked.phone, requestId: "00000000-0000-4000-8000-000000000001", leadDetails: leadFacts(), originalConversation: [] });
      work.initialResponse.resolve(initialResult(request)); await work.settle();
      expect(work.html()).toContain("First lead reply"); expect(work.html()).not.toContain("Reply on");
      expect(textarea(work.render()).props.value).toBe("Human first response");
      expect(work.workspaceSend).not.toHaveBeenCalled(); expect(work.send).not.toHaveBeenCalled();
      click(findButton(work.render(), "Use reply")); expect(textarea(work.render()).props.value).toBe("Synthetic Claude first lead reply.");
      expect(work.workspaceSend).not.toHaveBeenCalled(); expect(work.send).not.toHaveBeenCalled();
      work.edit("Reviewed first reply"); click(elements(work.render()).find((node) => node.props["aria-label"] === "Send text reply"));
      expect(work.workspaceSend).toHaveBeenCalledWith({ phone: clicked.phone, message: "Reviewed first reply", name: "Synthetic customer" });
      expect(work.send).not.toHaveBeenCalled(); work.dispose();
    }
    const clicked = leadSnapshot();
    const loading = workspace({ selected: { id: 42, lastInboundPhoneNumberId: null }, snapshot: clicked, leadCardPhone: clicked.phone, noDetail: true });
    await loading.settle(); const get = findButton(loading.render(), "Get Claude draft")!;
    expect(get.props.disabled).toBe(true); click(get); expect(loading.generateInitial).not.toHaveBeenCalled(); loading.dispose();
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
      expect(work.generate).not.toHaveBeenCalled(); work.initialResponse.resolve(initialResult(request)); await work.settle(); work.dispose();
    }
  });

  it("drops late results and old Use callbacks on same-session clicked card/facts/notes/phone/mode/history/line changes", async () => {
    for (const change of ["card", "category", "notes", "phone", "mode", "history", "line", "away-and-back"] as const) {
      const clicked = leadSnapshot();
      const work = workspace({ selected: { id: 0, lastInboundPhoneNumberId: null }, snapshot: clicked, leadCardPhone: clicked.phone, history: "[]" });
      await work.settle(); work.edit("Human response"); click(findButton(work.render(), "Get Claude draft"));
      const request = work.generateInitial.mock.calls[0][0];
      const mutate = () => {
        if (change === "card" || change === "away-and-back") work.setSnapshot(leadSnapshot({ id: 502, name: "Other clicked card" }));
        else if (change === "category") work.setSnapshot(leadSnapshot({ category: "Different category" }));
        else if (change === "notes") work.setSnapshot(leadSnapshot({ description: "Changed notes", nativeDetails: [{ answer: "Changed retained detail" }] }));
        else if (change === "phone") work.setPhone("(301) 555-0124");
        else if (change === "mode") { work.setSnapshot(null); work.setPhone(undefined); }
        else if (change === "history") work.setDetail({ sessionId: 0, leadPhone: "+13015550123", messageHistory: '[{"role":"assistant","content":"Saved new turn"}]' });
        else work.setLive([conversation({ id: 0, lastInboundPhoneNumberId: "PN_NEW_LINE" })]);
        work.render();
        if (change === "away-and-back") { work.setSnapshot(clicked); work.render(); }
      };
      mutate(); work.initialResponse.resolve(initialResult(request)); await work.settle();
      expect(work.html()).not.toContain("Synthetic Claude first lead reply."); expect(work.html()).not.toContain("Use reply");
      expect(textarea(work.render()).props.value).toBe("Human response"); expect(work.workspaceSend).not.toHaveBeenCalled(); expect(work.send).not.toHaveBeenCalled();
      work.dispose();
    }
    const clicked = leadSnapshot();
    const work = workspace({ selected: { id: 0, lastInboundPhoneNumberId: null }, snapshot: clicked, leadCardPhone: clicked.phone, history: "[]" });
    await work.settle(); work.edit("Human response"); click(findButton(work.render(), "Get Claude draft"));
    work.initialResponse.resolve(initialResult(work.generateInitial.mock.calls[0][0])); await work.settle();
    const oldUse = findButton(work.render(), "Use reply"); work.setSnapshot(leadSnapshot({ id: 502, description: "Other clicked card notes" })); work.render(); click(oldUse);
    expect(textarea(work.render()).props.value).toBe("Human response"); expect(work.workspaceSend).not.toHaveBeenCalled(); work.dispose();
  });

  it("keeps composer/primary untouched on initial failures and result identity mismatches, and drops unmounted replies", async () => {
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
      expect(work.html()).toContain("World-class draft"); expect(work.html()).not.toContain("PRIVATE"); expect(work.html()).not.toContain("Use reply");
      expect(work.workspaceSend).not.toHaveBeenCalled(); expect(work.send).not.toHaveBeenCalled(); work.dispose();
    }
    const clicked = leadSnapshot();
    const work = workspace({ selected: { id: 0, lastInboundPhoneNumberId: null }, snapshot: clicked, leadCardPhone: clicked.phone, history: "[]" });
    await work.settle(); click(findButton(work.render(), "Get Claude draft")); work.dispose();
    work.initialResponse.resolve(initialResult(work.generateInitial.mock.calls[0][0])); for (let turn = 0; turn < 20; turn++) await Promise.resolve();
    expect(work.lateWrites).toBe(0); expect(work.workspaceSend).not.toHaveBeenCalled();
  });
});
