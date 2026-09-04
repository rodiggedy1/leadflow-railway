import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("portal service request Bookings payment contract", () => {
  it("uses the request-selected card as the Bookings payment source and exposes the full booking-equivalent hold lifecycle", async () => {
    const [workspace, paymentActions, router] = await Promise.all([
      readFile(path.resolve(root, "client/src/components/NativeBookingsWorkspace.tsx"), "utf8"),
      readFile(path.resolve(root, "client/src/components/PortalRequestPaymentActions.tsx"), "utf8"),
      readFile(path.resolve(root, "server/bookingPaymentAdminRouter.ts"), "utf8"),
    ]);
    expect(workspace).toContain('paymentStatus: request.paymentChargedAt ? "captured" : request.stripePaymentMethodId && request.paymentLast4 ? "card_on_file" : "not_started"');
    expect(workspace).toContain("<PortalRequestPaymentActions requestId={active.id}");
    expect(workspace).not.toContain('paymentStatus: "not_started", firstCleaningTotalCents: request.estimatedTotalCents');
    expect(paymentActions).toContain("getForPortalRequest.useQuery({ requestId }");
    expect(paymentActions).toContain("placePortalRequestHold.useMutation");
    expect(paymentActions).toContain("capturePortalRequestHold.useMutation");
    expect(paymentActions).toContain("cancelPortalRequestHold.useMutation");
    expect(paymentActions).toContain("chargePortalRequestSavedCard.useMutation");
    expect(paymentActions).toContain("Place hold");
    expect(paymentActions).toContain("Capture ${amount}");
    expect(paymentActions).toContain("Cancel hold");
    expect(paymentActions).toContain("Charge ${amount}");
    expect(router).toContain("getForPortalRequest: agentProcedure");
    expect(router).toContain("placePortalRequestHold: agentProcedure");
    expect(router).toContain("capturePortalRequestHold: agentProcedure");
    expect(router).toContain("cancelPortalRequestHold: agentProcedure");
    expect(router).toContain("chargePortalRequestSavedCard: agentProcedure");
    expect(router).toContain("request.stripePaymentMethodId");
    expect(router).toContain('source: "customer_portal_service_request"');
    expect(router).toContain("if (request.paymentChargedAt || request.stripePaymentIntentId)");
    expect(router).toContain('capture_method: "manual"');
    expect(router).toContain("paymentIntents.capture");
    expect(router).toContain("paymentIntents.cancel");
    expect(router).toContain("customerPortalServiceRequestId: request.id");
    expect(router).toContain("Capture or cancel the active hold before charging this service request.");
  });

  it("registers the additive request charge-state migration with the required statement boundaries", async () => {
    const directory = path.resolve(root, "server", "versioned-migrations");
    const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as { migrations: Array<{ id: string; mode: string; sqlFile: string; sha256: string; replayMode: string }> };
    const migration = manifest.migrations.find(item => item.id === "0021_add_customer_portal_request_charge_state");
    expect(migration).toMatchObject({ mode: "additive-columns-existing-table", sqlFile: "0021_add_customer_portal_request_charge_state.sql", replayMode: "verified-idempotent" });
    const sql = await readFile(path.join(directory, migration!.sqlFile), "utf8");
    expect(createHash("sha256").update(sql).digest("hex")).toBe(migration!.sha256);
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS `stripePaymentIntentId`");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS `paymentChargedAt`");
    expect(sql.match(/--> statement-breakpoint/g)).toHaveLength(1);
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/i);
  });

  it("registers the additive authorization-to-portal-request link with the required managed migration shape", async () => {
    const directory = path.resolve(root, "server", "versioned-migrations");
    const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as { migrations: Array<{ id: string; mode: string; sqlFile: string; sha256: string; replayMode: string }> };
    const migration = manifest.migrations.find(item => item.id === "0022_add_portal_request_authorization_link");
    expect(migration).toMatchObject({ mode: "additive-columns-existing-table", sqlFile: "0022_add_portal_request_authorization_link.sql", replayMode: "verified-idempotent" });
    const sql = await readFile(path.join(directory, migration!.sqlFile), "utf8");
    expect(createHash("sha256").update(sql).digest("hex")).toBe(migration!.sha256);
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS `customerPortalServiceRequestId`");
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/i);
  });
});
