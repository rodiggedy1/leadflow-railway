import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizePhoneLegacy } from "./utils/phone";
import { claudeCustomerSmsConfig, customerSmsInstant, isClaudeCustomerSmsPilotPhone, isClaudeCustomerSmsPilotCustomerOverride } from "./instinct/claudeCustomerSms";

const source = readFileSync(new URL("./webhooks.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("webhooks.ts", source, ts.ScriptTarget.Latest, true);
function actualFunction(name: string): string {
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!node) throw new Error(`Missing actual function ${name}`);
  return node.getText(ast);
}
function webhookCallback(): string {
  let callback: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "app.post"
      && node.arguments[0]?.getText(ast) === '"/api/webhooks/openphone"') callback = node.arguments[1];
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!callback) throw new Error("Missing actual OpenPhone webhook");
  return callback.getText(ast);
}
// Compile only these actual functions; never import the monolith or start Express.
// Every dynamic import, DB read/write, timer, provider or model seam is mocked.
const executable = ts.transpileModule([
  actualFunction("isClaudeCustomerSmsPilotEvent"),
  actualFunction("dispatchPersistedClaudeCustomerSms"), "const csMessageDedup = new Map();",
  actualFunction("handleCsInboundMessage"),
  "globalThis.runCs = handleCsInboundMessage;",
  `globalThis.runWebhook = ${webhookCallback()};`,
].join("\n").replaceAll("import(", "testImport("),
{ compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;

const receivedAt = Date.parse("2026-11-16T18:00:01.000Z");
const originalCreatedAt = "2026-11-16T18:00:00.000Z";
function message(overrides: Record<string, unknown> = {}) {
  return { id: "provider-original", from: "+12025550123", to: ["+12025550999"],
    text: "Please change my cleaning to Friday", direction: "incoming", phoneNumberId: "PN-cs",
    createdAt: originalCreatedAt, ...overrides };
}
type FixtureOptions = { existing?: Record<string, any> | null; hiring?: Record<string, any> | null;
  cleaner?: boolean; failWrite?: boolean; insertId?: number | null; disabled?: boolean; dispatchThrows?: boolean; override?: boolean; missingAllowedPhone?: boolean };
function fixture(options: FixtureOptions = {}, nonCs = false) {
  const existing = options.existing === undefined ? { id: 42, leadSource: nonCs ? "bark-sms" : "cs-inbound", leadName: "Maya", stage: "OPEN", messageHistory: "[]" } : options.existing;
  const operations: Array<{ operation: string; table?: string; payload?: any; target?: any }> = [];
  const dispatch = vi.fn(async (input: unknown) => { operations.push({ operation: "dispatch", payload: input }); if (options.dispatchThrows) throw new Error("mock failure"); });
  const madison = vi.fn(async (input: unknown) => { operations.push({ operation: "legacy-draft", payload: input }); });
  const broadcast = vi.fn();
  const selects: any[][] = nonCs ? [existing ? [existing] : [], ...(options.cleaner ? [[{ name: "Staff" }]] : [[]])] : [
    options.cleaner ? [{ name: "Cleaner" }] : [],
    ...(options.cleaner ? [] : [[{ name: "Maya" }]]),
    existing ? [existing] : [],
    ...(existing ? [{ messageHistory: existing.messageHistory ?? "[]" }].map(row => [row]) : [options.hiring ? [options.hiring] : [], ...(options.hiring ? [[{ messageHistory: options.hiring.messageHistory ?? "[]" }]] : []), [{ id: 999 }]]),
  ];
  const db = {
    select: vi.fn(() => {
      const rows = selects.shift() ?? [];
      const chain: any = { from: (table: any) => { operations.push({ operation: "read", table: table.__name }); return chain; },
        where: () => chain, orderBy: () => chain, limit: async () => rows };
      return chain;
    }),
    update: vi.fn((table: any) => ({ set: (payload: any) => ({ where: async (target: any) => {
      operations.push({ operation: "update", table: table.__name, payload, target });
      if (options.failWrite && payload.messageHistory) throw new Error("mock write failed");
      return [{ affectedRows: 1 }];
    } }) })),
    insert: vi.fn((table: any) => ({ values: async (payload: any) => {
      operations.push({ operation: "insert", table: table.__name, payload });
      if (options.failWrite && payload.messageHistory) throw new Error("mock insert failed");
      return [{ insertId: options.insertId === undefined ? 77 : options.insertId }];
    } })),
    execute: vi.fn(async () => []),
  };
  const testImport = vi.fn(async (path: string) => {
    if (path === "./instinct/claudeCustomerSmsApplication") return { dispatchClaudeCustomerSms: dispatch };
    if (path === "./madisonSmsAgent") return { triggerMadisonSmsDraft: madison };
    if (path === "./sseBroadcast") return { broadcastOpsUpdate: broadcast };
    throw new Error(`Unexpected import ${path}`);
  });
  const env = options.disabled ? {} : { CLAUDE_CUSTOMER_SMS_ENABLED: "true", CLAUDE_CUSTOMER_SMS_START_AT: "2026-11-16T17:59:00Z",
    ...(!options.missingAllowedPhone ? { CLAUDE_CUSTOMER_SMS_ALLOWED_PHONE: "+12025550123" } : {}),
    ...(options.override ? { CLAUDE_CUSTOMER_SMS_TEST_CUSTOMER_OVERRIDE: "true" } : {}) };
  const sandbox: Record<string, any> = {
    process: { env },
    claudeCustomerSmsConfig: () => claudeCustomerSmsConfig(env), customerSmsInstant,
    isClaudeCustomerSmsPilotPhone: (phone: string) => isClaudeCustomerSmsPilotPhone(phone, env),
    isClaudeCustomerSmsPilotCustomerOverride: (phone: string) => isClaudeCustomerSmsPilotCustomerOverride(phone, env),
    Date: class extends Date { static now() { return receivedAt; } },
    console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() }, setTimeout: vi.fn(), setImmediate: vi.fn(),
    getDb: vi.fn(async () => db), testImport,
    getInboundPhoneNumberId: (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null,
    normalizePhone: normalizePhoneLegacy,
    eq: (column: any, value: any) => ({ column, value }), and: (...args: unknown[]) => args,
    or: (...args: unknown[]) => args, sql: (...args: unknown[]) => args, desc: (x: unknown) => x,
    inArray: (...args: unknown[]) => args, isNull: (...args: unknown[]) => args, ne: (...args: unknown[]) => args,
    computeSessionSummary: () => ({}), enqueueScoring: vi.fn(), syncAllOutboundMessages: vi.fn(async () => ({})),
    tryDetectCleanerRunningLate: vi.fn(async () => undefined), tryAdvanceGetEtaMission: vi.fn(async () => undefined),
    tryStoreJobSmsReply: vi.fn(async () => undefined), tryHandleCleanerRatingReply: vi.fn(async () => undefined),
    tryHandleConfirmationSmsReply: vi.fn(async () => undefined), markReactivationContactReplied: vi.fn(async () => undefined),
    markAlwaysOnContactReplied: vi.fn(async () => null), sendPushToAll: vi.fn(async () => undefined), logActivity: vi.fn(async () => undefined),
    ENV: { openPhoneCsNumberId: "PN-cs", openPhoneNumberId: "PN-leads", openPhoneBarkNumberId: "PN-bark" },
  };
  // Supply inert schema symbols imported by the source, without importing any DB.
  for (const node of ast.statements) {
    if (!ts.isImportDeclaration(node) || node.moduleSpecifier.getText(ast) !== '"../drizzle/schema"') continue;
    const bindings = node.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
      const name = item.name.text;
      sandbox[name] = new Proxy({ __name: name }, { get: (object, field) => field === "__name" ? object.__name : `${name}.${String(field)}` });
    }
  }
  vm.createContext(sandbox); vm.runInContext(executable, sandbox);
  return { dispatch, madison, operations, db, testImport,
    runCs: (msg: unknown) => sandbox.runCs(msg) as Promise<void>,
    runWebhook: (msg: unknown, type = "message.received") => sandbox.runWebhook({ body: { type, data: { object: msg } } }, { status: () => ({ json: vi.fn() }) }) as Promise<void> };
}
afterEach(() => vi.restoreAllMocks());

describe("actual webhook additive customer dispatch provenance", () => {
  it.each(["PN-cs", "PN-leads"])("covers actual receiving %s regardless of inbound source through CS intercept", async phoneNumberId => {
    const h = fixture(); await h.runWebhook(message({ phoneNumberId }));
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.dispatch).toHaveBeenCalledWith({ sessionId: 42, providerMessageId: "provider-original", fromPhone: "+12025550123",
      receivingPhoneNumberId: phoneNumberId, inboundText: "Please change my cleaning to Friday", createdAt: originalCreatedAt,
      receivedAt, isCleaner: false, direction: "incoming" });
    expect(h.madison).not.toHaveBeenCalled();
    expect(h.operations.findIndex(op => op.operation === "dispatch")).toBeGreaterThan(h.operations.findIndex(op => op.operation === "update" && op.payload.messageHistory));
    expect(h.testImport.mock.calls.flat()).not.toContain("./madisonSmsAgent");
  });

  it("uses new CS insert ID, never the unrelated later newest-phone fallback ID", async () => {
    const h = fixture({ existing: null }); await h.runCs(message());
    expect(h.dispatch.mock.calls[0][0]).toMatchObject({ sessionId: 77 });
    expect(h.madison).not.toHaveBeenCalled();
    const write = h.operations.find(op => op.operation === "insert" && op.payload.messageHistory)!;
    expect(JSON.parse(write.payload.messageHistory)[0]).toMatchObject({ opMsgId: "provider-original", receivingPhoneNumberId: "PN-cs" });
  });

  it("never treats a persisted hiring row as a customer", async () => {
    const h = fixture({ existing: null, hiring: { id: 88, messageHistory: "[]", leadSource: "hiring_interview" } }); await h.runCs(message());
    expect(h.operations.find(op => op.operation === "update" && op.payload.messageHistory)?.target).toMatchObject({ value: 88 });
    expect(h.dispatch).not.toHaveBeenCalled(); expect(h.madison).not.toHaveBeenCalled();
  });

  it.each([undefined, "", null])("does not dispatch synthetic/missing provider IDs %j but preserves existing drafts", async id => {
    const h = fixture(); await h.runCs(message({ id }));
    expect(h.dispatch).not.toHaveBeenCalled(); expect(h.madison).toHaveBeenCalledTimes(id === "" ? 0 : 1);
  });

  it.each([undefined, "", null])("does not substitute a default receiving ID for %j", async phoneNumberId => {
    const h = fixture(); await h.runCs(message({ phoneNumberId })); expect(h.dispatch).not.toHaveBeenCalled();
  });

  it.each([undefined, "outgoing", "unknown"])("requires positive incoming direction %j for new dispatch", async direction => {
    const h = fixture(); await h.runCs(message({ direction })); expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.madison).toHaveBeenCalledTimes(1);
  });

  it("excludes trustworthy cleaner identity while retaining existing inbound behavior", async () => {
    const h = fixture({ cleaner: true }); await h.runCs(message());
    expect(h.dispatch).not.toHaveBeenCalled(); expect(h.madison).not.toHaveBeenCalled();
  });

  it.each([{ csQueue: "Teams" }, { stage: "INTERVIEW_LINK_SENT" }, { stage: "SCHEDULE_CONFIRM_SENT" }])("excludes noncustomer saved session flags %j", async flags => {
    const h = fixture({ existing: { id: 42, leadSource: "cs-inbound", messageHistory: "[]", ...flags } });
    await h.runCs(message()); expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("failed persistence never dispatches or creates a customer reply", async () => {
    const h = fixture({ failWrite: true }); await expect(h.runCs(message())).rejects.toThrow("mock write failed");
    expect(h.dispatch).not.toHaveBeenCalled(); expect(h.madison).not.toHaveBeenCalled();
  });

  it.each([0, null])("missing/invalid actual insert ID %j never dispatches", async insertId => {
    const h = fixture({ existing: null, insertId }); await h.runCs(message()); expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("a duplicate actual provider delivery remains dropped before the hook", async () => {
    const h = fixture(); const msg = message(); await h.runCs(msg); await h.runCs(msg);
    expect(h.dispatch).toHaveBeenCalledTimes(1); expect(h.madison).not.toHaveBeenCalled();
  });

  it("capability off does no new imports/reads and keeps the original draft payload", async () => {
    const h = fixture({ disabled: true }); await h.runCs(message());
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.testImport.mock.calls.flat()).not.toContain("./instinct/claudeCustomerSmsApplication");
    expect(h.madison).toHaveBeenCalledTimes(1);
    expect(h.madison).toHaveBeenCalledWith({ inboundOpenPhoneId: "provider-original", sessionId: 42,
      fromPhone: "+12025550123", senderName: "Maya", isCleaner: false, inboundText: "Please change my cleaning to Friday" });
  });

  it("pilot dispatch failure cannot fall back to a competing native reply", async () => {
    const h = fixture({ dispatchThrows: true }); await h.runCs(message());
    expect(h.dispatch).toHaveBeenCalledTimes(1); expect(h.madison).not.toHaveBeenCalled();
  });
  it.each([{ from: "+12025559876" }, { createdAt: "2026-11-15T18:00:00Z" }, { text: "STOP" }])("preserves native drafting for nonpilot, old, or opt-out input %#", async overrides => {
    const h = fixture(); await h.runCs(message(overrides));
    if (overrides.from) expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.madison).toHaveBeenCalledTimes(1);
  });
  it("missing pilot phone cannot import the new application and preserves existing handling", async () => {
    const h = fixture({ missingAllowedPhone: true }); await h.runCs(message());
    expect(h.dispatch).not.toHaveBeenCalled(); expect(h.madison).toHaveBeenCalledTimes(1);
    expect(h.testImport.mock.calls.flat()).not.toContain("./instinct/claudeCustomerSmsApplication");
  });
  it("only the approved test role bypass admits an exact persisted cleaner/Teams session without rewriting its role", async () => {
    const h = fixture({ cleaner: true, override: true, existing: { id: 42, leadSource: "cs-inbound-cleaner", csQueue: "Teams", stage: "OPEN", messageHistory: "[]" } });
    await h.runCs(message()); expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 42, isCleaner: true }));
    const update = h.operations.find(op => op.operation === "update" && op.payload.messageHistory)!;
    expect(update.payload).not.toHaveProperty("leadSource"); expect(update.payload).not.toHaveProperty("csQueue");
    expect(h.madison).not.toHaveBeenCalled();
  });

  it.each([false, true])("covers exact existing/new Bark session, new=%s", async isNew => {
    const h = fixture({ existing: isNew ? null : undefined }, true); await h.runWebhook(message({ phoneNumberId: "PN-bark" }));
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({ sessionId: isNew ? 77 : 42,
      providerMessageId: "provider-original", receivingPhoneNumberId: "PN-bark", createdAt: originalCreatedAt, receivedAt, direction: "incoming", isCleaner: false }));
    const persisted = h.operations.find(op => ["insert", "update"].includes(op.operation) && op.payload?.messageHistory)!;
    expect(JSON.parse(persisted.payload.messageHistory)[0]).toMatchObject({ opMsgId: "provider-original", receivingPhoneNumberId: "PN-bark" });
    expect(persisted.payload.lastInboundPhoneNumberId).toBe("PN-bark");
  });

  it("Bark-only line uses the staff directory before customer dispatch", async () => {
    const h = fixture({ cleaner: true }, true); await h.runWebhook(message({ phoneNumberId: "PN-bark" }));
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it.each(["message.delivered", "message.updated", "message.sent"])("delivery/system event %s never reaches the new hook", async type => {
    const h = fixture(); await h.runWebhook(message({ direction: "outgoing" }), type); expect(h.dispatch).not.toHaveBeenCalled();
  });
});
