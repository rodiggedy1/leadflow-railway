import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { AiCallerPoll, AiCallerSession, AiCallerStart, AiCallerTransport } from "../client/src/hooks/useAiCallerSession";

// Minimal hook runner: no browser, provider, database, or application server.
const runner = vi.hoisted(() => ({ states: [] as unknown[], cleanups: [] as (() => void)[] }));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const slot = runner.states.length;
    runner.states.push(initial);
    return [initial, (next: unknown) => { runner.states[slot] = typeof next === "function" ? next(runner.states[slot]) : next; }];
  },
  useRef: (initial: unknown) => ({ current: initial }),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void)) => { const cleanup = effect(); if (cleanup) runner.cleanups.push(cleanup); },
}));
import { useAiCallerSession } from "../client/src/hooks/useAiCallerSession";
const params: AiCallerStart = { leadflowJobId: 501, jobDate: "2026-11-22", personName: "Sample Person", phone: "+12025550101", scenario: "Confirm address", script: "Please confirm the full address including city.", audience: "customer", language: "en" };
const poll = (status: AiCallerPoll["status"]): AiCallerPoll => ({ status, summary: "Stored summary", transcript: "Ava: Hello.\nCustomer: Hello.", recordingUrl: "https://storage.vapi.ai/sample.wav", durationSeconds: 12 });
function api(): AiCallerTransport {
  return { startCall: vi.fn(async () => ({ vapiCallId: "sample-call" })), pollCall: vi.fn(async () => poll("completed")) };
}
function current() { return runner.states[0] as AiCallerSession | null; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => { runner.states = []; runner.cleanups = []; vi.useFakeTimers(); });
afterEach(() => { runner.cleanups.forEach(cleanup => cleanup()); vi.useRealTimers(); });

describe("copied AI caller lifecycle", () => {
  it("does not start or poll anything merely because the page mounts", async () => {
    const transport = api(); useAiCallerSession(transport);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transport.startCall).not.toHaveBeenCalled(); expect(transport.pollCall).not.toHaveBeenCalled();
  });
  it("passes the exact selected job, recipient, script, scenario, role and language", async () => {
    const transport = api(); const hook = useAiCallerSession(transport);
    await hook.startCall(params);
    expect(transport.startCall).toHaveBeenCalledTimes(1);
    expect(transport.startCall).toHaveBeenCalledWith(params);
    expect(current()?.status).toBe("queued");
    await vi.advanceTimersByTimeAsync(4999); expect(transport.pollCall).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.pollCall).toHaveBeenCalledTimes(1);
    expect(transport.pollCall).toHaveBeenCalledWith({ vapiCallId: "sample-call" });
    expect(current()?.phase).toBe("terminal"); expect(current()?.outcome?.transcript).toBe(poll("completed").transcript);
    expect(current()?.outcome?.recordingUrl).toBe(poll("completed").recordingUrl);
    await vi.advanceTimersByTimeAsync(60_000); expect(transport.pollCall).toHaveBeenCalledTimes(1);
  });
  it("blocks rapid double starts before React rerenders", async () => {
    const pending = deferred<{ vapiCallId: string | null }>(); const transport = api();
    transport.startCall = vi.fn(() => pending.promise); const hook = useAiCallerSession(transport);
    const start = hook.startCall(params);
    await expect(hook.startCall(params)).rejects.toThrow("already active");
    pending.resolve({ vapiCallId: "sample-call" }); await start;
    expect(transport.startCall).toHaveBeenCalledTimes(1);
  });
  it("does not overlap slow polling and waits five seconds after completion", async () => {
    const pending = deferred<AiCallerPoll>(); const transport = api();
    transport.pollCall = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValue(poll("completed"));
    const hook = useAiCallerSession(transport); await hook.startCall(params);
    await vi.advanceTimersByTimeAsync(30_000); expect(transport.pollCall).toHaveBeenCalledTimes(1);
    pending.resolve(poll("ringing")); await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(4999); expect(transport.pollCall).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(transport.pollCall).toHaveBeenCalledTimes(2);
  });
  it.each(["completed", "voicemail", "no_answer", "failed"] as const)("stops on provider terminal status %s", async status => {
    const transport = api(); transport.pollCall = vi.fn(async () => poll(status));
    const hook = useAiCallerSession(transport); await hook.startCall(params);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(current()?.status).toBe(status); expect(current()?.phase).toBe("terminal");
    expect(transport.pollCall).toHaveBeenCalledTimes(1);
  });
  it("retries a transient poll error without placing the call again", async () => {
    const transport = api(); transport.pollCall = vi.fn().mockRejectedValueOnce(new Error("temporary")).mockResolvedValue(poll("completed"));
    const hook = useAiCallerSession(transport); await hook.startCall(params);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(transport.pollCall).toHaveBeenCalledTimes(2); expect(transport.startCall).toHaveBeenCalledTimes(1);
    expect(current()?.phase).toBe("terminal");
  });
  it("does not retry an uncertain start failure or missing provider ID", async () => {
    const transport = api(); transport.startCall = vi.fn(async () => ({ vapiCallId: null }));
    const hook = useAiCallerSession(transport); await expect(hook.startCall(params)).rejects.toThrow("No call ID");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transport.startCall).toHaveBeenCalledTimes(1); expect(transport.pollCall).not.toHaveBeenCalled();
    expect(current()?.phase).toBe("terminal");
  });
  it("shows the missing outbound-number error even when the Vapi response exceeds 200 characters", async () => {
    const failure = new Error('VAPI call failed: VAPI POST /call → 400: {"statusCode":400,"message":"`phoneNumber` `61431a3e-8144-4acd-b394-8f600ec3a473` does not exist.","error":"Bad Request","subscriptionLimits":{"concurrencyBlocked":false,"concurrencyLimit":10,"remainingConcurrentCalls":9}}');
    const transport = api(); transport.startCall = vi.fn().mockRejectedValue(failure);
    const hook = useAiCallerSession(transport);
    await expect(hook.startCall(params)).rejects.toBe(failure);
    expect(current()?.outcome?.error).toBe("The outbound phone number is not available in the connected Vapi account.");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transport.startCall).toHaveBeenCalledTimes(1); expect(transport.pollCall).not.toHaveBeenCalled();
  });
  it("stops queued polls on unmount", async () => {
    const transport = api(); const hook = useAiCallerSession(transport); await hook.startCall(params);
    runner.cleanups.forEach(cleanup => cleanup()); await vi.advanceTimersByTimeAsync(60_000);
    expect(transport.pollCall).not.toHaveBeenCalled();
  });
  it("ignores an in-flight poll that completes after unmount", async () => {
    const pending = deferred<AiCallerPoll>(); const transport = api(); transport.pollCall = vi.fn(() => pending.promise);
    const hook = useAiCallerSession(transport); await hook.startCall(params); await vi.advanceTimersByTimeAsync(5000);
    runner.cleanups.forEach(cleanup => cleanup()); pending.resolve(poll("completed")); await vi.advanceTimersByTimeAsync(0);
    expect(current()?.status).toBe("queued"); expect(vi.getTimerCount()).toBe(0);
  });
  it("does not schedule polling after a start finishes on an unmounted page", async () => {
    const pending = deferred<{ vapiCallId: string | null }>(); const transport = api(); transport.startCall = vi.fn(() => pending.promise);
    const hook = useAiCallerSession(transport); const start = hook.startCall(params);
    runner.cleanups.forEach(cleanup => cleanup()); pending.resolve({ vapiCallId: "sample-call" }); await start;
    await vi.advanceTimersByTimeAsync(60_000); expect(transport.pollCall).not.toHaveBeenCalled();
  });
  it("only dismisses terminal UI state; it never cancels a real call", async () => {
    const transport = api(); const hook = useAiCallerSession(transport); await hook.startCall(params);
    hook.dismissSession(); expect(current()?.phase).toBe("active");
    await vi.advanceTimersByTimeAsync(5000); hook.dismissSession(); expect(current()).toBeNull();
    await hook.startCall({ ...params, audience: "cleaner", leadflowJobId: null });
    expect(transport.startCall).toHaveBeenLastCalledWith({ ...params, audience: "cleaner", leadflowJobId: null });
  });
});

describe("AI caller setup boundaries", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
  it("reuses owned APIs, existing script helpers and the existing recording proxy", () => {
    const source = read("client/src/pages/AiCallerLive.tsx");
    for (const name of ["getPeople.useQuery", "getTemplates.useQuery", "getCallHistory.useQuery", "startCall.useMutation", "pollCall.fetch"]) expect(source).toContain(`leadflowJobs.callMatrix.${name}`);
    expect(source).toContain('from "./AiCallsExactLive"'); expect(source).toContain("applyMergeFields(template.body"); expect(source).toContain("buildScript(person");
    expect(source).toContain("proxyRecordingUrl(call.recordingUrl)"); expect(source).toContain("trpc.voice.listCalls.useQuery");
    expect(source).not.toContain("refetchInterval"); expect(source).not.toContain("cleanerJobId");
    expect(source).toContain("leadflowJobs.callMatrix.searchContacts.useQuery");
    expect(source).toContain("enabled: searchQuery.length > 0");
    expect(source).toContain("leadflowJobId: null, jobDate: date, scripts: []");
    const forbidden = new RegExp(["cleaner", "Jobs", "|", "cleaner", "_jobs"].join("")); expect(source).not.toMatch(forbidden);
  });
  it("keeps the shared review UI and transport-injected lifecycle free of live API access", () => {
    for (const relative of ["client/src/components/AiCallerWorkspace.tsx", "client/src/hooks/useAiCallerSession.ts"]) {
      const source = read(relative);
      expect(source).not.toMatch(/import.*(?:trpc|AiCallerLive)/);
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toContain("api.vapi.ai");
      expect(source).not.toContain("VAPI_PRIVATE_KEY");
    }
  });
  it("mounts the approved caller and preserves same-tab access to the existing configuration", () => {
    const app = read("client/src/App.tsx");
    expect(app).toContain('<Route path={"/admin/ai-calls"} component={AdminAiCallsExactReviewRoute} />');
    expect(app).toContain('<ReviewWorkspaceFrame hideNavigation><AiCallerLive /></ReviewWorkspaceFrame>');
    expect(app).toContain('if (view === "configuration")');
    expect(app).toContain('<AiCallsExactLive />');
    expect(read("client/src/pages/AiCallerLive.tsx")).toContain('/admin/ai-calls?view=configuration');
  });
  it("captures exact confirmation payload and shows no invented voice or timestamp controls", () => {
    const source = read("client/src/components/AiCallerWorkspace.tsx");
    expect(source).toContain("setConfirmation(payload)"); expect(source).toContain("await onStartCall(payload)");
    expect(source).toContain('value="Ava" disabled'); expect(source).not.toContain("Alex");
    expect(source).toContain("Transcript and outcome will appear when the call finishes.");
    expect(source).toContain('onError={() => notify("Recording could not load.")}');
  });
});
