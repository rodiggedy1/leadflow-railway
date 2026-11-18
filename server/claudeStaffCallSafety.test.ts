import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import { customerStaffCallTaskSchema } from "../shared/claudeCustomerTasks";
import { withoutApprovedStaffCallFeature, withoutApprovedStaffCallRepair } from "./staffCallSourceControl";
import { createStaffCallRecordingReader } from "./instinct/claudeStaffCallRecording";
import type { TrpcContext } from "./_core/context";
vi.mock("./db", () => ({ getDb: vi.fn(async () => null) }));
vi.mock("./_core/agentAuth", () => ({ getAgentFromRequest: vi.fn(async () => null) }));
vi.mock("./_core/cleanerAuth", () => ({ getCleanerFromRequest: vi.fn(async () => null) }));
import { getAgentFromRequest } from "./_core/agentAuth";
import { createClaudeCustomerTasksRouter } from "./claudeCustomerTasksRouter";

const baseline = "0f6f5369e4799e5c789fffae7fb221db6569c645";
const task = customerStaffCallTaskSchema.parse({ id: 88, version: 1, kind: "claude_customer_task", sessionId: null,
  customerName: null, customerPhone: "+13015550123", receivingPhoneNumberId: null, receivingPhoneNumber: null,
  sourceMessageId: "ACsynthetic88", sourceText: "Please call me tomorrow", receivedAt: 1800000000000,
  title: "Call customer tomorrow", items: [{ id: "callback", title: "Call tomorrow", evidenceQuote: "call me tomorrow", completedBy: null, completedAt: null }],
  call: { provider: "openphone", providerCallId: "ACsynthetic88", recordingId: 101,
    transcript: "Customer: Please call me tomorrow\nStaff: I will arrange a callback.", recordingUrl: "https://example.invalid/old-recording",
    businessPhoneNumberId: "PNsynthetic", businessPhoneNumber: "+13015550987", staffUserId: "USsynthetic", direction: "incoming" },
  status: "unclaimed", owner: null, claimedAt: null, completedAt: null, completedBy: null, completionNote: null,
  reply: { text: "", status: "not_applicable", providerMessageId: null }, activity: [{ action: "created", actor: null, at: 1800000000000, note: null }] });
const context = (owner = true): TrpcContext => ({ user: owner ? { openId: "synthetic-owner", name: "Synthetic owner" } as any : null,
  req: { protocol: "https", headers: {} } as any, res: {} as any });
function router() {
  const store = { get: vi.fn(async () => task) }, getStore = vi.fn(async () => store as any), broadcast = vi.fn();
  const readCallRecordingUrl = vi.fn(async () => { throw new Error("VAPI_MUST_NOT_READ_STAFF_CALL"); });
  const readStaffCallRecordingUrl = vi.fn(async () => "https://example.invalid/fresh-staff-recording");
  const router = createClaudeCustomerTasksRouter({ getStore, broadcast, readCallRecordingUrl, readStaffCallRecordingUrl });
  return { store, getStore, broadcast, readCallRecordingUrl, readStaffCallRecordingUrl, caller: router.createCaller(context()), router };
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(getAgentFromRequest).mockResolvedValue(null); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("NETWORK_FORBIDDEN"); })); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("staff-call recording authorization and fresh exact-call reads — offline", () => {
  it("uses only the authenticated canonical task's Quo call and performs no write or broadcast", async () => {
    const h = router();
    expect(await h.caller.recording({ id: task.id })).toEqual({ url: "https://example.invalid/fresh-staff-recording" });
    expect(h.store.get).toHaveBeenCalledWith(task.id); expect(h.readStaffCallRecordingUrl).toHaveBeenCalledWith(task.call.providerCallId);
    expect(h.readCallRecordingUrl).not.toHaveBeenCalled(); expect(h.broadcast).not.toHaveBeenCalled();
  });
  it("supports a regular agent, rejects anonymous/arbitrary-call input and revoked access before provider reads", async () => {
    const h = router(), guest = h.router.createCaller(context(false));
    await expect(guest.recording({ id: task.id })).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(h.getStore).not.toHaveBeenCalled();
    await expect((h.caller.recording as any)({ id: task.id, providerCallId: "ACother" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(h.readStaffCallRecordingUrl).not.toHaveBeenCalled();
    vi.mocked(getAgentFromRequest).mockResolvedValue({ agentId: 42, agentName: "Synthetic regular staff", isAdmin: false } as any);
    expect(await guest.recording({ id: task.id })).toEqual({ url: "https://example.invalid/fresh-staff-recording" });
    vi.mocked(getAgentFromRequest).mockResolvedValue(null);
    await expect(guest.recording({ id: task.id })).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(h.readStaffCallRecordingUrl).toHaveBeenCalledTimes(1);
  });
  it("requests the exact documented Quo endpoint and selects only a completed HTTPS recording, never a stored fallback", async () => {
    const fetch = vi.fn(async () => ({ status: 200, ok: true, json: async () => ({ data: [
      { status: "in-progress", url: "https://example.invalid/not-ready" }, { status: "completed", url: "http://example.invalid/not-https" },
      { status: "completed", url: "https://example.invalid/current-recording" },
    ] }) }) as Response);
    expect(await createStaffCallRecordingReader({ key: "synthetic-key", fetch: fetch as any })("ACsynthetic88")).toBe("https://example.invalid/current-recording");
    expect(fetch).toHaveBeenCalledWith("https://api.openphone.com/v1/call-recordings/ACsynthetic88", {
      headers: { Authorization: "synthetic-key", Accept: "application/json" }, redirect: "error" });
  });
  it("returns absent recordings honestly, rejects malformed/provider errors and never retries", async () => {
    for (const response of [{ status: 404, ok: false }, { status: 200, ok: true, json: async () => ({ data: [] }) }]) {
      const fetch = vi.fn(async () => response as Response);
      expect(await createStaffCallRecordingReader({ key: "synthetic-key", fetch: fetch as any })("ACsynthetic88")).toBeNull(); expect(fetch).toHaveBeenCalledTimes(1);
    }
    for (const response of [{ status: 503, ok: false }, { status: 200, ok: true, json: async () => ({ data: {} }) }]) {
      const fetch = vi.fn(async () => response as Response);
      await expect(createStaffCallRecordingReader({ key: "synthetic-key", fetch: fetch as any })("ACsynthetic88")).rejects.toThrow("STAFF_CALL_RECORDING_UNAVAILABLE"); expect(fetch).toHaveBeenCalledTimes(1);
    }
    const fetch = vi.fn();
    expect(await createStaffCallRecordingReader({ key: "", fetch: fetch as any })("ACsynthetic88")).toBeNull();
    expect(await createStaffCallRecordingReader({ key: "synthetic-key", fetch: fetch as any })("not-a-call")).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  });
});

describe("additive staff-call dispatch and exact protected functionality — offline", () => {
  function dispatchHarness(preview = false, reject = false) {
    const file = "server/instinct/claudeStaffCallsApplication.ts", source = readFileSync(file, "utf8");
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const object = ast.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(decl => decl.name.getText(ast) === "object"))!;
    const dispatch = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "dispatchClaudeStaffCallEvent")!;
    const ready = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "dispatchClaudeStaffCallTranscriptReady")!;
    const module = { exports: {} as any }, handle = vi.fn(() => reject ? Promise.reject(new Error("SYNTHETIC_PRIVATE_ERROR")) : new Promise(() => {})), error = vi.fn();
    const code = ts.transpileModule(object.getText(ast) + "\n" + ready.getText(ast) + "\n" + dispatch.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    runInNewContext(code, { module, exports: module.exports, handleClaudeStaffCall: handle, process: { env: { PREVIEW_MODE: preview ? "true" : "false" } }, console: { error } });
    return { dispatch: module.exports.dispatchClaudeStaffCallEvent, ready: module.exports.dispatchClaudeStaffCallTranscriptReady, handle, error };
  }
  it("dispatches only exact recording/transcript completion IDs without blocking the existing handlers", () => {
    const h = dispatchHarness();
    for (const [type, object] of [["call.recording.completed", { id: "ACrecording" }], ["call.transcript.completed", { callId: "ACtranscript" }], ["callTranscript", { callId: "ACold-alias" }]] as const) {
      expect(h.dispatch({ type, data: { object } })).toBeUndefined();
    }
    expect(h.handle.mock.calls).toEqual([["ACrecording"], ["ACtranscript"], ["ACold-alias"]]);
    for (const event of [null, {}, { type: "call.completed", data: { object: { id: "ACother" } } }, { type: "call.transcript.completed", data: { object: { id: "ACwrong-field" } } }, { type: "call.recording.completed", data: { object: { id: "bogus" } } }]) h.dispatch(event);
    expect(h.handle).toHaveBeenCalledTimes(3);
  });
  it("Preview never starts processing and async failure is contained without disclosing transcript/provider errors", async () => {
    const preview = dispatchHarness(true); preview.dispatch({ type: "call.recording.completed", data: { object: { id: "ACsynthetic" } } }); expect(preview.handle).not.toHaveBeenCalled();
    preview.ready("ACsynthetic"); expect(preview.handle).not.toHaveBeenCalled();
    const failed = dispatchHarness(false, true); expect(failed.dispatch({ type: "call.recording.completed", data: { object: { id: "ACsynthetic" } } })).toBeUndefined();
    await Promise.resolve(); await Promise.resolve(); expect(failed.error).toHaveBeenCalledWith("[Instinct Staff Call Tasks] Call task processing unavailable.");
  });
  it("starts one nonblocking source read on transcript readiness and rejects invalid call IDs without a retry", () => {
    const h = dispatchHarness();
    expect(h.ready("ACsyntheticReady")).toBeUndefined();
    for (const id of ["", "CRrecording-not-call", null, 73]) h.ready(id);
    expect(h.handle.mock.calls).toEqual([["ACsyntheticReady"]]);
  });
  function transcriptionHarness(existing = false, failSave = false, result: any = { text: "Exact whole call. Please call tomorrow.", segments: [{ end: 30 }] }) {
    const file = "server/webhooks.ts", source = readFileSync(file, "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "transcribeAndDebriefRecording")!;
    const events: string[] = [], stored: any[] = [];
    const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => existing ? [{ transcript: "existing saved transcript" }] : [] }) }) }),
      update: () => ({ set: (value: any) => ({ where: async () => { events.push("save"); if (failSave) throw new Error("SYNTHETIC_SAVE_FAILED"); stored.push(value); } }) }) };
    const transcribe = vi.fn(async () => { events.push("transcribe"); return result; });
    const ready = vi.fn(() => { events.push("ready"); });
    const debrief = vi.fn(async () => { events.push("debrief"); });
    const code = ts.transpileModule(fn.getText(ast).replace("async function transcribeAndDebriefRecording", "export async function transcribeAndDebriefRecording"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} as any };
    runInNewContext(code, { module, exports: module.exports, getDb: async () => db, openphoneCallRecordings: { transcript: "transcript", openphoneCallId: "call-id" }, eq: () => true,
      transcribeAudio: transcribe, dispatchClaudeStaffCallTranscriptReady: ready, generatePostCallDebrief: debrief, console: { log: () => {}, warn: () => {} } });
    return { run: module.exports.transcribeAndDebriefRecording, events, stored, transcribe, ready, debrief };
  }
  it("notifies only after the original Whisper transcript is saved, preserving its exact unattributed format and original debrief", async () => {
    const h = transcriptionHarness();
    await h.run("ACsyntheticReady", "https://example.invalid/audio");
    expect(h.events).toEqual(["transcribe", "save", "ready", "debrief"]);
    expect(h.transcribe).toHaveBeenCalledWith({ audioUrl: "https://example.invalid/audio" });
    const dialogue = [{ identifier: "transcript", content: "Exact whole call. Please call tomorrow.", start: 0, end: 30 }];
    expect(h.stored).toEqual([{ transcript: JSON.stringify(dialogue) }]);
    expect(h.ready).toHaveBeenCalledWith("ACsyntheticReady"); expect(h.debrief).toHaveBeenCalledWith("ACsyntheticReady", dialogue);
  });
  it("preserves the existing transcript skip, empty/error and save-failure branches without false readiness", async () => {
    const existing = transcriptionHarness(true); await existing.run("ACsyntheticReady", "https://example.invalid/audio");
    expect(existing.events).toEqual(["ready"]); expect(existing.transcribe).not.toHaveBeenCalled(); expect(existing.debrief).not.toHaveBeenCalled();
    for (const result of [{ text: " \n " }, { error: "SYNTHETIC_TRANSCRIPTION_FAILURE" }]) {
      const h = transcriptionHarness(false, false, result); await h.run("ACsyntheticReady", "https://example.invalid/audio");
      expect(h.events).toEqual(["transcribe"]); expect(h.ready).not.toHaveBeenCalled(); expect(h.debrief).not.toHaveBeenCalled();
    }
    const failed = transcriptionHarness(false, true); await expect(failed.run("ACsyntheticReady", "https://example.invalid/audio")).rejects.toThrow("SYNTHETIC_SAVE_FAILED");
    expect(failed.events).toEqual(["transcribe", "save"]); expect(failed.ready).not.toHaveBeenCalled(); expect(failed.debrief).not.toHaveBeenCalled();
  });
  it.each(["server/webhooks.ts", "shared/claudeCustomerTasks.ts", "client/src/components/ClaudeCustomerTasks.tsx"])("allows ONLY the approved local repair hunks in %s relative to current Production", path => {
    const released = "a39d461a00b01e9c052585eb77d6aa11e31223cd", source = readFileSync(path, "utf8");
    const original = execFileSync("git", ["show", `${released}:${path}`], { encoding: "utf8", maxBuffer: 5_000_000 });
    expect(withoutApprovedStaffCallRepair(path, source)).toBe(original);
    expect(withoutApprovedStaffCallRepair(path, source + "\n// UNAUTHORIZED_CHANGE\n")).not.toBe(original);
  });
  it.each(["server/webhooks.ts", "server/claudeCustomerTasksRouter.ts", "shared/claudeCustomerTasks.ts", "client/src/components/ClaudeCustomerTasks.tsx"])("allows ONLY the fixed approved additions to %s", path => {
    const source = readFileSync(path, "utf8"), original = execFileSync("git", ["show", `${baseline}:${path}`], { encoding: "utf8", maxBuffer: 5_000_000 });
    expect(withoutApprovedStaffCallFeature(path, source)).toBe(original);
    expect(withoutApprovedStaffCallFeature(path, source + "\n// UNAUTHORIZED_CHANGE\n")).not.toBe(original);
  });
  it("preserves every existing call, SMS, email, quote, sender, task lifecycle, pricing/payment, schema and right-column owner byte-for-byte", () => {
    for (const path of ["server/vapiService.ts", "server/vapiWebhook.ts", "server/openphone.ts", "server/instinct/claudeAgentClient.ts",
      "server/instinct/claudeCustomerCalls.ts", "server/instinct/claudeCustomerCallsApplication.ts", "server/instinct/claudeCustomerCallsStore.ts",
      "server/instinct/claudeCustomerTasksStore.ts", "server/instinct/claudeCustomerSms.ts", "server/instinct/claudeCustomerSmsApplication.ts", "server/instinct/claudeCustomerSmsGeneration.ts",
      "server/instinct/claudeCustomerEmail.ts", "server/instinct/claudeCustomerEmailApplication.ts", "server/instinct/claudeCustomerEmailStore.ts",
      "server/instinct/smsBookingQuote.ts", "server/instinct/smsBookingQuoteStore.ts", "server/instinct/bookingQuotePresentation.ts",
      "server/customerBookingLinkService.ts", "shared/publicBookingPricing.ts", "server/gmailService.ts", "server/cronSync.ts", "server/routers.ts", "server/_core/index.ts", "drizzle/schema.ts",
      "client/src/components/claude-customer-tasks.css", "client/src/pages/CommandChatExactLive.tsx", "client/src/pages/command-chat-exact-live.css", "client/src/pages/CommandChatEmailDetail.tsx", "client/src/pages/command-chat-email-detail.css"]) {
      expect(readFileSync(path, "utf8"), path).toBe(execFileSync("git", ["show", `${baseline}:${path}`], { encoding: "utf8", maxBuffer: 5_000_000 }));
    }
    const hooks = readFileSync("server/webhooks.ts", "utf8");
    expect(hooks).toContain('await handleCallRecordingCompleted(event);\n        dispatchClaudeStaffCallEvent(event);');
    expect(hooks).toContain('await handleCallTranscriptCompleted(event);\n        dispatchClaudeStaffCallEvent(event);');
  });
});
