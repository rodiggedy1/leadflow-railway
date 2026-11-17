import { TRPCError } from "@trpc/server";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { bookingFunnelRecords, type InsertBookingFunnelRecord } from "../drizzle/schema";
import { createCustomerBookingLinkInputSchema, type CreateCustomerBookingLinkInput } from "../shared/bookingFunnel";
import { createPublicBookingPriceSnapshot, PUBLIC_BOOKING_PRICING_VERSION } from "../shared/publicBookingPricing";
import { normalizePhone } from "./utils/phone";
import { createCustomerBookingLink, type CustomerBookingLinkAttribution, type CustomerBookingLinkDb } from "./customerBookingLinkService";
import { bookingFunnelRouter } from "./bookingFunnelRouter";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), broadcast: vi.fn(), randomBytes: vi.fn(), randomUUID: vi.fn() }));
vi.mock("node:crypto", async () => ({
  ...await vi.importActual<typeof import("node:crypto")>("node:crypto"),
  randomBytes: mocks.randomBytes,
  randomUUID: mocks.randomUUID,
}));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./sseBroadcast", () => ({ broadcastOpsUpdate: mocks.broadcast }));
vi.mock("./_core/env", () => ({ ENV: { cookieSecret: "offline-test-secret" } }));
vi.mock("./_core/trpc", async () => {
  const { initTRPC, TRPCError } = await import("@trpc/server");
  const t = initTRPC.context<{ agent?: CustomerBookingLinkAttribution }>().create();
  return {
    router: t.router,
    publicProcedure: t.procedure,
    bookingsAgentProcedure: t.procedure.use(({ ctx, next }) => {
      if (!ctx.agent) throw new TRPCError({ code: "UNAUTHORIZED", message: "Agent login required" });
      return next({ ctx: { agent: ctx.agent } });
    }),
  };
});
// Keep unrelated router imports inert: these tests never call models, APIs, or native booking paths.
vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn(() => { throw new Error("Forbidden model call"); }) }));
vi.mock("./cleanerPortalUpdates", () => ({ broadcastCleanerPortalJobsChanged: vi.fn() }));
vi.mock("./madisonKnowledgeRetrieval", () => ({ retrieveKnowledge: vi.fn() }));
vi.mock("./bookingLeadCreatedNotifications", () => ({ sendCustomerPortalLeadCreatedCommandChatCard: vi.fn(), sendWidgetLeadCreatedNotifications: vi.fn() }));
vi.mock("./_core/customerPortalAuth", () => ({ getCustomerPortalSessionFromRequest: vi.fn() }));
vi.mock("./bookingsService", () => ({ buildPreparedCanonicalBooking: vi.fn() }));
vi.mock("./canonicalBookingPersistence", () => ({ persistCanonicalBooking: vi.fn() }));
vi.mock("./bookingsRouter", () => ({ updateCanonicalBookingDetails: vi.fn() }));

type Db = NonNullable<Awaited<ReturnType<typeof import("./db").getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const attribution = { agentId: 17, agentName: "Test Agent" };
const fixedUuid = "11111111-1111-4111-8111-111111111111";
const fixedNow = new Date("2026-11-16T15:00:00.000Z");
const fixture = (overrides: Partial<CreateCustomerBookingLinkInput> = {}): CreateCustomerBookingLinkInput => ({
  customerName: "  Jane   Doe  ", customerPhone: "(703) 555-1234",
  customerEmail: "  Jane@EXAMPLE.com  ", address: "  123 Main Street  ",
  requestedLocalDate: "2026-11-20", requestedLocalTime: "09:30",
  pricing: { pricingMode: "home", serviceId: "standard", bedrooms: 1, bathrooms: 1, homeType: "House", condition: 5, maidCount: 2, hourCount: 2, extras: [], recurrence: "biweekly" },
  notes: ["Keep this note unchanged"], ...overrides,
});
function fakeDb() {
  const rows: InsertBookingFunnelRecord[] = [];
  const values = vi.fn(async (row: InsertBookingFunnelRecord) => { rows.push(row); return [{ insertId: 41 }]; });
  const insert = vi.fn((table: unknown) => { expect(table).toBe(bookingFunnelRecords); return { values }; });
  return { rows, values, insert, db: { insert } as unknown as CustomerBookingLinkDb };
}

// Verbatim pre-extraction createCustomerLink body, with ctx.agent replaced by attribution.
// This reference intentionally keeps the original calculations, order, and return shape.
async function originalCreateCustomerLink(db: CustomerBookingLinkDb, input: CreateCustomerBookingLinkInput, agent: CustomerBookingLinkAttribution) {
  const phone = normalizePhone(input.customerPhone);
  if (!phone) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a valid U.S. phone number." });
  const priceSnapshot = createPublicBookingPriceSnapshot(input.pricing);
  const normalizedCustomerName = input.customerName.trim().replace(/\s+/g, " ");
  const nameSlug = normalizedCustomerName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "customer";
  const token = `mib-${nameSlug}-${randomBytes(5).toString("hex")}`.slice(0, 40);
  const idempotencyKey = randomUUID();
  const commandHash = createHash("sha256").update(JSON.stringify({ token, idempotencyKey, input })).digest("hex");
  const now = new Date();
  await db.insert(bookingFunnelRecords).values({
    publicFunnelNumber: token, idempotencyKey, commandHash,
    source: "customer-booking-link", stage: "lead",
    bookedByAgentId: agent.agentId, bookedByAgentName: agent.agentName,
    customerName: normalizedCustomerName, customerPhone: phone,
    customerEmail: input.customerEmail?.trim().toLowerCase() || null,
    serviceId: input.pricing.serviceId, serviceName: priceSnapshot.serviceName,
    bedrooms: input.pricing.bedrooms, bathrooms: input.pricing.bathrooms,
    extras: input.pricing.extras, specialRequestNotes: input.notes,
    address: input.address?.trim() || null,
    requestedLocalDate: input.requestedLocalDate, requestedLocalTime: input.requestedLocalTime,
    requestedTimeZone: "America/New_York", recurrence: input.pricing.recurrence,
    pricingVersion: PUBLIC_BOOKING_PRICING_VERSION,
    firstCleaningTotalCents: priceSnapshot.breakdown.firstCleaningTotalCents,
    futureVisitTotalCents: priceSnapshot.breakdown.futureVisitTotalCents,
    priceSnapshot, version: 1, createdAt: now, updatedAt: now,
  });
  mocks.broadcast("booking_funnel_update");
  return { token, urlPath: `/book/${token}`, firstCleaningTotalCents: priceSnapshot.breakdown.firstCleaningTotalCents };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(fixedNow);
  mocks.randomBytes.mockReturnValue(Buffer.from("0123456789", "hex"));
  mocks.randomUUID.mockReturnValue(fixedUuid);
});
afterEach(() => vi.useRealTimers());

const pricingCases: Array<[string, Partial<CreateCustomerBookingLinkInput["pricing"]>]> = [
  ["default", {}], ["one-time", { recurrence: "one-time" }], ["weekly", { recurrence: "weekly" }], ["monthly", { recurrence: "monthly" }],
  ["condition and extras", { condition: 6, extras: [{ id: "inside-fridge", quantity: 2 }] }],
  ["unsorted extras", { extras: [{ id: "interior-windows", quantity: 3 }, { id: "inside-oven", quantity: 1 }] }],
  ["deep cleaning", { serviceId: "deep", bedrooms: 4, bathrooms: 3, homeType: "Townhome", condition: 8 }],
  ["move-out", { serviceId: "moveout", bedrooms: 0, bathrooms: 1, homeType: "Condo" }],
  ["hourly", { pricingMode: "hourly" }],
  ["hourly extras", { pricingMode: "hourly", recurrence: "weekly", maidCount: 4, hourCount: 8, extras: [{ id: "laundry-load", quantity: 3 }] }],
  ["custom price", { customPriceCents: 12345, recurrence: "monthly", extras: [{ id: "inside-fridge", quantity: 2 }] }],
  ["custom minimum", { customPriceCents: 1, recurrence: "one-time" }],
  ["custom maximum hourly", { pricingMode: "hourly", customPriceCents: 1_000_000 }],
];

describe("customer booking link extraction parity", () => {
  it.each(pricingCases)("matches the original complete inserted snapshot and result for %s", async (_label, pricing) => {
    const input = fixture();
    Object.assign(input.pricing, pricing);
    const beforeInput = structuredClone(input);
    const control = fakeDb();
    const expected = await originalCreateCustomerLink(control.db, input, attribution);
    mocks.broadcast.mockClear();
    const extracted = fakeDb();
    expect(await createCustomerBookingLink(extracted.db, input, attribution)).toEqual(expected);
    expect(extracted.rows).toEqual(control.rows);
    expect(extracted.insert).toHaveBeenCalledTimes(1);
    expect(extracted.values).toHaveBeenCalledTimes(1);
    expect(mocks.broadcast.mock.calls).toEqual([["booking_funnel_update"]]);
    expect(extracted.rows[0].createdAt).toBe(extracted.rows[0].updatedAt);
    expect(input).toEqual(beforeInput);
  });

  it("pins the exact default record fields and the public return shape", async () => {
    const input = fixture();
    const memory = fakeDb();
    const result = await createCustomerBookingLink(memory.db, input, attribution);
    expect(result).toEqual({ token: "mib-jane-doe-0123456789", urlPath: "/book/mib-jane-doe-0123456789", firstCleaningTotalCents: 18900 });
    expect(memory.rows[0]).toEqual({
      publicFunnelNumber: result.token, idempotencyKey: fixedUuid,
      commandHash: createHash("sha256").update(JSON.stringify({ token: result.token, idempotencyKey: fixedUuid, input })).digest("hex"),
      source: "customer-booking-link", stage: "lead", bookedByAgentId: 17, bookedByAgentName: "Test Agent",
      customerName: "Jane Doe", customerPhone: "+17035551234", customerEmail: "jane@example.com", address: "123 Main Street",
      serviceId: "standard", serviceName: "Standard Cleaning", bedrooms: 1, bathrooms: 1, extras: [], specialRequestNotes: input.notes,
      requestedLocalDate: "2026-11-20", requestedLocalTime: "09:30", requestedTimeZone: "America/New_York", recurrence: "biweekly",
      pricingVersion: "public-book-v2", firstCleaningTotalCents: 18900, futureVisitTotalCents: 16100,
      priceSnapshot: createPublicBookingPriceSnapshot(input.pricing), version: 1, createdAt: fixedNow, updatedAt: fixedNow,
    });
    expect(Object.keys(result).sort()).toEqual(["firstCleaningTotalCents", "token", "urlPath"]);
    expect(memory.rows[0].extras).toBe(input.pricing.extras);
    expect(memory.rows[0].specialRequestNotes).toBe(input.notes);
    expect((memory.rows[0].priceSnapshot as ReturnType<typeof createPublicBookingPriceSnapshot>).input.extras).not.toBe(input.pricing.extras);
  });

  it.each([
    ["one-time", 18900, null], ["weekly", 18900, 15100], ["biweekly", 18900, 16100], ["monthly", 18900, 17000],
  ] as const)("pins %s recurrence totals without another pricing implementation", async (recurrence, first, future) => {
    const input = fixture(); input.pricing.recurrence = recurrence;
    const memory = fakeDb(); await createCustomerBookingLink(memory.db, input, attribution);
    expect(memory.rows[0].firstCleaningTotalCents).toBe(first);
    expect(memory.rows[0].futureVisitTotalCents).toBe(future);
  });

  it.each(["7035551234", "17035551234", "+17035551234", "(703) 555-1234", "703.555.1234"])("retains shared phone normalization for %s", async customerPhone => {
    const memory = fakeDb(); await createCustomerBookingLink(memory.db, fixture({ customerPhone }), attribution);
    expect(memory.rows[0].customerPhone).toBe("+17035551234");
  });

  it.each([
    ["  Jane\t\nDoe  ", "Jane Doe", "jane-doe"], ["  Élodie O'Neil  ", "Élodie O'Neil", "lodie-o-neil"],
    ["客户", "客户", "customer"], ["--", "--", "customer"],
    ["ABCDEFGHIJKLMNOPQRSTUVWXYZ Long Name", "ABCDEFGHIJKLMNOPQRSTUVWXYZ Long Name", "abcdefghijklmnopqrstuvwx"],
  ])("retains name normalization and the original slug for %s", async (customerName, normalized, slug) => {
    const memory = fakeDb(); const result = await createCustomerBookingLink(memory.db, fixture({ customerName }), attribution);
    expect(memory.rows[0].customerName).toBe(normalized);
    expect(result.token).toBe(`mib-${slug}-0123456789`);
    expect(result.token.length).toBeLessThanOrEqual(40);
    expect(mocks.randomBytes.mock.calls).toEqual([[5]]);
    expect(mocks.randomUUID).toHaveBeenCalledTimes(1);
  });

  it("preserves optional null fields, raw notes, and input-based command hashing", async () => {
    const input = fixture({ customerEmail: undefined, address: undefined, notes: ["  raw note  "] });
    const first = fakeDb(); await createCustomerBookingLink(first.db, input, attribution);
    expect(first.rows[0]).toMatchObject({ customerEmail: null, address: null, specialRequestNotes: ["  raw note  "] });
    const second = fakeDb(); await createCustomerBookingLink(second.db, { ...input, customerName: "Jane Doe" }, attribution);
    expect(first.rows[0].customerName).toBe(second.rows[0].customerName);
    expect(first.rows[0].commandHash).not.toBe(second.rows[0].commandHash);
  });

  it("generates fresh ten-hex-suffix tokens, UUIDs and SHA-256 identities on the default path", async () => {
    const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
    mocks.randomBytes.mockImplementation(actual.randomBytes);
    mocks.randomUUID.mockImplementation(actual.randomUUID);
    const memory = fakeDb();
    const a = await createCustomerBookingLink(memory.db, fixture(), attribution);
    const b = await createCustomerBookingLink(memory.db, fixture(), attribution);
    expect(a.token).toMatch(/^mib-jane-doe-[a-f0-9]{10}$/);
    expect(b.token).toMatch(/^mib-jane-doe-[a-f0-9]{10}$/);
    expect(a.token).not.toBe(b.token);
    expect(memory.rows[0].idempotencyKey).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(memory.rows[0].idempotencyKey).not.toBe(memory.rows[1].idempotencyKey);
    for (const row of memory.rows) expect(row.commandHash).toBe(createHash("sha256").update(JSON.stringify({ token: row.publicFunnelNumber, idempotencyKey: row.idempotencyKey, input: fixture() })).digest("hex"));
  });
});

describe("customer booking link failure and transaction boundaries", () => {
  it.each(["", "123", "1234567890", "7031551234", "27035551234", "+447911123456", "+170355512345"])("keeps invalid phone %s as the exact BAD_REQUEST before pricing or identity generation", async customerPhone => {
    const input = fixture({ customerPhone }); input.pricing.extras = [{ id: "unsupported", quantity: 1 }];
    const memory = fakeDb();
    await expect(createCustomerBookingLink(memory.db, input, attribution)).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Enter a valid U.S. phone number." });
    await expect(originalCreateCustomerLink(memory.db, input, attribution)).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Enter a valid U.S. phone number." });
    expect(memory.insert).not.toHaveBeenCalled(); expect(mocks.randomBytes).not.toHaveBeenCalled(); expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it.each([
    ["unsupported extra", { extras: [{ id: "unsupported", quantity: 1 }] }, "Unsupported extra: unsupported"],
    ["duplicate extra", { extras: [{ id: "inside-fridge", quantity: 1 }, { id: "inside-fridge", quantity: 2 }] }, "Duplicate extra: inside-fridge"],
    ["invalid override", { customPriceCents: 0 }, "Custom first-cleaning price must be a whole number from 1 through 1000000."],
  ] as const)("preserves %s pricing error without wrapping it or writing", async (_label, pricing, message) => {
    const input = fixture(); Object.assign(input.pricing, pricing);
    const memory = fakeDb();
    await expect(createCustomerBookingLink(memory.db, input, attribution)).rejects.toThrow(message);
    await expect(originalCreateCustomerLink(memory.db, input, attribution)).rejects.toThrow(message);
    expect(memory.insert).not.toHaveBeenCalled(); expect(mocks.randomBytes).not.toHaveBeenCalled(); expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it.each(["insert", "values", "awaited values", "duplicate"])("propagates the exact %s DB failure with no notification or retry", async point => {
    const error = Object.assign(new Error(`Injected ${point} failure`), point === "duplicate" ? { code: "ER_DUP_ENTRY" } : {});
    for (const create of [originalCreateCustomerLink, createCustomerBookingLink]) {
      const memory = fakeDb();
      if (point === "insert") memory.insert.mockImplementation(() => { throw error; });
      else if (point === "values") memory.values.mockImplementation(() => { throw error; });
      else memory.values.mockRejectedValue(error);
      await expect(create(memory.db, fixture(), attribution)).rejects.toBe(error);
      expect(memory.insert).toHaveBeenCalledTimes(1);
      expect(memory.rows).toHaveLength(0);
      expect(mocks.broadcast).not.toHaveBeenCalled();
    }
  });

  it("keeps the inserted row and propagates the exact broadcast failure without rollback or retry", async () => {
    const error = new Error("Injected broadcast failure");
    for (const create of [originalCreateCustomerLink, createCustomerBookingLink]) {
      mocks.broadcast.mockClear(); mocks.broadcast.mockImplementation(() => { throw error; });
      const memory = fakeDb();
      await expect(create(memory.db, fixture(), attribution)).rejects.toBe(error);
      expect(memory.rows).toHaveLength(1); expect(memory.insert).toHaveBeenCalledTimes(1);
      expect(mocks.broadcast.mock.calls).toEqual([["booking_funnel_update"]]);
    }
  });

  it("does not notify while insertion is pending and notifies exactly once after it resolves", async () => {
    const memory = fakeDb(); let finish!: () => void;
    memory.values.mockImplementation(row => new Promise(resolve => { finish = () => { memory.rows.push(row); resolve([{ insertId: 41 }]); }; }));
    const pending = createCustomerBookingLink(memory.db, fixture(), attribution);
    expect(mocks.broadcast).not.toHaveBeenCalled(); expect(memory.rows).toHaveLength(0);
    finish(); await pending;
    expect(mocks.broadcast.mock.calls).toEqual([["booking_funnel_update"]]);
  });

  it("accepts Db and Tx insert-only structural types", () => {
    expectTypeOf<Db>().toMatchTypeOf<CustomerBookingLinkDb>();
    expectTypeOf<Tx>().toMatchTypeOf<CustomerBookingLinkDb>();
  });

  it("uses the AI attribution with one transaction insert and lets the caller notify only after commit", async () => {
    const memory = fakeDb(); const notify = vi.fn(); const phases: string[] = [];
    const transaction = async (callback: (tx: CustomerBookingLinkDb) => Promise<unknown>) => {
      phases.push("begin"); const result = await callback(memory.db); phases.push("commit"); return result;
    };
    const result = await transaction(async tx => {
      const link = await createCustomerBookingLink(tx, fixture(), { agentId: null, agentName: "Instinct · AI Call" }, () => {});
      expect(mocks.broadcast).not.toHaveBeenCalled(); expect(notify).not.toHaveBeenCalled();
      expect(memory.rows).toHaveLength(1); return link;
    });
    notify(); phases.push("notify");
    expect(phases).toEqual(["begin", "commit", "notify"]);
    expect(memory.insert).toHaveBeenCalledTimes(1);
    expect(memory.rows[0]).toMatchObject({ bookedByAgentId: null, bookedByAgentName: "Instinct · AI Call", source: "customer-booking-link", stage: "lead" });
    expect(result).toEqual({ token: "mib-jane-doe-0123456789", urlPath: "/book/mib-jane-doe-0123456789", firstCleaningTotalCents: 18900 });
    expect(notify).toHaveBeenCalledTimes(1); expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it("allows transaction rollback without an early default notification", async () => {
    const memory = fakeDb(); const error = new Error("Commit failed");
    const transaction = async (callback: (tx: CustomerBookingLinkDb) => Promise<unknown>) => {
      await callback(memory.db); memory.rows.length = 0; throw error;
    };
    await expect(transaction(tx => createCustomerBookingLink(tx, fixture(), { agentId: null, agentName: "Instinct · AI Call" }, () => {}))).rejects.toBe(error);
    expect(memory.insert).toHaveBeenCalledTimes(1); expect(memory.rows).toHaveLength(0); expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it("uses a supplied synchronous notify exactly once and propagates its failure after inserting", async () => {
    const memory = fakeDb(); const error = new Error("Custom notify failed");
    const notify = vi.fn(() => { expect(memory.rows).toHaveLength(1); throw error; });
    await expect(createCustomerBookingLink(memory.db, fixture(), attribution, notify)).rejects.toBe(error);
    expect(notify.mock.calls).toEqual([[]]); expect(mocks.broadcast).not.toHaveBeenCalled(); expect(memory.rows).toHaveLength(1);
  });
});

describe("customer booking link router adapter", () => {
  const caller = (agent: CustomerBookingLinkAttribution | undefined = attribution) => bookingFunnelRouter.createCaller({ agent } as never);
  it("preserves the bookings-agent procedure and delegates the existing parsed input and attribution", async () => {
    const input = fixture(); const parsed = createCustomerBookingLinkInputSchema.parse(input);
    const control = fakeDb(); const expected = await originalCreateCustomerLink(control.db, parsed, attribution);
    mocks.broadcast.mockClear(); const memory = fakeDb(); mocks.getDb.mockResolvedValue(memory.db);
    expect(await caller().createCustomerLink(input)).toEqual(expected);
    expect(memory.rows).toEqual(control.rows); expect(mocks.getDb).toHaveBeenCalledTimes(1);
    expect(mocks.broadcast.mock.calls).toEqual([["booking_funnel_update"]]);
    const source = readFileSync(new URL("./bookingFunnelRouter.ts", import.meta.url), "utf8");
    expect(source).toMatch(/createCustomerLink:\s*bookingsAgentProcedure\s*\.input\(createCustomerBookingLinkInputSchema\)/);
  });

  it("keeps authorization ahead of database access", async () => {
    await expect(bookingFunnelRouter.createCaller({} as never).createCustomerLink(fixture())).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.getDb).not.toHaveBeenCalled(); expect(mocks.randomBytes).not.toHaveBeenCalled(); expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it("preserves the unavailable database TRPC error ahead of phone validation", async () => {
    mocks.getDb.mockResolvedValue(null);
    await expect(caller().createCustomerLink(fixture({ customerPhone: "1234567" }))).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Booking service unavailable." });
    expect(mocks.randomBytes).not.toHaveBeenCalled(); expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it("preserves the invalid phone TRPC error with a database available", async () => {
    const memory = fakeDb(); mocks.getDb.mockResolvedValue(memory.db);
    await expect(caller().createCustomerLink(fixture({ customerPhone: "1234567" }))).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Enter a valid U.S. phone number." });
    expect(memory.insert).not.toHaveBeenCalled(); expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it("keeps schema validation ahead of database access", async () => {
    await expect(caller().createCustomerLink(fixture({ customerName: " " }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.getDb).not.toHaveBeenCalled(); expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it("does not turn a failed getDb into a phone error", async () => {
    const error = new Error("Injected getDb failure"); mocks.getDb.mockRejectedValue(error);
    await expect(caller().createCustomerLink(fixture())).rejects.toMatchObject({ cause: error });
    expect(mocks.randomBytes).not.toHaveBeenCalled(); expect(mocks.broadcast).not.toHaveBeenCalled();
  });
});
