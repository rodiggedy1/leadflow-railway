import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { claudeDraftSourceSchema, reviewedClaudeSmsProvenance, smsSenderLabel } from "../shared/smsSenderProvenance";
import { computeSessionSummary } from "./sessionSummary";

// Read, parse, and execute only the actual procedure expressions and identity helper.
// Never import appRouter, routers.ts, trpc middleware, schema, DB, provider, or SSE.
const currentSource = readFileSync(resolve("server/routers.ts"), "utf8");
const baselineSource = execFileSync("git", ["show", "f4e9b8e8179e97e2a91fc1368ffc6a00126ab89d:server/routers.ts"], { encoding: "utf8" });
const parse = (source: string) => ts.createSourceFile("routers.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const currentAst = parse(currentSource), baselineAst = parse(baselineSource);
const NOW = 1_800_000_000_000;
const draft = { requestId: "5c3ad1fa-07ac-4a11-94a9-8a6f56422312", kind: "sms_reply" as const };
const existingHistory = [
  { role: "assistant", content: "Old untagged Claude wording", ts: 20, senderName: "Claude AI" },
  { role: "user", content: "Incoming untouched", ts: 30, media: ["existing-media"] },
];
const leadInput = { sessionId: 71, message: "Original customer text\n edited exactly", fromNumberId: "actual-existing-line" };
const workspaceInput = { phone: "+12025550123", message: leadInput.message, name: "Customer, not staff" };
type ProcedureName = "sendMessage" | "sendWorkspaceMessage";
type Options = {
  sessions?: any[]; dbUnavailable?: boolean; selectError?: string; updateError?: string;
  providerFailure?: string; providerThrows?: string; authError?: string; agentName?: string;
  inactive?: boolean; cookie?: string; voiceInsertError?: boolean;
};
function property(ast: ts.SourceFile, name: string): ts.PropertyAssignment {
  const matches: ts.PropertyAssignment[] = [];
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === name) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (matches.length !== 1) throw new Error(`Expected one actual ${name} property, got ${matches.length}`);
  return matches[0];
}
function identityHelper(ast: ts.SourceFile) {
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "getAgentSessionFromCtx");
  if (!fn) throw new Error("Actual identity helper missing");
  return fn.getText(ast);
}
function expression(ast: ts.SourceFile, name: ProcedureName) {
  const initializer = property(ast, name).initializer;
  const imports: string[] = [];
  const transform = ts.transform(initializer, [(context) => {
    const visitor: ts.Visitor = node => {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        imports.push(node.arguments[0].getText(ast));
        return ts.factory.updateCallExpression(node, ts.factory.createIdentifier("injectedImport"), node.typeArguments, node.arguments);
      }
      return ts.visitEachChild(node, visitor, context);
    };
    return node => ts.visitNode(node, visitor) as ts.Expression;
  }]);
  const text = ts.createPrinter().printNode(ts.EmitHint.Expression, transform.transformed[0], ast);
  transform.dispose();
  expect(imports).toEqual(['"./sseBroadcast"']);
  return text;
}
function evaluate(text: string, injected: Record<string, unknown>) {
  const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return runInNewContext(js, injected, { timeout: 1000 });
}
function harness(ast: ts.SourceFile, name: ProcedureName, options: Options = {}) {
  const trace: any[] = [], writes: any[] = [], inserts: any[] = [];
  const rows = structuredClone(options.sessions ?? [{ id: 71, leadPhone: "+12025550123", leadName: "Customer", stage: "OPEN", messageHistory: JSON.stringify(existingHistory) }]);
  const dedup = new Map<string, number>(), timers: { callback: () => void; ms: number }[] = [];
  const record = (...parts: any[]) => trace.push(structuredClone(parts));
  const table = { id: "session.id", leadPhone: "session.phone", createdAt: "session.createdAt" };
  const opsTable = { id: "ops.id" };
  const predicate = (kind: string) => (...args: any[]) => ({ kind, args });
  const sql = (strings: TemplateStringsArray, ...args: any[]) => ({ kind: "sql", text: Array.from(strings), args });
  const db = {
    select(...args: any[]) {
      record("select", ...args);
      const chain = {
        from(value: any) { record("from", value); return chain; },
        where(value: any) { record("select.where", value); return chain; },
        orderBy(value: any) { record("orderBy", value); return chain; },
        async limit(value: number) { record("limit", value); if (options.selectError) throw new Error(options.selectError); return structuredClone(rows); },
      };
      return chain;
    },
    update(value: any) {
      record("update", value);
      return { set(payload: any) {
        record("set", payload);
        return { async where(condition: any) {
          record("update.where", condition);
          if (options.updateError) throw new Error(options.updateError);
          writes.push(structuredClone(payload));
          const row = rows.find((entry: any) => entry.id === condition.args[1]);
          if (row) Object.assign(row, structuredClone(payload));
          return [{ affectedRows: 1 }];
        } };
      } };
    },
    insert(value: any) {
      record("insert", value);
      return { async values(payload: any) {
        record("values", payload);
        if (value === opsTable && options.voiceInsertError) throw new Error("voice-card-error");
        inserts.push(structuredClone(payload));
        if (value === table) rows.push({ ...structuredClone(payload), id: 501 });
        return [{ insertId: 501 }];
      } };
    },
  };
  class FrozenDate extends Date {
    constructor(value?: any) { super(value === undefined ? NOW : value); }
    static now() { return NOW; }
  }
  const ctx = { req: { headers: { cookie: options.cookie ?? "agent_session_id=actual-cookie" } } };
  const injected: Record<string, any> = {
    z, claudeDraftSourceSchema, reviewedClaudeSmsProvenance, TRPCError,
    conversationSessions: table, opsChatMessages: opsTable, eq: predicate("eq"), or: predicate("or"), desc: predicate("desc"), sql,
    Date: FrozenDate, sendMessageDedup: dedup,
    setTimeout(callback: () => void, ms: number) { record("timer", ms); timers.push({ callback, ms }); },
    async getDb() { record("getDb"); return options.dbUnavailable ? null : db; },
    normalizePhone(phone: string) { record("normalizePhone", phone); const digits = phone.replace(/\D/g, "").slice(-10); return digits.length === 10 ? `+1${digits}` : null; },
    computeSessionSummary(history: any[]) { record("summary", history); return computeSessionSummary(history); },
    async sendSms(payload: any) {
      record("provider", payload);
      if (options.providerThrows) throw new Error(options.providerThrows);
      return options.providerFailure ? { success: false, error: options.providerFailure } : { success: true, messageId: "provider-existing-id" };
    },
    async injectedImport(path: string) {
      record("SSE.import", path);
      if (path !== "./sseBroadcast") throw new Error("Unexpected isolated import");
      return { broadcastOpsUpdate: (...args: any[]) => record("SSE.broadcast", ...args) };
    },
    console: { warn: (...args: any[]) => record("warn", ...args.map(String)), error: (...args: any[]) => record("error", ...args.map(String)) },
    AGENT_COOKIE_NAME: "agent_session_id",
    parseCookie(cookie: string) { return Object.fromEntries(cookie.split(";").map(part => part.trim().split("="))); },
    async verifyAgentSession(token: string) { record("verifyAgentSession", token); return token === "actual-cookie" ? { agentId: 5, agentName: "Stale JWT name", isAdmin: false } : null; },
    async getAgentById(id: number) { record("getAgentById", id); return { id, name: options.agentName ?? "Actual staff", isActive: !options.inactive }; },
    fetch() { throw new Error("OFFLINE_NETWORK_FORBIDDEN"); },
  };
  const actualAuth = evaluate(`${identityHelper(ast)}\ngetAgentSessionFromCtx;`, injected);
  injected.getAgentSessionFromCtx = async (received: unknown) => {
    record("auth");
    expect(received).toBe(ctx);
    if (options.authError) throw new Error(options.authError);
    return actualAuth(received);
  };
  let schema: z.ZodTypeAny | undefined;
  injected.publicProcedure = { input(value: z.ZodTypeAny) {
    schema = value;
    return { mutation(handler: any) { return handler; } };
  } };
  const handler = evaluate(`(${expression(ast, name)});`, injected);
  if (!schema) throw new Error("Actual input schema not captured");
  return {
    schema, trace, writes, inserts, rows, dedup, timers,
    async call(raw: any) {
      try { return { output: await handler({ input: schema!.parse(raw), ctx }) }; }
      catch (error: any) { return { error: { name: error.name, message: error.message, code: error.code } }; }
    },
    snapshot() { return structuredClone({ trace, writes, inserts, rows, dedup: [...dedup], timers: timers.map(timer => timer.ms) }); },
  };
}
async function compare(name: ProcedureName, raw: any, options: Options = {}) {
  const control = harness(baselineAst, name, options), candidate = harness(currentAst, name, options);
  const before = await control.call(raw), after = await candidate.call(raw);
  expect(after).toEqual(before);
  expect(JSON.stringify(candidate.snapshot())).toBe(JSON.stringify(control.snapshot()));
  return { control, candidate, result: after };
}
const events = (test: ReturnType<typeof harness>) => test.trace.map(event => event[0]);
const lastMessage = (test: ReturnType<typeof harness>) => JSON.parse(test.writes[0].messageHistory).at(-1);

for (const name of ["sendMessage", "sendWorkspaceMessage"] as const) {
  describe(`${name}: actual input contract`, () => {
    const input = name === "sendMessage" ? leadInput : workspaceInput;
    it("adds just one optional draft-source field while preserving every old schema expression", () => {
      const old = harness(baselineAst, name), added = harness(currentAst, name);
      expect(Object.keys((added.schema as any).shape)).toEqual([...Object.keys((old.schema as any).shape), "claudeDraftSource"]);
      for (const value of [input, { ...input, message: "x".repeat(1600) }, { ...input, legacyUnknown: true }]) {
        expect(added.schema.parse(value)).toEqual(old.schema.parse(value));
      }
      const schemaText = (ast: ts.SourceFile) => {
        const mutation = property(ast, name).initializer as ts.CallExpression;
        const inputCall = (mutation.expression as ts.PropertyAccessExpression).expression as ts.CallExpression;
        return inputCall.arguments[0].getText(ast).replace(/^\s*claudeDraftSource: claudeDraftSourceSchema.optional\(\),\n/m, "");
      };
      expect(schemaText(currentAst)).toBe(schemaText(baselineAst));
    });
    it.each([null, {}, { ...draft, requestId: "not-a-uuid" }, { ...draft, kind: "automatic" },
      { ...draft, mode: "automatic" }, { ...draft, senderName: "Spoof" }, { ...draft, smsProvenance: { mode: "automatic" } },
      { ...draft, reviewedBy: "Spoof" }, { ...draft, providerMessageId: "fake-id" }, "automatic"])("rejects invalid new metadata %# before any sender side effects", async source => {
      const test = harness(currentAst, name);
      const result = await test.call({ ...input, claudeDraftSource: source });
      expect(result.error?.name).toBe("ZodError");
      expect(test.trace).toEqual([]);
      expect(harness(baselineAst, name).schema.safeParse({ ...input, claudeDraftSource: source }).success).toBe(true);
    });
    it.each([{ message: "" }, { message: "x".repeat(1601) }, { message: 4 }])("preserves invalid original message validation %#", patch => {
      const old = harness(baselineAst, name).schema.safeParse({ ...input, ...patch });
      const added = harness(currentAst, name).schema.safeParse({ ...input, ...patch });
      expect(added.success).toBe(old.success);
      if (!old.success && !added.success) expect(added.error.issues).toEqual(old.error.issues);
    });
    it("ignores arbitrary client sender and automatic provenance as before; cannot manufacture a label", async () => {
      const test = harness(currentAst, name);
      expect((await test.call({ ...input, senderName: "Claude AI", smsProvenance: { version: 1, generator: "claude", mode: "automatic", receiptId: 9, providerMessageId: "spoof" } })).output).toBeTruthy();
      expect(lastMessage(test)).not.toHaveProperty("smsProvenance");
      expect(smsSenderLabel(lastMessage(test), "Existing fallback")).not.toContain("Claude draft");
      expect(lastMessage(test).senderName).toBe(name === "sendMessage" ? "Actual staff" : undefined);
    });
    it.each(["initial_lead", "sms_reply"] as const)("reviewed %s preserves actual staff, exact customer text and existing provider line", async kind => {
      const ordinary = harness(currentAst, name), reviewed = harness(currentAst, name);
      const originalResult = await ordinary.call(input);
      expect(await reviewed.call({ ...input, claudeDraftSource: { ...draft, kind }, senderName: "Fake staff", name: "Customer, not staff" })).toEqual(originalResult);
      const message = lastMessage(reviewed);
      expect(message).toEqual({ role: "assistant", content: input.message, ts: NOW, senderName: "Actual staff",
        smsProvenance: { version: 1, generator: "claude", mode: "human_reviewed", requestId: draft.requestId, kind, reviewedBy: "Actual staff" } });
      expect(reviewed.trace.filter(event => event[0] === "provider")).toEqual(ordinary.trace.filter(event => event[0] === "provider"));
      expect(JSON.parse(reviewed.writes[0].messageHistory).slice(0, -1)).toEqual(existingHistory);
      expect(smsSenderLabel(message, "Existing fallback")).toBe("Actual staff · Claude draft");
      expect(smsSenderLabel(JSON.parse(reviewed.rows[0].messageHistory).at(-1), "Existing fallback")).toBe("Actual staff · Claude draft");
      expect(smsSenderLabel(existingHistory[0], "Existing fallback")).toBe("Claude AI");
      expect(smsSenderLabel(existingHistory[1], "Customer")).toBe("Customer");
      expect(events(reviewed).filter(event => !["auth", "verifyAgentSession", "getAgentById"].includes(event))).toEqual(events(ordinary).filter(event => !["auth", "verifyAgentSession", "getAgentById"].includes(event)));
    });
  });
}

describe("sendMessage: byte-exact ordinary baseline and protected side effects", () => {
  it.each([
    ["normal existing line", leadInput, {}],
    ["default line", { sessionId: 71, message: "Default line text" }, {}],
    ["CS reactivation and voice card", { ...leadInput, source: "cs_inbox", isVoiceCommand: true }, {}],
    ["voice card failure is swallowed", { ...leadInput, isVoiceCommand: true }, { voiceInsertError: true }],
    ["false provider result stores history and returns false", leadInput, { providerFailure: "provider-rejected" }],
    ["provider exception after history save", leadInput, { providerThrows: "provider-threw" }],
    ["database unavailable", leadInput, { dbUnavailable: true }],
    ["session not found", leadInput, { sessions: [] }],
    ["malformed existing history", leadInput, { sessions: [{ id: 71, leadPhone: "+12025550123", stage: "OPEN", messageHistory: "broken" }] }],
    ["read failure", leadInput, { selectError: "read-error" }],
    ["write failure prevents provider", leadInput, { updateError: "write-error" }],
    ["missing auth preserves failure", leadInput, { cookie: "" }],
    ["inactive auth preserves failure", leadInput, { inactive: true }],
  ] as [string, any, Options][])("%s", async (_title, input, options) => { await compare("sendMessage", input, options); });
  it("stores before provider, preserves summary/read/CS/voice/SSE order and exact output", async () => {
    const { candidate, result } = await compare("sendMessage", { ...leadInput, source: "cs_inbox", isVoiceCommand: true });
    expect(result.output).toEqual({ success: true, smsSent: true });
    expect(events(candidate)).toEqual(["auth", "verifyAgentSession", "getAgentById", "getDb", "timer", "select", "from", "select.where", "limit", "summary", "update", "set", "update.where", "provider", "update", "set", "update.where", "SSE.import", "SSE.broadcast", "insert", "values", "SSE.broadcast"]);
    expect(lastMessage(candidate)).toEqual({ role: "assistant", content: leadInput.message, ts: NOW, senderName: "Actual staff" });
    expect(candidate.writes[0].lastReadAt).toEqual({ kind: "sql", text: ["lastCustomerReplyAt"], args: [] });
    expect(candidate.writes[1]).toEqual({ csQueue: "CS", csResolvedAt: null });
  });
  it.each([{}, { claudeDraftSource: draft }])("keeps duplicate lock/key/output and timeout expiration unchanged %#", async attribution => {
    const old = harness(baselineAst, "sendMessage"), added = harness(currentAst, "sendMessage");
    expect(await added.call({ ...leadInput, ...attribution })).toEqual(await old.call(leadInput));
    const beforeOld = old.trace.length, beforeNew = added.trace.length;
    expect(await added.call({ ...leadInput, ...attribution })).toEqual(await old.call(leadInput));
    expect(added.trace.slice(beforeNew)).toEqual(old.trace.slice(beforeOld));
    expect(added.dedup).toEqual(old.dedup);
    expect(added.writes).toHaveLength(1);
    expect(added.trace.filter(event => event[0] === "provider")).toHaveLength(1);
    expect(added.timers[0].ms).toBe(15_000);
    added.timers[0].callback(); old.timers[0].callback();
    expect(added.dedup).toEqual(old.dedup);
    expect(added.dedup.size).toBe(0);
  });
  it("reviewed provider false retains the existing stored-message false return, not a new success/block", async () => {
    const test = harness(currentAst, "sendMessage", { providerFailure: "provider-rejected" });
    expect(await test.call({ ...leadInput, claudeDraftSource: draft })).toEqual({ output: { success: true, smsSent: false } });
    expect(lastMessage(test).smsProvenance.mode).toBe("human_reviewed");
    expect(events(test).indexOf("update.where")).toBeLessThan(events(test).indexOf("provider"));
  });
  it.each([{ cookie: "" }, { inactive: true }, { authError: "auth-service-failed" }])("reviewed input never bypasses existing auth failure %#", async options => {
    const ordinary = harness(baselineAst, "sendMessage", options), tagged = harness(currentAst, "sendMessage", options);
    expect(await tagged.call({ ...leadInput, claudeDraftSource: draft })).toEqual(await ordinary.call(leadInput));
    expect(tagged.snapshot()).toEqual(ordinary.snapshot());
    expect(tagged.writes).toEqual([]);
  });
  it.each([{ sessionId: -1 }, { sessionId: 1.5 }, { fromNumberId: 2 }, { source: "other" }, { isVoiceCommand: "yes" }])("keeps old lead parameter rejection identical %#", patch => {
    const before = harness(baselineAst, "sendMessage").schema.safeParse({ ...leadInput, ...patch });
    const after = harness(currentAst, "sendMessage").schema.safeParse({ ...leadInput, ...patch });
    expect(before.success).toBe(false); expect(after.success).toBe(false);
    if (!before.success && !after.success) expect(after.error.issues).toEqual(before.error.issues);
  });
});

describe("sendWorkspaceMessage: ordinary byte-shape, authority and protected errors/order", () => {
  it.each([
    ["ordinary customer, no new auth", {}],
    ["public unauthenticated ordinary send unchanged", { cookie: "" }],
    ["new customer existing creation path", { sessions: [] }],
    ["malformed history", { sessions: [{ id: 71, leadPhone: "+12025550123", stage: "OPEN", messageHistory: "broken" }] }],
    ["provider failure throws before history", { providerFailure: "provider-rejected" }],
    ["provider exception", { providerThrows: "provider-threw" }],
    ["new customer provider failure preserves creation", { sessions: [], providerFailure: "provider-rejected" }],
    ["DB unavailable", { dbUnavailable: true }],
    ["select failure", { selectError: "read-error" }],
    ["write failure after provider", { updateError: "write-error" }],
    ["canonical skips review/hiring without mutations", { sessions: [
      { id: 91, stage: "REVIEW_REQUESTED", leadPhone: "+12025550123", messageHistory: "[]" },
      { id: 92, stage: "INTERVIEW_NUDGE_1", leadPhone: "+12025550123", messageHistory: "[]" },
      { id: 71, stage: "OPEN", leadPhone: "+12025550123", messageHistory: JSON.stringify(existingHistory) },
    ] }],
    ["canonical existing fallback", { sessions: [{ id: 91, stage: "REVIEW_DONE", leadPhone: "+12025550123", messageHistory: "[]" }] }],
  ] as [string, Options][])("%s", async (_title, options) => { const { candidate } = await compare("sendWorkspaceMessage", workspaceInput, options); expect(events(candidate)).not.toContain("auth"); });
  it("ordinary workspace stores exact old history shape after fixed-line provider acceptance", async () => {
    const { candidate, result } = await compare("sendWorkspaceMessage", workspaceInput);
    expect(result.output).toEqual({ success: true, ts: NOW, sessionId: 71 });
    expect(events(candidate)).toEqual(["getDb", "normalizePhone", "select", "from", "select.where", "orderBy", "limit", "provider", "update", "summary", "set", "update.where", "update", "set", "update.where", "SSE.import", "SSE.broadcast"]);
    expect(lastMessage(candidate)).toEqual({ role: "assistant", content: workspaceInput.message, ts: NOW });
    expect(candidate.trace.find(event => event[0] === "provider")).toEqual(["provider", { to: workspaceInput.phone, content: workspaceInput.message, fromNumberId: "PN0wVLcpCq" }]);
    expect(candidate.writes[0].lastReadAt).toBe(NOW);
  });
  it.each([{ cookie: "" }, { inactive: true }, { authError: "auth-service-failed" }, { agentName: " " }])("requested attribution failure %# omits both metadata and sender without blocking or altering ordinary send", async options => {
    const ordinary = harness(baselineAst, "sendWorkspaceMessage", options), tagged = harness(currentAst, "sendWorkspaceMessage", options);
    expect(await tagged.call({ ...workspaceInput, claudeDraftSource: draft })).toEqual(await ordinary.call(workspaceInput));
    expect(tagged.writes).toEqual(ordinary.writes);
    expect(tagged.rows).toEqual(ordinary.rows);
    expect(lastMessage(tagged)).not.toHaveProperty("senderName");
    expect(lastMessage(tagged)).not.toHaveProperty("smsProvenance");
    const filtered = tagged.snapshot();
    filtered.trace = filtered.trace.filter((event: any[]) => !["auth", "verifyAgentSession", "getAgentById"].includes(event[0]));
    expect(filtered).toEqual(ordinary.snapshot());
  });
  it("attributed new-customer send preserves customer name and all existing insertion fields", async () => {
    const ordinary = harness(baselineAst, "sendWorkspaceMessage", { sessions: [] }), tagged = harness(currentAst, "sendWorkspaceMessage", { sessions: [] });
    expect(await tagged.call({ ...workspaceInput, claudeDraftSource: draft })).toEqual(await ordinary.call(workspaceInput));
    expect(tagged.inserts).toEqual(ordinary.inserts);
    expect(tagged.inserts[0].leadName).toBe(workspaceInput.name);
    expect(lastMessage(tagged).senderName).toBe("Actual staff");
    expect(lastMessage(tagged).smsProvenance.reviewedBy).toBe("Actual staff");
  });
  it.each([{ providerFailure: "provider-rejected" }, { providerThrows: "provider-threw" }, { dbUnavailable: true }, { selectError: "read-error" }])("reviewed source leaves pre-append failures %# identical, without identity lookup", async options => {
    const before = harness(baselineAst, "sendWorkspaceMessage", options), after = harness(currentAst, "sendWorkspaceMessage", options);
    expect(await after.call({ ...workspaceInput, claudeDraftSource: draft })).toEqual(await before.call(workspaceInput));
    expect(after.snapshot()).toEqual(before.snapshot());
    expect(after.writes).toEqual([]);
    expect(events(after)).not.toContain("auth");
  });
  it.each([{ phone: "short" }, { phone: 123 }, { name: 4 }])("keeps old workspace parameter rejection identical %#", patch => {
    const before = harness(baselineAst, "sendWorkspaceMessage").schema.safeParse({ ...workspaceInput, ...patch });
    const after = harness(currentAst, "sendWorkspaceMessage").schema.safeParse({ ...workspaceInput, ...patch });
    expect(before.success).toBe(false); expect(after.success).toBe(false);
    if (!before.success && !after.success) expect(after.error.issues).toEqual(before.error.issues);
  });
});

describe("source-level scope proof", () => {
  it("leaves the entire inherited router byte-identical outside the two send procedures and the required import", () => {
    let restored = currentSource;
    const replacements = (["sendMessage", "sendWorkspaceMessage"] as const).map(name => ({
      node: property(currentAst, name), control: property(baselineAst, name).getText(baselineAst),
    })).sort((a, b) => b.node.getStart(currentAst) - a.node.getStart(currentAst));
    for (const { node, control } of replacements) {
      restored = restored.slice(0, node.getStart(currentAst)) + control + restored.slice(node.end);
    }
    restored = restored.replace("import { claudeDraftSourceSchema, reviewedClaudeSmsProvenance, type SmsSenderProvenance } from '../shared/smsSenderProvenance';\n", "");
    expect(restored).toBe(baselineSource);
  });
  it("preserves the actual identity helper byte-for-byte and every provider call", () => {
    expect(identityHelper(currentAst)).toBe(identityHelper(baselineAst));
    for (const name of ["sendMessage", "sendWorkspaceMessage"] as const) {
      const calls = (ast: ts.SourceFile) => {
        const found: string[] = [];
        function visit(node: ts.Node) {
          if (ts.isCallExpression(node) && node.expression.getText(ast) === "sendSms") found.push(node.getText(ast));
          ts.forEachChild(node, visit);
        }
        visit(property(ast, name));
        return found;
      };
      expect(calls(currentAst)).toEqual(calls(baselineAst));
    }
  });
  it("contains no new data-table dependency in the added sender hunks", () => {
    const beforeLines = new Set(baselineSource.split("\n"));
    const added = currentSource.split("\n").filter(line => !beforeLines.has(line)).join("\n");
    expect(added).not.toMatch(/cleaner[_]?jobs/i);
    expect(added).not.toMatch(/automaticClaudeSmsProvenance|providerMessageId|receiptId/);
  });
});
