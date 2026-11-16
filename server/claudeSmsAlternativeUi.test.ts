import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { claudeSmsAlternativeGenerateInputSchema, claudeSmsAlternativeResultSchema, type ClaudeSmsAlternativeGenerateInput, type ClaudeSmsAlternativeResult } from "../shared/claudeSmsAlternative";
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
type Props = { conversation: Conversation; conversations: Conversation[]; callerName: string; callerPhotoUrl: null;
  photoMap: Record<string, string>; businessDate: string; leadCardPhone?: string; lead: null;
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

function workspace(options: { selected?: Partial<Conversation>; leadCardPhone?: string; history?: string; primary?: "pending" | "fallback" } = {}) {
  let selected = conversation(options.selected);
  let detail: Detail = { sessionId: selected.id, leadPhone: selected.leadPhone, messageHistory: options.history ?? history() };
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
    madison: { claudeAlternative: { generate: { useMutation: () => ({ mutateAsync: generate }) } } },
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
        photoMap: {}, businessDate: "2026-11-15", leadCardPhone: options.leadCardPhone, lead: null,
        onNotice: notice, onOpenLeadDetails: vi.fn(), onSessionResolved: vi.fn(), onClose: vi.fn() });
      const pending = jobs; jobs = []; pending.forEach((run) => run());
      if (!dirty) return tree;
    }
    throw new Error("Synthetic drawer did not settle");
  };
  const settle = async () => { for (let turn = 0; turn < 20; turn++) { await Promise.resolve(); if (dirty) render(); } return render(); };
  const edit = (value: string) => (textarea(render()).props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
  render();
  return { render, settle, html: () => renderToStaticMarkup(render()), edit, generate, claudeResponse, uuid, fetchMock, fallback, send, workspaceSend,
    setDetail: (value: Detail) => { detail = value; }, setLive: (value: Conversation[]) => { live = value; }, setSelected: (value: Conversation) => { selected = value; },
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
