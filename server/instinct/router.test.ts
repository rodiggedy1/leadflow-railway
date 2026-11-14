import { describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import type { Request, Response } from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInstinctRouter } from "./router";
import { createInstinctService, type InstinctService } from "./service";
import { signAgentSession } from "../_core/agentAuth";
import { AGENT_COOKIE_NAME } from "../../shared/const";
import { assertReadSelect, type ReadDb, type SelectPort, type SqlRow, type SqlValue } from "./readDb";
import type { AuthorizedScope, ModelCallable } from "../../shared/instinct";
// Auth is real JWT/cookie verification, but no runtime credentials are loaded.
vi.mock("../_core/env", () => ({ ENV: { cookieSecret: "offline-instinct-router-fixture-only" } }));
const at = "2026-11-13T18:00:00.000Z", phone = "+13015550123", line = "+13015550456";
const scope: AuthorizedScope = { installationScope: "installation", sourceAccountKey: "account", authorizationVersion: "v1", actor: { staffId: "1", role: "admin" } };
class RouterDb implements ReadDb {
  calls = 0;
  async select(sql: string, params: readonly SqlValue[] = []): Promise<SqlRow[]> {
    assertReadSelect(sql); this.calls++;
    const table = /FROM `([a-z_]+)`/.exec(sql)?.[1];
    if (sql.includes("MAX(`id`)")) return [{ throughId: table === "conversation_sessions" ? "1" : null }];
    if (table === "conversation_sessions") {
      if (sql.includes("`id` > ?") && String(params[0]) !== "0") return [];
      return [{ id: "1", leadPhone: phone, messageHistory: JSON.stringify([{ role: "user", content: "Thanks", ts: at, fromPhone: phone, toPhone: line }]), createdAt: new Date(at), updatedAt: new Date(at) }];
    }
    return [];
  }
  async snapshot<T>(read: (port: SelectPort) => Promise<T>): Promise<T> { return read(this); }
}
function harness() {
  const db = new RouterDb(), model: ModelCallable = vi.fn(async () => ({ id: "offline", created: 1, model: "injected", choices: [{ index: 0, message: { role: "assistant" as const, content: '{"actions":[]}' }, finish_reason: "stop" }] }));
  const service = createInstinctService({ scope, db, model, clock: { now: () => new Date(at) }, businessLines: [line] });
  const resolve = vi.fn(async (agent: { agentId: number }) => ({ scope: { ...scope, actor: { staffId: String(agent.agentId), role: "admin" as const } }, service }));
  const router = createInstinctRouter({ resolve });
  return { db, model, service, resolve, router };
}
async function ctx(admin: boolean | null = true, id = 1) {
  const cookie = admin === null ? "" : `${AGENT_COOKIE_NAME}=${await signAgentSession({ agentId: id, agentName: "Offline admin", agentEmail: "fixture@example.test", isAdmin: admin })}`;
  const req = new IncomingMessage(new Socket()); req.headers.cookie = cookie;
  return { req: req as Request, res: new ServerResponse(req) as Response, user: null };
}

describe("actual existing admin-agent authenticated Instinct router", () => {
  it.each(["sources", "feed", "check", "evidence", "reverify", "dayReview", "ask"] as const)("unauthenticated %s fails before scope resolution/read/model", async method => {
    const h = harness(), caller = h.router.createCaller(await ctx(null));
    const inputs = {
      sources: { sourceKinds: ["sms" as const] }, feed: { filter: "all" as const }, check: { sourceRefs: [], expectedContextRevision: "r1" },
      evidence: { issueId: "issue:1", issueRevision: "r1" }, reverify: { issueId: "issue:1", issueRevision: "r1" },
      dayReview: { localDate: "2026-11-13", timeZone: "America/New_York" as const, sourceKinds: ["sms" as const] }, ask: { threadId: "thread", requestId: "request", question: "Explain" },
    };
    let request: Promise<unknown>;
    switch (method) {
      case "sources": request = caller.sources(inputs.sources); break; case "feed": request = caller.feed(inputs.feed); break;
      case "check": request = caller.check(inputs.check); break; case "evidence": request = caller.evidence(inputs.evidence); break;
      case "reverify": request = caller.reverify(inputs.reverify); break; case "dayReview": request = caller.dayReview(inputs.dayReview); break;
      case "ask": request = caller.ask(inputs.ask); break;
    }
    await expect(request).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(h.resolve).not.toHaveBeenCalled(); expect(h.db.calls).toBe(0); expect(h.model).not.toHaveBeenCalled();
  });
  it("non-admin signed session cannot reach service; malformed cookie cannot authenticate", async () => {
    const h = harness(); await expect(h.router.createCaller(await ctx(false)).sources({ sourceKinds: ["sms"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const malformed = await ctx(null); malformed.req.headers.cookie = `${AGENT_COOKIE_NAME}=forged-token`; await expect(h.router.createCaller(malformed).feed({ filter: "all" })).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(h.db.calls).toBe(0); expect(h.resolve).not.toHaveBeenCalled();
  });
  it("invalid/zero staff ID cannot reach runtime resolution", async () => { const h = harness(); await expect(h.router.createCaller(await ctx(true, 0)).sources({ sourceKinds: ["sms"] })).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(h.resolve).not.toHaveBeenCalled(); expect(h.db.calls).toBe(0); });
  it("admin actual sources/check/feed/evidence/ask are validated read-only envelopes", async () => {
    const h = harness(), caller = h.router.createCaller(await ctx()); const inventory = await caller.sources({ sourceKinds: ["sms"] });
    const result = await caller.check({ sourceRefs: inventory.items.map(item => item.ref), expectedContextRevision: inventory.binding.contextRevision! }); expect(result.issues[0].outcome).toBe("no_action");
    const feed = await caller.feed({ filter: "all" }); expect(feed.groups[0].issues[0].issueId).toBe(result.issues[0].issueId);
    const evidence = await caller.evidence({ issueId: result.issues[0].issueId, issueRevision: result.issues[0].revision }); expect(evidence.evidence[0].originalText).toBe("Thanks"); expect(evidence.snapshot).toBeNull();
    const answer = await caller.ask({ threadId: "thread", requestId: "request", question: "Explain", selectedIssueId: result.issues[0].issueId, selectedIssueRevision: result.issues[0].revision }); expect(answer.status).toBe("unavailable"); expect(answer.binding.requestId).toBe("request"); expect(h.model).toHaveBeenCalledTimes(1);
  });
  it("admin dayReview retains continuation and does not expose non-read endpoints", async () => {
    const h = harness(), caller = h.router.createCaller(await ctx()); const first = await caller.dayReview({ localDate: "2026-11-13", timeZone: "America/New_York", sourceKinds: ["sms"] });
    const last = await caller.dayReview({ localDate: "2026-11-13", timeZone: "America/New_York", sourceKinds: ["sms"], cursor: first.continuation! }); expect(last.coverage).toMatchObject({ analyzed: 1, continuation: null });
    expect(Object.keys(h.router._def.procedures)).toEqual(["sources", "feed", "check", "evidence", "reverify", "dayReview", "ask"]);
    const types = h.router._def.procedures; expect(types.sources._def.type).toBe("query"); expect(types.feed._def.type).toBe("query"); expect(types.evidence._def.type).toBe("query"); expect(types.check._def.type).toBe("mutation");
  });
  it.each(["sourceAccountKey", "installationScope", "SQL", "body", "target", "send", "sync"])("strict input rejects arbitrary %s before scope/read", async field => {
    const h = harness(), caller = h.router.createCaller(await ctx()); await expect(caller.sources(Object.assign({ sourceKinds: ["sms" as const] }, { [field]: "forged" }))).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(h.resolve).not.toHaveBeenCalled(); expect(h.db.calls).toBe(0);
  });
  it("cross-actor issue and source refs are rejected before evidence DB reads", async () => {
    const h = harness(), one = h.router.createCaller(await ctx()), two = h.router.createCaller(await ctx(true, 2)); const inventory = await one.sources({ sourceKinds: ["sms"] }); const result = await one.check({ sourceRefs: inventory.items.map(item => item.ref), expectedContextRevision: inventory.binding.contextRevision! }); const before = h.db.calls;
    await expect(two.check({ sourceRefs: inventory.items.map(item => item.ref), expectedContextRevision: inventory.binding.contextRevision! })).rejects.toMatchObject({ code: "FORBIDDEN", message: "INVALID_SOURCE_REFERENCE" });
    await expect(two.evidence({ issueId: result.issues[0].issueId, issueRevision: result.issues[0].revision })).rejects.toMatchObject({ code: "CONFLICT", message: "STALE_ISSUE" }); expect(h.db.calls).toBe(before);
  });
  it("forged selected issue revision and cursor become safe conflicts/forbidden", async () => {
    const h = harness(), caller = h.router.createCaller(await ctx()), before = h.db.calls;
    await expect(caller.evidence({ issueId: "issue:forged", issueRevision: "forged" })).rejects.toMatchObject({ code: "CONFLICT", message: "STALE_ISSUE" });
    await expect(caller.sources({ sourceKinds: ["sms"], cursor: "cursor:forged" })).rejects.toMatchObject({ code: "FORBIDDEN", message: "INVALID_SCOPE" }); expect(h.db.calls).toBe(before);
  });
  it("server scope resolver cannot substitute another actor", async () => {
    const h = harness(), router = createInstinctRouter({ resolve: async () => ({ service: h.service, scope: { ...scope, actor: { staffId: "999", role: "admin" } } }) });
    await expect(router.createCaller(await ctx()).feed({ filter: "all" })).rejects.toMatchObject({ code: "FORBIDDEN", message: "INVALID_SCOPE" }); expect(h.db.calls).toBe(0);
  });
  it("raw source exceptions are redacted with no error cause or secret leaked", async () => {
    const h = harness(), service: InstinctService = { ...h.service, sources: async () => { throw new Error("mysql://raw-password@secret-db/customer-sql"); } };
    const router = createInstinctRouter({ resolve: () => ({ scope, service }) }); let caught: unknown;
    try { await router.createCaller(await ctx()).sources({ sourceKinds: ["sms"] }); } catch (error) { caught = error; }
    expect(caught).toMatchObject({ code: "PRECONDITION_FAILED", message: "SOURCE_UNAVAILABLE" }); expect(JSON.stringify(caught)).not.toMatch(/password|secret-db|customer-sql/); expect((caught as Error & { cause?: unknown }).cause).toBeUndefined();
  });
  it("router sources use preserved existing admin procedure only; no presence-writing or operational path", () => {
    const root = path.dirname(fileURLToPath(import.meta.url)), source = readFileSync(path.join(root, "router.ts"), "utf8");
    expect(source.match(/adminAgentProcedure\.input/g)).toHaveLength(7); expect(source).not.toMatch(/opsChatProcedure|bookingsAgentProcedure|\.sync\(|\.send\(/);
    const registration = readFileSync(path.join(root, "../aiActionsRouter.ts"), "utf8");
    expect(registration).toContain("dailyAudit: dailyActionAuditRouter,");
    if (registration.includes('import { liveTextMonitorRouter }')) expect(registration).toContain("liveText: liveTextMonitorRouter,");
    expect(registration).toContain("instinct: instinctRouter,");
  });
  it("actual connected router and owned tests have zero strict owned-file diagnostics", () => {
    const root = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(root, "../..");
    const owned = ["router.ts", "router.test.ts", "service.ts", "service.test.ts"].map(name => path.join(root, name));
    const program = ts.createProgram(owned, { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, esModuleInterop: true, resolveJsonModule: true, jsx: ts.JsxEmit.ReactJSX, baseUrl: repo, paths: { "@shared/*": ["shared/*"] } });
    // The repository-wide baseline diagnostics belong to S1-10's comparison.
    // This assertion uses the actual graph and never filters any owned diagnostic.
    const diagnostics = ts.getPreEmitDiagnostics(program).filter(d => !d.file || owned.includes(d.file.fileName));
    expect(diagnostics.map(d => `${d.file?.fileName}:${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`)).toEqual([]);
  });
});
