import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { normalizePhone } from "./utils/phone";

function executable(file: string, expose: string) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const body = ast.statements.filter(node => !ts.isImportDeclaration(node))
    .map(node => node.getText(ast).replace(/^export /, "")).join("\n");
  return ts.transpileModule(`${body}\nglobalThis.${expose} = ${expose};`.replaceAll("import(", "testImport("),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
}
// Execute the actual sender and helper only. No application, real DB, provider or SSE imports.
const senderCode = executable("./leadflowConfirmationCallsRouter.ts", "leadflowConfirmationCallsRouter");
const helperCode = executable("./sms/appendCsOutboundMessage.ts", "appendCsOutboundMessage");
const sentAt = Date.parse("2026-11-22T18:00:00Z");
const phone = "+12025550123";
const previous = { role: "user", content: "See you tomorrow", ts: sentAt - 120_000, opMsgId: "prior-inbound" };
function fixture(options: { success?: boolean; throwSend?: boolean; noCustomer?: boolean; failHistory?: boolean; failConfirmationUpdate?: boolean; noCsNumber?: boolean } = {}) {
  const sessions = [
    ...(!options.noCustomer ? [{ id: 42, leadPhone: phone, leadSource: "cs-inbound", updatedAt: 1, messageHistory: JSON.stringify([previous]) }] : []),
    { id: 43, leadPhone: phone, leadSource: "cs_initiated", updatedAt: 9, messageHistory: "[]" },
    { id: 44, leadPhone: phone, leadSource: "cs-inbound-cleaner", updatedAt: 10, messageHistory: "[]" },
  ];
  const operations: Array<{ table: string; operation: string; payload?: any }> = [];
  const calls: Record<string, any>[] = [];
  const job = { id: 7, jobDate: "2026-11-23", customerName: "Maya Jones", customerPhone: "(202) 555-0123", bookingStatus: "active" };
  const db = {
    select: vi.fn(() => {
      let table: string; let predicate: any;
      const chain: any = { from: (value: string) => { table = value; return chain; },
        where: (value: any) => { predicate = value; return chain; }, orderBy: () => chain,
        limit: async () => {
          operations.push({ table, operation: "read", payload: predicate });
          if (table === "leadflowJobs") return [job];
          if (table !== "conversationSessions") throw new Error(`Unexpected read ${table}`);
          const customerOnly = predicate.strings.join("").includes("= 'cs-inbound'");
          return sessions.filter(row => row.leadPhone === phone && (!customerOnly || row.leadSource === "cs-inbound"))
            .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 1);
        } };
      return chain;
    }),
    insert: (table: string) => ({ values: async (payload: any) => {
      operations.push({ table, operation: "insert", payload });
      if (table === "confirmationCalls") { calls.push({ id: 91, ...payload }); return [{ insertId: 91 }]; }
      if (table !== "conversationSessions") throw new Error(`Unexpected insert ${table}`);
      if (options.failHistory) throw new Error("mock history failure");
      sessions.push({ id: 60, ...payload }); return [{ insertId: 60 }];
    } }),
    update: (table: string) => ({ set: (payload: any) => ({ where: async (predicate: any) => {
      operations.push({ table, operation: "update", payload });
      if (table === "conversationSessions" && options.failHistory) throw new Error("mock history failure");
      if (table === "confirmationCalls" && options.failConfirmationUpdate && payload.status === "completed") throw new Error("mock metadata failure");
      const target = (table === "confirmationCalls" ? calls : sessions).find(row => row.id === predicate.value);
      if (!target) throw new Error(`Unexpected update ${table} ${predicate.value}`);
      Object.assign(target, payload); return [{ affectedRows: 1 }];
    } }) }),
  };
  const send = vi.fn(async (_input: { to: string; content: string; fromNumberId?: string }) => {
    if (options.throwSend) throw new Error("mock provider failure");
    return { success: options.success !== false, messageId: "provider-confirmation" };
  });
  const broadcast = vi.fn();
  const procedure: any = { input: () => procedure, query: (fn: any) => fn, mutation: (fn: any) => fn };
  const sandbox: Record<string, any> = {
    z, router: (value: any) => value, opsChatProcedure: procedure, getDb: async () => db,
    sendSms: send, normalizePhone, ENV: options.noCsNumber ? {} : { openPhoneCsNumberId: "PN-cs" },
    TRPCError: class extends Error { constructor(options: any) { super(options.message); } },
    Date: class extends Date { static now() { return sentAt; } }, console: { log: vi.fn(), error: vi.fn() },
    eq: (column: any, value: any) => ({ column, value }), and: (...args: any[]) => args,
    asc: (value: any) => value, desc: (value: any) => value, inArray: (...args: any[]) => args, ne: (...args: any[]) => args,
    computeSessionSummary: () => ({}),
    testImport: async (path: string) => {
      if (path === "drizzle-orm") return { sql: (strings: any, ...values: any[]) => ({ strings: [...strings], values }) };
      if (path === "../sseBroadcast" || path === "./sseBroadcast") return { broadcastOpsUpdate: broadcast };
      throw new Error(`Unexpected import ${path}`);
    },
  };
  for (const table of ["leadflowJobs", "confirmationCalls", "conversationSessions"]) {
    // String-backed inert schema lets the mock table methods identify the selected table.
    const value: any = new String(table);
    for (const column of ["id", "leadPhone", "leadSource", "messageHistory", "updatedAt", "jobDate", "customerName", "customerPhone", "bookingStatus", "leadflowJobId"]) value[column] = `${table}.${column}`;
    sandbox[table] = value;
  }
  // Coerce inert schema objects at every mock DB table boundary.
  const select = db.select;
  db.select = vi.fn(() => { const chain = select(); const from = chain.from; chain.from = (table: any) => from(String(table)); return chain; });
  const insert = db.insert; db.insert = (table: any) => insert(String(table));
  const update = db.update; db.update = (table: any) => update(String(table));
  vm.createContext(sandbox); vm.runInContext(helperCode, sandbox);
  const append = vi.fn(sandbox.appendCsOutboundMessage); sandbox.appendCsOutboundMessage = append;
  vm.runInContext(senderCode, sandbox);
  return { sessions, calls, operations, send, append, broadcast, sandbox, db,
    run: () => sandbox.leadflowConfirmationCallsRouter.placeCall({ input: { leadflowJobId: 7, jobDate: "2026-11-23" }, ctx: { opsCaller: { name: "April" } } }) };
}

describe("confirmation SMS exact customer history", () => {
  it("stores the accepted SMS once with exact provider ID/body/time and preserves prior customer history", async () => {
    const h = fixture(); expect(await h.run()).toEqual({ confirmationCallId: 91 });
    expect(h.send).toHaveBeenCalledOnce(); expect(h.send).toHaveBeenCalledWith(expect.objectContaining({ to: phone, fromNumberId: "PN-cs" }));
    const body = h.send.mock.calls[0][0].content;
    expect(h.append).toHaveBeenCalledOnce(); expect(h.append).toHaveBeenCalledWith({ db: h.db, recipientPhone: phone,
      recipientName: "Maya Jones", message: body, senderName: "April", sentAt, openPhoneMessageId: "provider-confirmation", customerSessionOnly: true });
    expect(JSON.parse(h.sessions.find(row => row.id === 42)!.messageHistory)).toEqual([previous,
      { role: "assistant", content: body, ts: sentAt, senderName: "April", opMsgId: "provider-confirmation" }]);
    expect(h.sessions.filter(row => [43, 44].includes(row.id)).every(row => row.messageHistory === "[]")).toBe(true);
    expect(h.calls[0]).toMatchObject({ status: "completed", smsFollowupSent: 1, smsFollowupBody: body, smsFollowupAt: sentAt });
    expect(h.operations.filter(op => op.table === "conversationSessions" && op.operation === "update")).toHaveLength(1);
  });
  it.each([{ success: false }, { throwSend: true }])("never saves a failed send as conversation history %#", async options => {
    const h = fixture(options); expect(await h.run()).toEqual({ confirmationCallId: 91 });
    expect(h.send).toHaveBeenCalledOnce(); expect(h.append).not.toHaveBeenCalled();
    expect(h.calls[0].status).toBe("failed"); expect(h.calls[0].smsFollowupSent).toBeUndefined();
    expect(JSON.parse(h.sessions[0].messageHistory)).toEqual([previous]);
  });
  it("waits for history persistence before returning the accepted send", async () => {
    const h = fixture(); let release!: () => void; let signalStarted!: () => void;
    const started = new Promise<void>(resolve => { signalStarted = resolve; });
    h.append.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; signalStarted(); }));
    let finished = false; const result = h.run().then((value: any) => { finished = true; return value; });
    await started; expect(h.append).toHaveBeenCalledOnce(); expect(finished).toBe(false);
    release(); expect(await result).toEqual({ confirmationCallId: 91 });
  });
  it("retains accepted send status when the history store fails without resending", async () => {
    const h = fixture({ failHistory: true }); await h.run();
    expect(h.calls[0]).toMatchObject({ status: "completed", smsFollowupSent: 1 });
    expect(h.send).toHaveBeenCalledOnce(); expect(h.append).toHaveBeenCalledOnce();
  });
  it("stores the accepted text even if the separate confirmation metadata update fails", async () => {
    const h = fixture({ failConfirmationUpdate: true }); await h.run();
    expect(h.send).toHaveBeenCalledOnce(); expect(h.append).toHaveBeenCalledOnce();
    expect(JSON.parse(h.sessions.find(row => row.id === 42)!.messageHistory)[1]).toMatchObject({ opMsgId: "provider-confirmation", content: h.send.mock.calls[0][0].content });
    // Existing confirmation-record error semantics are outside this history repair.
    expect(h.calls[0].status).toBe("failed");
  });
  it("does not reclassify a successful provider send if the helper unexpectedly rejects", async () => {
    const h = fixture(); h.append.mockRejectedValueOnce(new Error("mock unexpected rejection")); await h.run();
    expect(h.calls[0].status).toBe("completed"); expect(h.send).toHaveBeenCalledOnce();
  });
  it("creates the existing proactive customer-history record only when no customer session exists", async () => {
    const h = fixture({ noCustomer: true }); await h.run();
    const created = h.sessions.find(row => row.id === 60)!;
    expect(created).toMatchObject({ leadPhone: phone, leadName: "Maya Jones", leadSource: "cs-inbound", stage: "OPEN" });
    expect(JSON.parse(created.messageHistory)[0]).toMatchObject({ role: "assistant", opMsgId: "provider-confirmation" });
    expect(h.sessions.filter(row => [43, 44].includes(row.id)).every(row => row.messageHistory === "[]")).toBe(true);
  });
  it("keeps the existing broad helper lookup for unrelated callers", async () => {
    const h = fixture(); await h.append({ db: h.db, recipientPhone: phone, message: "Existing staff send", senderName: "April", sentAt });
    expect(JSON.parse(h.sessions.find(row => row.id === 44)!.messageHistory)[0].content).toBe("Existing staff send");
    expect(JSON.parse(h.sessions.find(row => row.id === 42)!.messageHistory)).toEqual([previous]);
  });
  it("retains existing provider-ID deduplication", async () => {
    const h = fixture(); await h.run(); await h.append(h.append.mock.calls[0][0]);
    expect(JSON.parse(h.sessions.find(row => row.id === 42)!.messageHistory)).toHaveLength(2);
    expect(h.operations.filter(op => op.table === "conversationSessions" && op.operation === "update")).toHaveLength(1);
  });
  it("keeps the existing default sending line when no CS line is configured", async () => {
    const h = fixture({ noCsNumber: true }); await h.run();
    expect(h.send.mock.calls[0][0]).not.toHaveProperty("fromNumberId"); expect(h.calls[0].status).toBe("completed");
  });
});
