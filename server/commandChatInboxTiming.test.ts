import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import superjson from "superjson";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { QueryBuilder } from "drizzle-orm/mysql-core/query-builders/query-builder";
import { conversationSessions } from "../drizzle/schema";
import {
  COMMAND_CHAT_INBOX_PATH as inbox, INBOX_TIMING_LIMITS,
  beginInboxTimingRequest, observeInboxContext, observeInboxProcedure, observeInboxHandler,
  inboxTimingStage, inboxTimingLocal, inboxTimingSkipped,
  captureInboxAcquisition, completeInboxAcquisition, serializeInboxTiming,
  commandChatInboxTimingEnabled,
  commandChatInboxTimingReadAllowed, getCommandChatInboxTimingSnapshot,
} from "./_core/commandChatInboxTiming";

vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: vi.fn(async () => null) } }));
vi.mock("./_core/agentAuth", () => ({ getAgentFromRequest: vi.fn(async () => ({ agentId: 1, isAdmin: true })) }));
vi.mock("./_core/cleanerAuth", () => ({ getCleanerFromRequest: vi.fn(async () => null) }));
import { sdk } from "./_core/sdk";
import { getAgentFromRequest } from "./_core/agentAuth";
import { createContext } from "./_core/context";
import { router, agentProcedure, publicProcedure } from "./_core/trpc";

type Log = Record<string, any>;
let logs: Log[];
let lines: string[];
const enable = () => {
  vi.stubEnv("COMMAND_CHAT_INBOX_TIMING_ENABLED", "true");
  vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "preview");
  vi.stubEnv("PREVIEW_MODE", "true");
};
class FakeResponse extends EventEmitter {
  headersSent = false;
  headers = new Map<string, unknown>();
  calls: Array<{ method: string; receiver: unknown; args: any[] }> = [];
  setHeader(name: string, value: unknown) { this.headers.set(name, value); }
  write(...args: any[]) { this.calls.push({ method: "write", receiver: this, args }); return false; }
  end(...args: any[]) { this.calls.push({ method: "end", receiver: this, args }); return this; }
}
function request(paths = inbox) {
  const req = { path: "/trpc/" + paths, headers: { "x-request-id": "untrusted", cookie: "fixture-private" } };
  const res = new FakeResponse();
  const batch = beginInboxTimingRequest(req, res);
  return { req, res, batch };
}
async function invocation<T>(req: object, work: () => Promise<T>) {
  return observeInboxProcedure(req, inbox, () => observeInboxHandler(inbox, async () => ({ ok: true, data: await work() })));
}
const ends = (label: string) => logs.filter(l => l.event === "stage_end" && l.stage === label);
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };

// Run the actual pool wrapper against callback-only fakes, never import db/router startup.
const dbSource = fs.readFileSync(path.resolve(import.meta.dirname, "db.ts"), "utf8");
const poolStart = dbSource.indexOf("function wrapPoolInstrumentation(");
const poolEnd = dbSource.indexOf("\n// ── Pool singleton", poolStart);
const poolJs = ts.transpileModule(dbSource.slice(poolStart, poolEnd), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function instrument(core: any, failures = vi.fn()) {
  const install = new Function("DB_POOL_MONITOR_VERSION", "RESTART_WORTHY_CODES", "recordAcquisitionFailure", "captureInboxAcquisition", "completeInboxAcquisition", "require", poolJs + ";return wrapPoolInstrumentation;");
  install(1, new Set(["QUEUE_LIMIT"]), failures, captureInboxAcquisition, completeInboxAcquisition, () => ({ version: "fixture" }))({ pool: core });
}

beforeEach(() => {
  logs = []; lines = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    if (typeof line === "string" && line.startsWith("[CommandChatInboxTiming] ")) {
      lines.push(line); logs.push(JSON.parse(line.slice("[CommandChatInboxTiming] ".length)));
    }
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(sdk.authenticateRequest).mockResolvedValue(null);
  vi.mocked(getAgentFromRequest).mockResolvedValue({ agentId: 1, isAdmin: true } as any);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("bounded observation-only inbox timing", () => {
  it.each([
    [undefined, "preview", "true"], ["false", "preview", "true"], ["1", "preview", "true"],
    ["true", "production", "true"], ["true", "Preview", "true"], ["true", "preview", "false"], ["true", "preview", undefined],
  ])("is exactly default OFF for flag=%s environment=%s mode=%s", async (flag, env, mode) => {
    vi.stubEnv("COMMAND_CHAT_INBOX_TIMING_ENABLED", flag); vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", env); vi.stubEnv("PREVIEW_MODE", mode);
    expect(commandChatInboxTimingEnabled()).toBe(false);
    const { req, res, batch } = request();
    const value = [new Date(1), undefined, NaN, { secret: "fixture-private" }];
    const serialize = vi.fn(superjson.serialize);
    const result = await invocation(req, async () => inboxTimingStage("sessions", async () => value));
    expect(result.data).toBe(value);
    expect(serializeInboxTiming(result.data, serialize)).toStrictEqual(superjson.serialize(value));
    expect(serialize).toHaveBeenCalledTimes(1);
    expect(batch).toBeUndefined(); expect(res.headers.size).toBe(0); expect(logs).toEqual([]);
    expect(captureInboxAcquisition()).toBeUndefined();
  });

  it.each(["commandCenter.listCommandChatInboxExtra", "other.listCommandChatInbox", "agents.me", ""])('ignores non-exact path "%s"', async paths => {
    enable(); const { req, res, batch } = request(paths);
    await observeInboxProcedure(req, paths, async () => ({ ok: true }));
    expect(batch).toBeUndefined(); expect(res.headers.size).toBe(0); expect(logs).toEqual([]);
  });

  it("uses generated UUIDs, one shared context and distinct immutable invocation/stage IDs in repeated mixed batches", async () => {
    enable(); const { req, res, batch } = request(inbox + ",agents.me," + inbox);
    expect(beginInboxTimingRequest(req, res)).toBe(batch);
    await observeInboxContext(batch, () => inboxTimingStage("optional_auth", async () => null));
    const barrier = deferred();
    const a = invocation(req, () => inboxTimingStage("sessions", async () => { await barrier.promise; return [1]; }));
    await invocation(req, () => inboxTimingStage("latest_voice", async () => [2]));
    barrier.resolve(); await a;
    await observeInboxProcedure(req, "agents.me", async () => ({ ok: true }));
    expect(ends("context")).toHaveLength(1);
    const ids = new Set(ends("procedure").map(l => l.invocation_id)); expect(ids.size).toBe(2);
    expect(new Set(logs.map(l => l.request_id)).size).toBe(1);
    expect(logs[0].request_id).toMatch(/^[0-9a-f-]{36}$/); expect(logs[0].request_id).not.toBe("untrusted");
    expect(res.headers.get("X-Command-Chat-Inbox-Trace")).toBe(logs[0].request_id);
    for (const l of logs.filter(l => l.event === "stage_start")) {
      expect(logs.filter(e => e.event === "stage_end" && e.stage_id === l.stage_id)).toHaveLength(1);
    }
  });

  it("attributes queued acquisitions to captured dispatch, without restoring application callback ALS or changing callback receiver/arguments/count", async () => {
    enable(); const one = request(); const two = request(); const queue: Function[] = [];
    const core = { getConnection: vi.fn(function (this: any, cb: Function) { expect(this).toBe(core); queue.push(cb); }) };
    const originalGetConnection = core.getConnection;
    instrument(core); vi.spyOn(Math, "random").mockReturnValue(0.5);
    const done = deferred(); const conn = {}; const app = vi.fn(function (this: any, ...args: any[]) {
      expect(this).toBeUndefined(); expect(args).toEqual([null, conn]);
      // Callback runs under request two's release scope, NOT request one's dispatch scope.
      const probe = captureInboxAcquisition(); completeInboxAcquisition(probe, true); done.resolve();
    });
    const a = invocation(one.req, () => inboxTimingStage("sessions", async () => { core.getConnection(app); await done.promise; return []; }));
    await invocation(two.req, () => inboxTimingStage("team_profiles", async () => { queue[0](null, conn); return []; }));
    await a;
    expect(app).toHaveBeenCalledTimes(1); expect(originalGetConnection).toHaveBeenCalledTimes(1);
    const starts = logs.filter(l => l.event === "acquisition_start");
    expect(starts.map(l => l.stage)).toEqual(["sessions", "team_profiles"]);
    expect(starts[0].request_id).not.toBe(starts[1].request_id);
    const completion = logs.find(l => l.event === "acquisition_end" && l.acquisition_id === starts[0].acquisition_id)!;
    expect(completion.request_id).toBe(starts[0].request_id); expect(completion.stage_id).toBe(starts[0].stage_id);
    expect(ends("sessions")[0].acquisition_coverage).toBe("exactly_one_contained");
    expect(ends("sessions")[0].post_acquisition_db_wall_ms).toBeGreaterThanOrEqual(0);
  });

  it("keeps the original successful monitor sampling and failure health accounting", async () => {
    enable(); const { req } = request(); const fail = Object.assign(new Error("Queue limit reached."), {});
    const health = vi.fn(); const core = { getConnection: (cb: Function) => cb(fail, undefined) };
    instrument(core, health); const app = vi.fn();
    await invocation(req, () => inboxTimingStage("sessions", async () => { core.getConnection(app); return []; }));
    expect(app).toHaveBeenCalledTimes(1); expect(app).toHaveBeenCalledWith(fail, undefined);
    expect(health).toHaveBeenCalledTimes(1); expect(health).toHaveBeenCalledWith("QUEUE_LIMIT");
    expect(ends("sessions")[0]).toMatchObject({ acquisition_coverage: "partial", post_acquisition_db_wall_ms: null });
    const sourceWithoutInsertions = dbSource.replace('import { captureInboxAcquisition, completeInboxAcquisition } from "./_core/commandChatInboxTiming";\n', "")
      .replace("    const inboxAcquisition = captureInboxAcquisition();\n", "").replace("      completeInboxAcquisition(inboxAcquisition, !err);\n", "");
    expect(sourceWithoutInsertions).toContain("if (Math.random() < 0.1)");
  });

  it("evaluates lazy statements in scope and never calls acquisition a getDb wait", async () => {
    enable(); const { req } = request(); let ticket: ReturnType<typeof captureInboxAcquisition>;
    await invocation(req, async () => {
      await inboxTimingStage("get_db_handle", async () => { expect(captureInboxAcquisition()).toBeUndefined(); });
      await inboxTimingStage("sessions", () => ({ then(resolve: (v: string) => void) {
        ticket = captureInboxAcquisition(); completeInboxAcquisition(ticket, true); resolve("rows");
    } }) as PromiseLike<string>);
      inboxTimingSkipped("retained_outbound");
    });
    expect(ticket).toBeDefined(); expect(ends("get_db_handle")[0]).not.toHaveProperty("acquisition_coverage");
    expect(ends("retained_outbound")[0]).toMatchObject({ outcome: "skipped", wall_ms: null, acquisition_coverage: "skipped", post_acquisition_db_wall_ms: null });
  });

  it.each(["missing", "multiple", "failed", "late"])("does not subtract %s acquisition coverage", async kind => {
    enable(); const { req } = request(); let late: ReturnType<typeof captureInboxAcquisition>;
    await invocation(req, () => inboxTimingStage("sessions", async () => {
      if (kind === "missing") return [];
      const ticket = captureInboxAcquisition();
      if (kind === "late") late = ticket;
      else completeInboxAcquisition(ticket, kind !== "failed");
      if (kind === "multiple") completeInboxAcquisition(captureInboxAcquisition(), true);
      return [];
    }));
    completeInboxAcquisition(late, true);
    expect(ends("sessions")[0].post_acquisition_db_wall_ms).toBeNull();
    expect(ends("sessions")[0].acquisition_coverage).toBe(kind === "missing" ? "unavailable" : "partial");
    if (kind === "late") expect(logs.find(l => l.event === "acquisition_end")?.late).toBe(true);
  });

  it("preserves application errors/results and does not leak arbitrary error messages, payloads or cookies", async () => {
    enable(); const { req } = request(); const error = new Error("fixture-private SQL customer phone");
    await expect(invocation(req, () => inboxTimingStage("sessions", async () => { throw error; }))).rejects.toBe(error);
    expect(ends("sessions")[0].outcome).toBe("error"); expect(ends("handler")[0].outcome).toBe("error");
    expect(ends("procedure")[0].outcome).toBe("error");
    const result = { ok: false, error }; expect(await observeInboxProcedure(req, inbox, async () => result)).toBe(result);
    expect(lines.join("\n")).not.toMatch(/fixture-private|customer|cookie|SQL/);
    expect(inboxTimingLocal("projection", () => 5)).toBe(5);
  });

  it("is fail-open when logging or response header observation throws, without retrying work", async () => {
    enable(); vi.mocked(console.log).mockImplementation(() => { throw new Error("observer only"); });
    const req = { path: "/trpc/" + inbox }; const res = new FakeResponse();
    vi.spyOn(res, "setHeader").mockImplementation(() => { throw new Error("header observer only"); });
    expect(beginInboxTimingRequest(req, res)).toBeDefined(); const work = vi.fn(async () => [7]);
    expect((await invocation(req, work)).data).toEqual([7]); expect(work).toHaveBeenCalledTimes(1);
    const error = new Error("application");
    await expect(invocation(req, async () => { throw error; })).rejects.toBe(error);
    expect(() => res.emit("finish")).not.toThrow();
  });

  it("fails open on ALS setup/monotonic-clock observation failures and never replays synchronous work", async () => {
    enable(); const { req, res } = request(); const work = vi.fn(async () => [8]);
    const als = vi.spyOn(AsyncLocalStorage.prototype, "run").mockImplementation(() => { throw new Error("observer setup only"); });
    expect((await invocation(req, work)).data).toEqual([8]); expect(work).toHaveBeenCalledTimes(1);
    als.mockRestore();
    await invocation(req, async () => {
      const error = new Error("synchronous application"); const local = vi.fn(() => { throw error; });
      expect(() => inboxTimingLocal("projection", local)).toThrow(error); expect(local).toHaveBeenCalledTimes(1);
      vi.spyOn(performance, "now").mockImplementation(() => { throw new Error("clock observer only"); });
      expect(inboxTimingLocal("projection", () => 9)).toBe(9);
    });
    expect(() => res.emit("finish")).not.toThrow();
  });

  it("uses identical SuperJSON bytes for marked output only, and preserves serialization exceptions", async () => {
    enable(); const { req } = request(); const data = [{ createdAt: new Date(1), absent: undefined, bigint: 4n, nan: NaN }];
    const result = await invocation(req, async () => data);
    const before = JSON.stringify(superjson.serialize(data));
    expect(JSON.stringify(serializeInboxTiming(result.data, superjson.serialize))).toBe(before);
    expect(ends("serialize")).toHaveLength(1);
    serializeInboxTiming({ untouched: true }, superjson.serialize); expect(ends("serialize")).toHaveLength(1);
    const error = new Error("serializer application error"); const serialize = vi.fn(() => { throw error; });
    expect(() => serializeInboxTiming(data, serialize)).toThrow(error); expect(serialize).toHaveBeenCalledTimes(1);
    expect(ends("serialize").at(-1)?.outcome).toBe("error");
  });

  it("counts response bytes without retaining body; preserves write/end receiver, callbacks, arguments and return values; reports finish exactly once", async () => {
    enable(); const { req, res } = request(inbox + ",agents.me"); const cb = vi.fn();
    await invocation(req, async () => []);
    const body = Buffer.from("PRIVATE_RESPONSE_SENTINEL");
    const bytes = Buffer.byteLength("é") + body.byteLength;
    expect(res.write("é", "utf8", cb)).toBe(false);
    expect(res.end(body, cb)).toBe(res);
    expect(res.calls[0]).toEqual({ method: "write", receiver: res, args: ["é", "utf8", cb] });
    expect(res.calls[1].args).toEqual([body, cb]); expect(cb).not.toHaveBeenCalled();
    expect(logs.find(l => l.event === "response_end")).toMatchObject({ shared_batch: true, response_bytes: bytes });
    res.emit("finish"); res.emit("close"); res.emit("finish");
    expect(logs.filter(l => l.event === "response_terminal")).toHaveLength(1);
    expect(logs.at(-1)).toMatchObject({ outcome: "finish", shared_batch: true, response_bytes: bytes });
    expect(res.listenerCount("finish")).toBe(0); expect(res.listenerCount("close")).toBe(0);
    expect(lines.join("\n")).not.toContain("PRIVATE_RESPONSE_SENTINEL"); expect(res.write).toBe(FakeResponse.prototype.write);
  });

  it("reports a close without end as incomplete transport wall, not a successful network delivery", () => {
    enable(); const { res } = request(); res.emit("close"); res.emit("finish");
    expect(logs.at(-1)).toMatchObject({ event: "response_terminal", outcome: "close", end_to_terminal_ms: null, shared_batch: true });
  });

  it("bounds stages, invocations, acquisitions and records, and stops after metadata retention", async () => {
    enable(); const { req, res, batch } = request();
    await invocation(req, () => inboxTimingStage("sessions", async () => {
      for (let i = 0; i < 100; i++) completeInboxAcquisition(captureInboxAcquisition(), true);
      for (let i = 0; i < 100; i++) inboxTimingLocal("projection", () => i);
    }));
    for (let i = 0; i < 100; i++) await invocation(req, async () => []);
    expect(logs.filter(l => l.event === "acquisition_start")).toHaveLength(INBOX_TIMING_LIMITS.acquisitionsPerStage);
    expect(logs.filter(l => l.event === "stage_start").length).toBeLessThanOrEqual(INBOX_TIMING_LIMITS.stagesPerBatch);
    expect(lines.length).toBeLessThanOrEqual(INBOX_TIMING_LIMITS.recordsPerBatch);
    expect(lines.reduce((n, l) => n + Buffer.byteLength(l) + 1, 0)).toBeLessThan(INBOX_TIMING_LIMITS.bytesPerBatch);
    const count = logs.length;
    vi.spyOn(performance, "now").mockReturnValue(batch!.started + INBOX_TIMING_LIMITS.retentionMs + 1);
    await invocation(req, async () => []); res.end("not retained"); res.emit("finish");
    expect(logs).toHaveLength(count);
  });

  it("reserves response observation space even when stage logging fills its budget", async () => {
    enable(); const { req, res } = request();
    await invocation(req, async () => {
      for (let i = 0; i < 100; i++) await inboxTimingStage("sessions", async () => {
        for (let j = 0; j < 8; j++) completeInboxAcquisition(captureInboxAcquisition(), true);
      });
    });
    res.end("fixture"); res.emit("finish");
    expect(logs.filter(l => l.event === "response_end")).toHaveLength(1);
    expect(logs.filter(l => l.event === "response_terminal")).toHaveLength(1);
    expect(lines.length).toBeLessThanOrEqual(INBOX_TIMING_LIMITS.recordsPerBatch);
    expect(lines.reduce((n, l) => n + Buffer.byteLength(l) + 1, 0)).toBeLessThanOrEqual(INBOX_TIMING_LIMITS.bytesPerBatch);
  });

  it("keeps actual configured input/output transformers and context unchanged when OFF", async () => {
    vi.stubEnv("COMMAND_CHAT_INBOX_TIMING_ENABLED", "false");
    const req = { path: "/trpc/" + inbox, headers: {} }; const res = new FakeResponse();
    const ctx = await createContext({ req, res } as any);
    const value = [{ createdAt: new Date(1), missing: undefined, infinity: Infinity, large: 2n }];
    const testRouter = router({ commandCenter: router({ listCommandChatInbox: agentProcedure.query(() => value) }) });
    expect(await testRouter.createCaller(ctx).commandCenter.listCommandChatInbox()).toBe(value);
    const transformer = testRouter._def._config.transformer;
    const serialized = superjson.serialize(value);
    expect(JSON.stringify(transformer.input.serialize(value))).toBe(JSON.stringify(serialized));
    expect(JSON.stringify(transformer.output.serialize(value))).toBe(JSON.stringify(serialized));
    expect(transformer.input.deserialize(serialized)).toStrictEqual(superjson.deserialize(serialized));
    expect(transformer.output.deserialize(serialized)).toStrictEqual(superjson.deserialize(serialized));
    expect(res.headers.size).toBe(0); expect(res.write).toBe(FakeResponse.prototype.write);
    expect(res.end).toBe(FakeResponse.prototype.end); expect(logs).toEqual([]);
  });

  it("uses actual createContext and middleware without extra auth calls or changed successful/failing results", async () => {
    enable(); const req = { path: "/trpc/" + inbox + ",agents.me", headers: {} }; const res = new FakeResponse();
    const ctx = await createContext({ req, res } as any);
    expect(ctx).toEqual({ req, res, user: null }); expect(sdk.authenticateRequest).toHaveBeenCalledTimes(1);
    const data = [{ createdAt: new Date(3) }];
    const testRouter = router({ commandCenter: router({ listCommandChatInbox: agentProcedure.query(async () => data), untouched: agentProcedure.query(() => "other") }) });
    expect(await testRouter.createCaller(ctx).commandCenter.listCommandChatInbox()).toBe(data);
    const serialize = testRouter._def._config.transformer.output.serialize;
    expect(JSON.stringify(serialize(data))).toBe(JSON.stringify(superjson.serialize(data)));
    expect(ends("agent_auth")).toHaveLength(1); expect(ends("handler")).toHaveLength(1); expect(ends("serialize")).toHaveLength(1);
    expect(await testRouter.createCaller(ctx).commandCenter.untouched()).toBe("other"); expect(ends("procedure")).toHaveLength(1);
    vi.mocked(getAgentFromRequest).mockResolvedValue(null);
    await expect(testRouter.createCaller(ctx).commandCenter.listCommandChatInbox()).rejects.toMatchObject({ code: "UNAUTHORIZED", message: "Agent login required" });
    expect(ends("procedure").at(-1)?.outcome).toBe("error"); expect(ends("handler")).toHaveLength(1);
  });

  it("preserves optional-auth failure and context capability behavior without a new lookup", async () => {
    enable(); const req = { path: "/trpc/" + inbox, headers: {} }; const res = new FakeResponse();
    vi.mocked(sdk.authenticateRequest).mockRejectedValue(new Error("private optional auth"));
    const ctx = await createContext({ req, res } as any); expect(ctx.user).toBeNull();
    expect(ends("optional_auth")[0].outcome).toBe("error"); expect(ends("context")[0].outcome).toBe("ok");
    expect(getAgentFromRequest).not.toHaveBeenCalled(); expect(res.headers.has("X-Command-Chat-API-Debug")).toBe(false);
  });

  it.each([false, true])("keeps exact actual-handler SQL/order/19 fields and Preview retained pause for empty=%s with tracing ON versus OFF", async empty => {
    enable();
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "commandCenterRouter.ts"), "utf8");
    const start = source.indexOf("listCommandChatInbox: agentProcedure");
    const marker = ".query(async () => {";
    const from = source.indexOf(marker, start) + marker.length;
    const to = source.indexOf("\n    }),", from);
    const js = ts.transpileModule(`const run = async () => {${source.slice(from, to)}\n};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const make = new Function("getDb", "conversationSessions", "and", "eq", "inArray", "isNotNull", "isNull", "or", "sql",
      "inboxTimingStage", "inboxTimingLocal", "inboxTimingSkipped", js + ";return run;");
    const fixture = { id: 1, leadPhone: "+12025550100", leadName: "Invented timing fixture", leadSource: "fixture",
      csQueue: "CS", aiSummary: null, lastInboundPhoneNumberId: null, lastMessageText: "fixture text",
      lastMessageTs: 10, lastMessageRole: "user", lastCalledAt: null, createdAt: new Date(1), updatedAt: new Date(2) };
    const dialect = new MySqlDialect(); const compiler = new QueryBuilder(dialect);
    const run = async (on: boolean) => {
      vi.stubEnv("COMMAND_CHAT_INBOX_TIMING_ENABLED", on ? "true" : "false");
      const statements: Array<{ sql: string; params: unknown[] }> = [];
      const capture = () => completeInboxAcquisition(captureInboxAcquisition(), true);
      const db = {
        select: (selection: any) => ({ from: (table: any) => ({ where: (predicate: any) => ({ then(resolve: Function) {
          capture(); statements.push(compiler.select(selection).from(table).where(predicate).toSQL());
          resolve(empty ? [] : [{ ...fixture }]);
        } }) }) }),
        execute: (statement: any) => ({ then(resolve: Function) {
          capture(); const query = dialect.sqlToQuery(statement); statements.push(query);
          resolve([query.sql.includes("FROM voice_calls") ? [{ sessionId: 1, latestCallTs: 15 }] : [{ phone10: "2025550100" }]]);
        } }),
      };
      const getDb = vi.fn(async () => db);
      const handler = make(getDb, conversationSessions, and, eq, inArray, isNotNull, isNull, or, sql,
        inboxTimingStage, inboxTimingLocal, inboxTimingSkipped);
      const { req, res } = request();
      const result = await invocation(req, handler);
      const bytes = JSON.stringify(serializeInboxTiming(result.data, superjson.serialize));
      res.end(bytes); res.emit("finish");
      expect(getDb).toHaveBeenCalledTimes(1);
      return { data: result.data as any[], statements, bytes };
    };
    const off = await run(false); expect(logs).toEqual([]);
    const on = await run(true);
    expect(on).toStrictEqual(off);
    expect(on.statements).toHaveLength(empty ? 1 : 3);
    expect(on.statements.every(q => /^\s*SELECT\b/i.test(q.sql))).toBe(true);
    expect(on.statements.every(q => !q.sql.includes("openphone_call_recordings"))).toBe(true);
    if (!empty) { expect(Object.keys(on.data[0])).toHaveLength(19); expect(on.data[0]).toMatchObject({ calledAt: null, personType: "team", hasUnanswered: true }); }
    for (const label of empty ? ["sessions"] : ["sessions", "latest_voice", "team_profiles"])
      expect(ends(label)[0].acquisition_coverage).toBe("exactly_one_contained");
    expect(ends("retained_outbound")[0].outcome).toBe("skipped");
    expect(ends("serialize")).toHaveLength(1);
    expect(logs.find(l => l.event === "response_end")?.response_bytes).toBe(Buffer.byteLength(on.bytes));
  });

  it("preserves synchronous driver dispatch and response-write/end errors without observer retries", async () => {
    enable(); const { req } = request(); const error = new Error("synchronous driver application error");
    const driver = vi.fn(() => { throw error; }); const core = { getConnection: driver }; instrument(core);
    await expect(invocation(req, () => inboxTimingStage("sessions", async () => { core.getConnection(); }))).rejects.toBe(error);
    expect(driver).toHaveBeenCalledTimes(1); expect(ends("sessions")[0].post_acquisition_db_wall_ms).toBeNull();
    const res = new FakeResponse(); const write = vi.fn(() => { throw error; }); const end = vi.fn(() => { throw error; });
    res.write = write; res.end = end;
    beginInboxTimingRequest({ path: "/trpc/" + inbox }, res);
    expect(() => res.write("fixture")).toThrow(error); expect(() => res.end("fixture")).toThrow(error);
    expect(write).toHaveBeenCalledTimes(1); expect(end).toHaveBeenCalledTimes(1); res.emit("close");
  });
});

// Extract only the actual added route AST; never import application/router startup.
const retrievalSource = fs.readFileSync(path.resolve(import.meta.dirname, "commandCenterRouter.ts"), "utf8");
const retrievalAst = ts.createSourceFile("commandCenterRouter.ts", retrievalSource, ts.ScriptTarget.Latest, true);
let retrievalExpression: string | undefined;
function findRetrieval(node: ts.Node): void {
  if (ts.isPropertyAssignment(node) && node.name.getText(retrievalAst) === "getCommandChatInboxTiming") {
    if (retrievalExpression) throw new Error("Diagnostic route must occur exactly once");
    retrievalExpression = node.initializer.getText(retrievalAst);
  }
  ts.forEachChild(node, findRetrieval);
}
findRetrieval(retrievalAst);
if (!retrievalExpression) throw new Error("Actual diagnostic route missing");
const retrievalJs = ts.transpileModule(`const route = ${retrievalExpression};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function retrievalCaller(snapshot = vi.fn(getCommandChatInboxTimingSnapshot)) {
  const make = new Function("publicProcedure", "commandChatInboxTimingReadAllowed", "getCommandChatInboxTimingSnapshot", "TRPCError", retrievalJs + ";return route;");
  const testRouter = router({ commandCenter: router({ getCommandChatInboxTiming: make(publicProcedure, commandChatInboxTimingReadAllowed, snapshot, TRPCError) }) });
  return { testRouter, snapshot };
}
const diagnosticHeader = "x-command-chat-inbox-diagnostic-key";
const diagnosticSecret = "FAKE_DIAGNOSTIC_SECRET_ONLY";
const diagnosticContext = (header: unknown = diagnosticSecret) => ({ req: { path: "/trpc/commandCenter.getCommandChatInboxTiming", headers: { [diagnosticHeader]: header } }, res: new FakeResponse(), user: null } as any);

describe("memory-only diagnostic retrieval", () => {
  beforeEach(() => {
    // Opportunistically expire prior tests' records through the production read path.
    const clock = vi.spyOn(performance, "now").mockReturnValue(Number.MAX_SAFE_INTEGER);
    expect(getCommandChatInboxTimingSnapshot()).toEqual([]); clock.mockRestore();
    enable(); vi.stubEnv("CRON_SECRET", diagnosticSecret);
  });

  it("retains only the newest 512 fixed records within the strict serialized-byte budget", () => {
    for (let i = 0; i < INBOX_TIMING_LIMITS.snapshotRecords + 90; i++) request();
    const snapshot = getCommandChatInboxTimingSnapshot();
    expect(snapshot).toStrictEqual(logs.slice(-INBOX_TIMING_LIMITS.snapshotRecords));
    expect(snapshot).toHaveLength(512);
    const charged = snapshot.reduce((n, record) => n + Buffer.byteLength("[CommandChatInboxTiming] " + JSON.stringify(record)) + 1 + 32, 0);
    expect(charged).toBeLessThanOrEqual(INBOX_TIMING_LIMITS.snapshotBytes);
    expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThanOrEqual(1024 * 1024);
  });

  it("expires on snapshot reads at exactly 120 seconds, not before", () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(1_000); request();
    clock.mockReturnValue(120_999); expect(getCommandChatInboxTimingSnapshot()).toHaveLength(1);
    clock.mockReturnValue(121_000); expect(getCommandChatInboxTimingSnapshot()).toEqual([]);
  });

  it("expires on writes without a timer or subsequent read of old records", () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(1_000); request();
    const oldId = logs[0].request_id;
    clock.mockReturnValue(121_000); request();
    expect(getCommandChatInboxTimingSnapshot()).toStrictEqual([logs[1]]);
    expect(getCommandChatInboxTimingSnapshot().some(record => record.request_id === oldId)).toBe(false);
  });

  it("returns defensive arrays and primitive-record copies", () => {
    request(); const first = getCommandChatInboxTimingSnapshot(); const original = { ...first[0] };
    const second = getCommandChatInboxTimingSnapshot(); expect(second).not.toBe(first); expect(second[0]).not.toBe(first[0]);
    first[0].request_id = "MUTATED_PRIVATE_SENTINEL"; first[0].payload = "MUTATED_PRIVATE_SENTINEL"; first.length = 0;
    expect(getCommandChatInboxTimingSnapshot()).toStrictEqual([original]);
    expect(second).toStrictEqual([original]);
  });

  it("reuses exact Preview API debug activation, defaults OFF, and gives explicit false precedence", () => {
    for (const [timing, debug, expected] of [[undefined, undefined, false], [undefined, "true", true], ["false", "true", false], ["true", undefined, true], ["true", "false", true]] as const) {
      vi.stubEnv("COMMAND_CHAT_INBOX_TIMING_ENABLED", timing); vi.stubEnv("COMMAND_CHAT_API_DEBUG_ENABLED", debug);
      expect(commandChatInboxTimingEnabled()).toBe(expected);
    }
    vi.stubEnv("COMMAND_CHAT_INBOX_TIMING_ENABLED", undefined); vi.stubEnv("COMMAND_CHAT_API_DEBUG_ENABLED", "true");
    expect(request().batch).toBeDefined();
    vi.stubEnv("COMMAND_CHAT_INBOX_TIMING_ENABLED", "false"); expect(request().batch).toBeUndefined();
  });

  it("blocks absent configuration and missing, wrong, duplicate or non-string headers before snapshot", async () => {
    const { testRouter, snapshot } = retrievalCaller();
    const sameLengthWrongKey = "X".repeat(Buffer.byteLength(diagnosticSecret));
    for (const value of [undefined, "", sameLengthWrongKey, diagnosticSecret + "x", [diagnosticSecret], 1]) {
      const ctx = diagnosticContext(); ctx.req.headers[diagnosticHeader] = value;
      await expect(testRouter.createCaller(ctx).commandCenter.getCommandChatInboxTiming()).rejects.toMatchObject({ code: "FORBIDDEN", message: "Inbox timing diagnostics unavailable" });
    }
    vi.stubEnv("CRON_SECRET", undefined);
    await expect(testRouter.createCaller(diagnosticContext()).commandCenter.getCommandChatInboxTiming()).rejects.toMatchObject({ code: "FORBIDDEN" });
    vi.stubEnv("CRON_SECRET", ""); expect(commandChatInboxTimingReadAllowed(diagnosticSecret)).toBe(false);
    expect(snapshot).not.toHaveBeenCalled();
  });

  it("blocks Production, non-exact Preview, mode OFF and disabled timing before snapshot even with a correct key", async () => {
    const { testRouter, snapshot } = retrievalCaller();
    for (const [env, mode, flag] of [["production", "true", "true"], ["Preview", "true", "true"], ["preview", "false", "true"], ["preview", "true", "false"]]) {
      vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", env); vi.stubEnv("PREVIEW_MODE", mode); vi.stubEnv("COMMAND_CHAT_INBOX_TIMING_ENABLED", flag); vi.stubEnv("COMMAND_CHAT_API_DEBUG_ENABLED", "true");
      await expect(testRouter.createCaller(diagnosticContext()).commandCenter.getCommandChatInboxTiming()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(snapshot).not.toHaveBeenCalled();
  });

  it("executes the actual public route and cookie-free SDK/context path without auth-session or DB calls", async () => {
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "_core/sdk.ts"), "utf8");
    const ast = ts.createSourceFile("sdk.ts", source, ts.ScriptTarget.Latest, true);
    const cls = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "SDKServer") as ts.ClassDeclaration;
    const methods = ["parseCookies", "verifySession", "authenticateRequest"].map(name => {
      const method = cls.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name);
      if (!method) throw new Error("Required SDK method missing"); return method.getText(ast);
    }).join("\n");
    const js = ts.transpileModule(`class CookieFreeSdk { ${methods} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const dbCall = vi.fn(() => { throw new Error("DB access forbidden in retrieval test"); });
    const fakeDb = { getUserByOpenId: dbCall, upsertUser: dbCall };
    const instance = new Function("db", "ForbiddenError", "COOKIE_NAME", js + ";return new CookieFreeSdk;")(fakeDb, (message: string) => new Error(message), "fixture_cookie");
    vi.mocked(sdk.authenticateRequest).mockImplementation(req => instance.authenticateRequest(req));
    const context = diagnosticContext(); const ctx = await createContext(context);
    request(); const { testRouter, snapshot } = retrievalCaller();
    const count = logs.length;
    expect(await testRouter.createCaller(ctx).commandCenter.getCommandChatInboxTiming()).toStrictEqual(getCommandChatInboxTimingSnapshot());
    expect(snapshot).toHaveBeenCalledTimes(1); expect(dbCall).not.toHaveBeenCalled();
    expect(getAgentFromRequest).not.toHaveBeenCalled(); expect(sdk.authenticateRequest).toHaveBeenCalledTimes(1);
    expect(ctx.user).toBeNull(); expect(context.req.headers.cookie).toBeUndefined(); expect(logs).toHaveLength(count);
    expect(retrievalExpression).toMatch(/^publicProcedure\s*\.query/);
    expect(retrievalExpression).not.toMatch(/getDb|\.input|agentProcedure|querystring|console\./);
  });

  it("retains records despite a stdout observation failure and fails empty on snapshot clock failure without changing work", async () => {
    vi.mocked(console.log).mockImplementation(() => { throw new Error("PRIVATE_STDOUT_ERROR_SENTINEL"); });
    const { req } = request(); const work = vi.fn(async () => []);
    expect((await invocation(req, work)).data).toEqual([]); expect(work).toHaveBeenCalledTimes(1);
    expect(getCommandChatInboxTimingSnapshot().some(record => record.event === "stage_end")).toBe(true);
    const clock = vi.spyOn(performance, "now").mockImplementation(() => { throw new Error("PRIVATE_CLOCK_ERROR_SENTINEL"); });
    expect(getCommandChatInboxTimingSnapshot()).toEqual([]); clock.mockRestore();
    expect(JSON.stringify(getCommandChatInboxTimingSnapshot())).not.toMatch(/PRIVATE_STDOUT|PRIVATE_CLOCK/);
  });

  it("retains only fixed allowlisted primitive fields and UUIDs, never payloads, customer IDs, header secrets or arbitrary errors", async () => {
    const { req, res, batch } = request();
    await observeInboxContext(batch, () => inboxTimingStage("optional_auth", async () => null));
    const data = { customerId: "PRIVATE_CUSTOMER_SENTINEL", body: "PRIVATE_PAYLOAD_SENTINEL" };
    const result = await invocation(req, () => inboxTimingStage("sessions", async () => {
      completeInboxAcquisition(captureInboxAcquisition(), true); return data;
    }));
    serializeInboxTiming(result.data, superjson.serialize); inboxTimingSkipped("retained_outbound");
    await expect(invocation(req, async () => { throw new Error("PRIVATE_APPLICATION_ERROR_SENTINEL"); })).rejects.toThrow("PRIVATE_APPLICATION_ERROR_SENTINEL");
    res.end("PRIVATE_RESPONSE_SENTINEL"); res.emit("finish");
    const allowed = new Set(["version", "procedure", "request_id", "invocation_id", "stage_id", "stage", "event", "outcome", "wall_ms", "acquisitions", "acquisition_coverage", "post_acquisition_db_wall_ms", "acquisition_id", "late", "shared_batch", "context_entry_to_end_ms", "last_inbox_serialize_to_end_shared_ms", "response_bytes", "context_entry_to_terminal_ms", "end_to_terminal_ms"]);
    const snapshot = getCommandChatInboxTimingSnapshot(); expect(snapshot).toStrictEqual(logs);
    for (const record of snapshot) {
      for (const [key, value] of Object.entries(record)) {
        expect(allowed.has(key)).toBe(true); expect(value === null || ["string", "number", "boolean"].includes(typeof value)).toBe(true);
        if (key.endsWith("_id") && value !== null) expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      }
      expect(record.procedure).toBe(inbox);
    }
    expect(JSON.stringify(snapshot)).not.toMatch(/PRIVATE_|fixture-private|untrusted|FAKE_DIAGNOSTIC_SECRET_ONLY/);
  });
});
