import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Script } from "node:vm";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";

const root = resolve(import.meta.dirname, "..");
const adminSource = readFileSync(resolve(root, "server/bookingPaymentAdminRouter.ts"), "utf8");
const webhookSource = readFileSync(resolve(root, "server/stripeWebhookRoute.ts"), "utf8");

function between(source: string, start: string, end: string) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  if (first < 0 || last < 0) throw new Error(`Cannot extract source block: ${start}`);
  return source.slice(first, last);
}

// Execute production expressions, not a reimplementation of their decisions.
// No router imports, application startup, connections, or provider SDK are used.
const wrapper = `
${between(adminSource, "function stripeFailureMessage(", "function affectedRows(")}
${between(adminSource, "async function activePortalRequestHold(", "export const bookingPaymentAdminRouter")}
const callbacks = {
${between(adminSource, "placeHold: agentProcedure", "captureHold: agentProcedure")}
${between(adminSource, "placePortalRequestHold: agentProcedure", "capturePortalRequestHold: agentProcedure")}
};
${between(webhookSource, "async function promoteMarkedPendingAuthorization(", "async function reconcileEvent(")}
globalThis.extracted = { ...callbacks, promoteMarkedPendingAuthorization };
`;
const compiled = (source: string) => transformSync(source, {
  loader: "ts", target: "es2022", format: "cjs",
}).code;
const currentCode = compiled(wrapper);
// Negative control: restore only the old status literals in the same source.
const originalStatusCode = compiled(wrapper.replaceAll('"pending_card"', '"pending"'));

// Captured database contract; deliberately independent of the varchar TS schema.
const capturedAuthorizationStatuses = ["pending_card", "authorized", "captured", "cancelled", "failed"] as const;
type Row = Record<string, any>;
type Column = { table: string; key: string };
type Predicate =
  | { op: "eq"; column: Column; value: unknown }
  | { op: "and" | "or"; terms: Predicate[] };
type Table = { name: string; [key: string]: any };
type Flow = "native" | "portal";

function table(name: string, keys: string[]): Table {
  return Object.assign({ name }, Object.fromEntries(keys.map(key => [key, { table: name, key }])));
}
const paymentAuthorizations = table("payment_authorizations", [
  "id", "bookingPaymentProfileId", "customerPortalServiceRequestId", "status", "createdAt",
]);
const bookingPaymentProfiles = table("booking_payment_profiles", ["id", "bookingId"]);
const bookings = table("bookings", ["id"]);
const eq = (column: Column, value: unknown): Predicate => ({ op: "eq", column, value });
const and = (...terms: Predicate[]): Predicate => ({ op: "and", terms });
const or = (...terms: Predicate[]): Predicate => ({ op: "or", terms });
function matches(predicate: Predicate, row: Row, target: Table): boolean {
  if (predicate.op === "eq") {
    if (predicate.column.table !== target.name) throw new Error("Unexpected cross-table predicate");
    return row[predicate.column.key] === predicate.value;
  }
  return predicate.op === "and"
    ? predicate.terms.every(term => matches(term, row, target))
    : predicate.terms.some(term => matches(term, row, target));
}

function database(profile: Row, booking: Row) {
  const rows: Record<string, Row[]> = {
    [paymentAuthorizations.name]: [],
    [bookingPaymentProfiles.name]: [profile],
    [bookings.name]: [booking],
  };
  const writes: { table: string; ids: number[]; values: Row; predicate?: Predicate }[] = [];
  const selects: { table: string; predicate: Predicate }[] = [];
  function validate(target: Table, values: Row) {
    if (target === paymentAuthorizations && values.status !== undefined &&
      !capturedAuthorizationStatuses.includes(values.status)) {
      throw new Error(`Captured authorization enum rejects ${values.status}`);
    }
  }
  const db = {
    select: (_projection?: unknown) => ({
      from: (target: Table) => ({
        where: (predicate: Predicate) => {
          selects.push({ table: target.name, predicate });
          const selected = () => rows[target.name].filter(row => matches(predicate, row, target));
          return {
            limit: async (count: number) => selected().slice(0, count),
            orderBy: (_order: unknown) => ({ limit: async (count: number) => selected().slice(-count) }),
            then: (fulfilled: any, rejected: any) => Promise.resolve(selected()).then(fulfilled, rejected),
          };
        },
      }),
    }),
    insert: (target: Table) => ({
      values: (values: Row) => {
        validate(target, values);
        return {
          $returningId: async () => {
            const id = Math.max(99, ...rows[target.name].map(row => row.id)) + 1;
            rows[target.name].push({ ...values, id });
            writes.push({ table: target.name, ids: [id], values: { ...values } });
            return [{ id }];
          },
        };
      },
    }),
    update: (target: Table) => ({
      set: (values: Row) => ({
        where: async (predicate: Predicate) => {
          validate(target, values);
          const selected = rows[target.name].filter(row => matches(predicate, row, target));
          writes.push({ table: target.name, ids: selected.map(row => row.id), values: { ...values }, predicate });
          selected.forEach(row => Object.assign(row, values));
          return [{ affectedRows: selected.length }];
        },
      }),
    }),
    transaction: async (callback: (tx: any) => Promise<unknown>) => callback(db),
  };
  return { db, rows, writes, selects };
}

class OfflineTRPCError extends Error {
  readonly code: string;
  constructor(options: { code: string; message: string }) {
    super(options.message);
    this.code = options.code;
  }
}

function harness(flow: Flow, options: { oldStatus?: boolean; failure?: Row | Error; intentStatus?: string } = {}) {
  const booking: Row = {
    id: 7, publicBookingNumber: "B-7", customerName: "Offline customer",
    customerPhone: "+15550000007", firstCleaningTotalCents: 12345, paymentStatus: "card_on_file",
  };
  const profile: Row = {
    id: 41, bookingId: booking.id, version: 3, paymentStatus: "card_on_file",
    stripeCustomerId: "cus_offline", stripePaymentMethodId: "pm_offline",
  };
  const request: Row = {
    id: 9, publicRequestNumber: "R-9", customerName: booking.customerName,
    customerPhone: booking.customerPhone, estimatedTotalCents: booking.firstCleaningTotalCents,
    stripePaymentMethodId: profile.stripePaymentMethodId, paymentLast4: "4242",
    stripePaymentIntentId: null, paymentChargedAt: null,
  };
  const memory = database(profile, booking);
  const beforeProvider: Row[] = [];
  const create = vi.fn(async (..._args: any[]) => {
    const row = memory.rows[paymentAuthorizations.name].at(-1)!;
    beforeProvider.push({ ...row });
    expect(row.status).toBe("pending_card");
    expect(row.stripePaymentIntentId).toBeNull();
    if (options.failure) throw options.failure;
    return {
      id: "pi_offline", status: options.intentStatus ?? "requires_capture",
      payment_method_options: { card: { capture_before: 2000000000 } },
    };
  });
  const stripe = { paymentIntents: { create } };
  const getStripeClient = vi.fn(() => stripe);
  const authorizeCanonicalBookingHold = vi.fn(async (client: typeof stripe, input: Row) =>
    client.paymentIntents.create(input));
  const portalRequestStripeCardOrThrow = vi.fn(async () => ({ stripe, customerId: profile.stripeCustomerId }));
  const syncNativeBookingPaymentState = vi.fn(async (_tx: unknown, values: Row) => {
    expect(values.bookingId).toBe(booking.id);
    Object.assign(booking, values);
  });
  const bindings: Row = {
    paymentAuthorizations, bookingPaymentProfiles, bookings, eq, and, or,
    desc: (column: Column) => column,
    agentProcedure: { input: () => ({ mutation: (callback: unknown) => callback }) },
    confirmedBookingInput: {}, confirmedPortalRequestInput: {},
    paymentTargetOrThrow: async () => ({ db: memory.db, booking, profile }),
    portalRequestPaymentTargetOrThrow: async () => ({ db: memory.db, request }),
    portalRequestStripeCardOrThrow, getStripeClient, authorizeCanonicalBookingHold,
    syncNativeBookingPaymentState, getDb: vi.fn(async () => memory.db),
    TRPCError: OfflineTRPCError,
  };
  new Script(options.oldStatus ? originalStatusCode : currentCode).runInNewContext(bindings, { timeout: 1000 });
  const extracted = bindings.extracted;
  const place = () => extracted[flow === "native" ? "placeHold" : "placePortalRequestHold"]({
    input: flow === "native" ? { bookingId: booking.id, confirmed: true } : { requestId: request.id, confirmed: true },
    ctx: { agent: { agentName: "Offline tester" } },
  });
  function seed(overrides: Row = {}) {
    const row: Row = {
      id: 100, bookingPaymentProfileId: flow === "native" ? profile.id : null,
      customerPortalServiceRequestId: flow === "portal" ? request.id : null,
      status: "pending_card", stripeCustomerId: profile.stripeCustomerId,
      stripePaymentMethodId: profile.stripePaymentMethodId, stripePaymentIntentId: null,
      amountCents: booking.firstCleaningTotalCents, currency: "usd",
      customerPhone: booking.customerPhone, ...overrides,
    };
    memory.rows[paymentAuthorizations.name].push(row);
    return row;
  }
  function event(overrides: Row = {}) {
    return {
      id: "pi_webhook", status: "requires_capture", capture_method: "manual",
      customer: profile.stripeCustomerId, payment_method: profile.stripePaymentMethodId,
      amount: booking.firstCleaningTotalCents, amount_capturable: booking.firstCleaningTotalCents,
      currency: "usd", payment_method_options: { card: { capture_before: 2000000000 } },
      metadata: {
        leadflowAuthorizationAttempt: "v1", leadflowAuthorizationAttemptId: "100", operation: "authorization",
        ...(flow === "native"
          ? { bookingPaymentProfileId: String(profile.id), bookingId: String(booking.id) }
          : { customerPortalServiceRequestId: String(request.id) }),
      },
      ...overrides,
    };
  }
  return {
    ...memory, place, seed, event, profile, booking, request, beforeProvider, create,
    getStripeClient, authorizeCanonicalBookingHold, portalRequestStripeCardOrThrow,
    syncNativeBookingPaymentState, promote: extracted.promoteMarkedPendingAuthorization,
  };
}

const flows: Flow[] = ["native", "portal"];
describe("captured authorization status compatibility: extracted production behavior", () => {
  it.each(flows)("%s persists pending_card before provider creation and authorizes the same row", async flow => {
    const h = harness(flow);
    const unrelated = h.seed({ id: 80, bookingPaymentProfileId: 900, customerPortalServiceRequestId: 901 });
    const result = await h.place();
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.beforeProvider).toHaveLength(1);
    const pending = h.beforeProvider[0];
    expect(pending).toMatchObject({ status: "pending_card", amountCents: 12345, stripeCustomerId: "cus_offline", stripePaymentMethodId: "pm_offline" });
    expect(result).toMatchObject({ authorizationId: pending.id, paymentStatus: "authorized", captureBefore: 2000000000000 });
    expect(h.rows[paymentAuthorizations.name]).toHaveLength(2);
    expect(h.rows[paymentAuthorizations.name][1]).toMatchObject({ id: pending.id, status: "authorized", stripePaymentIntentId: "pi_offline", errorMessage: null });
    expect(unrelated).toMatchObject({ id: 80, status: "pending_card", stripePaymentIntentId: null });
    expect(h.writes.filter(write => write.table === paymentAuthorizations.name).map(write => write.ids)).toEqual([[pending.id], [pending.id]]);
    if (flow === "native") {
      expect(h.authorizeCanonicalBookingHold).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ authorizationAttemptId: pending.id, bookingId: 7, profileId: 41 }));
      expect(h.profile).toMatchObject({ paymentStatus: "authorized", stripePaymentIntentId: "pi_offline" });
      expect(h.booking.paymentStatus).toBe("authorized");
    } else {
      expect(h.create).toHaveBeenCalledWith(expect.objectContaining({
        capture_method: "manual", metadata: expect.objectContaining({ leadflowAuthorizationAttemptId: String(pending.id) }),
      }), expect.objectContaining({ idempotencyKey: "leadflow:portal-request:9:authorization:v1" }));
      expect(h.request.stripePaymentIntentId).toBeNull();
    }
  });

  for (const status of ["pending_card", "authorized"]) {
    it.each(flows)(`%s blocks an existing ${status} attempt before provider access`, async flow => {
      const h = harness(flow);
      h.seed({ status });
      await expect(h.place()).rejects.toMatchObject({ code: "CONFLICT" });
      expect(h.create).not.toHaveBeenCalled();
      expect(h.authorizeCanonicalBookingHold).not.toHaveBeenCalled();
      expect(h.portalRequestStripeCardOrThrow).not.toHaveBeenCalled();
      expect(h.getStripeClient).not.toHaveBeenCalled();
      expect(h.writes).toEqual([]);
    });
  }

  it.each(flows)("%s preserves supported pending_card after an unknown outcome and blocks the next attempt", async flow => {
    const h = harness(flow, { failure: new Error("offline timeout") });
    await expect(h.place()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(h.rows[paymentAuthorizations.name][0]).toMatchObject({ id: 100, status: "pending_card", stripePaymentIntentId: null });
    expect(h.rows[paymentAuthorizations.name][0].errorMessage).toContain("outcome is unknown");
    expect(h.profile.paymentStatus).toBe("card_on_file");
    const writeCount = h.writes.length;
    await expect(h.place()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.rows[paymentAuthorizations.name]).toHaveLength(1);
    expect(h.writes).toHaveLength(writeCount);
  });

  it.each(flows)("%s marks a definitive provider failure failed on the original row", async flow => {
    const h = harness(flow, { failure: { statusCode: 402, message: "offline declined" } });
    await expect(h.place()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.rows[paymentAuthorizations.name]).toHaveLength(1);
    expect(h.rows[paymentAuthorizations.name][0]).toMatchObject({ id: 100, status: "failed", errorMessage: "offline declined" });
    if (flow === "native") {
      expect(h.profile.paymentStatus).toBe("failed");
      expect(h.booking.paymentStatus).toBe("failed");
    }
  });

  it.each(flows)("%s rejects the original pending literal at the enum boundary before Stripe", async flow => {
    const h = harness(flow, { oldStatus: true });
    await expect(h.place()).rejects.toThrow("Captured authorization enum rejects pending");
    expect(h.create).not.toHaveBeenCalled();
    expect(h.authorizeCanonicalBookingHold).not.toHaveBeenCalled();
    expect(h.rows[paymentAuthorizations.name]).toEqual([]);
    expect(h.writes).toEqual([]);
  });
});

// This helper consumes the object after route signature validation; transport
// verification is not simulated and no extra Stripe call is permitted here.
describe("signed-event promotion: extracted production helper", () => {
  it.each(flows)("%s promotes only the marked pending_card row without another Stripe call", async flow => {
    const h = harness(flow);
    const row = h.seed();
    const unrelated = h.seed({ id: 101 });
    expect(await h.promote(h.event())).toBe(true);
    expect(h.rows[paymentAuthorizations.name][0]).toBe(row);
    expect(row).toMatchObject({ id: 100, status: "authorized", stripePaymentIntentId: "pi_webhook", captureBefore: 2000000000000 });
    expect(unrelated).toMatchObject({ id: 101, status: "pending_card", stripePaymentIntentId: null });
    const authorizationWrite = h.writes.find(write => write.table === paymentAuthorizations.name)!;
    expect(authorizationWrite.ids).toEqual([100]);
    expect(authorizationWrite.predicate).toEqual(and(eq(paymentAuthorizations.id, 100), eq(paymentAuthorizations.status, "pending_card")));
    if (flow === "native") {
      expect(h.profile).toMatchObject({ paymentStatus: "authorized", stripePaymentIntentId: "pi_webhook", authorizationExpiresAt: 2000000000000 });
      expect(h.booking).toMatchObject({ paymentStatus: "authorized", status: "needs_attention" });
    } else {
      expect(h.writes).toHaveLength(1);
      expect(h.profile.paymentStatus).toBe("card_on_file");
      expect(h.request.stripePaymentIntentId).toBeNull();
    }
    const writeCount = h.writes.length;
    expect(await h.promote(h.event())).toBe(false);
    expect(h.writes).toHaveLength(writeCount);
    expect(h.create).not.toHaveBeenCalled();
    expect(h.getStripeClient).not.toHaveBeenCalled();
  });

  const mismatches: [string, (event: Row) => Row][] = [
    ["missing marker", event => ({ ...event, metadata: { ...event.metadata, leadflowAuthorizationAttempt: undefined } })],
    ["invalid attempt", event => ({ ...event, metadata: { ...event.metadata, leadflowAuthorizationAttemptId: "0" } })],
    ["provider status", event => ({ ...event, status: "succeeded" })],
    ["capture method", event => ({ ...event, capture_method: "automatic" })],
    ["operation", event => ({ ...event, metadata: { ...event.metadata, operation: "direct_charge" } })],
    ["customer", event => ({ ...event, customer: "cus_other" })],
    ["payment method", event => ({ ...event, payment_method: "pm_other" })],
    ["amount", event => ({ ...event, amount: event.amount + 1 })],
    ["capturable amount", event => ({ ...event, amount_capturable: event.amount - 1 })],
    ["currency", event => ({ ...event, currency: "eur" })],
    ["profile binding", event => ({ ...event, metadata: { ...event.metadata, bookingPaymentProfileId: "42" } })],
    ["booking binding", event => ({ ...event, metadata: { ...event.metadata, bookingId: "8" } })],
  ];
  it.each(mismatches)("ignores a signed object with mismatched %s without promotion or provider access", async (_label, change) => {
    const h = harness("native");
    const row = h.seed();
    expect(await h.promote(change(h.event()))).toBe(false);
    expect(row).toMatchObject({ status: "pending_card", stripePaymentIntentId: null });
    expect(h.profile.paymentStatus).toBe("card_on_file");
    expect(h.writes).toEqual([]);
    expect(h.create).not.toHaveBeenCalled();
    expect(h.getStripeClient).not.toHaveBeenCalled();
  });

  it("ignores a mismatched portal request binding", async () => {
    const h = harness("portal");
    h.seed();
    const event = h.event();
    event.metadata.customerPortalServiceRequestId = "10";
    expect(await h.promote(event)).toBe(false);
    expect(h.writes).toEqual([]);
    expect(h.getStripeClient).not.toHaveBeenCalled();
  });

  it("the original pending predicate cannot promote a supported pending_card row", async () => {
    const h = harness("native", { oldStatus: true });
    const row = h.seed();
    expect(await h.promote(h.event())).toBe(false);
    expect(row.status).toBe("pending_card");
    expect(h.writes).toEqual([]);
    expect(h.getStripeClient).not.toHaveBeenCalled();
  });
});
