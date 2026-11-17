import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { customerCallTaskSchema, type CustomerTask } from "../shared/claudeCustomerTasks";
import type { TrpcContext } from "./_core/context";
vi.mock("./db", () => ({ getDb: vi.fn(async () => null) }));
vi.mock("./_core/agentAuth", () => ({ getAgentFromRequest: vi.fn(async () => null) }));
vi.mock("./_core/cleanerAuth", () => ({ getCleanerFromRequest: vi.fn(async () => null) }));
import { getAgentFromRequest } from "./_core/agentAuth";
import { createClaudeCustomerTasksRouter } from "./claudeCustomerTasksRouter";
const BASELINE = "8a1789ddfca54d3e771a412bf5c60c8ebca694f2";
const baseline = (path: string) => execFileSync("git", ["show", `${BASELINE}:${path}`], { encoding: "utf8" });
function withoutApprovedCustomerLookup(source: string) {
  const approvedBase = execFileSync("git", ["show", "dd40d73242d004d0855022c7c96126964b1df8be:server/vapiService.ts"], { encoding: "utf8", maxBuffer: 5_000_000 });
  const blocks = [
    /(?<=## Existing customer detection[^\n]*\n)[\s\S]*?(?=## PRICING)/g,
    /(?<=        name: "lookupCustomer",\n        )description: "[^\n]*",/g,
    /\/\*\*(?:(?!\/\*\*|\*\/)[\s\S])*\*\/\nexport async function handleLookupCustomer[\s\S]*?(?=\/\*\* Handle a reschedule request)/g,
  ];
  for (const block of blocks) {
    const original = approvedBase.match(block);
    expect(original).toHaveLength(1);
    expect(source.match(block)).toHaveLength(1);
    source = source.replace(block, () => original![0]);
  }
  return source;
}
function withoutApprovedQuoteIntegration(source: string) {
  return source
    .replace('import { buildCallBookingQuoteToolDefinitions, callBookingQuoteServerToken, withCallBookingQuoteInstructions } from "./instinct/callBookingQuote";\n\n', "")
    .replace('    ...buildCallBookingQuoteToolDefinitions(webhookUrl, callBookingQuoteServerToken(ENV.vapiPrivateKey)),\n', "")
    .replace('content: withCallBookingQuoteInstructions(buildSystemPrompt()),', 'content: buildSystemPrompt(),')
    .replace('  // Only this call\'s canonical quote-link receipt bypasses the old quote fallback.\n  const { hasCallBookingQuoteAttempt } = await import("./instinct/callBookingQuoteStore");\n  const quoteLinkHandled = await hasCallBookingQuoteAttempt(db, vapiCallId);\n\n', "")
    .replace('if (!quoteLinkHandled && !leadCreated && normalizedPhone && structuredData)', 'if (!leadCreated && normalizedPhone && structuredData)')
    .replace('if (!quoteLinkHandled && normalizedPhone && callSummaryForSms', 'if (normalizedPhone && callSummaryForSms');
}
const task = customerCallTaskSchema.parse({ id: 77, version: 1, kind: "claude_customer_task", sessionId: null, customerName: "Synthetic Jane", customerPhone: "+13015550123",
  receivingPhoneNumberId: null, receivingPhoneNumber: null, sourceMessageId: "synthetic-call", sourceText: "Move my visit", receivedAt: 1800000000000,
  title: "Review visit change", items: [{ id: "item-1", title: "Review change", evidenceQuote: "Move my visit", completedBy: null, completedAt: null }],
  call: { provider: "vapi", providerCallId: "synthetic-call", voiceCallId: 10, transcript: "User: Move my visit\nAI: Staff will review it.", recordingUrl: "https://storage.example.test/private.wav", callbackTaskIds: [] },
  status: "unclaimed", owner: null, claimedAt: null, completedAt: null, completedBy: null, completionNote: null,
  reply: { text: "", status: "not_applicable", providerMessageId: null }, activity: [{ action: "created", actor: null, at: 1800000000000, note: null }] });
function context(owner = true): TrpcContext { return { user: owner ? { openId: "owner", name: "Owner" } as any : null, req: { protocol: "https", headers: {} } as any, res: {} as any }; }
function port(value: CustomerTask | null = task) { const store: any = { get: vi.fn(async () => value) }; const getStore = vi.fn(async () => store); const broadcast = vi.fn(); const readCallRecordingUrl = vi.fn(async () => "https://storage.example.test/fresh-signed.wav"); const router = createClaudeCustomerTasksRouter({ getStore, broadcast, readCallRecordingUrl }); return { store, getStore, broadcast, readCallRecordingUrl, router }; }
beforeEach(() => vi.mocked(getAgentFromRequest).mockResolvedValue(null));
describe("call recording auth and read-only boundaries", () => {
  it("rejects anonymous reads before acquiring storage or requesting provider artifacts", async () => { const h = port(); await expect(h.router.createCaller(context(false)).recording({ id: 77 })).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(h.getStore).not.toHaveBeenCalled(); expect(h.readCallRecordingUrl).not.toHaveBeenCalled(); });
  it("lets a regular authenticated agent request only the canonical task's recording, without writes or broadcast", async () => { const h = port(); vi.mocked(getAgentFromRequest).mockResolvedValue({ agentId: 17, agentName: "Synthetic Staff", isAdmin: false } as any); expect(await h.router.createCaller(context(false)).recording({ id: 77 })).toEqual({ url: "https://storage.example.test/fresh-signed.wav" }); expect(h.readCallRecordingUrl).toHaveBeenCalledWith("synthetic-call"); expect(h.broadcast).not.toHaveBeenCalled(); });
  it("rejects arbitrary provider-call IDs in caller input", async () => { const h = port(); await expect((h.router.createCaller(context()).recording as any)({ id: 77, providerCallId: "other-call" })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(h.getStore).not.toHaveBeenCalled(); });
  it("does not request recordings for missing tasks or SMS/email records", async () => { for (const value of [null, { ...task, call: undefined } as any]) { const h = port(value); if (value) delete (value as any).call; await expect(h.router.createCaller(context()).recording({ id: 77 })).rejects.toMatchObject({ code: "NOT_FOUND" }); expect(h.readCallRecordingUrl).not.toHaveBeenCalled(); } });
  it("returns missing recordings without inventing a playable link", async () => { const h = port(); h.readCallRecordingUrl.mockResolvedValue(null as any); expect(await h.router.createCaller(context()).recording({ id: 77 })).toEqual({ url: null }); });
  it("revoked staff cannot obtain the previous signed link", async () => { const h = port(); vi.mocked(getAgentFromRequest).mockResolvedValue({ agentId: 17, agentName: "Staff", isAdmin: false } as any); await h.router.createCaller(context(false)).recording({ id: 77 }); vi.mocked(getAgentFromRequest).mockResolvedValue(null); await expect(h.router.createCaller(context(false)).recording({ id: 77 })).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(h.readCallRecordingUrl).toHaveBeenCalledTimes(1); });
});
describe("explicitly approved greeting and voice-ID exceptions and source boundaries", () => {
  it("changes only the opening and voice ID, preserving every other model, voice setting, tool, routing, lookup, bootstrap and post-call line", () => {
    const original = 'Hi, thank you for calling Maids in Black! This is Madison. How can I help you today?';
    const opening = 'Hi, thank you for calling Maids in Black! I’m Madison, your AI customer-service assistant. I can help with quotes, booking requests, and cleaning questions. How can I help you today?';
    const oldVoice = 'voiceId: "6aDn1KB0hjpdcocrUkmq"';
    const newVoice = 'voiceId: "6u6JbqKdaQy89ENzLSju"';
    const current = withoutApprovedQuoteIntegration(withoutApprovedCustomerLookup(readFileSync("server/vapiService.ts", "utf8"))); expect(current.split(opening)).toHaveLength(2); expect(current.split(newVoice)).toHaveLength(2); expect(current).not.toContain(oldVoice); expect(current.replace(opening, original).replace(newVoice, oldVoice)).toBe(baseline("server/vapiService.ts"));
  });
  it("preserves all existing SMS/email prompts, providers, send paths, schema, crons and booking/payment UI", () => {
    for (const path of ["server/webhooks.ts", "server/cronSync.ts", "server/routers.ts", "server/gmailService.ts", "server/instinct/claudeCustomerSms.ts", "server/instinct/claudeCustomerSmsApplication.ts", "server/instinct/claudeCustomerSmsGeneration.ts", "server/instinct/claudeSmsAlternative.ts", "server/instinct/claudeCustomerEmail.ts", "server/instinct/claudeCustomerEmailApplication.ts", "server/instinct/claudeCustomerEmailStore.ts", "server/instinct/claudeAgentClient.ts", "drizzle/schema.ts", "server/_core/index.ts", "client/src/components/claude-customer-tasks.css", "client/src/pages/command-chat-exact-live.css", "client/src/pages/CommandChatEmailDetail.tsx", "client/src/pages/command-chat-email-detail.css"]) expect(readFileSync(path, "utf8")).toBe(baseline(path));
  });
});
