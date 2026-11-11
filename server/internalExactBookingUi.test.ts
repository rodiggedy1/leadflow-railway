import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as ts from "typescript";
import { createBookingArrivalPreference } from "../shared/bookingArrival";
import { calculatePublicBookingPrice } from "../shared/publicBookingPricing";
import { createCanonicalPricingInput, type CanonicalBookingDraft } from "../shared/canonicalBooking";
import { createInternalExactPrepareInput, internalBookingErrorMessage, type InternalExactBookingApi, type NativePreparedBooking } from "../client/src/components/internal-booking/InternalExactBookingApi";
import { createInternalExactBookingSession } from "../client/src/components/internal-booking/InternalExactBookingSession";
import type { InternalBookingSubmission } from "../client/src/components/internal-booking/InternalBookingAdapter";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const internal = "client/src/components/internal-booking/";
const draft = (overrides: Partial<CanonicalBookingDraft> = {}): CanonicalBookingDraft => ({
  serviceId: "deep", pricingMode: "home", bedrooms: 3, bathrooms: 2, homeType: "House",
  maidCount: 2, hourCount: 4, condition: 8, frequency: "biweekly",
  extras: { "inside-fridge": 2, "inside-oven": 1 },
  customerName: "  Alex Morgan  ", customerPhone: " 202-555-0142 ", customerEmail: " alex@example.test ",
  address: " 123 Test Street, Unit 4, Washington, DC, 20001 ",
  requestedLocalDate: "2026-11-18", requestedLocalTime: "16:30",
  specialRequestNotes: ["  Gate 123  ", " ", " Access: Lockbox "],
  arrivalPreference: createBookingArrivalPreference("flexible"), ...overrides,
});
const submission = (changes: Partial<InternalBookingSubmission> = {}): InternalBookingSubmission => ({
  draft: draft(), idempotencyKey: "d432d702-5ff4-4f0a-97ab-a9602716ef28", paymentMethod: "card", ...changes,
});
const prepared = (changes: Partial<NativePreparedBooking> = {}): NativePreparedBooking => ({
  bookingId: 91, publicBookingNumber: "BK-91", publicFunnelNumber: "BF-91", stage: "payment_incomplete",
  version: 1, created: true, totalCents: 34567, firstCleaningTotalCents: 34567, futureVisitTotalCents: 20000,
  paymentMethod: "card", paymentStatus: "pending", unpaid: false, ...changes,
});
function api(prepare: InternalExactBookingApi["prepare"]): InternalExactBookingApi {
  const unused = async () => { throw new Error("Provider method must not run in this test"); };
  return { prepare, startSetup: unused, confirmSetup: unused, finalize: unused, prepareCashApp: unused, settleCashApp: unused, abandonCashApp: unused };
}
function functionReturnJsx(source: string, name: string) {
  const parsed = ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name) as ts.FunctionDeclaration | undefined;
  if (!declaration?.body) throw new Error(`Missing function ${name}`);
  return declaration.body.statements.filter(ts.isReturnStatement).map(node => node.expression?.getText(parsed));
}

describe("internal-only literal public booking UI", () => {
  it("keeps every protected current public file byte-identical to the authorized base", () => {
    const paths = ["client/src/pages/Book.tsx", "client/src/App.tsx", "client/src/components/PublicBookingHeader.tsx", "client/src/components/BookingPaymentCheckout.tsx", "client/src/components/BookingApplePayCheckout.tsx", "client/src/components/BookingCashAppCheckout.tsx", "client/src/components/approved-book/ApprovedBookPayment.tsx", "client/src/components/approved-book/FirstPage.tsx", "client/src/components/approved-book/SecondPage.tsx", "client/src/components/approved-book/ApprovedBookContext.tsx", "client/src/components/approved-book/ArrivalOptions.tsx", "client/src/components/approved-book/ReviewCalendar.tsx"];
    for (const path of paths) expect(read(path)).toBe(execFileSync("git", ["show", `1b2be3ed784bd58666dbc63c9c424ed2fe8452e0:${path}`], { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH } }));
  });
  it("copies actual card, wallet and Cash App return JSX without reinterpretation", () => {
    for (const [file, names] of [
      ["BookingPaymentCheckout.tsx", ["InternalCardSetupForm", "PublicBookingCardSetupBeforeReservation"]],
      ["BookingApplePayCheckout.tsx", ["WalletCardOnFileElement", "BookingWalletCardOnFileCheckout"]],
      ["BookingCashAppCheckout.tsx", ["BookingCashAppCheckout"]],
    ] as const) {
      for (const name of names) expect(functionReturnJsx(read(internal + file), name)).toEqual(functionReturnJsx(read("client/src/components/" + file), name));
    }
  });
  it("copies the three approved screens and unchanged calendar/styles rather than adding a design", () => {
    const source = read(internal + "InternalPublicBook.tsx");
    expect(source).toContain('import ApprovedBookFirstPage from "@/components/approved-book/FirstPage"');
    expect(source).toContain('import ApprovedBookSecondPage from "@/components/approved-book/SecondPage"');
    expect(source).toContain('import "@/pages/booking-flow-review.css"');
    const start = source.indexOf("export default function InternalPublicBook");
    const end = source.indexOf("function LiteralPageThree", start);
    const controller = source.slice(start, end);
    expect(controller).not.toMatch(/bookingFunnel\.(begin|reserve|update)|mutationToken|beginFunnelMutation/);
    expect(controller).toContain('selectedPaymentMethod === "cashapp" ? "cashapp" as const : "card" as const');
    expect(source).toContain('setCardLabel("No payment collected · booking remains unpaid")');
    expect(read(internal + "InternalBookingWrapper.tsx")).toContain('key={attempt}');
    expect(read(internal + "useInternalExactBooking.ts")).toContain("trpc.bookings.internalExact");
    expect(read("client/src/pages/InternalBooking.tsx")).toContain("export default InternalBooking");
  });
});

describe("canonical native preparation input", () => {
  it.each(["card", "cashapp"] as const)("selects native %s without public capability tokens", paymentMethod => {
    const input = createInternalExactPrepareInput(submission({ paymentMethod }), false);
    expect(input).toMatchObject({ paymentMethod, withoutPayment: false, companyNotes: null, booking: { surface: "popup" } });
    expect(input.booking).not.toHaveProperty("idempotencyKey");
    expect(input).not.toHaveProperty("mutationToken");
    expect(input.booking.customer).toEqual({ fullName: "Alex Morgan", phone: "202-555-0142", email: "alex@example.test" });
    expect(input.booking.address).toBe("123 Test Street, Unit 4, Washington, DC, 20001");
    expect(input.booking.service.specialRequestNotes).toEqual(["Gate 123", "Access: Lockbox"]);
    expect(input.booking.service.extras).toEqual([{ id: "inside-fridge", quantity: 2 }, { id: "inside-oven", quantity: 1 }]);
    expect(input.booking.requestedSchedule.localTime).toBe("08:30");
  });
  it("initial unpaid preparation forces invoice without any provider prerequisite", () => {
    const input = createInternalExactPrepareInput(submission({ paymentMethod: "cashapp" }), true);
    expect(input.paymentMethod).toBe("invoice");
    expect(input.withoutPayment).toBe(true);
  });
  it.each([
    ["flexible", undefined, undefined, "08:30", 10],
    ["preferred", "morning", undefined, "08:00", 5],
    ["preferred", "afternoon", undefined, "12:00", 5],
    ["exact", undefined, "14:30", "14:30", 0],
  ] as const)("retains canonical %s arrival pricing", (mode, period, start, expectedTime, discount) => {
    const input = createInternalExactPrepareInput(submission({ draft: draft({ arrivalPreference: createBookingArrivalPreference(mode, period, start) }) }), false);
    expect(input.booking.requestedSchedule.localTime).toBe(expectedTime);
    expect(calculatePublicBookingPrice(input.booking.pricing).arrivalDiscountPercent).toBe(discount);
  });
  it.each(["home", "hourly"] as const)("keeps %s final override in exact cents with future visits unchanged", pricingMode => {
    const original = draft({ pricingMode });
    const adjusted = draft({ pricingMode, customPriceCents: 12345 });
    const input = createInternalExactPrepareInput(submission({ draft: adjusted }), false);
    const p = calculatePublicBookingPrice(input.booking.pricing);
    expect(input.booking.acceptedPricing.totalCents).toBe(12345);
    expect(p.firstCleaningTotalCents).toBe(12345);
    expect(p.arrivalDiscountPercent).toBe(0);
    expect(p.futureVisitTotalCents).toBe(calculatePublicBookingPrice(createCanonicalPricingInput(original)).futureVisitTotalCents);
    expect(p.serviceSubtotalCents + p.extrasTotalCents + (12345 - p.serviceSubtotalCents - p.extrasTotalCents)).toBe(12345);
  });
  it("rejects an absent real arrival preference rather than creating a hidden default", () => {
    expect(() => createInternalExactPrepareInput(submission({ draft: draft({ arrivalPreference: undefined }) }), false)).toThrow();
  });
});

describe("single native target and retry protection", () => {
  it("deduplicates concurrent provider preparation and retains one real target on wallet/Cash App switches", async () => {
    const session = createInternalExactBookingSession();
    let resolvePrepare!: (value: NativePreparedBooking) => void;
    const create = vi.fn(() => new Promise<NativePreparedBooking>(resolve => { resolvePrepare = resolve; }));
    const transport = api(create);
    const first = session.prepare(transport, submission({ paymentMethod: "cashapp" }), false);
    const concurrent = session.prepare(transport, submission(), false);
    expect(create).toHaveBeenCalledTimes(1);
    resolvePrepare(prepared({ paymentMethod: "cashapp" }));
    const target = await first;
    expect(await concurrent).toEqual(target);
    expect(await session.prepare(transport, submission({ draft: draft({ customPriceCents: 1 }) }), false)).toEqual(target);
    expect(create).toHaveBeenCalledTimes(1);
    expect(session.requireTarget(target)).toBe(91);
    expect(() => session.requireTarget({ ...target, bookingId: 92 })).toThrow();
    await expect(session.prepare(transport, submission(), true)).rejects.toThrow("Payment preparation has started");
  });
  it("precreation failure unlocks a retry with the same supplied UUID", async () => {
    const create = vi.fn().mockRejectedValueOnce(new Error("Connection interrupted")).mockResolvedValueOnce(prepared());
    const session = createInternalExactBookingSession();
    const input = submission();
    await expect(session.prepare(api(create), input, false)).rejects.toThrow("Connection interrupted");
    expect(session.prepared).toBeNull();
    await session.prepare(api(create), input, false);
    expect(create.mock.calls.map(([input]) => input.idempotencyKey)).toEqual([input.idempotencyKey, input.idempotencyKey]);
  });
  it("prevents concurrent unpaid conversion and performs no Stripe calls on unpaid creation", async () => {
    const create = vi.fn(async () => prepared({ stage: "booked", paymentMethod: "invoice", unpaid: true }));
    const session = createInternalExactBookingSession();
    const pending = session.prepare(api(create), submission(), true);
    await expect(session.prepare(api(create), submission(), false)).rejects.toThrow("already being prepared");
    await expect(pending).resolves.toEqual({ kind: "internal", bookingId: 91, publicBookingNumber: "BK-91" });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ paymentMethod: "invoice", withoutPayment: true }));
  });
  it("retains a persisted target if the server does not confirm truthful unpaid completion", async () => {
    const session = createInternalExactBookingSession();
    await expect(session.prepare(api(async () => prepared()), submission(), true)).rejects.toThrow("unpaid status could not be confirmed");
    expect(session.prepared?.bookingId).toBe(91);
  });
  it("normalizes raw validation payloads and missing native endpoints", () => {
    expect(internalBookingErrorMessage(new Error('[{"code":"invalid_type"}]'))).toBe("Please review the booking details and try again.");
    const error = Object.assign(new Error("No procedure found"), { data: { code: "NOT_FOUND" } });
    expect(internalBookingErrorMessage(error)).toBe("The internal booking service is unavailable. Please try again later.");
  });
});
