import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), legacy: vi.fn(), dispatch: vi.fn(), sendSms: vi.fn(), model: vi.fn(), notify: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
// Do not load the application's full router, provider, or model modules.
vi.mock("./thumbtackWebhook", () => ({ handleNativeThumbTackLead: mocks.legacy }));
vi.mock("./instinct/claudeThumbtackFirstResponseApplication", () => ({ dispatchClaudeThumbtackFirstResponse: mocks.dispatch }));
vi.mock("./openphone", () => ({ sendSms: mocks.sendSms }));
vi.mock("./_core/llm", () => ({ invokeLLM: mocks.model }));
vi.mock("./_core/notification", () => ({ notifyOwner: mocks.notify }));

import { registerThumbTackWebhookCaptureRoute } from "./thumbtackWebhookCapture";
import { readThumbtackFirstResponseDiagnostic } from "./thumbtackFirstResponseDiagnostic";

const env = {
  THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED: "true", OPENPHONE_PHONE_NUMBER_ID: "private-sender",
  OPENPHONE_API_KEY: "private-sms-key", OPENAI_API_KEY: "private-model-key", RAILWAY_ENVIRONMENT_NAME: "production",
  RAILWAY_GIT_COMMIT_SHA: "a".repeat(40), CRON_SECRET: "offline-secret", DATABASE_URL: "mysql://private-user:private-password@example.invalid/private-db",
};
const nativePayload = {
  event: { eventType: "NegotiationCreatedV4", webhookID: "offline-delivery" },
  data: { negotiationID: "offline-negotiation", createdAt: "2026-11-23T15:05:41Z",
    customer: { firstName: "Private", lastName: "Customer", phone: "2025550123" },
    request: { category: { name: "House Cleaning" }, description: "Private description and access code",
      location: { city: "Private City", state: "MD" }, details: [{ question: "Home size", answer: "2 bedrooms and 1 bathroom" }] } },
};
const capture = () => ({ id: 501, source: "thumbtack", event_type: "NegotiationCreatedV4", created_at: "2026-11-23T15:05:56Z",
  processed: 0, processed_at: null, raw_payload: JSON.stringify(nativePayload) });
const introduction = (overrides: Record<string, unknown> = {}) => ({ id: 601, sessionId: 701,
  capability: "claude_thumbtack_first_response_v1", status: "TOOLS_RUNNING", negotiationId: "offline-negotiation",
  phase: "claimed", hasGeneratedDraft: 0, errorStage: null, errorCode: null, outboundOpenPhoneId: null,
  stateMessageId: null, providerMessageId: null, providerStatus: null, ...overrides });
function database(options: { captures?: any[]; receipts?: any[]; notices?: any[]; failAt?: string; error?: unknown } = {}) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const execute = vi.fn(async (query: any) => {
    const compiled = new MySqlDialect().sqlToQuery(query);
    queries.push(compiled);
    expect(compiled.sql.trim()).toMatch(/^SELECT\b/);
    expect(compiled.sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|FOR UPDATE|cleaner_jobs)\b/i);
    if (options.failAt && compiled.sql.includes(options.failAt)) throw options.error;
    if (compiled.sql.includes("FROM webhook_events")) return [options.captures ?? [capture()]];
    if (compiled.sql.includes("FROM madison_sms_drafts")) return [options.receipts ?? []];
    if (compiled.sql.includes("FROM ops_chat_messages")) return [options.notices ?? []];
    throw new Error("Unexpected query");
  });
  return { execute, transaction: vi.fn(() => { throw new Error("Writes/locks forbidden"); }), queries };
}
function route() {
  const gets: Record<string, any> = {}, posts: Record<string, any> = {};
  registerThumbTackWebhookCaptureRoute({ get: (path: string, handler: any) => { gets[path] = handler; },
    post: (path: string, handler: any) => { posts[path] = handler; } } as any);
  const res: any = { setHeader: vi.fn(), status: vi.fn(() => res), json: vi.fn(() => res) };
  const req = (query: Record<string, unknown> = { secret: "offline-secret", captureId: "501" }, headers: Record<string, string | undefined> = {}) =>
    ({ query, get: (name: string) => headers[name.toLowerCase()] });
  return { handler: gets["/api/webhooks/thumbtack-capture/diagnostic"], gets, posts, req, res };
}
beforeEach(() => {
  vi.resetAllMocks();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.stubEnv("PREVIEW_MODE", "false");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in diagnostic"); }));
});
afterEach(() => {
  expect(mocks.dispatch).not.toHaveBeenCalled(); expect(mocks.sendSms).not.toHaveBeenCalled();
  expect(mocks.model).not.toHaveBeenCalled(); expect(mocks.notify).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

describe("authenticated native introduction diagnostic route", () => {
  it.each([{}, { secret: "wrong" }, { secret: ["offline-secret"] }])("rejects unauthorized requests before any database work: %j", async query => {
    const h = route(); await h.handler(h.req({ ...query, captureId: "501" }), h.res);
    expect(h.res.status).toHaveBeenCalledWith(403); expect(mocks.getDb).not.toHaveBeenCalled();
    expect(h.res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  });
  it("fails closed when the runtime has no CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", ""); const h = route(); await h.handler(h.req(), h.res);
    expect(h.res.status).toHaveBeenCalledWith(403); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it.each([undefined, "0", "-1", "1.5", "501x", "9007199254740992", ["501"], "1 OR 1=1"])("rejects invalid capture identity %j before database work", async captureId => {
    const h = route(); await h.handler(h.req({ secret: "offline-secret", captureId }), h.res);
    expect(h.res.status).toHaveBeenCalledWith(400); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it.each([{ "x-cron-secret": "offline-secret" }, { authorization: "Bearer offline-secret" }])("supports the existing header authorization: %j", async headers => {
    const db = database(); mocks.getDb.mockResolvedValue(db); const h = route();
    await h.handler(h.req({ captureId: "501" }, headers), h.res);
    expect(h.res.status).toHaveBeenCalledWith(200); expect(db.execute).toHaveBeenCalledTimes(3);
    expect(h.posts["/api/webhooks/thumbtack-capture/first-response"]).toBeDefined();
    expect(h.posts["/api/webhooks/thumbtack-capture"]).toBeDefined();
    expect(h.gets["/api/webhooks/thumbtack-capture/events"]).toBeDefined();
  });
  it("returns configuration with a bounded 503 if database access is unavailable", async () => {
    mocks.getDb.mockResolvedValue(null); const h = route(); await h.handler(h.req(), h.res);
    expect(h.res.status).toHaveBeenCalledWith(503);
    expect(h.res.json).toHaveBeenCalledWith(expect.objectContaining({ configuration: expect.objectContaining({ nativeConfigAvailable: true }),
      readError: { stage: "database", code: "DATABASE_UNAVAILABLE" } }));
  });
  it("does not expose a connection error, URL, SQL parameters or raw exception", async () => {
    mocks.getDb.mockRejectedValue(new Error(env.DATABASE_URL)); const h = route(); await h.handler(h.req(), h.res);
    expect(h.res.status).toHaveBeenCalledWith(500); expect(h.res.json).toHaveBeenCalledWith({ error: "Diagnostic unavailable" });
  });
});

describe("passive native introduction evidence reader", () => {
  it("reports saved capture and phone availability without pretending no receipt proves no dispatch", async () => {
    const db = database(); const result = await readThumbtackFirstResponseDiagnostic(db as any, 501, env);
    expect(result.capture).toMatchObject({ eventType: "NegotiationCreatedV4", processed: false });
    expect(result.projection).toEqual({ accepted: true, validPhone: true, phoneLast4: "0123", negotiationId: "offline-negotiation" });
    expect(result.evidence).toMatchObject({ introductionAttemptRecorded: null, conclusion: "NO_DURABLE_INTRODUCTION_ATTEMPT_EVIDENCE" });
    expect(result.configuration).toMatchObject({ nativeConfigAvailable: true, dispatchMode: "native_ai", runtimeCommit: "a".repeat(40),
      appliesAt: "diagnostic_request_not_original_arrival" });
    expect(db.queries[0].params).toEqual([501]); expect(db.queries[0].sql).toContain("WHERE id = ? LIMIT 1");
    expect(db.queries[1].sql).toContain("WHERE inboundOpenPhoneId IN"); expect(db.queries[1].sql).toContain("LIMIT 3");
    expect(db.queries[2].sql).toContain("WHERE activeDedupKey IN"); expect(db.queries[2].sql).toContain("LIMIT 2");
    expect(db.transaction).not.toHaveBeenCalled();
    const response = JSON.stringify(result);
    for (const privateValue of [env.OPENPHONE_API_KEY, env.OPENAI_API_KEY, env.OPENPHONE_PHONE_NUMBER_ID, env.CRON_SECRET,
      env.DATABASE_URL, "Private Customer", "Private description", "Private City", "+12025550123", "2025550123"]) expect(response).not.toContain(privateValue);
  });
  it("does not misclassify processed capture as successful generation or sending", async () => {
    const result = await readThumbtackFirstResponseDiagnostic(database({ captures: [{ ...capture(), processed: 1 }] }) as any, 501, env);
    expect(result.capture?.processed).toBe(true); expect(result.evidence.introductionAttemptRecorded).toBeNull();
    expect(result.evidence.providerAcceptanceRecorded).toBe(false);
  });
  it("shows a before-claim failure notice even when no draft exists", async () => {
    const db = database({ notices: [{ id: 801, failureCaptureId: "501", workflow: "thumbtack_first_response", stage: "claim", code: "CLAIM_FAILED", uncertain: "false" }] });
    const result = await readThumbtackFirstResponseDiagnostic(db as any, 501, env);
    expect(result.evidence).toMatchObject({ introductionAttemptRecorded: true, firstRecordedFailure: { stage: "claim", code: "CLAIM_FAILED" }, conclusion: "RECORDED_FAILURE" });
  });
  it("finds a capture-keyed failure when passive native parsing fails", async () => {
    const db = database({ captures: [{ ...capture(), raw_payload: "invalid JSON" }], notices: [
      { id: 801, failureCaptureId: "501", workflow: "thumbtack_first_response", stage: "capture", code: "INVALID_NATIVE_CAPTURE" }] });
    const result = await readThumbtackFirstResponseDiagnostic(db as any, 501, env);
    expect(result.projection?.accepted).toBe(false); expect(db.execute).toHaveBeenCalledTimes(2);
    expect(result.evidence.firstRecordedFailure).toEqual({ stage: "capture", code: "INVALID_NATIVE_CAPTURE" });
  });
  it("does not attribute another capture's failure or another negotiation's legacy receipt to this lead", async () => {
    const result = await readThumbtackFirstResponseDiagnostic(database({ receipts: [introduction({ negotiationId: "other-negotiation", outboundOpenPhoneId: "OM-other" })],
      notices: [{ id: 801, failureCaptureId: "999", workflow: "thumbtack_first_response", code: "CLAIM_FAILED" }] }) as any, 501, env);
    expect(result.receipts).toEqual([]); expect(result.failureNotices).toEqual([]); expect(result.evidence.introductionAttemptRecorded).toBeNull();
  });
  it("reports an introduction receipt without accepting an intake-only receipt as an introduction", async () => {
    const result = await readThumbtackFirstResponseDiagnostic(database({ receipts: [introduction({ capability: "thumbtack_lead_intake_v1", phase: "intake_recorded" })] }) as any, 501, env);
    expect(result.receipts).toHaveLength(1); expect(result.evidence.introductionAttemptRecorded).toBeNull();
  });
  it("reports persisted generation state and error codes without returning draft/customer content", async () => {
    const result = await readThumbtackFirstResponseDiagnostic(database({ receipts: [introduction({ status: "DISMISSED", hasGeneratedDraft: 1,
      errorStage: "GATE", errorCode: "GENERATION_OR_SAVE_FAILED", generatedDraft: "Private generated SMS", errorMessage: env.DATABASE_URL })] }) as any, 501, env);
    expect(result.receipts[0]).toMatchObject({ hasGeneratedDraft: true, errorCode: "GENERATION_OR_SAVE_FAILED" });
    expect(result.evidence.firstRecordedFailure).toEqual({ stage: "GATE", code: "GENERATION_OR_SAVE_FAILED" });
    expect(JSON.stringify(result)).not.toContain("Private generated SMS"); expect(JSON.stringify(result)).not.toContain(env.DATABASE_URL);
  });
  it("reports provider acceptance separately from delivery without leaking message IDs", async () => {
    const result = await readThumbtackFirstResponseDiagnostic(database({ receipts: [introduction({ status: "SENT", phase: "accepted", outboundOpenPhoneId: "private-provider-id",
      hasGeneratedDraft: 1, providerStatus: "queued" })] }) as any, 501, env);
    expect(result.evidence).toMatchObject({ providerAcceptanceRecorded: true, conclusion: "PROVIDER_ACCEPTANCE_RECORDED_NOT_DELIVERY_PROOF" });
    expect(JSON.stringify(result)).not.toContain("private-provider-id");
  });
  it.each(["outboundOpenPhoneId", "stateMessageId", "providerMessageId"])("recognizes acceptance recorded in %s", async field => {
    const result = await readThumbtackFirstResponseDiagnostic(database({ receipts: [introduction({ [field]: "OM-offline" })] }) as any, 501, env);
    expect(result.evidence.providerAcceptanceRecorded).toBe(true);
  });
  it.each([null, "null", "", " "])("does not misreport an empty or JSON-null provider receipt %j as acceptance", async value => {
    const result = await readThumbtackFirstResponseDiagnostic(database({ receipts: [introduction({
      outboundOpenPhoneId: value, stateMessageId: value, providerMessageId: value })] }) as any, 501, env);
    expect(result.evidence.providerAcceptanceRecorded).toBe(false);
  });
  it("fails closed with a code-only schema failure and preserves completed evidence", async () => {
    const result = await readThumbtackFirstResponseDiagnostic(database({ failAt: "FROM madison_sms_drafts", error: {
      message: env.DATABASE_URL, cause: { code: "ER_BAD_FIELD_ERROR", sqlMessage: "Private SQL, params and customer data" } } }) as any, 501, env);
    expect(result.readError).toEqual({ stage: "native_receipts", code: "ER_BAD_FIELD_ERROR" });
    expect(result.capture).not.toBeNull(); expect(result.evidence.introductionAttemptRecorded).toBeNull();
    expect(JSON.stringify(result)).not.toContain("Private SQL"); expect(JSON.stringify(result)).not.toContain(env.DATABASE_URL);
  });
  it("stops after a missing capture instead of searching other leads", async () => {
    const db = database({ captures: [] }); const result = await readThumbtackFirstResponseDiagnostic(db as any, 501, env);
    expect(result.evidence.conclusion).toBe("CAPTURE_NOT_FOUND"); expect(db.execute).toHaveBeenCalledOnce();
  });
  it("does not manufacture database rows or dispatch when configuration is disabled", async () => {
    const result = await readThumbtackFirstResponseDiagnostic(database() as any, 501, { ...env, THUMBTACK_CLAUDE_FIRST_RESPONSE_ENABLED: "false" });
    expect(result.configuration).toMatchObject({ enabledFlag: false, nativeConfigAvailable: false, dispatchMode: "legacy" });
    expect(result.projection?.accepted).toBe(true); expect(result.evidence.introductionAttemptRecorded).toBeNull();
  });
  it("shows sender/model key presence only, and never identifies a missing flag as the historical cause", async () => {
    const result = await readThumbtackFirstResponseDiagnostic(database() as any, 501, { ...env,
      OPENPHONE_PHONE_NUMBER_ID: " ", OPENPHONE_API_KEY: "", OPENAI_API_KEY: "" });
    expect(result.configuration).toMatchObject({ senderIdPresent: false, smsApiKeyPresent: false, modelApiKeyPresent: false, nativeConfigAvailable: false });
    expect(result.evidence.firstRecordedFailure).toBeNull();
  });
  it("reports the current relay mode without invoking any relay network operation", async () => {
    const result = await readThumbtackFirstResponseDiagnostic(database() as any, 501, { ...env, PREVIEW_MODE: "true" });
    expect(result.configuration.dispatchMode).toBe("relay");
  });
  it("never exposes malformed runtime commit values", async () => {
    const result = await readThumbtackFirstResponseDiagnostic(database() as any, 501, { ...env, RAILWAY_GIT_COMMIT_SHA: env.DATABASE_URL });
    expect(result.configuration.runtimeCommit).toBeNull();
  });
  it("has no runtime imports of generation, SMS, application dispatcher, store, or full router", () => {
    const source = readFileSync(new URL("./thumbtackFirstResponseDiagnostic.ts", import.meta.url), "utf8");
    const imports = source.match(/(?:import[\s\S]*?from\s*["'][^"']+["'];|import\(["'][^"']+["']\))/g) ?? [];
    expect(imports.join("\n")).not.toMatch(/openphone|worldClass|claudeThumbtackFirstResponseApplication|claudeThumbtackFirstResponseStore|_core\/llm|routers/);
  });
});
