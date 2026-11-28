import { withoutApprovedTaskCallPlayback } from "./taskCallPlaybackSourceControl";
import React from "react";
import * as recordingUtils from "../client/src/lib/utils";
import { renderToStaticMarkup } from "react-dom/server";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import * as icons from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import * as contract from "../shared/claudeCustomerTasks";
import type { CustomerTask } from "../shared/claudeCustomerTasks";

// OFFLINE ONLY: execute the actual TSX with injected React/tRPC/Dialog seams.
// No app/router, authentication, database, provider, model, browser, or network.
const BASELINE = "8a1789ddfca54d3e771a412bf5c60c8ebca694f2";
const componentPath = "client/src/components/ClaudeCustomerTasks.tsx";
const pagePath = "client/src/pages/CommandChatExactLive.tsx";
const source = readFileSync(componentPath, "utf8");
const page = readFileSync(pagePath, "utf8");
const baseline = (path: string) => execFileSync("git", ["show", `${BASELINE}:${path}`], { encoding: "utf8" });
// Test-only: restore exactly the approved takeover hunks for historical byte guards.
// Behavioral harnesses continue to execute the actual, unnormalized source.
function withoutApprovedTaskTakeover(value: string) {
  value = withoutApprovedTaskCallPlayback(componentPath, value);
  const approved: Array<[string, string]> = [
    ['  claim: (id: number, expectedOwnerId?: string) => Promise<void>;\n', '  claim: (id: number) => Promise<void>;\n'],
    ['    claim: (id, expectedOwnerId) => run(id, () => expectedOwnerId === undefined\n      ? claim.mutateAsync({ id })\n      : claim.mutateAsync({ id, expectedOwnerId })),\n', '    claim: (id) => run(id, () => claim.mutateAsync({ id })),\n'],
    ['      {task.status === "claimed" && !mine && task.owner && <button type="button" className="cct-primary" disabled={busy || !callerId}\n        title={`Take over from ${task.owner.name}`} onClick={() => void update(() => actions.claim(task.id, task.owner!.id))}>\n        {busy ? <><Loader2 aria-hidden="true" />Taking over…</> : "Take over"}</button>}\n', ''],
  ];
  for (const [current, original] of approved) {
    expect(value.split(current)).toHaveLength(2);
    value = value.replace(current, original);
  }
  return value;
}
function withoutApprovedTaskReads(value: string) {
  value = withoutApprovedTaskTakeover(value);
  const classifier = `  const transientFailure = [identity.error, query.error].every(error => {
    const code = error?.data?.code;
    const httpStatus = error?.data?.httpStatus;
    return (!code || ["INTERNAL_SERVER_ERROR", "TIMEOUT", "TOO_MANY_REQUESTS", "BAD_GATEWAY", "SERVICE_UNAVAILABLE", "GATEWAY_TIMEOUT"].includes(code))
      && (httpStatus === undefined || httpStatus === 408 || httpStatus === 429 || httpStatus >= 500);
  });
`;
  expect(value.split(classifier)).toHaveLength(2);
  value = value.replace('  transientFailure: boolean;\n', '').replace(classifier, '')
    .replace('failed: query.isError || identity.isError, transientFailure, pendingIds', 'failed: query.isError || identity.isError, pendingIds');
  const stream = (input: string) => {
    const parsed = ts.createSourceFile(componentPath, input, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const matches = parsed.statements.filter(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === "ClaudeCustomerTaskStreamCard");
    expect(matches).toHaveLength(1); return { parsed, statement: matches[0] };
  };
  const current = stream(value), original = stream(baseline(componentPath));
  return value.slice(0, current.statement.getStart(current.parsed)) + original.statement.getText(original.parsed) + value.slice(current.statement.end);
}
const NOW = 1_800_000_000_000;
const actor = { id: "synthetic-owner-openid", name: "Synthetic staff" };
const confirmer = { id: "synthetic-confirmer", name: "Confirming staff" };
type CallTask = Extract<CustomerTask, { call: unknown }>;
type SmsTask = Extract<CustomerTask, { sessionId: number; receivingPhoneNumberId: string }>;
type EmailTask = Extract<CustomerTask, { email: unknown }>;
const actions = () => ({ claim: vi.fn(async (_id: number) => {}), completeItem: vi.fn(async (_id: number, _itemId: string) => {}), complete: vi.fn(async (_id: number, _note: string) => {}) });
function sms(overrides: Partial<SmsTask> = {}): SmsTask {
  return {
    id: 901, version: 1, kind: "claude_customer_task", sessionId: 42,
    customerName: "Synthetic customer", customerPhone: "+13015550123", receivingPhoneNumberId: "PN_SYNTHETIC", receivingPhoneNumber: "+13015550987",
    sourceMessageId: "SYNTHETIC_SOURCE", sourceText: "Please add the oven.\nKeep the caller's exact words.", receivedAt: NOW - 60_000,
    title: "Review oven request", items: [{ id: "oven", title: "Handle oven request", evidenceQuote: "add the oven", completedBy: null, completedAt: null }],
    status: "unclaimed", owner: null, claimedAt: null, completedAt: null, completedBy: null, completionNote: null,
    reply: { text: "Staff will review the request.", status: "prepared", providerMessageId: null },
    activity: [{ action: "created", actor: null, at: NOW - 60_000, note: null }], ...overrides,
  };
}
function email(overrides: Partial<EmailTask> = {}): EmailTask {
  return { ...sms(), id: 902, sessionId: null, customerPhone: null, receivingPhoneNumberId: null, receivingPhoneNumber: null,
    email: { mailboxEmail: "office@example.test", threadId: "SYNTHETIC_EXACT_THREAD", fromEmail: "caller@example.test", replyToEmail: null,
      recipientEmail: "office@example.test", subject: "Synthetic request", rfcMessageId: "<SYNTHETIC@example.test>" }, ...overrides };
}
function call(overrides: Partial<CallTask> = {}): CallTask {
  return contract.customerCallTaskSchema.parse({ ...sms(), id: 903, sessionId: null, receivingPhoneNumberId: null, receivingPhoneNumber: null,
    call: { provider: "vapi", providerCallId: "SYNTHETIC_PROVIDER_CALL", voiceCallId: 77,
      transcript: "Assistant: How can I help?\nCaller: Please add the oven.\nAssistant: I will ask staff to review it.\nCaller: Keep the caller's exact words.",
      recordingUrl: "https://recordings.example.test/synthetic-full-call.wav", callbackTaskIds: [401] },
    reply: { text: "", status: "not_applicable", providerMessageId: null }, ...overrides });
}
type Element = React.ReactElement<Record<string, any>>;
const nodes = (tree: unknown): Element[] => Array.isArray(tree) ? tree.flatMap(nodes) : React.isValidElement<Record<string, any>>(tree) ? [tree, ...nodes(tree.props.children)] : [];
const text = (tree: unknown): string => typeof tree === "string" || typeof tree === "number" ? String(tree) : Array.isArray(tree) ? tree.map(text).join("") : React.isValidElement<Record<string, any>>(tree) ? text(tree.props.children) : "";
const transcriptText = (tree: unknown): string => nodes(tree).filter(node => node.props.className === "cct-call-turn").map(turn =>
  nodes(turn).filter(node => node.props.className === "cct-call-speaker").map(text).join("") + nodes(turn).filter(node => node.props.className === "cct-verbatim").map(text).join("\n")).join("\n");
const normalized = (value: string) => value.replace(/\s+/g, " ").trim();
const button = (tree: unknown, label: string) => nodes(tree).find(node => node.type === "button" && text(node) === label)!;
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const Dialog = (_props: any) => null;
const DialogContent = (_props: any) => null;
const DialogTrigger = (_props: any) => null;
const Provider = (_props: any) => null;
const div = ({ children, ...props }: any) => React.createElement("div", props, children);
const sanitizer = { sanitize: vi.fn((value: string, options: unknown) => {
  expect(options).toEqual({ USE_PROFILES: { html: true }, FORBID_ATTR: ["style", "color", "bgcolor"] });
  if (value === "<p>Synthetic HTML source</p>" || value === "<b>Synthetic HTML evidence</b>") return value;
  throw new Error("Unexpected sanitizer input: call and plain-text source must stay literal");
}) };
function harness(api: unknown = {}, initialContext?: unknown, input = source) {
  const slots = new Map<string, unknown[]>();
  let key = ""; let cursor = 0; let context = initialContext;
  const react = { ...React,
    createContext: () => ({ Provider }),
    useState(initial: unknown) {
      const values = slots.get(key)!; const index = cursor++;
      if (!(index in values)) values[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [values[index], (next: unknown) => { values[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(values[index]) : next; }];
    },
    useRef(initial: unknown) { const values = slots.get(key)!; const index = cursor++; if (!(index in values)) values[index] = { current: initial }; return values[index]; },
    useContext: () => context,
  };
  const module = { exports: {} as Record<string, any> };
  runInNewContext(ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
    { module, exports: module.exports, Date, Intl, Map, Set, Error, Number, require: (id: string) => {
      if (id === "react") return react;
      if (id === "dompurify") return sanitizer;
      if (id === "lucide-react") return icons;
      if (id === "@/lib/trpc") return { trpc: api };
      if (id === "@/lib/utils") return recordingUtils;
      if (id === "@shared/claudeCustomerTasks") return contract;
      if (id === "@/components/ui/dialog") return { Dialog, DialogContent, DialogTrigger, DialogDescription: div, DialogTitle: div };
      if (id.endsWith(".css")) return {};
      // Phase 1 booking-change panel: rendered and tested separately (claudeBookingChangePanelUi.test.ts).
      if (id === "./ClaudeBookingChangePanel") return { ClaudeBookingChangePanel: () => null, useBookingChange: () => ({ data: null }), bookingChangeStatus: () => null, bookingChangeHistory: () => [], useManualBookingChange: () => null, manualBookingStatus: () => null, ManualBookingNotice: () => null };
      throw new Error(`Forbidden offline UI import: ${id}`);
    } }, { timeout: 1500 });
  const ui = module.exports;
  const render = (name: string, props: Record<string, unknown>, instance = name): Element => {
    key = instance; cursor = 0; if (!slots.has(key)) slots.set(key, []); return ui[name](props);
  };
  const expand = (tree: any, path = "root", dialogState?: { open: boolean; onOpenChange: (open: boolean) => void }): any => {
    if (Array.isArray(tree)) return tree.map((child, index) => {
      const result = expand(child, `${path}.${index}`, dialogState);
      return React.isValidElement(result) ? React.cloneElement(result, { key: result.key ?? `${path}.${index}` }) : result;
    });
    if (!React.isValidElement<Record<string, any>>(tree)) return tree;
    const name = Object.keys(ui).find(name => ui[name] === tree.type);
    if (name) return expand(render(name, tree.props, path), `${path}.${name}`, dialogState);
    if (tree.type === Provider) {
      const previous = context; context = tree.props.value;
      try { return expand(tree.props.children, `${path}.provider`, dialogState); }
      finally { context = previous; }
    }
    if (tree.type === Dialog) return React.createElement("div", { "data-dialog-open": tree.props.open }, expand(tree.props.children, `${path}.dialog`, tree.props as any));
    if (tree.type === DialogContent) return dialogState?.open ? React.createElement("div", { role: "dialog", className: tree.props.className }, expand(tree.props.children, `${path}.content`, dialogState)) : null;
    if (tree.type === DialogTrigger) {
      expect(tree.props.asChild).toBe(true);
      const child = tree.props.children as Element;
      return React.cloneElement(child, { "aria-haspopup": "dialog", "aria-expanded": dialogState?.open,
        onClick: () => dialogState!.onOpenChange(true) });
    }
    if (tree.type === div) return div({ ...tree.props, children: expand(tree.props.children, `${path}.div`, dialogState) });
    return React.cloneElement(tree, {}, expand(tree.props.children, `${path}.children`, dialogState));
  };
  return { ui, render, expand, setContext: (value: unknown) => { context = value; } };
}
function rig(task: CustomerTask, input = source, callerId = actor.id) {
  const a = actions(); const onOpenConversation = vi.fn();
  const context = { callerId, tasks: [task], loading: false, failed: false, pendingIds: new Set<number>(), actions: a, onOpenConversation, refresh: vi.fn() };
  const get = vi.fn(() => ({ data: task, isLoading: false, isError: false }));
  const recordingUrl = "https://recordings.example.test/fresh-signed-call.wav";
  const recording = vi.fn(() => ({ data: { url: recordingUrl }, isLoading: false, isError: false, refetch: vi.fn() }));
  const work = harness({ claudeCustomerTasks: { get: { useQuery: get }, recording: { useQuery: recording } } }, context, input);
  const render = (placement: "queue" | "stream", pending = false) => {
    context.pendingIds = pending ? new Set([task.id]) : new Set();
    const draw = () => work.expand(work.render(placement === "queue" ? "ClaudeCustomerTasksQueue" : "ClaudeCustomerTaskStreamCard", placement === "queue" ? {} : { taskId: task.id }), placement);
    let tree = draw();
    if (placement === "queue" && task.status === "done" && !nodes(tree).some(node => node.props.className === "cct-card-status")) {
      button(tree, "Done1").props.onClick(); tree = draw();
    }
    // Approved 320px design: cards start collapsed; these checks read the expanded card, as staff do.
    const collapsed = nodes(tree).find(node => node.props.className === "cct-expand" && node.props["aria-expanded"] === false);
    if (collapsed) { collapsed.props.onClick(); tree = draw(); }
    return tree;
  };
  return { ...work, a, onOpenConversation, get, recording, recordingUrl, context, render, html: (placement: "queue" | "stream", pending = false) => renderToStaticMarkup(render(placement, pending)) };
}

describe("Canonical AI customer call task evidence in the actual queue and stream (offline)", () => {
  it.each(["queue", "stream"] as const)("labels the %s task AI CALL, shows the real caller phone and exact plain caller evidence without an SMS acknowledgment", placement => {
    sanitizer.sanitize.mockClear();
    const task = call({ sourceText: "  Please add the oven.\n<script>literal caller evidence</script>\nKeep all spacing.  ", items: [{ ...call().items[0], evidenceQuote: "<b>literal caller quote</b>" }] });
    const work = rig(task); const tree = work.render(placement); const html = work.html(placement);
    expect(text(nodes(tree).find(node => node.props.className === "cct-card-meta"))).toContain(" · AI call · ");
    expect(text(nodes(tree).find(node => node.props.className === "cct-customer-phone"))).toBe(task.customerPhone);
    expect(text(nodes(tree).find(node => node.props.className === "cct-source-message"))).toBe(`Caller evidence${task.sourceText}`);
    expect(text(nodes(tree).find(node => node.type === "blockquote"))).toBe(task.items[0].evidenceQuote);
    expect(html).toContain("&lt;script&gt;literal caller evidence&lt;/script&gt;"); expect(html).toContain("&lt;b&gt;literal caller quote&lt;/b&gt;");
    expect(html).not.toContain("<script>"); expect(html).not.toContain("Acknowledgment"); expect(html).not.toContain("acknowledgment");
    expect(html).not.toContain("Customer text"); expect(html).not.toContain("Sent ·"); expect(html).not.toContain("not sent");
    expect(nodes(tree).some(node => String(node.props.className).startsWith("cct-reply "))).toBe(false);
    expect(nodes(tree).find(node => node.type === "details")!.props.open).toBeUndefined();
    expect(sanitizer.sanitize).not.toHaveBeenCalled(); expect(work.onOpenConversation).not.toHaveBeenCalled();
    for (const mutation of Object.values(work.a)) expect(mutation).not.toHaveBeenCalled();
    expect(work.get).not.toHaveBeenCalled();
  });

  it.each(["queue", "stream"] as const)("opens the complete %s call in a local dialog independent of session, ownership, status, pending or SMS callback", placement => {
    for (const status of ["unclaimed", "claimed", "done"] as const) for (const pending of [false, true]) for (const sessionId of [null, 42]) {
      const transcript = "  Assistant: Spoken acknowledgment, not an SMS.\nCaller: <script>literal transcript</script>\n" + "Caller: Retain this exact full-call turn.\n".repeat(140) + "Caller: FINAL FULL-CALL TURN.  ";
      const task = call({ status, sessionId, owner: status === "unclaimed" ? null : { id: "other-owner", name: "Other staff" }, completedBy: status === "done" ? confirmer : null,
        call: { ...call().call, transcript } });
      const work = rig(task, source, ""); work.context.onOpenConversation = undefined as any;
      let tree = work.render(placement, pending); const open = button(tree, "Open full call");
      expect(open.props.type).toBe("button"); expect(open.props.disabled).toBeUndefined(); expect(open.props["aria-haspopup"]).toBe("dialog");
      expect(nodes(tree).some(node => node.props.role === "dialog")).toBe(false);
      expect(work.recording).not.toHaveBeenCalled();
      open.props.onClick(); tree = work.render(placement, pending);
      const dialog = nodes(tree).find(node => node.props.role === "dialog")!; expect(dialog).toBeDefined();
      const full = nodes(dialog).find(node => node.props["aria-label"] === "Full call transcript")!;
      expect(normalized(transcriptText(full))).toBe(normalized(transcript));
      expect(nodes(full).filter(node => node.props.className === "cct-call-speaker")).toHaveLength(transcript.trim().split("\n").length);
      const audio = nodes(dialog).find(node => node.type === "audio")!;
      expect(audio.props).toMatchObject({ controls: true, preload: "metadata", src: work.recordingUrl, "aria-label": "Call recording" });
      const recording = nodes(dialog).find(node => node.type === "a")!;
      expect(recording.props).toMatchObject({ href: work.recordingUrl, target: "_blank", rel: "noopener noreferrer" });
      expect(work.recording).toHaveBeenCalledWith({ id: task.id }, { retry: false, staleTime: 0, refetchOnWindowFocus: false });
      const html = renderToStaticMarkup(dialog); expect(html).toContain("FINAL FULL-CALL TURN.  ");
      expect(html.match(/Retain this exact full-call turn/g)).toHaveLength(140); expect(html).toContain("&lt;script&gt;literal transcript&lt;/script&gt;"); expect(html).not.toContain("<script>");
      expect(html).not.toContain("Sent ·"); expect(work.onOpenConversation).not.toHaveBeenCalled();
      for (const mutation of Object.values(work.a)) expect(mutation).not.toHaveBeenCalled();
      expect(task.call.transcript).toBe(transcript); expect(task.status).toBe(status);
    }
  });

  it("preserves absent phone and recording as absent, keeps full transcript, and uses the keyboard-accessible existing Dialog trigger", () => {
    const task = call({ customerPhone: null, call: { ...call().call, recordingUrl: null } });
    const work = rig(task); button(work.render("stream"), "Open full call").props.onClick(); const tree = work.render("stream");
    expect(text(nodes(tree).find(node => node.props.className === "cct-customer-phone"))).toBe("");
    expect(nodes(tree).some(node => node.type === "audio" || node.type === "a")).toBe(false);
    expect(normalized(transcriptText(tree))).toBe(normalized(task.call.transcript)); expect(text(tree)).not.toContain("+13015550123");
    expect(source).toContain('<DialogTrigger asChild><button type="button" className="cct-conversation-link">Open full call</button></DialogTrigger>');
    expect(source).toContain('<Dialog open={open} onOpenChange={setOpen}>');
    expect(source).toContain('<DialogContent className="cct-confirm-dialog">');
    const dialog = readFileSync("client/src/components/ui/dialog.tsx", "utf8");
    expect(dialog).toContain("DialogPrimitive.Trigger"); expect(dialog).toContain("DialogPrimitive.Content"); expect(dialog).toContain("DialogPrimitive.Close");
  });
  it.each(["loading", "missing", "error"] as const)("keeps the full transcript available when recording is %s; never uses a cached private link", mode => {
    const task = call(); const work = rig(task); const refetch = vi.fn();
    work.recording.mockReturnValue({ data: mode === "missing" ? { url: null } : undefined, isLoading: mode === "loading", isError: mode === "error", refetch } as any);
    expect(work.recording).not.toHaveBeenCalled(); button(work.render("stream"), "Open full call").props.onClick();
    const tree = work.render("stream"); expect(normalized(transcriptText(tree))).toBe(normalized(task.call.transcript));
    expect(nodes(tree).some(node => node.type === "audio" || node.type === "a")).toBe(false);
    expect(renderToStaticMarkup(tree)).not.toContain(task.call.recordingUrl!);
    expect(text(tree)).toContain(mode === "loading" ? "Loading call recording" : "Call recording unavailable");
    if (mode === "error") { button(tree, "Retry").props.onClick(); expect(refetch).toHaveBeenCalledOnce(); }
  });
});

describe("Task-call playback and transcript presentation repair — offline", () => {
  const staff = (transcript = "Unattributed: Original saved words.", source: "quo" | "saved" = "saved") => contract.customerStaffCallTaskSchema.parse({ ...call(), sourceMessageId: "ACsynthetic-staff",
    call: { provider: "openphone", providerCallId: "ACsynthetic-staff", recordingId: 91, transcript, transcriptSource: source,
      recordingUrl: "https://recordings.example.test/staff.wav", businessPhoneNumberId: "PNsynthetic", businessPhoneNumber: "+13015550987", staffUserId: null, direction: "incoming" } });
  it.each(["vapi", "openphone"] as const)("uses the existing AI player proxy and metadata loading for %s only after opening", provider => {
    const task = provider === "vapi" ? call() : staff();
    for (const url of ["https://storage.vapi.ai/synthetic.wav", "https://synthetic.r2.cloudflarestorage.com/calls/synthetic.wav", "https://synthetic.r2.dev/calls/synthetic.wav", "https://recordings.example.test/public.wav"]) {
      const work = rig(task);
      work.recording.mockReturnValue({ data: { url }, isLoading: false, isError: false, refetch: vi.fn() });
      expect(work.recording).not.toHaveBeenCalled();
      button(work.render("stream"), "Open full call").props.onClick(); const tree = work.render("stream");
      const expected = recordingUtils.proxyRecordingUrl(url);
      expect(nodes(tree).find(node => node.type === "audio")!.props).toMatchObject({ src: expected, controls: true, preload: "metadata" });
      expect(nodes(tree).find(node => node.type === "a")!.props.href).toBe(expected);
      expect(work.recording).toHaveBeenCalledTimes(1);
      expect(work.recording.mock.calls[0][1]).not.toHaveProperty("refetchInterval");
    }
  });
  it("reports a media-element failure without polling, retries once on click and remounts even if the fresh URL is identical", () => {
    const work = rig(call()), refetch = vi.fn();
    work.recording.mockReturnValue({ data: { url: "https://storage.vapi.ai/synthetic.wav" }, isLoading: false, isError: false, refetch });
    button(work.render("stream"), "Open full call").props.onClick();
    let tree = work.render("stream"), audio = nodes(tree).find(node => node.type === "audio")!;
    const originalKey = audio.key; audio.props.onError();
    tree = work.render("stream"); expect(text(tree)).toContain("Audio could not be loaded."); expect(refetch).not.toHaveBeenCalled();
    expect(normalized(transcriptText(tree))).toBe(normalized(call().call.transcript));
    button(tree, "Retry").props.onClick(); expect(refetch).toHaveBeenCalledTimes(1);
    tree = work.render("stream"); audio = nodes(tree).find(node => node.type === "audio")!;
    expect(audio.key).not.toBe(originalKey); expect(text(tree)).not.toContain("Audio could not be loaded.");
    audio.props.onError();
    work.recording.mockReturnValue({ data: { url: "https://storage.vapi.ai/new-synthetic.wav" }, isLoading: false, isError: false, refetch });
    tree = work.render("stream"); expect(text(tree)).not.toContain("Audio could not be loaded.");
    expect(nodes(tree).find(node => node.type === "audio")!.props.src).toBe(recordingUtils.proxyRecordingUrl("https://storage.vapi.ai/new-synthetic.wav"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
  it("formats saved undiarized text into neutral paragraphs without changing words or inventing inner speaker attribution", () => {
    const words = Array.from({ length: 137 }, (_, index) => `original${index}`).join(" ");
    const transcript = `Unattributed:  ${words}  \r\nStaff: these are words inside undiarized text.\nCorrection: Monday, not Friday.\n中文 日本語 العربية <script>literal evidence</script>`;
    const task = staff(transcript), work = rig(task);
    const tree = work.expand(work.ui.CustomerTaskCallTranscript({ task }));
    expect(nodes(tree).filter(node => node.props.className === "cct-call-speaker").map(text)).toEqual(["Unattributed:"]);
    const paragraphs = nodes(tree).filter(node => node.props.className === "cct-verbatim").map(text);
    expect(paragraphs.length).toBeGreaterThan(1);
    expect(paragraphs.join("")).toBe(transcript.replace(/^Unattributed:/, ""));
    expect(normalized(transcriptText(tree))).toBe(normalized(transcript));
    expect(renderToStaticMarkup(tree)).toContain("&lt;script&gt;literal evidence&lt;/script&gt;");
    expect(renderToStaticMarkup(tree)).not.toContain("<script>");
    expect(task.call.transcript).toBe(transcript);
    expect(work.recording).not.toHaveBeenCalled(); for (const action of Object.values(work.a)) expect(action).not.toHaveBeenCalled();
  });
  it("separates existing AI and native staff labels literally, leaves arbitrary colon-prefixed prose unlabelled", () => {
    for (const task of [call({ call: { ...call().call, transcript: "AI: Original words.\nUser: Exact answer.\nCorrection: Monday, not Friday." } }),
      staff("Caller: Original caller words.\nStaff: Original staff words.\nUnattributed: Unknown voice.", "quo")]) {
      const work = rig(task), tree = work.expand(work.ui.CustomerTaskCallTranscript({ task }));
      expect(normalized(transcriptText(tree))).toBe(normalized(task.call.transcript));
      const labels = nodes(tree).filter(node => node.props.className === "cct-call-speaker").map(text);
      expect(labels).toEqual(task.call.provider === "vapi" ? ["AI:", "User:"] : ["Caller:", "Staff:", "Unattributed:"]);
      expect(text(tree)).not.toContain("Ava"); expect(text(tree)).not.toContain("Madison");
    }
  });
  it("normalizes only the exact approved display hunks and still detects unrelated changes", () => {
    // The released card (ac36ea3) still normalizes exactly to the original; the approved 320px redesign (2026-11-27) keeps the
    // call playback, transcript and evidence code and its styles byte-for-byte.
    const released = (path: string) => execFileSync("git", ["show", `ac36ea3dad109368be9d4ac5166c7d461ae60db0:${path}`], { encoding: "utf8" });
    for (const path of [componentPath, "client/src/components/claude-customer-tasks.css"]) {
      const original = execFileSync("git", ["show", `af1b1337:${path}`], { encoding: "utf8" });
      expect(withoutApprovedTaskCallPlayback(path, released(path))).toBe(original);
      expect(withoutApprovedTaskCallPlayback(path, released(path) + "\n// UNAUTHORIZED_CHANGE\n")).not.toBe(original);
    }
    const calls = (source: string) => source.slice(source.indexOf("export function CustomerTaskCallRecording"), source.indexOf("export function TaskCompletionConfirm"));
    expect(calls(readFileSync(componentPath, "utf8"))).toBe(calls(released(componentPath)));
    const callStyles = (css: string) => css.split("\n").filter(line => /cct-call|cct-phone-transcript/.test(line)).join("\n");
    expect(callStyles(readFileSync("client/src/components/claude-customer-tasks.css", "utf8"))).toBe(callStyles(released("client/src/components/claude-customer-tasks.css")));
  });
});

describe("Staff Quo calls reuse the unchanged task card and human controls", () => {
  function staffCall() {
    return contract.customerStaffCallTaskSchema.parse({ ...call(), sourceMessageId: "ACsynthetic-staff",
      call: { provider: "openphone", providerCallId: "ACsynthetic-staff", recordingId: 91,
        transcript: "Customer: Please add the oven.\nStaff: I will arrange that later.", recordingUrl: "https://recordings.example.test/staff.wav",
        businessPhoneNumberId: "PNsynthetic", businessPhoneNumber: "+13015550987", staffUserId: "USsynthetic", direction: "incoming" } });
  }
  it.each(["queue", "stream"] as const)("renders a PHONE CALL in %s with exact caller evidence and the same full-call dialog", placement => {
    const task = staffCall(), work = rig(task);
    let tree = work.render(placement);
    expect(text(nodes(tree).find(node => node.props.className === "cct-card-meta"))).toContain(" · Phone call · ");
    expect(text(tree)).toContain(task.customerPhone!); expect(text(tree)).toContain(task.items[0].evidenceQuote);
    expect(text(tree)).not.toContain("Acknowledgment"); expect(work.get).not.toHaveBeenCalled(); expect(work.recording).not.toHaveBeenCalled();
    button(tree, "Open full call").props.onClick(); tree = work.render(placement);
    expect(text(tree)).toContain("Full staff call"); expect(normalized(transcriptText(tree))).toBe(normalized(task.call.transcript));
    expect(work.recording).toHaveBeenCalledWith({ id: task.id }, { retry: false, staleTime: 0, refetchOnWindowFocus: false });
    expect(nodes(tree).find(node => node.type === "audio")!.props.src).toBe(work.recordingUrl);
    expect(work.onOpenConversation).not.toHaveBeenCalled();
    for (const action of Object.values(work.a)) expect(action).not.toHaveBeenCalled();
  });
  it.each(["queue", "stream"] as const)("preserves unknown attribution for a saved whole-call transcript in %s without a fake customer quote or assignee", placement => {
    const original = staffCall(), transcript = "Unattributed: Please call tomorrow. I will check and get back to you.";
    const task = contract.customerStaffCallTaskSchema.parse({ ...original, customerName: null, sourceText: "Please call tomorrow. I will check and get back to you.",
      call: { ...original.call, staffUserId: null, transcript, transcriptSource: "saved", evidenceScope: "call_transcript" } });
    const work = rig(task); let tree = work.render(placement);
    expect(text(nodes(tree).find(node => node.props.className === "cct-source-message"))).toBe(`Call evidence${task.sourceText}`);
    expect(text(tree)).not.toContain("Caller evidence"); expect(text(tree)).not.toContain("Customer task");
    expect(text(nodes(tree).find(node => node.props.className === "cct-card-meta"))).toContain("Caller");
    button(tree, "Open full call").props.onClick(); tree = work.render(placement);
    expect(text(tree)).toContain(transcript); expect(task.call.staffUserId).toBeNull(); expect(task.owner).toBeNull();
    for (const action of Object.values(work.a)) expect(action).not.toHaveBeenCalled();
    expect(work.get).not.toHaveBeenCalled(); expect(work.onOpenConversation).not.toHaveBeenCalled();
  });
  it("still parses old Quo task metadata without inserting provenance defaults or changing any AI-call schema", () => {
    const old = staffCall(); expect(old.call).not.toHaveProperty("transcriptSource"); expect(old.call).not.toHaveProperty("evidenceScope");
    expect(contract.customerStaffCallTaskSchema.parse(old)).toEqual(old);
    const ai = call(); expect(contract.customerCallTaskSchema.parse(ai)).toEqual(ai);
    expect(contract.customerCallTaskSchema.safeParse({ ...ai, call: { ...ai.call, staffUserId: null, transcriptSource: "saved" } }).success).toBe(false);
  });
  it.each(["queue", "stream"] as const)("retains identical Claim/Done ownership, required note and completion controls for %s staff calls", async placement => {
    const task = staffCall(), unclaimed = rig(task);
    button(unclaimed.render(placement), "Claim").props.onClick(); await flush(); expect(unclaimed.a.claim).toHaveBeenCalledWith(task.id);
    expect(task.status).toBe("unclaimed");
    const work = rig({ ...task, status: "claimed", owner: actor, claimedAt: NOW });
    button(work.render(placement), "Mark done").props.onClick(); let tree = work.render(placement);
    expect(button(tree, "Confirm done").props.disabled).toBe(true);
    nodes(tree).find(node => node.type === "textarea")!.props.onChange({ target: { value: "  Arranged oven cleaning  " } });
    tree = work.render(placement); button(tree, "Confirm done").props.onClick(); await flush();
    expect(work.a.complete).toHaveBeenCalledWith(task.id, "Arranged oven cleaning");
    const other = rig({ ...task, status: "claimed", owner: { id: "someone-else", name: actor.name }, claimedAt: NOW });
    expect(button(other.render(placement), "Mark done")).toBeUndefined();
  });
});

describe("AI call task human confirmation and canonical state remain unchanged (offline)", () => {
  it.each(["queue", "stream"] as const)("preserves Claim/Done, owner gates, confirmation note and item action behavior in %s", async placement => {
    const unclaimed = rig(call()); const claimButton = button(unclaimed.render(placement), "Claim"); claimButton.props.onClick(); claimButton.props.onClick(); await flush();
    expect(unclaimed.a.claim.mock.calls).toEqual([[903]]); expect(unclaimed.context.tasks[0].status).toBe("unclaimed");
    expect(button(unclaimed.render(placement, true), "Claiming…").props.disabled).toBe(true);
    const task = call({ customerName: null, status: "claimed", owner: actor, claimedAt: NOW }); const work = rig(task);
    let tree = work.render(placement); expect(text(tree)).toContain(`Claimed by ${actor.name}`);
    nodes(tree).find(node => String(node.props["aria-label"]).startsWith("Confirm completed item"))!.props.onClick(); await flush(); expect(work.a.completeItem).toHaveBeenCalledWith(903, "oven");
    button(work.render(placement), "Mark done").props.onClick(); tree = work.render(placement);
    expect(text(tree)).toContain("human confirmation"); expect(text(tree)).toContain("not system verification");
    expect(text(tree)).toContain("No booking change, customer call, customer text, or conversation closure is performed.");
    expect(text(nodes(tree).find(node => node.props.className === "cct-confirm-task"))).toContain(task.customerPhone);
    expect(button(tree, "Confirm done").props.disabled).toBe(true); button(tree, "Confirm done").props.onClick(); await flush(); expect(work.a.complete).not.toHaveBeenCalled();
    nodes(tree).find(node => node.type === "textarea")!.props.onChange({ target: { value: "  Staff reviewed the caller request  " } });
    tree = work.render(placement); expect(button(tree, "Confirm done").props.disabled).toBe(false);
    button(tree, "Confirm done").props.onClick(); await flush(); expect(work.a.complete).toHaveBeenCalledWith(903, "Staff reviewed the caller request"); expect(task.status).toBe("claimed");
    const other = rig(call({ status: "claimed", owner: { id: "different-owner", name: actor.name } }));
    expect(button(other.render(placement), "Mark done")).toBeUndefined(); expect(nodes(other.render(placement)).find(node => String(node.props["aria-label"]).startsWith("Confirm completed item"))).toBeUndefined();
    const done = rig(call({ status: "done", owner: actor, completedBy: confirmer, completedAt: NOW, completionNote: "Actual staff confirmation note" }));
    expect(text(nodes(done.render(placement)).find(node => node.props.className === "cct-card-status"))).toBe(`Completed by ${confirmer.name}`);
    expect(done.html(placement)).toContain("Actual staff confirmation note"); expect(done.html(placement)).not.toContain("Verified");
  });

  it("reconciles call records through the same list/get caches, pending lock and conflict refresh", async () => {
    let rows: CustomerTask[] = [call()]; const gets = new Map<number, CustomerTask>();
    let release!: () => void; let first = true;
    const cancelList = vi.fn(async () => {}); const cancelGet = vi.fn(async () => {});
    const invalidate = vi.fn(() => first ? new Promise<void>(resolve => { first = false; release = resolve; }) : Promise.resolve());
    const claimed = call({ status: "claimed", owner: actor, claimedAt: NOW });
    const completed = call({ status: "done", owner: actor, completedBy: actor, completedAt: NOW, completionNote: "Staff confirmed" });
    const claim = vi.fn(async () => claimed); const completeItem = vi.fn(async () => claimed); const complete = vi.fn(async () => completed);
    const api = { useUtils: () => ({ claudeCustomerTasks: { invalidate,
      list: { cancel: cancelList, setData: (_input: unknown, update: (records: CustomerTask[]) => CustomerTask[]) => { rows = update(rows); } },
      get: { cancel: cancelGet, setData: ({ id }: { id: number }, record: CustomerTask) => gets.set(id, record) },
    } }), claudeCustomerTasks: {
      identity: { useQuery: () => ({ data: actor }) }, list: { useQuery: () => ({ data: rows }) },
      claim: { useMutation: () => ({ mutateAsync: claim }) }, completeItem: { useMutation: () => ({ mutateAsync: completeItem }) }, complete: { useMutation: () => ({ mutateAsync: complete }) },
    } };
    const work = harness(api); const provider = () => work.render("ClaudeCustomerTasksProvider", { callerId: "untrusted-prop", children: null }).props.value;
    let context = provider(); expect(context.callerId).toBe(actor.id); const saving = context.actions.claim(903); await flush(); context = provider();
    expect(context.pendingIds.has(903)).toBe(true); expect(rows[0]).toBe(claimed); expect(gets.get(903)).toBe(claimed);
    await expect(context.actions.claim(903)).rejects.toThrow("already saving"); expect(claim.mock.calls).toEqual([[{ id: 903 }]]);
    release(); await saving; expect(provider().pendingIds.size).toBe(0);
    await provider().actions.completeItem(903, "oven"); expect(completeItem).toHaveBeenCalledWith({ id: 903, itemId: "oven" });
    await provider().actions.complete(903, "  Staff confirmed  "); expect(complete).toHaveBeenCalledWith({ id: 903, note: "Staff confirmed" });
    expect(rows[0]).toBe(completed); expect(gets.get(903)).toBe(completed);
    const before = invalidate.mock.calls.length; claim.mockRejectedValueOnce(new Error("Synthetic owner conflict"));
    await expect(provider().actions.claim(903)).rejects.toThrow("Synthetic owner conflict"); expect(invalidate.mock.calls.length).toBeGreaterThan(before);
    expect(rows[0]).toBe(completed); expect(provider().pendingIds.size).toBe(0); expect(cancelList).toHaveBeenCalledWith({}); expect(cancelGet).toHaveBeenCalledWith({ id: 903 });
  });
});

describe("AI call addition preserves actual baseline SMS/email, layout and popup contracts", () => {
  it.each(["queue", "stream"] as const)("renders and navigates SMS/email byte-identically to baseline in %s across statuses and pending", placement => {
    for (const status of ["unclaimed", "claimed", "done"] as const) for (const pending of [false, true]) for (const task of [sms(), email()]) {
      const record = { ...task, status, owner: status === "unclaimed" ? null : actor, completedBy: status === "done" ? confirmer : null, completedAt: status === "done" ? NOW : null };
      const candidate = rig(record); const control = rig(record, baseline(componentPath));
      expect(candidate.html(placement, pending)).toBe(control.html(placement, pending));
      button(candidate.render(placement, pending), "Open full conversation").props.onClick(); button(control.render(placement, pending), "Open full conversation").props.onClick();
      expect(candidate.onOpenConversation.mock.calls).toEqual(control.onOpenConversation.mock.calls); expect(candidate.onOpenConversation).toHaveBeenCalledWith(record);
      for (const mutation of Object.values(candidate.a)) expect(mutation).not.toHaveBeenCalled();
    }
  });

  it("keeps every SMS/email acknowledgment status, complete HTML email evidence and literal text handling", () => {
    for (const status of ["prepared", "sent", "uncertain", "suppressed"] as const) for (const task of [sms(), email()]) {
      const record = { ...task, reply: { text: "Exact acknowledgment\nSecond line", status, providerMessageId: "DO_NOT_RENDER_PROVIDER_ID" } };
      expect(rig(record).html("stream")).toBe(rig(record, baseline(componentPath)).html("stream"));
    }
    const base = email(); const html = email({ sourceText: "<p>Synthetic HTML source</p>", email: { ...base.email, bodyFormat: "html" }, items: [{ ...base.items[0], evidenceQuote: "<b>Synthetic HTML evidence</b>" }] });
    expect(rig(html).html("queue")).toBe(rig(html, baseline(componentPath)).html("queue"));
    for (const record of [sms({ sourceText: "<script>literal source</script>" }), email({ sourceText: "<script>literal source</script>" })]) expect(rig(record).html("stream")).toBe(rig(record, baseline(componentPath)).html("stream"));
  });

  it("preserves provider, handlers, confirmation state/buttons, CSS, email popup and complete SMS/email callback bytes", () => {
    const original = baseline(componentPath);
    const between = (value: string, start: string, end: string) => value.slice(value.indexOf(start), value.indexOf(end, value.indexOf(start)));
    expect(between(withoutApprovedTaskReads(source), "/** Own only", "/** Canonical call evidence")).toBe(between(original, "/** Own only", "export function TaskCompletionConfirm"));
    expect(between(source, "  const [confirmOpen", "  return <article")).toBe(between(original, "  const [confirmOpen", "  return <article"));
    expect(source.slice(source.indexOf("{error && !confirmOpen"))).toBe(original.slice(original.indexOf("{error && !confirmOpen")));
    expect(withoutApprovedTaskCallPlayback(pagePath, page).replace('    if ("call" in task) return; // TaskCard opens its canonical call evidence locally.\n', "")).toBe(baseline(pagePath));
    for (const path of ["client/src/components/claude-customer-tasks.css", "client/src/pages/command-chat-exact-live.css", "client/src/pages/CommandChatEmailDetail.tsx", "client/src/pages/command-chat-email-detail.css", "client/src/components/ui/dialog.tsx"]) expect(withoutApprovedTaskCallPlayback(path, readFileSync(path, "utf8"))).toBe(baseline(path));
    expect(source).not.toMatch(/\bfetch\(|EventSource|setInterval|\.slice\(0,/);
  });
});

// Current authorized UI additions: full source, real exported components, synthetic data only.
describe("SMS conversation to canonical task navigation — offline", () => {
  function related(tasks: CustomerTask[] = [sms()]) {
    const a = actions(), refresh = vi.fn(), onOpenConversation = vi.fn();
    const context = { callerId: actor.id, tasks, loading: false, failed: false, transientFailure: true,
      pendingIds: new Set<number>(), actions: a, refresh, onOpenConversation };
    // No tRPC methods provided: any new query or mutation is a hard offline failure.
    const work = harness({}, context);
    const raw = (sessionId = 42, ids = ["SYNTHETIC_SOURCE"]) => work.render("ClaudeSmsConversationTasks", {
      sessionId, children: (afterMessage: (id: string) => React.ReactNode) => ids.map(id => React.createElement(React.Fragment, { key: id }, afterMessage(id))),
    });
    const render = (sessionId = 42, ids = ["SYNTHETIC_SOURCE"]) => work.expand(raw(sessionId, ids), "related");
    return { work, context, a, refresh, onOpenConversation, render, raw };
  }
  const launch = (tree: unknown) => {
    const focus = vi.fn();
    nodes(tree).find(node => node.type === "button" && node.props["aria-haspopup"] === "dialog")!.props.onClick({ currentTarget: { focus } });
    return focus;
  };
  it("matches only exact stored SMS sessions, not same-phone siblings, email tasks, or linked call tasks", () => {
    const original = [sms({ id: 11 }), sms({ id: 12, sessionId: 43 }), call({ sessionId: 42 }), email()];
    const r = related(original);
    expect(r.work.ui.customerSmsConversationTasks(original, 42).map((task: CustomerTask) => task.id)).toEqual([11]);
    expect(r.work.ui.customerSmsConversationTasks(original, 43).map((task: CustomerTask) => task.id)).toEqual([12]);
    expect(original.map(task => task.id)).toEqual([11, 12, 903, 902]);
    expect(nodes(r.render()).filter(node => node.props.className === "cct-message-task")).toHaveLength(1);
    expect(text(r.render(44))).toBe("");
    for (const action of Object.values(r.a)) expect(action).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1])("rejects invalid conversation identity %s without inventing a match", id => {
    const r = related();
    expect(r.work.ui.customerSmsConversationTasks(r.context.tasks, id)).toEqual([]);
    expect(text(r.render(id))).toBe("");
  });
  it("orders tasks within their request without promoting Open ahead of Done and preserves the canonical source array", () => {
    const rows = [sms({ id: 1, status: "done", receivedAt: NOW }), sms({ id: 2, receivedAt: NOW - 100 }),
      sms({ id: 3, status: "claimed", owner: { id: "other", name: "Other staff" }, receivedAt: NOW - 100 }),
      sms({ id: 4, status: "done", receivedAt: NOW - 100 })];
    const r = related(rows), tree = r.render();
    expect(r.work.ui.customerSmsConversationTasks(rows, 42).map((task: CustomerTask) => task.id)).toEqual([2, 3, 4, 1]);
    expect(rows.map(task => task.id)).toEqual([1, 2, 3, 4]);
    expect(nodes(tree).filter(node => node.props.className === "cct-message-task-status").map(text)).toEqual(["Open", "Open", "Done", "Done"]);
    r.context.tasks = rows.map(task => ({ ...task, status: "done" }));
    expect(nodes(r.render()).filter(node => node.props.className === "cct-message-task-title").map(text)).toEqual(
      nodes(tree).filter(node => node.props.className === "cct-message-task-title").map(text));
  });
  it("renders every task inline with full literal wrapping titles and no panel, numbered list or task scrollbar", () => {
    const title = '<script>literal title</script> & ' + "complete task title ".repeat(15);
    const r = related(Array.from({ length: 160 }, (_, index) => sms({ id: index + 1, title: `${index}: ${title}` })));
    const tree = r.render();
    expect(nodes(tree).filter(node => node.props.className === "cct-message-task")).toHaveLength(160);
    expect(nodes(tree).some(node => node.type === "details" || node.type === "ol" || node.type === "li")).toBe(false);
    expect(text(tree)).not.toContain("Related tasks");
    expect(text(tree)).toContain(`159: ${title}`);
    const markup = renderToStaticMarkup(tree);
    expect(markup).toContain("&lt;script&gt;literal title&lt;/script&gt;"); expect(markup).not.toContain("<script>");
    const css = readFileSync("client/src/components/claude-customer-tasks.css", "utf8");
    const timelineCss = css.slice(css.indexOf(".cct-message-tasks {"), css.indexOf(".cct-source-message {"));
    expect(timelineCss).not.toMatch(/overflow(?:-[xy])?\s*:|max-height\s*:/);
    expect(css).not.toContain(".cct-related-task-list");
    expect(css).toContain(".cct-message-task-title { min-width: 0; flex: 1; overflow-wrap: anywhere;");
  });
  it.each(["unclaimed", "claimed", "done"] as const)("opens the existing %s task card read-only and preserves task-to-conversation navigation", status => {
    const task = sms({ status, owner: status === "unclaimed" ? null : actor, completedBy: status === "done" ? confirmer : null });
    const r = related([task]); let tree = r.render();
    expect(nodes(tree).some(node => node.props.role === "dialog")).toBe(false);
    const link = nodes(tree).find(node => node.type === "button" && node.props["aria-haspopup"] === "dialog")!;
    expect(link.props.type).toBe("button"); launch(tree); tree = r.render();
    const dialog = nodes(tree).find(node => node.props.role === "dialog")!;
    expect(dialog).toBeDefined(); expect(nodes(dialog).find(node => node.props["data-task-id"] === task.id)!.props["data-task-status"]).toBe(status);
    expect(text(dialog)).toContain(task.title); expect(text(dialog)).toContain(task.sourceText);
    for (const action of Object.values(r.a)) expect(action).not.toHaveBeenCalled();
    expect(r.refresh).not.toHaveBeenCalled(); expect(r.onOpenConversation).not.toHaveBeenCalled();
    button(dialog, "Open full conversation").props.onClick(); expect(r.onOpenConversation).not.toHaveBeenCalled();
    expect(nodes(r.render()).some(node => node.props.role === "dialog")).toBe(false);
  });
  it("uses canonical status changes in both list and already-open detail and hides selection on another session", () => {
    const task = sms({ status: "claimed", owner: actor }), r = related([task]);
    launch(r.render());
    r.context.tasks = [{ ...task, status: "done", completedBy: confirmer, completedAt: NOW, completionNote: "Completed by staff" }];
    const tree = r.render();
    expect(nodes(tree).filter(node => node.props.className === "cct-message-task-status").map(text)).toEqual(["Done"]);
    expect(nodes(tree).find(node => node.props["data-task-id"] === task.id)!.props["data-task-status"]).toBe("done");
    expect(text(tree)).toContain("Completed by Confirming staff"); expect(button(tree, "Mark done")).toBeUndefined();
    r.context.tasks = [...r.context.tasks, sms({ id: 999, sessionId: 43 })];
    expect(nodes(r.render(43)).some(node => node.props.role === "dialog")).toBe(false);
    expect(task.status).toBe("claimed");
  });
  it("shows honest loading/error states, retries only on click, and never claims no tasks during a failed cache read", () => {
    const r = related(); r.context.loading = true;
    expect(text(nodes(r.render()).find(node => node.props.role === "status"))).toBe("Loading task status…"); expect(r.refresh).not.toHaveBeenCalled();
    r.context.loading = false; r.context.failed = true;
    expect(text(r.render())).toContain("Tasks could not be refreshed."); expect(text(r.render())).not.toContain("No tasks");
    button(r.render(), "Retry").props.onClick(); expect(r.refresh).toHaveBeenCalledOnce();
    r.context.tasks = []; expect(text(r.render())).toBe("");
  });
  it("retains an open canonical completion dialog and its note through transient errors without reopening after dismissal", () => {
    const r = related([sms({ status: "claimed", owner: actor })]); launch(r.render());
    button(r.render(), "Mark done").props.onClick();
    nodes(r.render()).find(node => node.type === "textarea")!.props.onChange({ target: { value: "Unsaved human confirmation note" } });
    r.context.failed = true;
    const stale = r.render(); expect(text(stale)).toContain("Showing the last loaded status.");
    expect(nodes(stale).filter(node => node.props.role === "dialog")).toHaveLength(2);
    expect(nodes(stale).find(node => node.type === "textarea")!.props.value).toBe("Unsaved human confirmation note");
    for (const action of Object.values(r.a)) expect(action).not.toHaveBeenCalled();
    const raw = r.raw();
    nodes(raw).find(node => node.type === Dialog)!.props.onOpenChange(false);
    r.context.failed = false; expect(nodes(r.render()).some(node => node.props.role === "dialog")).toBe(false);
  });
  it("restores keyboard focus to the launching row with preventScroll and suppresses cached private details on auth failure", () => {
    const r = related(), focus = launch(r.render());
    const raw = r.raw(), preventDefault = vi.fn();
    nodes(raw).find(node => node.type === DialogContent)!.props.onCloseAutoFocus({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce(); expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    r.context.failed = true; r.context.transientFailure = false;
    const tree = r.render(); expect(text(tree)).toContain("Tasks could not be refreshed.");
    expect(nodes(tree).some(node => node.props["data-task-id"])).toBe(false);
    expect(nodes(tree).filter(node => node.props.className === "cct-message-task-title")).toHaveLength(0);
  });
  it("changes only render-only anchors and the timeline seam; all queries, effects, drafts, sends and scroll code stay byte-identical", () => {
    const control = execFileSync("git", ["show", `e58f374b:${pagePath}`], { encoding: "utf8" });
    expect(withoutApprovedTaskCallPlayback(pagePath, page)).toBe(control);
    expect(page).toContain('<div className="ccc-live-sms-messages" ref={messageListRef}><ClaudeSmsConversationTasks');
    expect(page).toContain('{smsTaskAnchors[index] && afterMessage(smsTaskAnchors[index]!)}');
    const current = ts.createSourceFile(componentPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const node = current.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ClaudeSmsConversationTasks")!;
    expect(node.getText(current)).not.toMatch(/trpc\.|useEffect|fetch\(|setTimeout|setInterval|refetchInterval|\.actions\./);
  });
  it.each(["opMsgId", "openPhoneId", "openPhoneMessageId", "providerMessageId"])("accepts the saved %s alias and identical repeated metadata aliases without guessing", alias => {
    const r = related(), anchors = r.work.ui.customerSmsTaskMessageAnchors;
    expect(anchors([{ role: "user", [alias]: "SOURCE", metadata: { providerMessageId: "SOURCE" } }])).toEqual(["SOURCE"]);
    expect(anchors([{ role: "customer", metadata: { [alias]: "SOURCE" } }])).toEqual(["SOURCE"]);
    expect(anchors([{ role: "user", [alias]: "  " }])).toEqual([null]);
  });
  it("rejects missing/contradictory identities, duplicate saved turns, and outbound or unknown-role ID collisions", () => {
    const anchors = related().work.ui.customerSmsTaskMessageAnchors;
    expect(anchors([{ role: "user", content: "same words", ts: NOW }, { role: "assistant", opMsgId: "OUT" }])).toEqual([null, null]);
    expect(anchors([{ role: "user", opMsgId: "A", metadata: { providerMessageId: "B" } }])).toEqual([null]);
    expect(anchors([{ role: "user", opMsgId: "A" }, { role: "user", opMsgId: "A" }])).toEqual([null, null]);
    expect(anchors([{ role: "user", opMsgId: "A" }, { role: "assistant", providerMessageId: "A" }])).toEqual([null, null]);
    expect(anchors([{ role: "user", opMsgId: "A" }, { role: "system", opMsgId: "A", providerMessageId: "B" }])).toEqual([null, null]);
    expect(anchors([null, {}, { role: "user", opMsgId: 123 }, { role: "assistant", metadata: { opMsgId: "C" } }])).toEqual([null, null, null, null]);
  });
  it("renders all tasks only at their exact request and never moves a Done task to a different request", () => {
    const r = related([sms({ id: 1, title: "First task", sourceMessageId: "A", status: "done" }),
      sms({ id: 2, title: "Second task", sourceMessageId: "A" }), sms({ id: 3, title: "Third task", sourceMessageId: "B" }),
      sms({ id: 4, title: "Unresolved task", sourceMessageId: "MISSING" })]);
    const groups = nodes(r.render(42, ["A", "B"])).filter(node => node.props.className === "cct-message-tasks");
    expect(groups.map(group => nodes(group).filter(node => node.props.className === "cct-message-task-title").map(text))).toEqual([["First task", "Second task"], ["Third task"]]);
    expect(text(groups[0])).toContain("Done"); expect(text(r.render(42, ["A", "B"]))).not.toContain("Unresolved task");
    const second = nodes(groups[0]).filter(node => node.props.className === "cct-message-task")[1];
    second.props.onClick({ currentTarget: { focus: vi.fn() } });
    expect(nodes(r.render(42, ["A", "B"])).find(node => node.props["data-task-id"])!.props["data-task-id"]).toBe(2);
    for (const action of Object.values(r.a)) expect(action).not.toHaveBeenCalled();
  });
});

describe("Phone-call reading format only — offline", () => {
  const staff = (transcript: string, transcriptSource: "saved" | "quo" = "quo") => contract.customerStaffCallTaskSchema.parse({ ...call(),
    call: { provider: "openphone", providerCallId: "ACsynthetic", recordingId: 91, transcript, transcriptSource,
      recordingUrl: null, businessPhoneNumberId: "PNsynthetic", businessPhoneNumber: "+13015550987", staffUserId: null, direction: "incoming" } });
  it("retains native speaker turns and source paragraph breaks without altering literal words or punctuation", () => {
    const task = staff("Caller:  First paragraph.\nStill the same paragraph.\n\nSecond paragraph!\nStaff: Exact answer?\n\nFollow-up wording.");
    const work = rig(task), tree = work.expand(work.ui.CustomerTaskCallTranscript({ task }));
    expect(nodes(tree).filter(node => node.props.className === "cct-call-speaker").map(text)).toEqual(["Caller:", "Staff:"]);
    expect(nodes(tree).filter(node => node.props.className === "cct-verbatim").map(text)).toEqual([
      "  First paragraph.\nStill the same paragraph.", "Second paragraph!\n", " Exact answer?", "Follow-up wording."]);
    expect(normalized(transcriptText(tree))).toBe(normalized(task.call.transcript));
    expect(text(tree)).not.toContain("Speaker not identified");
  });
  it("groups punctuated passages on sentence boundaries and uses lossless neutral chunks only for oversized sentences", () => {
    const work = rig(call());
    const sentences = Array.from({ length: 8 }, (_, i) => `Sentence ${i} ` + "original wording ".repeat(10) + "ends here. ").join("");
    const paragraphs: string[] = work.ui.phoneCallReadingParagraphs(sentences);
    expect(paragraphs.length).toBeGreaterThan(1); expect(paragraphs.join("")).toBe(sentences);
    paragraphs.forEach(paragraph => expect(paragraph.trim()).toMatch(/ends here\.$/));
    const unpunctuated = "  " + Array.from({ length: 151 }, (_, i) => `word${i}`).join("  ") + " \n";
    const fallback: string[] = work.ui.phoneCallReadingParagraphs(unpunctuated);
    expect(fallback.length).toBeGreaterThan(1); expect(fallback.join("")).toBe(unpunctuated);
    expect(work.ui.phoneCallReadingParagraphs("First.\r\n \r\nSecond.")).toEqual(["First.", "Second."]);
  });
  it("keeps saved Whisper undiarized, including inner Staff/Caller-looking prose and repeated original paragraphs", () => {
    const transcript = "Unattributed: Exact first paragraph.\n\nStaff: spoken words, not a verified identity.\nCaller: more literal words.\n\nRepeated sentence. Repeated sentence.\nUnattributed: Second saved segment.";
    const work = rig(staff(transcript, "saved")), tree = work.expand(work.ui.CustomerTaskCallTranscript({ task: work.context.tasks[0] }));
    expect(nodes(tree).filter(node => node.props.className === "cct-call-speaker").map(text)).toEqual(["Unattributed:", "Unattributed:"]);
    expect(text(tree)).toContain("Speaker not identified — this transcript may include both sides of the call.");
    expect(normalized(transcriptText(tree))).toBe(normalized(transcript));
    expect(nodes(tree).filter(node => node.props.className === "cct-call-turn").every(node => node.props["data-speaker"] === "unattributed")).toBe(true);
  });
  it("safely preserves unknown-speaker, non-Latin and HTML-looking text without adding invented labels or timestamps", () => {
    const transcript = "Correction: Monday, not Friday.\n\n中文 日本語 العربية <script>literal</script> & original.";
    const work = rig(staff(transcript)), tree = work.expand(work.ui.CustomerTaskCallTranscript({ task: work.context.tasks[0] }));
    expect(nodes(tree).filter(node => node.props.className === "cct-call-speaker")).toHaveLength(0);
    expect(normalized(transcriptText(tree))).toBe(normalized(transcript));
    expect(renderToStaticMarkup(tree)).toContain("&lt;script&gt;literal&lt;/script&gt;"); expect(renderToStaticMarkup(tree)).not.toContain("<script>");
    expect(text(tree)).toContain("Speaker not identified"); expect(text(tree)).not.toMatch(/Madison|Ava|00:00/);
  });
  it("preserves the confirmed-working audio function/mount byte-for-byte and renders AI transcripts byte-identically to the released baseline", () => {
    const control = execFileSync("git", ["show", `e58f374b:${componentPath}`], { encoding: "utf8" });
    const fn = (input: string, name: string) => {
      const ast = ts.createSourceFile(componentPath, input, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      return ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!.getText(ast);
    };
    expect(fn(source, "CustomerTaskCallRecording")).toBe(fn(control, "CustomerTaskCallRecording"));
    expect(fn(source, "CustomerTaskCallEvidence")).toBe(fn(control, "CustomerTaskCallEvidence"));
    for (const transcript of [call().call.transcript, "AI: " + "original word ".repeat(151) + "\nUser: Exact answer.\nCorrection: keep this plain.", "中文 <script>literal</script>\n\nOriginal unlabeled line."]) {
      const task = call({ call: { ...call().call, transcript } });
      expect(renderToStaticMarkup(rig(task).ui.CustomerTaskCallTranscript({ task }))).toBe(renderToStaticMarkup(rig(task, control).ui.CustomerTaskCallTranscript({ task })));
    }
  });
});
