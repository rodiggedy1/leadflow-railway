import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { effectiveNativeVisitAmount, nativeBookingManualAmountsSchema } from "../shared/nativeBookingManualAmounts";

// OFFLINE ONLY: extract and execute the actual placeHold mutation. Never import
// the payment router, its auth/configuration, DB, models, or provider clients.
const root = resolve(import.meta.dirname, "..");
const routerPath = "server/bookingPaymentAdminRouter.ts";
const current = () => readFileSync(resolve(root, routerPath), "utf8");
const original = () => execFileSync("git", ["show", `a9e5139bad72d51e2a2ff7dfb9cce8c85255335a:${routerPath}`], { cwd: root, encoding: "utf8" });
const BOOKING_DATE = "2030-01-02";
const NOW = "2030-01-01T00:00:00.000Z";
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

class OfflineTRPCError extends Error {
  code: string;
  constructor(input: { code: string; message: string }) { super(input.message); this.code = input.code; }
}
function actionNode(source: string) {
  const file = ts.createSourceFile(routerPath, source, ts.ScriptTarget.Latest, true);
  const matches: ts.ArrowFunction[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(file) === "placeHold" && ts.isCallExpression(node.initializer)) {
      const candidate = node.initializer.arguments[0];
      if (candidate && ts.isArrowFunction(candidate)) matches.push(candidate);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (matches.length !== 1) throw new Error("Expected exactly one actual placeHold mutation");
  return { file, node: matches[0] };
}
function loadAction(source: string, globals: Record<string, unknown>) {
  const { file, node } = actionNode(source);
  const module = { exports: {} as { run: (input: unknown) => Promise<unknown> } };
  const output = ts.transpileModule(`exports.run = ${node.getText(file)};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(output, { exports: module.exports, Date, ...globals }, { filename: routerPath, timeout: 1500 });
  return module.exports.run;
}
function savedAmount(amountCents: number) {
  const command = {
    bookingId: 7, expectedDate: BOOKING_DATE, expectedAmountCents: 12000,
    expectedRevision: 0, amountCents, scope: "visit", requestId: "00000000-0000-4000-8000-000000000001",
  };
  return nativeBookingManualAmountsSchema.parse({
    version: 1, revision: 1,
    visits: [{ jobId: null, date: BOOKING_DATE, firstVisit: true, amountCents, protected: false }], seriesRules: [],
    history: [{
      requestId: command.requestId, actor: { id: "8", name: "Synthetic staff" }, timestamp: NOW, command,
      priorEffective: [{ jobId: null, date: BOOKING_DATE, firstVisit: true, amountCents: 12000 }],
      afterEffective: [{ jobId: null, date: BOOKING_DATE, firstVisit: true, amountCents }],
      result: {
        bookingId: 7, selectedJobId: null, selectedDate: BOOKING_DATE, selectedChanged: true,
        selectedAmountCents: amountCents, manualAmountRevision: 1, changedVisitCount: 1, changedJobCount: 0,
        protectedVisitCount: 0, protectedVisits: [], futureRuleChanged: false, replayed: false,
      },
    }],
  });
}
type Options = {
  saved?: number; profileStatus?: string; existingHold?: boolean;
  expectedAmountCents?: number;
  providerFailure?: { statusCode?: number }; intentStatus?: string;
  editAfterCommit?: boolean;
};
async function execute(source: string, options: Options = {}) {
  const trace: any[] = [];
  const selections: any[] = [];
  const booking = {
    id: 7, publicBookingNumber: "B-SYNTHETIC-7", requestedLocalDate: BOOKING_DATE,
    recurrence: "weekly", customerPhone: "+12025550111", customerName: "Synthetic customer",
    firstCleaningTotalCents: 12000, futureVisitTotalCents: 10000,
    priceSnapshot: { immutable: true, originalTotalCents: 12000 },
    ...(options.saved === undefined ? {} : { manualAmountOverrides: savedAmount(options.saved) }),
  };
  const before = clone(booking);
  // A separate stale preflight result must never choose the authorization amount.
  const stalePreflightBooking = { ...before, requestedLocalDate: "2029-12-31", manualAmountOverrides: undefined };
  const profile = {
    id: 3, version: 2, paymentStatus: options.profileStatus ?? "card_on_file",
    stripeCustomerId: "cus_synthetic", stripePaymentMethodId: "pm_synthetic",
  };
  const authorizations = { id: "authorization.id", bookingPaymentProfileId: "authorization.profileId", status: "authorization.status" };
  const profiles = { id: "profile.id" };
  let locked = false;
  let committed = false;
  let durablePending: any;
  const update = (table: unknown) => {
    if (table !== authorizations && table !== profiles) throw new Error("Unexpected table update");
    return { set: (values: unknown) => ({ where: async (where: unknown) => { trace.push(["update", table === profiles ? "profile" : "authorization", clone(values), clone(where)]); } }) };
  };
  const tx = {
    select: () => ({ from: (table: unknown) => {
      expect(locked).toBe(true); expect(table).toBe(authorizations);
      return { where: (where: unknown) => ({ limit: (limit: number) => ({ for: async (mode: string) => {
        trace.push(["active-hold locking read", clone(where), limit, mode]);
        return options.existingHold ? [{ id: 66, status: "authorized" }] : [];
      } }) }) };
    } }),
    insert: (table: unknown) => {
      expect(locked).toBe(true); expect(table).toBe(authorizations);
      return { values: (values: unknown) => ({ $returningId: async () => {
        durablePending = clone(values); trace.push(["pending insert", durablePending]); return [{ id: 9 }];
      } }) };
    },
    update,
  };
  const db = {
    update,
    transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      trace.push("existing post-provider transaction begin");
      const result = await work(tx);
      trace.push("existing post-provider transaction commit"); return result;
    },
  };
  const stripe = Object.freeze({ synthetic: true });
  const run = loadAction(source, {
    TRPCError: OfflineTRPCError, paymentAuthorizations: authorizations, bookingPaymentProfiles: profiles,
    eq: (...args: unknown[]) => ["eq", ...args], and: (...args: unknown[]) => ["and", ...args], or: (...args: unknown[]) => ["or", ...args],
    paymentTargetOrThrow: async (id: number) => {
      trace.push(["preflight", id]); return { db, booking: stalePreflightBooking, profile: { ...profile } };
    },
    withUnclaimedNativeFirstVisit: async (targetDb: unknown, id: number, work: (tx: unknown, target: unknown) => Promise<unknown>) => {
      expect(targetDb).toBe(db); expect(id).toBe(7);
      trace.push("existing native first-visit lock acquired"); locked = true;
      try {
        const result = await work(tx, { booking, profile });
        expect(booking).toEqual(before);
        committed = true; trace.push("pending transaction committed");
        if (options.editAfterCommit) {
          booking.firstCleaningTotalCents = 22000;
          booking.manualAmountOverrides = savedAmount(24400);
        }
        return result;
      } finally { locked = false; }
    },
    effectiveNativeVisitAmount: (target: typeof booking, date: string, identity: { firstVisit: boolean }) => {
      expect(locked).toBe(true); expect(committed).toBe(false); expect(target).toBe(booking);
      expect(date).toBe(BOOKING_DATE); expect(identity).toEqual({ firstVisit: true });
      const amount = effectiveNativeVisitAmount(target, date, identity);
      selections.push({ date, identity: clone(identity), amountCents: amount }); return amount;
    },
    getStripeClient: () => { expect(committed).toBe(true); trace.push("existing Stripe client seam"); return stripe; },
    authorizeCanonicalBookingHold: async (client: unknown, input: any) => {
      expect(client).toBe(stripe); expect(locked).toBe(false); expect(committed).toBe(true);
      expect(durablePending).toBeDefined(); expect(durablePending.status).toBe("pending_card");
      trace.push(["canonical hold", clone(input)]);
      if (options.providerFailure) throw Object.assign(new Error("Synthetic provider failure"), options.providerFailure);
      return { id: "pi_synthetic", status: options.intentStatus ?? "requires_capture", payment_method_options: { card: { capture_before: 1893542400 } } };
    },
    stripeFailureMessage: (error: Error) => error.message,
    syncNativeBookingPaymentState: async (targetTx: unknown, input: unknown) => {
      expect(targetTx).toBe(tx); trace.push(["existing native payment sync", clone(input)]);
    },
  });
  let result: unknown;
  let error: { code?: string; message: string } | undefined;
  try { result = await run({ input: { bookingId: 7, confirmed: true, ...(options.expectedAmountCents === undefined ? {} : { expectedAmountCents: options.expectedAmountCents }) }, ctx: { agent: { agentName: "Synthetic staff" } } }); }
  catch (cause) { const failure = cause as Error & { code?: string }; error = { code: failure.code, message: failure.message }; }
  if (!options.editAfterCommit) expect(booking).toEqual(before);
  expect(booking.priceSnapshot).toEqual(before.priceSnapshot);
  return { trace: clone(trace), selections, durablePending, result: result === undefined ? undefined : clone(result), error };
}
const behavior = (outcome: Awaited<ReturnType<typeof execute>>) => ({ trace: outcome.trace, result: outcome.result, error: outcome.error });
function onlyReplaceOriginalHoldAmount(trace: any[], amountCents: number) {
  return trace.map(entry => Array.isArray(entry) && (entry[0] === "pending insert" || entry[0] === "canonical hold")
    ? [entry[0], { ...entry[1], amountCents }] : entry);
}
afterEach(() => vi.useRealTimers());

describe("saved native first-visit amount uses the existing locked hold flow", () => {
  it("persists and actually passes 13900 to canonical authorization, preserving the original complete sequence", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(NOW));
    const actual = await execute(current(), { saved: 13900, expectedAmountCents: 13900 });
    const baseline = await execute(original());
    expect(actual.error).toBeUndefined();
    expect(actual.durablePending.amountCents).toBe(13900);
    expect(actual.trace.find(entry => entry[0] === "canonical hold")[1]).toEqual({
      bookingId: 7, profileId: 3, customerId: "cus_synthetic", paymentMethodId: "pm_synthetic",
      amountCents: 13900, publicBookingNumber: "B-SYNTHETIC-7", agentName: "Synthetic staff", attempt: 2, authorizationAttemptId: 9,
    });
    expect(actual.selections).toEqual([{ date: BOOKING_DATE, identity: { firstVisit: true }, amountCents: 13900 }]);
    expect(actual.trace).toEqual(onlyReplaceOriginalHoldAmount(baseline.trace, 13900));
    expect(actual.result).toEqual(baseline.result);
    const sequence = actual.trace.map(entry => Array.isArray(entry) ? entry[0] : entry);
    expect(sequence).toEqual([
      "preflight", "existing native first-visit lock acquired", "active-hold locking read", "pending insert",
      "pending transaction committed", "existing Stripe client seam", "canonical hold", "update", "update",
      "existing post-provider transaction begin", "existing native payment sync", "existing post-provider transaction commit",
    ]);
    expect(actual.trace.filter(entry => entry[0] === "update").map(entry => [entry[1], entry[2].status ?? entry[2].paymentStatus])).toEqual([["authorization", "authorized"], ["profile", "authorized"]]);
  });

  it("with no override retains raw 12000 and the entire original outcome", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(NOW));
    const actual = await execute(current());
    expect(actual.durablePending.amountCents).toBe(12000);
    expect(actual.trace.find(entry => entry[0] === "canonical hold")[1].amountCents).toBe(12000);
    expect(behavior(actual)).toEqual(behavior(await execute(original())));
  });

  it("selects from the freshly locked booking, not stale raw preflight, and reuses that committed amount", async () => {
    const actual = await execute(current(), { saved: 13900, editAfterCommit: true });
    expect(actual.error).toBeUndefined();
    expect(actual.selections).toHaveLength(1);
    expect(actual.durablePending.amountCents).toBe(13900);
    expect(actual.trace.find(entry => entry[0] === "canonical hold")[1].amountCents).toBe(13900);
  });

  it("reserves and authorizes the exact confirmed decimal amount 13975", async () => {
    const actual = await execute(current(), { saved: 13975, expectedAmountCents: 13975 });
    expect(actual.error).toBeUndefined();
    expect(actual.durablePending.amountCents).toBe(13975);
    expect(actual.trace.find(entry => entry[0] === "canonical hold")[1].amountCents).toBe(13975);
    expect(actual.selections).toEqual([{ date: BOOKING_DATE, identity: { firstVisit: true }, amountCents: 13975 }]);
  });

  it("rejects stale confirmed 13900 against freshly saved 14900 before any reservation or provider seam", async () => {
    const actual = await execute(current(), { saved: 14900, expectedAmountCents: 13900 });
    expect(actual.error).toEqual({ code: "CONFLICT", message: "The booking amount changed. Refresh the booking and confirm the current hold amount." });
    expect(actual.selections).toEqual([{ date: BOOKING_DATE, identity: { firstVisit: true }, amountCents: 14900 }]);
    expect(actual.durablePending).toBeUndefined();
    expect(actual.result).toBeUndefined();
    expect(actual.trace).toEqual([["preflight", 7], "existing native first-visit lock acquired"]);
  });

  it.each([{ profileStatus: "not_started" }, { existingHold: true }])("retains the original pre-provider rejection %j", async options => {
    const actual = await execute(current(), { ...options, saved: 13900 });
    expect(actual.error?.code).toBe(options.existingHold ? "CONFLICT" : "BAD_REQUEST");
    expect(actual.durablePending).toBeUndefined();
    expect(actual.trace.some(entry => entry[0] === "canonical hold")).toBe(false);
    expect(behavior(actual)).toEqual(behavior(await execute(original(), options)));
  });

  it.each([400, 409, 429, 500, undefined])("retains original failure/review handling for synthetic provider status %s", async statusCode => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(NOW));
    const options = { providerFailure: { statusCode } };
    const actual = await execute(current(), { ...options, saved: 13900 });
    const baseline = await execute(original(), options);
    expect(actual.trace).toEqual(onlyReplaceOriginalHoldAmount(baseline.trace, 13900));
    expect(actual.error).toEqual(baseline.error);
    expect(actual.result).toBeUndefined();
  });

  it.each(["canceled", "requires_payment_method", "processing"])("retains original non-authorized intent handling for %s", async intentStatus => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(NOW));
    const actual = await execute(current(), { saved: 13900, intentStatus });
    const baseline = await execute(original(), { intentStatus });
    expect(actual.trace).toEqual(onlyReplaceOriginalHoldAmount(baseline.trace, 13900));
    expect(actual.error).toEqual(baseline.error);
  });

  it("normalizes only the authorized hold import/confirmed-amount guard/locked selection/returned amount/two amount uses; every other router byte equals HEAD", () => {
    const source = current();
    const { file, node } = actionNode(source);
    let body = node.getText(file);
    const compute = /^[ \t]*const amountCents = effectiveNativeVisitAmount\(booking, booking\.requestedLocalDate, \{ firstVisit: true \}\);\r?\n/gm;
    expect(body.match(compute)).toHaveLength(1);
    body = body.replace(compute, "");
    const guard = '        if (input.expectedAmountCents !== undefined && input.expectedAmountCents !== amountCents)\n          throw new TRPCError({ code: "CONFLICT", message: "The booking amount changed. Refresh the booking and confirm the current hold amount." });\n';
    expect(body.split(guard)).toHaveLength(2);
    body = body.replace(guard, "");
    expect(body.match(/booking, profile, pending, amountCents/g)).toHaveLength(2);
    body = body.replaceAll("booking, profile, pending, amountCents", "booking, profile, pending");
    expect(body.match(/^[ \t]*amountCents,\r?\n/gm)).toHaveLength(2);
    body = body.replace(/^([ \t]*)amountCents,\r?\n/gm, "$1amountCents: booking.firstCleaningTotalCents,\n");
    let normalized = source.slice(0, node.getStart(file)) + body + source.slice(node.end);
    const inputExtension = '.input(confirmedBookingInput.extend({ expectedAmountCents: z.number().int().nonnegative().safe().optional() }))';
    expect(normalized.split(inputExtension)).toHaveLength(2);
    normalized = normalized.replace(inputExtension, ".input(confirmedBookingInput)");
    const addedImport = 'import { effectiveNativeVisitAmount } from "../shared/nativeBookingManualAmounts";\n';
    expect(normalized.split(addedImport)).toHaveLength(2);
    normalized = normalized.replace(addedImport, "");
    expect(normalized).toBe(original());
  });
});
