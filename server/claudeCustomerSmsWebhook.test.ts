import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizePhoneLegacy } from "./utils/phone";
import { claudeCustomerSmsConfig, customerSmsInstant, isClaudeCustomerSmsPilotPhone, isClaudeCustomerSmsPhoneEligible, isClaudeCustomerSmsPilotCustomerOverride, logClaudeCustomerSmsDiagnostic } from "./instinct/claudeCustomerSms";

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
  cleaner?: boolean; failWrite?: boolean; insertId?: number | null; disabled?: boolean; dispatchThrows?: boolean; override?: boolean; missingAllowedPhone?: boolean;
  allCustomers?: boolean; dispatchOutcome?: "accepted" | "excluded" | "disabled" | "failed" | "duplicate" | "suppressed" | "uncertain" };
function fixture(options: FixtureOptions = {}, nonCs = false) {
  const existing = options.existing === undefined ? { id: 42, leadSource: nonCs ? "bark-sms" : "cs-inbound", leadName: "Maya", stage: "OPEN", messageHistory: "[]" } : options.existing;
  const operations: Array<{ operation: string; table?: string; payload?: any; target?: any }> = [];
  const persistedHistories = new Map<number, string>();
  if (existing) persistedHistories.set(existing.id, existing.messageHistory ?? "[]");
  const dispatchSnapshots: Array<{ sessionId: number; history: any[] }> = [];
  const dispatch = vi.fn(async (input: any) => {
    operations.push({ operation: "dispatch", payload: input });
    dispatchSnapshots.push({ sessionId: input.sessionId, history: JSON.parse(persistedHistories.get(input.sessionId) ?? "[]") });
    if (options.dispatchThrows) throw new Error("mock failure"); return { outcome: options.dispatchOutcome ?? "accepted" };
  });
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
      if (payload.messageHistory) persistedHistories.set(target.value, payload.messageHistory);
      return [{ affectedRows: 1 }];
    } }) })),
    insert: vi.fn((table: any) => ({ values: async (payload: any) => {
      operations.push({ operation: "insert", table: table.__name, payload });
      if (options.failWrite && payload.messageHistory) throw new Error("mock insert failed");
      if (payload.messageHistory) persistedHistories.set(options.insertId === undefined ? 77 : options.insertId!, payload.messageHistory);
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
    ...(options.allCustomers ? { CLAUDE_CUSTOMER_SMS_SCOPE: "all_customers" } : {}),
    ...(options.override ? { CLAUDE_CUSTOMER_SMS_TEST_CUSTOMER_OVERRIDE: "true" } : {}) };
  const sandbox: Record<string, any> = {
    process: { env },
    claudeCustomerSmsConfig: () => claudeCustomerSmsConfig(env), customerSmsInstant,
    isClaudeCustomerSmsPilotPhone: (phone: string) => isClaudeCustomerSmsPilotPhone(phone, env),
    isClaudeCustomerSmsPhoneEligible: (phone: string) => isClaudeCustomerSmsPhoneEligible(phone, env),
    isClaudeCustomerSmsPilotCustomerOverride: (phone: string) => isClaudeCustomerSmsPilotCustomerOverride(phone, env),
    logClaudeCustomerSmsDiagnostic,
    Date: class extends Date { static now() { return receivedAt; } },
    console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() }, setTimeout: vi.fn(), setImmediate: vi.fn(),
    getDb: vi.fn(async () => db), testImport,
    getInboundPhoneNumberId: (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null,
    normalizePhone: normalizePhoneLegacy,
    eq: (column: any, value: any) => ({ column, value }), and: (...args: unknown[]) => args,
    or: (...args: unknown[]) => args, sql: (...args: unknown[]) => args, desc: (x: unknown) => x,
    inArray: (...args: unknown[]) => args, isNull: (...args: unknown[]) => args, ne: (...args: unknown[]) => args,
    computeSessionSummary: () => ({}), enqueueScoring: vi.fn(), syncAllOutboundMessages: vi.fn(async (phone: string, sessionId: number) => {
      operations.push({ operation: "sync-complete", payload: { phone, sessionId } }); return {};
    }),
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
  return { dispatch, dispatchSnapshots, persistedHistories, madison, operations, db, testImport, sandbox,
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

  it("dispatches the exact persisted hiring row without changing its classification", async () => {
    const h = fixture({ existing: null, hiring: { id: 88, messageHistory: "[]", leadSource: "hiring_interview" } }); await h.runCs(message());
    expect(h.operations.find(op => op.operation === "update" && op.payload.messageHistory)?.target).toMatchObject({ value: 88 });
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 88, isCleaner: true })); expect(h.madison).not.toHaveBeenCalled();
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

  it("responds to a known cleaner while retaining the existing saved classification", async () => {
    const h = fixture({ cleaner: true }); await h.runCs(message());
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 42, isCleaner: true })); expect(h.madison).not.toHaveBeenCalled();
  });

  it.each([{ csQueue: "Teams" }, { stage: "INTERVIEW_LINK_SENT" }, { stage: "SCHEDULE_CONFIRM_SENT" }, { leadSource: "staff" }, { leadSource: "internal" }])("responds regardless of saved classification %j", async flags => {
    const h = fixture({ existing: { id: 42, leadSource: "cs-inbound", messageHistory: "[]", ...flags } });
    await h.runCs(message()); expect(h.dispatch).toHaveBeenCalledOnce(); expect(h.madison).not.toHaveBeenCalled();
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
  it.each([{ createdAt: "2026-11-15T18:00:00Z" }, { text: "STOP" }])("preserves existing drafting for old or opt-out input %#", async overrides => {
    const h = fixture(); await h.runCs(message(overrides));
    expect(h.dispatch).not.toHaveBeenCalled(); expect(h.madison).toHaveBeenCalledTimes(1);
  });
  it("responds to a nonpilot phone even when legacy scope is absent", async () => {
    const h = fixture(); await h.runCs(message({ from: "+12025559876" }));
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({ fromPhone: "+12025559876" })); expect(h.madison).not.toHaveBeenCalled();
  });
  it("a missing legacy pilot phone does not disable the responder", async () => {
    const h = fixture({ missingAllowedPhone: true }); await h.runCs(message());
    expect(h.dispatch).toHaveBeenCalledOnce(); expect(h.madison).not.toHaveBeenCalled();
    expect(h.testImport.mock.calls.flat()).toContain("./instinct/claudeCustomerSmsApplication");
  });
  it("keeps an exact persisted cleaner/Teams classification unchanged while replying", async () => {
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

  it("Bark-only line does not consult a staff directory to reject a sender", async () => {
    const h = fixture({ cleaner: true }, true); await h.runWebhook(message({ phoneNumberId: "PN-bark" }));
    expect(h.dispatch).toHaveBeenCalledOnce();
    expect(h.operations.filter(op => op.operation === "read" && op.table === "cleanerProfiles")).toEqual([]);
  });

  it.each(["message.delivered", "message.updated", "message.sent"])("delivery/system event %s never reaches the new hook", async type => {
    const h = fixture(); await h.runWebhook(message({ direction: "outgoing" }), type); expect(h.dispatch).not.toHaveBeenCalled();
  });
});

describe("all-role SMS keeps existing intake and operational handling", () => {
  const customer = "+12025559876";
  it.each(["PN-cs", "PN-leads"])("opens the actual %s customer handoff and skips only the competing draft", async phoneNumberId => {
    const h = fixture({ allCustomers: true }); await h.runWebhook(message({ from: customer, phoneNumberId }));
    expect(h.dispatch).toHaveBeenCalledOnce(); expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({ fromPhone: customer, sessionId: 42, receivingPhoneNumberId: phoneNumberId }));
    expect(h.madison).not.toHaveBeenCalled();
    expect(h.sandbox.tryHandleConfirmationSmsReply).toHaveBeenCalledOnce();
    expect(h.sandbox.enqueueScoring).toHaveBeenCalledWith(42, false);
    expect(h.sandbox.syncAllOutboundMessages).toHaveBeenCalledWith(customer, 42);
  });
  it("keeps the exact new inserted row as the all-customer dispatch identity", async () => {
    const h = fixture({ allCustomers: true, existing: null }); await h.runCs(message({ from: customer }));
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 77, fromPhone: customer })); expect(h.madison).not.toHaveBeenCalled();
  });
  it.each(["PN-cs", "PN-bark"])("responds to a cleaner on %s without disabling existing operational handlers", async phoneNumberId => {
    const h = fixture({ allCustomers: true, cleaner: true }, phoneNumberId === "PN-bark");
    await h.runWebhook(message({ from: customer, phoneNumberId })); expect(h.dispatch).toHaveBeenCalledOnce(); expect(h.madison).not.toHaveBeenCalled();
    if (phoneNumberId === "PN-cs") {
      expect(h.sandbox.tryDetectCleanerRunningLate).toHaveBeenCalledOnce(); expect(h.sandbox.tryAdvanceGetEtaMission).toHaveBeenCalledOnce();
    } else {
      expect(h.sandbox.tryStoreJobSmsReply).toHaveBeenCalledOnce(); expect(h.sandbox.tryHandleCleanerRatingReply).toHaveBeenCalledOnce(); expect(h.sandbox.tryHandleConfirmationSmsReply).toHaveBeenCalledOnce();
    }
  });
  it.each([{ csQueue: "Teams" }, { leadSource: "internal" }, { leadSource: "staff" }, { stage: "INTERVIEW_LINK_SENT" }, { stage: "SCHEDULE_CONFIRM_SENT" }])("responds to stored team, staff, interview and scheduling flags %#", async flags => {
    const h = fixture({ allCustomers: true, existing: { id: 42, leadSource: "cs-inbound", messageHistory: "[]", ...flags } });
    await h.runCs(message({ from: customer })); expect(h.dispatch).toHaveBeenCalledOnce(); expect(h.madison).not.toHaveBeenCalled();
  });
  it("preserves the actual hiring intake row and lets Instinct respond", async () => {
    const h = fixture({ allCustomers: true, existing: null, hiring: { id: 88, leadSource: "hiring_interview", messageHistory: "[]" } });
    await h.runCs(message({ from: customer })); expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 88 })); expect(h.madison).not.toHaveBeenCalled();
    expect(h.operations.find(op => op.operation === "update" && op.payload.messageHistory)?.target).toMatchObject({ value: 88 });
  });
  it.each([{ createdAt: "2026-11-15T18:00:00Z" }, { createdAt: undefined }, { createdAt: "2026-11-16T18:01:00Z" }, { id: "cs-fallback-untrusted" }, { text: "STOP" }, { direction: "outgoing" }])("does not claim an old, replayed, opt-out or malformed customer event %#", async patch => {
    const h = fixture({ allCustomers: true }); await h.runCs(message({ from: customer, ...patch })); expect(h.dispatch).not.toHaveBeenCalled(); expect(h.madison).toHaveBeenCalledOnce();
  });
  it.each(["excluded", "disabled"] as const)("does not suppress the existing draft when the application returns %s", async dispatchOutcome => {
    const h = fixture({ allCustomers: true, dispatchOutcome }); await h.runCs(message({ from: customer })); expect(h.dispatch).toHaveBeenCalledOnce(); expect(h.madison).toHaveBeenCalledOnce();
  });
  it.each(["accepted", "failed", "duplicate", "suppressed", "uncertain"] as const)("avoids a second responder for an owned %s result without retrying", async dispatchOutcome => {
    const h = fixture({ allCustomers: true, dispatchOutcome }); await h.runCs(message({ from: customer })); expect(h.dispatch).toHaveBeenCalledOnce(); expect(h.madison).not.toHaveBeenCalled();
  });
  it("keeps the existing pilot no-competing-responder rule when the application fails after customer ownership", async () => {
    const h = fixture({ allCustomers: true, dispatchThrows: true }); await h.runCs(message({ from: customer })); expect(h.dispatch).toHaveBeenCalledOnce(); expect(h.madison).not.toHaveBeenCalled();
  });
  it.each([false, true])("uses the exact existing/new Bark row, new=%s, without suppressing its customer operational handlers", async isNew => {
    const h = fixture({ allCustomers: true, existing: isNew ? null : undefined }, true);
    await h.runWebhook(message({ from: customer, phoneNumberId: "PN-bark" })); expect(h.dispatch).toHaveBeenCalledOnce();
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({ sessionId: isNew ? 77 : 42, receivingPhoneNumberId: "PN-bark", fromPhone: customer }));
    expect(h.sandbox.tryStoreJobSmsReply).toHaveBeenCalledOnce(); expect(h.sandbox.tryHandleCleanerRatingReply).toHaveBeenCalledOnce(); expect(h.sandbox.tryHandleConfirmationSmsReply).toHaveBeenCalledOnce();
  });
});

describe("customer history sync precedes the exact Instinct snapshot", () => {
  const confirmation = { role: "assistant", content: "Confirming your cleaning appointment tomorrow. Reply YES to confirm. Reply FLEXIBLE or NOT FLEXIBLE.",
    ts: receivedAt - 60_000, opMsgId: "provider-confirmation", senderName: "Dispatcher" };
  it.each([false, true])("awaits the existing single sync for an existing/new customer row, new=%s", async isNew => {
    const h = fixture({ allCustomers: true, existing: isNew ? null : undefined });
    const fromPhone = "+12025559876";
    let release!: () => void; let signalStarted!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { signalStarted = resolve; });
    h.sandbox.syncAllOutboundMessages.mockImplementationOnce(async (phone: string, sessionId: number) => {
      h.operations.push({ operation: "sync-start", payload: { phone, sessionId } }); signalStarted();
      await gate;
      const history = JSON.parse(h.persistedHistories.get(sessionId)!);
      h.persistedHistories.set(sessionId, JSON.stringify([confirmation, ...history]));
      h.operations.push({ operation: "sync-complete", payload: { phone, sessionId } });
      return { added: 1, newestOutboundTs: confirmation.ts };
    });
    const result = h.runWebhook(message({ from: fromPhone, text: "Yes" })); await started;
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.sandbox.syncAllOutboundMessages).toHaveBeenCalledOnce();
    release(); await result;
    const sessionId = isNew ? 77 : 42;
    expect(h.sandbox.syncAllOutboundMessages).toHaveBeenCalledOnce();
    expect(h.sandbox.syncAllOutboundMessages).toHaveBeenCalledWith(fromPhone, sessionId);
    expect(h.dispatchSnapshots).toEqual([{ sessionId, history: [confirmation,
      expect.objectContaining({ role: "user", content: "Yes", opMsgId: "provider-original" })] }]);
    expect(h.operations.findIndex(op => op.operation === "dispatch")).toBeGreaterThan(h.operations.findIndex(op => op.operation === "sync-complete"));
    expect(h.sandbox.enqueueScoring).toHaveBeenCalledWith(sessionId, false);
    expect(h.sandbox.tryHandleConfirmationSmsReply).toHaveBeenCalledOnce();
    expect(h.madison).not.toHaveBeenCalled();
  });
  it("retains a confirmation saved by the sender when Yes reaches the customer reply/task handoff", async () => {
    const h = fixture({ allCustomers: true, existing: { id: 42, leadSource: "cs-inbound", stage: "OPEN", messageHistory: JSON.stringify([confirmation]) } });
    await h.runCs(message({ text: "Yes" }));
    expect(h.dispatchSnapshots[0].history).toEqual([confirmation, expect.objectContaining({ role: "user", content: "Yes" })]);
    expect(h.sandbox.syncAllOutboundMessages).toHaveBeenCalledOnce(); expect(h.dispatch).toHaveBeenCalledOnce();
  });
  it("passes the flexibility/access text unchanged with the confirmation context to the canonical application", async () => {
    const text = "I will not be home but the door is unlocked so you are flexible to come when you want";
    const h = fixture({ allCustomers: true, existing: { id: 42, leadSource: "cs-inbound", stage: "OPEN", messageHistory: JSON.stringify([confirmation]) } });
    await h.runWebhook(message({ from: "+12025559876", text }));
    expect(h.dispatch).toHaveBeenCalledOnce();
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({ inboundText: text, sessionId: 42, providerMessageId: "provider-original" }));
    expect(h.dispatchSnapshots[0].history).toEqual([confirmation, expect.objectContaining({ role: "user", content: text })]);
    expect(h.madison).not.toHaveBeenCalled(); expect(h.sandbox.tryHandleConfirmationSmsReply).toHaveBeenCalledOnce();
  });
  it("preserves nonfatal sync failure handling without an added retry or competing responder", async () => {
    const h = fixture({ allCustomers: true }); h.sandbox.syncAllOutboundMessages.mockRejectedValueOnce(new Error("mock sync failure"));
    await h.runCs(message({ text: "Yes" }));
    expect(h.sandbox.syncAllOutboundMessages).toHaveBeenCalledOnce(); expect(h.dispatch).toHaveBeenCalledOnce();
    expect(h.sandbox.console.warn).toHaveBeenCalledWith("[CS] syncAllOutboundMessages error:", expect.any(Error));
    expect(h.madison).not.toHaveBeenCalled();
  });
  it.each([{ disabled: true }])("retains original sync handling when Instinct is disabled %#", async options => {
    const h = fixture(options); let release!: () => void;
    h.sandbox.syncAllOutboundMessages.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    await h.runCs(message());
    expect(h.dispatch).not.toHaveBeenCalled(); expect(h.sandbox.syncAllOutboundMessages).toHaveBeenCalledOnce();
    release();
  });
  it.each([{ cleaner: true }, { existing: null, hiring: { id: 88, leadSource: "hiring_interview", messageHistory: "[]" } }])("awaits the exact team/hiring history sync before dispatch %#", async options => {
    const h = fixture(options); let release!: () => void; let signalStarted!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { signalStarted = resolve; });
    h.sandbox.syncAllOutboundMessages.mockImplementationOnce(async (phone: string, sessionId: number) => {
      signalStarted(); await gate;
      const history = JSON.parse(h.persistedHistories.get(sessionId)!);
      h.persistedHistories.set(sessionId, JSON.stringify([confirmation, ...history]));
    });
    const pending = h.runCs(message({ from: "+12025559876", text: "Yes" })); await started;
    expect(h.dispatch).not.toHaveBeenCalled(); release(); await pending;
    expect(h.dispatch).toHaveBeenCalledOnce(); expect(h.sandbox.syncAllOutboundMessages).toHaveBeenCalledOnce();
    expect(h.dispatchSnapshots[0].history).toEqual([confirmation, expect.objectContaining({ role: "user", content: "Yes", opMsgId: "provider-original" })]);
    expect(h.madison).not.toHaveBeenCalled();
  });
  it("preserves the existing single sync on the separate Bark inbound path", async () => {
    const h = fixture({ allCustomers: true }, true); await h.runWebhook(message({ phoneNumberId: "PN-bark" }));
    expect(h.dispatch).toHaveBeenCalledOnce(); expect(h.sandbox.syncAllOutboundMessages).toHaveBeenCalledOnce();
    expect(h.sandbox.syncAllOutboundMessages).toHaveBeenCalledWith("+12025550123", 42);
  });
});

describe("dispatch boundary diagnostic observations", () => {
  function records(log: { mock: { calls: unknown[][] } }) {
    return log.mock.calls.map(call => typeof call[0] === "string" ? JSON.parse(call[0]) : null)
      .filter(value => value?.message === "[ClaudeCustomerSMS][Diagnostic]");
  }
  it.each(["accepted", "excluded", "disabled", "failed", "duplicate", "suppressed", "uncertain"] as const)("records the exact %s outcome without changing responder ownership", async dispatchOutcome => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const h = fixture({ allCustomers: true, dispatchOutcome });
    await h.runWebhook(message({ from: "+12025559876" }));
    const replyOwned = !["excluded", "disabled"].includes(dispatchOutcome);
    expect(records(log)).toContainEqual(expect.objectContaining({ sessionId: 42, inboundMessageId: "provider-original", stage: "dispatch", outcome: dispatchOutcome }));
    expect(h.dispatch).toHaveBeenCalledOnce(); expect(h.madison).toHaveBeenCalledTimes(replyOwned ? 0 : 1);
    expect(h.sandbox.tryHandleConfirmationSmsReply).toHaveBeenCalledOnce();
    expect(log.mock.calls.flat().join(" ")).not.toContain("Please change");
    expect(log.mock.calls.flat().join(" ")).not.toContain("+12025559876");
  });
  it.each([
    [{ disabled: true }, {}, "CONFIG_DISABLED"],
    [{}, { id: "cs-fallback-untrusted" }, "INVALID_PROVIDER_MESSAGE_ID"],
    [{}, { direction: "outgoing" }, "NOT_INCOMING"],
    [{}, { text: "STOP" }, "STOP_STYLE_TEXT"],
    [{}, { createdAt: undefined }, "INVALID_CREATED_AT"],
    [{}, { createdAt: "2026-11-16T18:01:00Z" }, "CREATED_AFTER_RECEIPT"],
  ] as const)("records a coarse guard decline %# before application invocation", async (options, patch) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const h = fixture(options); await h.runCs(message(patch));
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(records(log)).toContainEqual(expect.objectContaining({ stage: "dispatch", reason: "EVENT_GUARD_DECLINED", replyOwned: false, receiptClaimAttempted: false, generationReached: false }));
    expect(h.testImport.mock.calls.flat()).not.toContain("./instinct/claudeCustomerSmsApplication");
  });
  it("keeps existing failure ownership and logs no raw exception", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const h = fixture({ allCustomers: true, dispatchThrows: true });
    await h.runCs(message({ from: "+12025559876" }));
    expect(records(log)).toContainEqual(expect.objectContaining({ stage: "dispatch", reason: "DISPATCH_EXCEPTION", replyOwned: true, errorCode: "UNCLASSIFIED_ERROR" }));
    expect(log.mock.calls.flat().join(" ")).not.toContain("mock failure");
    expect(h.dispatch).toHaveBeenCalledOnce(); expect(h.madison).not.toHaveBeenCalled();
    expect(h.sandbox.console.warn).toHaveBeenCalledWith("[ClaudeCustomerSMS] Additive dispatch stopped; existing inbound flow continues.");
  });
  it.each(["accepted", "failed", "excluded"] as const)("a throwing diagnostic console cannot change the %s handoff", async dispatchOutcome => {
    vi.spyOn(console, "log").mockImplementation(() => { throw new Error("synthetic logger failure"); });
    const h = fixture({ allCustomers: true, dispatchOutcome });
    await h.runWebhook(message({ from: "+12025559876" }));
    expect(h.dispatch).toHaveBeenCalledOnce(); expect(h.madison).toHaveBeenCalledTimes(dispatchOutcome === "excluded" ? 1 : 0);
    expect(h.sandbox.console.warn).not.toHaveBeenCalledWith("[ClaudeCustomerSMS] Additive dispatch stopped; existing inbound flow continues.");
    expect(h.sandbox.tryHandleConfirmationSmsReply).toHaveBeenCalledOnce();
  });
});
