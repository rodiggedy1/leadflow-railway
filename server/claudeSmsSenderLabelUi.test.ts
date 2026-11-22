import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as provenance from "../shared/smsSenderProvenance";
import { claudeSmsAlternativeGenerateInputSchema, claudeSmsAlternativeResultSchema } from "../shared/claudeSmsAlternative";
import { claudeInitialLeadInputSchema, claudeInitialLeadResultSchema } from "../shared/claudeInitialLead";
import { getCsInboxReplyPhoneNumberIdForSelectedConversation } from "../shared/csInboxPhoneNumberRouting";
import { actualSmsTaskMessageAnchors, expandSmsTaskTimeline } from "./smsTaskTimelineUiHarness";

// Actual UI source only: injected hooks and synthetic tRPC callbacks. No app,
// router, DB, auth, provider, model, real data, or network imports/invocations.
const source = readFileSync(new URL("../client/src/pages/CommandChatExactLive.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("CommandChatExactLive.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const drawer = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "SmsConversationDrawer")!;
const controller = drawer.body!.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "createSmsDraftAttributionController")!;
const compile = (code: string) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const compiled = compile(`${drawer.getText(ast)}\nexports.Drawer = SmsConversationDrawer;`);
const REQUEST = "00000000-0000-4000-8000-000000000001";
const NOW = 1800000000000;
const LINE = "PN_SYNTHETIC_LINE";
const PHONE = "+13015550123";
const staff = "Synthetic staff";
type Element = React.ReactElement<Record<string, any>>;
const elements = (tree: unknown): Element[] => Array.isArray(tree) ? tree.flatMap(elements) : React.isValidElement<Record<string, any>>(tree) ? [tree, ...elements(tree.props.children)] : [];
const text = (tree: unknown): string => typeof tree === "string" || typeof tree === "number" ? String(tree) : Array.isArray(tree) ? tree.map(text).join("") : React.isValidElement<Record<string, any>>(tree) ? text(tree.props.children) : "";
const button = (tree: unknown, label: string) => elements(tree).find(node => node.type === "button" && text(node) === label)!;
const composer = (tree: unknown) => elements(tree).find(node => node.type === "textarea")!;
const avatar = (props: { name: string; photoUrl: string | null }) => React.createElement("span", { "data-avatar-name": props.name, "data-avatar-photo": props.photoUrl ?? "neutral" });
const icon = () => React.createElement("svg");
const conversation = (overrides: Record<string, unknown> = {}) => ({ id: 42, leadName: "Synthetic customer", leadPhone: PHONE, leadSource: "cs-inbound", lastMessageText: "Friday?", lastMessageTs: NOW, lastMsgTs: NOW, lastSenderRole: "user", hasUnanswered: true, aiSummary: null, personType: "customer", lastInboundPhoneNumberId: LINE, receivedAt: NOW, calledAt: null, ...overrides });
const inbound = { role: "user", content: "Friday?", ts: NOW, opMsgId: "OM_SYNTHETIC_INBOUND" };
const lead = { name: "Synthetic customer", serviceType: "Home cleaning", category: "House cleaning", address: null, location: null, requestedDates: null, bedrooms: "2", bathrooms: "1", homeSize: null, rooms: null, propertyType: null, frequency: null, extras: [], pets: null, description: null, summary: null, travelPreferences: [], proposedTimes: [], nativeDetails: [] };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; }
function workspace(options: { initial?: boolean; history?: unknown[] } = {}) {
  let selected = conversation();
  let live = [selected];
  let phone: string | undefined = options.initial ? PHONE : undefined;
  let detail = { sessionId: 42, leadPhone: PHONE, messageHistory: JSON.stringify(options.history ?? [inbound]) };
  const reply = deferred<any>();
  const initial = deferred<any>();
  const generate = vi.fn((_request: any) => reply.promise);
  const generateInitial = vi.fn((_request: any) => initial.promise);
  const send = vi.fn();
  const sendWorkspace = vi.fn();
  let replyCallbacks: any;
  let workspaceCallbacks: any;
  let quoteCallbacks: any;
  const invalidate = vi.fn();
  const trpc = {
    useUtils: () => ({ commandCenter: { listCommandChatInbox: { invalidate } }, leads: { getCsConversation: { invalidate } } }),
    leads: { getCsConversation: { useQuery: () => ({ data: detail }) }, sendMessage: { useMutation: (callbacks: any) => { replyCallbacks = callbacks; return { isPending: false, mutate: send }; } }, sendWorkspaceMessage: { useMutation: (callbacks: any) => { workspaceCallbacks = callbacks; return { isPending: false, mutate: sendWorkspace }; } } },
    leadflowJobs: { customerProfile: { useQuery: () => ({ data: null }) }, teamIdentityByPhone: { useQuery: () => ({ data: null }) } },
    leadflowSchedule: { getSchedule: { useQuery: () => ({ data: null }) } },
    opsChat: { csReply: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) } },
    madison: { claudeAlternative: { generate: { useMutation: () => ({ mutateAsync: generate }) }, generateInitialLead: { useMutation: () => ({ mutateAsync: generateInitial }) } } },
    commandCenter: { prepareQuoteAssistant: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) } },
    bookingFunnel: { createCustomerLink: { useMutation: (callbacks: any) => { quoteCallbacks = callbacks; return { isPending: false, mutate: vi.fn() }; } } },
  };
  const slots: Array<{ value?: any; deps?: any[]; cleanup?: () => void }> = [];
  let cursor = 0;
  let dirty = false;
  let effects: Array<() => void> = [];
  const changed = (slot: typeof slots[number] | undefined, deps: any[]) => !slot?.deps || deps.length !== slot.deps.length || deps.some((v, i) => !Object.is(v, slot.deps![i]));
  const hooks = {
    useState(initial: any) { const i = cursor++; if (!slots[i]) slots[i] = { value: typeof initial === "function" ? initial() : initial }; return [slots[i].value, (next: any) => { const value = typeof next === "function" ? next(slots[i].value) : next; if (!Object.is(value, slots[i].value)) dirty = true; slots[i].value = value; }]; },
    useRef(initial: any) { const i = cursor++; if (!slots[i]) slots[i] = { value: { current: initial } }; return slots[i].value; },
    useMemo(factory: () => any, deps: any[]) { const i = cursor++; if (changed(slots[i], deps)) slots[i] = { value: factory(), deps }; return slots[i].value; },
    useCallback(callback: any, deps: any[]) { return hooks.useMemo(() => callback, deps); },
    useEffect(effect: () => void | (() => void), deps: any[]) { const i = cursor++; if (changed(slots[i], deps)) { const cleanup = slots[i]?.cleanup; slots[i] = { deps, cleanup }; effects.push(() => { cleanup?.(); const next = effect(); slots[i].cleanup = typeof next === "function" ? next : undefined; }); } },
  };
  let tokenRead = false;
  const fetchMock = vi.fn(async () => ({ ok: true, body: { getReader: () => ({ read: async () => { if (tokenRead) return { done: true }; tokenRead = true; return { done: false, value: new TextEncoder().encode('data: {"token":"Existing OpenAI draft."}\n') }; }, cancel: async () => {} }) } }));
  const module = { exports: {} as { Drawer: (props: any) => Element } };
  const timeline = ({ children }: any) => children(() => null);
  runInNewContext(compiled, { module, exports: module.exports, React, ...hooks, trpc, ...provenance,
    claudeSmsAlternativeGenerateInputSchema, claudeSmsAlternativeResultSchema, claudeInitialLeadInputSchema, claudeInitialLeadResultSchema,
    getCsInboxReplyPhoneNumberIdForSelectedConversation, normalizedLeadPhone: (value: string | null) => value?.replace(/\D/g, "").slice(-10) || "",
    ClaudeSmsConversationTasks: timeline, customerSmsTaskMessageAnchors: actualSmsTaskMessageAnchors, Fragment: React.Fragment,
    ...Object.fromEntries(["Users", "Eye", "X", "CalendarClock", "Sparkles", "ChevronRight", "Loader2", "RefreshCw", "ChevronDown", "Pencil", "Send"].map(name => [name, icon])), Avatar: avatar,
    smsConversationName: (value: any) => value.leadName, customerPortraitFor: () => "/synthetic.png", displayLeadSource: () => "CS", renderMessageBody: (value: string) => value, formatTime: () => "10:00 AM",
    fetch: fetchMock, crypto: { randomUUID: () => REQUEST }, AbortController, TextDecoder, console: { warn: vi.fn() }, requestAnimationFrame: () => 1, cancelAnimationFrame: vi.fn(), Date,
    QUOTE_EXTRA_ICONS: {}, QUOTE_EXTRA_OPTIONS: [], firstName: (value: string) => value.split(" ")[0], quoteHomeType: () => "Home", window: { location: { origin: "https://synthetic.invalid" } },
  }, { timeout: 1500 });
  let tree: Element;
  const render = () => { for (let pass = 0; pass < 12; pass++) { dirty = false; cursor = 0; tree = expandSmsTaskTimeline(module.exports.Drawer({ conversation: selected, conversations: live, callerName: staff, callerPhotoUrl: "/staff.png", photoMap: { [staff]: "/staff.png", Rohan: "/rohan.png" }, businessDate: "2026-11-16", leadCardPhone: phone, leadCardSnapshot: phone ? lead : null, lead: null, onNotice: vi.fn(), onOpenLeadDetails: vi.fn(), onSessionResolved: vi.fn(), onClose: vi.fn() }), timeline); const pending = effects; effects = []; pending.forEach(run => run()); if (!dirty) return tree; } throw new Error("Synthetic drawer did not settle"); };
  const settle = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve(); if (dirty) render(); } return render(); };
  const edit = (value: string) => composer(render()).props.onChange({ target: { value } });
  const click = (label: string) => { const node = button(render(), label); expect(node).toBeDefined(); node.props.onClick(); };
  const submit = () => elements(render()).find(node => node.props["aria-label"] === "Send text reply")!.props.onClick();
  const select = async () => { await settle(); click("Get Claude draft"); const request = (phone ? generateInitial : generate).mock.calls.at(-1)![0]; if (phone) initial.resolve({ kind: "initial_lead", sessionId: request.sessionId, customerPhone: PHONE, requestId: request.requestId, replyText: "Selected Claude draft.", contextHash: "a".repeat(64), mode: "review_only", smsSent: false, actionsExecuted: false, agentId: "synthetic", agentSessionId: "synthetic" }); else reply.resolve({ ...request, receivingPhoneNumber: "+13015550987", replyText: "Selected Claude draft.", contextHash: "a".repeat(64), mode: "review_only", smsSent: false, actionsExecuted: false, agentId: "synthetic", agentSessionId: "synthetic" }); await settle(); click("Use reply"); render(); };
  const replace = (eventName: string, value: string, full = true) => { const node = composer(render()); const old = node.props.value as string; node.props[eventName]({ currentTarget: { value: old, selectionStart: full ? 0 : old.length, selectionEnd: old.length }, key: "x", shiftKey: false }); edit(value); };
  render();
  return { render, settle, edit, click, select, submit, replace, send, sendWorkspace, generate, generateInitial, reply, initial, fetchMock,
    html: () => renderToStaticMarkup(render()),
    history: (messages: unknown[]) => { detail = { ...detail, messageHistory: JSON.stringify(messages) }; },
    selected: (overrides: Record<string, unknown>) => { selected = { ...selected, ...overrides }; },
    live: (overrides: Record<string, unknown>) => { live = [{ ...selected, ...overrides }]; },
    phone: (value: string | undefined) => { phone = value; },
    success: (result: any = options.initial ? { success: true, sessionId: 42 } : { duplicate: false }) => (options.initial ? workspaceCallbacks : replyCallbacks).onSuccess(result, (options.initial ? sendWorkspace : send).mock.calls.at(-1)![0]),
    failure: () => workspaceCallbacks.onError(new Error("Synthetic failure")),
    quote: () => quoteCallbacks.onSuccess({ urlPath: "/synthetic-quote", firstCleaningTotalCents: 12000 }),
    dispose: () => slots.forEach(slot => slot.cleanup?.()),
  };
}
const manualReply = (message: string) => ({ sessionId: 42, message, fromNumberId: LINE, source: "cs_inbox" });
const draftSource = (kind = "sms_reply") => ({ requestId: REQUEST, kind });

describe("internal sender-label actual composer provenance", () => {
  it("executes the UI's pure controller; accepts only valid explicit sources and never guesses from text", () => {
    const module = { exports: {} as { create: () => any } };
    runInNewContext(compile(`${controller.getText(ast)}\nexports.create = createSmsDraftAttributionController;`), { module, exports: module.exports, ...provenance });
    const c = module.exports.create(); c.target("a"); c.edit("Selected Claude draft."); expect(c.forSend("a")).toBeNull();
    c.select(draftSource(), "a"); c.edit("Staff substantially edited it"); expect(c.forSend("a")).toEqual(draftSource()); expect(c.forSend("b")).toBeNull();
    c.select({ requestId: "invalid", kind: "sms_reply" }, "a"); expect(c.forSend("a")).toBeNull();
    c.select({ ...draftSource(), mode: "automatic" }, "a"); expect(c.forSend("a")).toBeNull();
    c.select(draftSource(), "a"); c.target("b"); c.target("a"); expect(c.forSend("a")).toBeNull();
  });

  it.each([false, true])("only verified Use reply attributes reviewed edits on the existing manual route (initial=%s)", async initial => {
    const w = workspace({ initial }); await w.select(); expect(w.send).not.toHaveBeenCalled(); expect(w.sendWorkspace).not.toHaveBeenCalled();
    w.edit("  Reviewed and edited content  "); w.submit();
    const expected = initial ? { phone: PHONE, message: "Reviewed and edited content", name: "Synthetic customer" } : manualReply("Reviewed and edited content");
    expect((initial ? w.sendWorkspace : w.send).mock.calls[0][0]).toEqual({ ...expected, claudeDraftSource: draftSource(initial ? "initial_lead" : "sms_reply") }); w.dispose();
  });

  it.each(["clear", "onBeforeInput", "onPaste", "onCut", "onKeyDown", "OpenAI", "quote"])("clears assistance on %s without changing normal sending", async action => {
    const w = workspace(); await w.select();
    if (action === "clear") { w.edit(""); w.edit("Unrelated manual reply"); }
    else if (action === "OpenAI") w.click("Insert into reply");
    else if (action === "quote") w.quote();
    else w.replace(action, "Unrelated manual reply");
    const value = composer(w.render()).props.value.trim(); w.submit(); expect(w.send.mock.calls[0][0]).toEqual(manualReply(value)); w.dispose();
  });

  it.each(["onBeforeInput", "onPaste", "onKeyDown"])("partial edits via %s preserve selected assistance", async eventName => {
    const w = workspace(); await w.select(); w.replace(eventName, "Selected Claude draft. Staff addition", false); w.submit();
    expect(w.send.mock.calls[0][0].claudeDraftSource).toEqual(draftSource()); w.dispose();
  });

  it.each(["conversation", "selected phone", "live phone", "receiving line", "lead phone"])("clears selected assistance synchronously after %s changes", async change => {
    const w = workspace(); await w.select();
    if (change === "conversation") w.selected({ id: 43 });
    else if (change === "selected phone") w.selected({ leadPhone: "+13015550124" });
    else if (change === "live phone") w.live({ leadPhone: "+13015550124" });
    else if (change === "receiving line") w.live({ lastInboundPhoneNumberId: "PN_OTHER" });
    else w.phone("+13015550124");
    w.render(); w.edit("Manual reply on new target"); w.submit(); const sent = change === "lead phone" ? w.sendWorkspace : w.send;
    expect(sent.mock.calls[0][0]).not.toHaveProperty("claudeDraftSource"); w.dispose();
  });

  it("keeps selected edited assistance after same-target incoming/history refresh, without needing an extant proposal", async () => {
    const w = workspace(); await w.select(); w.edit("Reviewed reply");
    w.history([inbound, { role: "user", content: "Also Saturday?", opMsgId: "OM_NEW", ts: NOW + 10 }]);
    w.live({ lastMessageText: "Also Saturday?", lastMessageTs: NOW + 10 }); w.render(); w.submit();
    expect(w.send.mock.calls[0][0]).toEqual({ ...manualReply("Reviewed reply"), claudeDraftSource: draftSource() }); w.dispose();
  });

  it.each(["generationOnly", "discard", "failure", "mismatch", "stale"])("never tags an unused %s proposal", async state => {
    const w = workspace(); await w.settle(); w.edit("Unrelated human text"); w.click("Get Claude draft");
    const request = w.generate.mock.calls[0][0];
    if (state === "failure") w.reply.reject(new Error("Synthetic unavailable"));
    else {
      if (state === "stale") { w.live({ lastInboundPhoneNumberId: "PN_OTHER" }); w.render(); }
      w.reply.resolve({ ...request, requestId: state === "mismatch" ? "00000000-0000-4000-8000-000000000009" : REQUEST, receivingPhoneNumber: "+13015550987", replyText: "Selected Claude draft.", contextHash: "a".repeat(64), mode: "review_only", smsSent: false, actionsExecuted: false, agentId: "synthetic", agentSessionId: "synthetic" });
    }
    await w.settle(); if (state === "discard") w.click("Discard"); w.submit(); expect(w.send.mock.calls[0][0]).not.toHaveProperty("claudeDraftSource"); w.dispose();
  });

  it.each([false, true])("optimistic success and history refetch render the same assistance while retaining staff identity (initial=%s)", async initial => {
    const w = workspace({ initial }); await w.select(); w.edit("Reviewed reply"); w.submit(); w.success();
    expect(w.html()).toContain(`${staff} · Claude draft`); expect(w.html()).toContain('data-avatar-name="Synthetic staff"'); expect(w.html()).toContain('data-avatar-photo="/staff.png"');
    const persisted = { role: "assistant", content: "Reviewed reply", ts: Date.now(), senderName: "Canonical server staff", smsProvenance: provenance.reviewedClaudeSmsProvenance(draftSource(initial ? "initial_lead" : "sms_reply"), "Canonical server staff") };
    w.history([inbound, persisted]); expect(w.html()).toContain("Canonical server staff · Claude draft"); expect(w.html()).not.toContain(`${staff} · Claude draft`); expect(persisted.senderName).toBe("Canonical server staff");
    w.edit("Next ordinary manual reply"); w.submit(); expect((initial ? w.sendWorkspace : w.send).mock.calls.at(-1)![0]).not.toHaveProperty("claudeDraftSource"); w.dispose();
  });

  it("failed manual sends create no outgoing label; an error preserves the still-used selected composer for deliberate retry", async () => {
    const w = workspace({ initial: true }); await w.select(); w.submit(); w.failure(); expect(w.html()).not.toContain(`${staff} · Claude draft`);
    expect(composer(w.render()).props.value).toBe("Selected Claude draft."); w.submit(); expect(w.sendWorkspace.mock.calls.at(-1)![0].claudeDraftSource).toEqual(draftSource("initial_lead"));
    w.success({ success: false, sessionId: 42 }); expect(w.html()).not.toContain(`${staff} · Claude draft`); w.dispose();
  });

  it("no author inference from old matching text, staff identity, lead source, or incoming metadata", async () => {
    const w = workspace({ history: [inbound, { role: "assistant", content: "Selected Claude draft.", senderName: "Rohan", ts: NOW + 1 }, { role: "user", content: "Incoming with marker", senderName: "Rohan", ts: NOW + 2, smsProvenance: provenance.reviewedClaudeSmsProvenance(draftSource(), "Rohan") }] });
    await w.settle(); w.edit("Selected Claude draft."); w.submit(); expect(w.send.mock.calls[0][0]).toEqual(manualReply("Selected Claude draft."));
    expect(w.html()).not.toContain("· Claude draft"); expect(w.html()).toContain("Customer · 10:00 AM"); w.dispose();
  });

  it("only verified automatic history is labeled and uses a neutral avatar rather than Rohan's photo", async () => {
    const automatic = provenance.automaticClaudeSmsProvenance(9, "OM_AUTO");
    const w = workspace({ history: [{ role: "assistant", content: "Automatic text unchanged", senderName: "Rohan", ts: NOW, opMsgId: "OM_AUTO", smsProvenance: automatic }] });
    await w.settle(); expect(w.html()).toContain("Claude AI · Automatic"); expect(w.html()).toContain('data-avatar-name="Claude AI"'); expect(w.html()).toContain('data-avatar-photo="neutral"'); expect(w.html()).not.toContain("/rohan.png");
    w.history([{ role: "assistant", content: "Unbound automatic marker", senderName: "Rohan", ts: NOW, opMsgId: "OM_OTHER", smsProvenance: automatic }]);
    expect(w.html()).not.toContain("Claude AI · Automatic"); expect(w.html()).toContain('data-avatar-name="Rohan"'); expect(w.html()).toContain('data-avatar-photo="/rohan.png"'); w.dispose();
  });
});
