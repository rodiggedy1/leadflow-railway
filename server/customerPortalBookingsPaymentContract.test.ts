import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("portal service request Bookings payment contract", () => {
  it("uses the request-selected card as the Bookings payment source instead of a hardcoded missing state", async () => {
    const [workspace, paymentActions, router] = await Promise.all([
      readFile(path.resolve(root, "client/src/components/NativeBookingsWorkspace.tsx"), "utf8"),
      readFile(path.resolve(root, "client/src/components/PortalRequestPaymentActions.tsx"), "utf8"),
      readFile(path.resolve(root, "server/bookingPaymentAdminRouter.ts"), "utf8"),
    ]);
    expect(workspace).toContain('paymentStatus: request.paymentChargedAt ? "captured" : request.stripePaymentMethodId && request.paymentLast4 ? "card_on_file" : "not_started"');
    expect(workspace).toContain("<PortalRequestPaymentActions requestId={active.id}");
    expect(workspace).not.toContain('paymentStatus: "not_started", firstCleaningTotalCents: request.estimatedTotalCents');
    expect(paymentActions).toContain("getForPortalRequest.useQuery({ requestId }");
    expect(paymentActions).toContain("chargePortalRequestSavedCard.useMutation");
    expect(paymentActions).toContain("Charge ${amount}");
    expect(router).toContain("getForPortalRequest: agentProcedure");
    expect(router).toContain("chargePortalRequestSavedCard: agentProcedure");
    expect(router).toContain("request.stripePaymentMethodId");
    expect(router).toContain('source: "customer_portal_service_request"');
    expect(router).toContain("if (request.paymentChargedAt || request.stripePaymentIntentId)");
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
});
