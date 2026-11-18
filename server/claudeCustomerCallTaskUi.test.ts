import React from "react";
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
function withoutApprovedTaskReads(value: string) {
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
const button = (tree: unknown, label: string) => nodes(tree).find(node => node.type === "button" && text(node) === label)!;
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const Dialog = (_props: any) => null;
const DialogContent = (_props: any) => null;
const DialogTrigger = (_props: any) => null;
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
      if (id === "@shared/claudeCustomerTasks") return contract;
      if (id === "@/components/ui/dialog") return { Dialog, DialogContent, DialogTrigger, DialogDescription: div, DialogTitle: div };
      if (id.endsWith(".css")) return {};
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
    let tree = work.expand(work.render(placement === "queue" ? "ClaudeCustomerTasksQueue" : "ClaudeCustomerTaskStreamCard", placement === "queue" ? {} : { taskId: task.id }), placement);
    if (placement === "queue" && task.status === "done" && !nodes(tree).some(node => node.props.className === "cct-card-status")) {
      button(tree, "Done1").props.onClick(); tree = work.expand(work.render("ClaudeCustomerTasksQueue", {}), placement);
    }
    return tree;
  };
  return { ...work, a, onOpenConversation, get, recording, recordingUrl, context, render, html: (placement: "queue" | "stream", pending = false) => renderToStaticMarkup(render(placement, pending)) };
}

describe("Canonical AI customer call task evidence in the actual queue and stream (offline)", () => {
  it.each(["queue", "stream"] as const)("labels the %s task AI CALL, shows the real caller phone and exact plain caller evidence without an SMS acknowledgment", placement => {
    sanitizer.sanitize.mockClear();
    const task = call({ sourceText: "  Please add the oven.\n<script>literal caller evidence</script>\nKeep all spacing.  ", items: [{ ...call().items[0], evidenceQuote: "<b>literal caller quote</b>" }] });
    const work = rig(task); const tree = work.render(placement); const html = work.html(placement);
    expect(text(nodes(tree).find(node => node.props.className === "cct-task-label"))).toBe("Customer task · AI CALL");
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
      expect(nodes(full).find(node => node.type === "p")!.props.children).toBe(transcript);
      const audio = nodes(dialog).find(node => node.type === "audio")!;
      expect(audio.props).toMatchObject({ controls: true, preload: "none", src: work.recordingUrl, "aria-label": "Call recording" });
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
    expect(text(tree)).toContain(task.call.transcript); expect(text(tree)).not.toContain("+13015550123");
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
    const tree = work.render("stream"); expect(text(tree)).toContain(task.call.transcript);
    expect(nodes(tree).some(node => node.type === "audio" || node.type === "a")).toBe(false);
    expect(renderToStaticMarkup(tree)).not.toContain(task.call.recordingUrl!);
    expect(text(tree)).toContain(mode === "loading" ? "Loading call recording" : "Call recording unavailable");
    if (mode === "error") { button(tree, "Retry").props.onClick(); expect(refetch).toHaveBeenCalledOnce(); }
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
    expect(text(nodes(tree).find(node => node.props.className === "cct-task-label"))).toBe("Staff task · PHONE CALL");
    expect(text(tree)).toContain(task.customerPhone!); expect(text(tree)).toContain(task.items[0].evidenceQuote);
    expect(text(tree)).not.toContain("Acknowledgment"); expect(work.get).not.toHaveBeenCalled(); expect(work.recording).not.toHaveBeenCalled();
    button(tree, "Open full call").props.onClick(); tree = work.render(placement);
    expect(text(tree)).toContain("Full staff call"); expect(text(tree)).toContain(task.call.transcript);
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
    expect(text(nodes(tree).find(node => node.props.className === "cct-customer-identity"))).toContain("Caller");
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
    button(tree, "Confirm item").props.onClick(); await flush(); expect(work.a.completeItem).toHaveBeenCalledWith(903, "oven");
    button(work.render(placement), "Mark done").props.onClick(); tree = work.render(placement);
    expect(text(tree)).toContain("human confirmation"); expect(text(tree)).toContain("not system verification");
    expect(text(tree)).toContain("No booking change, customer call, customer text, or conversation closure is performed.");
    expect(text(nodes(tree).find(node => node.props.className === "cct-confirm-task"))).toContain(task.customerPhone);
    expect(button(tree, "Confirm done").props.disabled).toBe(true); button(tree, "Confirm done").props.onClick(); await flush(); expect(work.a.complete).not.toHaveBeenCalled();
    nodes(tree).find(node => node.type === "textarea")!.props.onChange({ target: { value: "  Staff reviewed the caller request  " } });
    tree = work.render(placement); expect(button(tree, "Confirm done").props.disabled).toBe(false);
    button(tree, "Confirm done").props.onClick(); await flush(); expect(work.a.complete).toHaveBeenCalledWith(903, "Staff reviewed the caller request"); expect(task.status).toBe("claimed");
    const other = rig(call({ status: "claimed", owner: { id: "different-owner", name: actor.name } }));
    expect(button(other.render(placement), "Mark done")).toBeUndefined(); expect(button(other.render(placement), "Confirm item")).toBeUndefined();
    const done = rig(call({ status: "done", owner: actor, completedBy: confirmer, completedAt: NOW, completionNote: "Actual staff confirmation note" }));
    expect(text(nodes(done.render(placement)).find(node => node.props.className === "cct-card-status"))).toBe(`Confirmed by ${confirmer.name}`);
    expect(done.html(placement)).toContain("Actual staff confirmation note"); expect(done.html(placement)).toContain("not system-verified");
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
    expect(page.replace('    if ("call" in task) return; // TaskCard opens its canonical call evidence locally.\n', "")).toBe(baseline(pagePath));
    for (const path of ["client/src/components/claude-customer-tasks.css", "client/src/pages/command-chat-exact-live.css", "client/src/pages/CommandChatEmailDetail.tsx", "client/src/pages/command-chat-email-detail.css", "client/src/components/ui/dialog.tsx"]) expect(readFileSync(path, "utf8")).toBe(baseline(path));
    expect(source).not.toMatch(/\bfetch\(|EventSource|setInterval|\.slice\(0,/);
  });
});
