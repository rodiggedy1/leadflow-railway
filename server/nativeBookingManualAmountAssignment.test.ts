import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { effectiveNativeVisitAmount } from "../shared/nativeBookingManualAmounts";
const root = resolve(import.meta.dirname, "..");
const tables: any = Object.fromEntries(["bookings", "leadflowJobs", "bookingAssignments", "schedulingTeams"].map(name => [name, Object.assign({ name }, Object.fromEntries(["id", "bookingId", "jobDate", "status", "isActive", "isArchived", "assignedAt", "teamId", "teamName"].map(field => [field, name + "." + field])))]));
const operations = {
  eq: (column: string, value: unknown) => (row: any) => row[column.split(".").at(-1)!] === value,
  gt: (column: string, value: any) => (row: any) => row[column.split(".").at(-1)!] > value,
  inArray: (column: string, values: unknown[]) => (row: any) => values.includes(row[column.split(".").at(-1)!]),
  and: (...terms: Function[]) => (row: any) => terms.every(term => term(row)),
};
function loadProjection() {
  const source = readFileSync(resolve(root, "server/bookingLifecycleService.ts"), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: any = {};
  const modules: any = { "@trpc/server": { TRPCError }, "drizzle-orm": operations, "../drizzle/schema": tables, "./db": {}, "./utils/businessTime": { businessLocalDateTimeToUtcMs: (date: string) => Date.parse(date + "T14:00:00Z") }, "../shared/nativeBookingManualAmounts": { effectiveNativeVisitAmount } };
  vm.runInNewContext(output, { exports, Date, require: (name: string) => { if (!(name in modules)) throw Error("Unexpected import " + name); return modules[name]; } });
  return exports.syncNativeBookingOperationalProjection;
}
function assignment(db: any) {
  const source = readFileSync(resolve(root, "server/bookingsRouter.ts"), "utf8");
  const file = ts.createSourceFile("bookingsRouter.ts", source, ts.ScriptTarget.Latest, true);
  let arrow: ts.Node | undefined;
  function walk(node: ts.Node) { if (ts.isPropertyAssignment(node) && node.name.getText(file) === "assignTeam" && ts.isCallExpression(node.initializer)) arrow = node.initializer.arguments[0]; ts.forEachChild(node, walk); }
  walk(file); if (!arrow) throw Error("Assignment handler missing");
  const output = ts.transpileModule("exports.run = " + arrow.getText(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: any = {};
  vm.runInNewContext(output, { exports, ...tables, ...operations, Date, TRPCError, getDb: async () => db, syncNativeBookingOperationalProjection: loadProjection(), publishNativeBookingRefresh: () => {} });
  return exports.run;
}
function metadata(amounts: number[]) {
  return { version: 1, revision: amounts.length, visits: [{ jobId: 11, date: "2030-01-02", firstVisit: true, amountCents: amounts.at(-1), protected: false }], seriesRules: [], history: amounts.map((amountCents, index) => {
    const requestId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    const command = { bookingId: 7, expectedDate: "2030-01-02", expectedAmountCents: index ? amounts[index - 1] : 19000, expectedRevision: index, amountCents, scope: "visit", requestId };
    const result = { bookingId: 7, selectedJobId: 11, selectedDate: command.expectedDate, selectedChanged: true, selectedAmountCents: amountCents, manualAmountRevision: index + 1, changedVisitCount: 1, changedJobCount: 1, protectedVisitCount: 0, protectedVisits: [], futureRuleChanged: false, replayed: false };
    return { requestId, actor: { id: "8", name: "Staff" }, timestamp: "2030-01-01T00:00:00.000Z", command, priorEffective: [{ jobId: 11, date: command.expectedDate, firstVisit: true, amountCents: command.expectedAmountCents }], afterEffective: [{ jobId: 11, date: command.expectedDate, firstVisit: true, amountCents }], result };
  }) };
}
describe("native amount assignment current-read interleaving (synthetic, not MySQL isolation)", () => {
  it.each([false, true])("preserves an edit committed before acquiring the assignment lock (older override: %s)", async older => {
    const rows: any = { bookings: [{ id: 7, requestedLocalDate: "2030-01-02", requestedLocalTime: "09:00", requestedTimeZone: "America/New_York", recurrence: "weekly", firstCleaningTotalCents: 19000, futureVisitTotalCents: 16000, manualAmountOverrides: older ? metadata([21000]) : null, extras: [], specialRequestNotes: [], companyNotes: null, status: "confirmed", paymentStatus: "card_on_file" }], leadflowJobs: [{ id: 11, bookingId: 7, jobDate: "2030-01-02", jobTotalCents: older ? 21000 : 19000 }, { id: 12, bookingId: 7, jobDate: "2030-01-09", jobTotalCents: 16000 }], bookingAssignments: [], schedulingTeams: [{ id: 2, name: "Team", isActive: 1, isArchived: 0 }] };
    const trace: string[] = [];
    const tx: any = {
      select: () => {
        let table: string, predicate = (_row: unknown) => true, count = Infinity;
        const chain: any = { from: (value: any) => { table = value.name; return chain; }, where: (value: any) => { predicate = value; return chain; }, limit: (value: number) => { count = value; return chain; }, orderBy: () => chain,
          for: (mode: string) => { expect(mode).toBe("update"); if (table === "bookings") { trace.push("current booking lock"); rows.bookings[0].manualAmountOverrides = metadata(older ? [21000, 23125] : [23125]); rows.leadflowJobs[0].jobTotalCents = 23125; } return chain; },
          then: (resolve: Function, reject: Function) => Promise.resolve(structuredClone(rows[table].filter(predicate).slice(0, count))).then(resolve as any, reject as any) };
        return chain;
      },
      update: (table: any) => ({ set: (values: any) => ({ where: async (predicate: Function) => { expect(trace).toContain("current booking lock"); rows[table.name].filter(predicate).forEach((row: any) => Object.assign(row, structuredClone(values))); return [{ affectedRows: 1 }]; } }) }),
      insert: (table: any) => ({ values: async (value: any) => rows[table.name].push({ id: 1, ...value }) }),
    };
    await assignment({ transaction: async (work: Function) => work(tx) })({ input: { bookingId: 7, teamId: 2 }, ctx: { agent: { agentId: 8 } } });
    expect(trace).toEqual(["current booking lock"]);
    expect(rows.leadflowJobs[0].jobTotalCents).toBe(23125);
    expect(effectiveNativeVisitAmount(rows.bookings[0], "2030-01-02", { firstVisit: true })).toBe(23125);
    expect(rows.leadflowJobs[1].jobTotalCents).toBe(16000);
    expect(rows.bookings[0].firstCleaningTotalCents).toBe(19000);
    expect(rows.bookingAssignments[0].teamId).toBe(2);
  });
});
