import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("payment authorization reconciliation", () => {
  it("keeps legacy card-on-file holds Stripe-first while booking and portal holds remain local-first", () => {
    const legacy = read("server/stripeRouter.ts");
    const booking = read("server/bookingPaymentAdminRouter.ts");

    const legacyStart = legacy.indexOf("createPreauth: agentProcedure");
    const legacyEnd = legacy.indexOf(
      "recoverVerifiedCardLinkHold: agentProcedure",
      legacyStart
    );
    const legacyCreate = legacy.indexOf(
      "stripe.paymentIntents.create",
      legacyStart
    );
    const legacyInsert = legacy.indexOf(
      "await db.insert(paymentAuthorizations).values({",
      legacyStart
    );
    const legacyBlock = legacy.slice(legacyStart, legacyEnd);

    expect(legacyCreate).toBeGreaterThan(legacyStart);
    expect(legacyInsert).toBeGreaterThan(legacyCreate);
    expect(legacyBlock).not.toContain('status: "pending"');
    expect(legacyBlock).not.toContain("leadflowAuthorizationAttempt");

    const bookingStart = booking.indexOf("placeHold: agentProcedure");
    const bookingCreate = booking.indexOf(
      "authorizeCanonicalBookingHold",
      bookingStart
    );
    const bookingPending = booking.indexOf('status: "pending"', bookingStart);
    expect(bookingPending).toBeGreaterThan(bookingStart);
    expect(bookingPending).toBeLessThan(bookingCreate);

    const portalStart = booking.indexOf(
      "placePortalRequestHold: agentProcedure"
    );
    const portalCreate = booking.indexOf(
      "stripe.paymentIntents.create",
      portalStart
    );
    const portalPending = booking.indexOf('status: "pending"', portalStart);
    expect(portalPending).toBeGreaterThan(portalStart);
    expect(portalPending).toBeLessThan(portalCreate);
  });

  it("keeps booking and portal completion tied to their same pending record", () => {
    const legacy = read("server/stripeRouter.ts");
    const booking = read("server/bookingPaymentAdminRouter.ts");
    const legacyStart = legacy.indexOf("createPreauth: agentProcedure");
    const legacyEnd = legacy.indexOf(
      "recoverVerifiedCardLinkHold: agentProcedure",
      legacyStart
    );
    const legacyBlock = legacy.slice(legacyStart, legacyEnd);

    expect(legacyBlock).toContain("stripePaymentIntentId: paymentIntent.id");
    expect(legacyBlock).toContain("}).$returningId();");
    expect(legacyBlock).not.toContain(
      "where(eq(paymentAuthorizations.id, Number(pending.id)))"
    );
    expect(booking).toContain(
      "where(eq(paymentAuthorizations.id, Number(pending.id)))"
    );
    expect(booking).toContain("stripePaymentIntentId: intent.id");
  });

  it("keeps booking and portal unknown outcomes pending and correlates only marked new holds to the signed webhook", () => {
    const legacy = read("server/stripeRouter.ts");
    const booking = read("server/bookingPaymentAdminRouter.ts");
    const engine = read("server/bookingPaymentActionsEngine.ts");
    const webhook = read("server/stripeWebhookRoute.ts");

    const legacyStart = legacy.indexOf("createPreauth: agentProcedure");
    const legacyEnd = legacy.indexOf(
      "recoverVerifiedCardLinkHold: agentProcedure",
      legacyStart
    );
    const legacyBlock = legacy.slice(legacyStart, legacyEnd);

    expect(legacyBlock).not.toContain("definitiveProviderFailure");
    expect(legacyBlock).not.toContain("leadflowAuthorizationAttempt");
    for (const source of [booking]) {
      expect(source).toContain("definitiveProviderFailure");
      expect(source).toContain(
        "The local attempt remains in review to prevent a duplicate charge."
      );
      expect(source).toContain('leadflowAuthorizationAttempt: "v1"');
      expect(source).toContain("leadflowAuthorizationAttemptId");
    }
    expect(engine).toContain('leadflowAuthorizationAttempt: "v1"');
    expect(engine).toContain("authorizationAttemptId");
    expect(webhook).toContain("promoteMarkedPendingAuthorization");
    expect(webhook).toContain(
      'object.metadata?.leadflowAuthorizationAttempt !== "v1"'
    );
    expect(webhook).toContain('eq(paymentAuthorizations.status, "pending")');
    expect(webhook).toContain(
      "object.amount_capturable === pending.amountCents"
    );
    expect(webhook).not.toContain("paymentIntents.create");
    expect(webhook).not.toContain("paymentIntents.capture");
    expect(webhook).not.toContain("paymentIntents.cancel");
  });

  it("allows an operator to recover only an already-existing verified card-link hold without a Stripe mutation", () => {
    const source = read("server/stripeRouter.ts");
    const ui = read("client/src/pages/PaymentsExactLive.tsx");
    const start = source.indexOf("recoverVerifiedCardLinkHold: agentProcedure");
    const end = source.indexOf("capturePayment: agentProcedure", start);
    const recovery = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(recovery).toContain("stripe.paymentIntents.retrieve");
    expect(recovery).toContain("stripe.paymentMethods.retrieve");
    expect(recovery).toContain('intent.status === "requires_capture"');
    expect(recovery).toContain('intent.capture_method === "manual"');
    expect(recovery).toContain("expectedAmountCents");
    expect(recovery).toContain("intent.amount === input.expectedAmountCents");
    expect(recovery).toContain(
      "intent.metadata.customerPhone === token.customerPhone"
    );
    expect(recovery).toContain(
      "intentCustomerId === customer.stripeCustomerId"
    );
    expect(recovery).toContain(
      "intentPaymentMethodId === customer.stripePaymentMethodId"
    );
    expect(recovery).not.toContain("paymentIntents.create");
    expect(recovery).not.toContain("paymentIntents.capture");
    expect(recovery).not.toContain("paymentIntents.cancel");
    expect(ui).toContain("Recover existing Stripe hold");
    expect(ui).toContain("recoverVerifiedCardLinkHold.mutate");
    expect(ui).toContain("does not charge, capture, cancel, or change Stripe");
  });
});
