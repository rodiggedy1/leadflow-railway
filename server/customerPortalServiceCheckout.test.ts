import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("customer portal shared service checkout", () => {
  it("routes every catalog service through one shared request form with a fixed visible action footer", async () => {
    const [portal, catalog, styles] = await Promise.all([
      readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8"),
      readFile(path.resolve(root, "shared/customerPortalServices.ts"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/customer-portal-service-request-actions.css"), "utf8"),
    ]);

    expect(catalog).toContain('id: "lawn-yard-care"');
    expect(catalog).toContain("export const CUSTOMER_PORTAL_SERVICES");
    expect(portal).toContain("const service = CUSTOMER_PORTAL_SERVICES.find(candidate => candidate.id === serviceId);");
    expect(portal).toContain("CUSTOMER_PORTAL_SERVICES.map(service =>");
    expect(portal).toContain('<ServiceRequestForm service={selectedService}');
    expect(portal).toContain('className="mib-portal-service-request-scroll"');
    expect(portal).toContain('className="mib-portal-request-actions"');
    expect(portal).toContain("Send service request");
    expect(portal).toContain("Continue to secure card entry");
    expect(portal).toContain("Save new card");
    expect(portal).toContain("Use saved card instead");
    expect(styles).toContain(".mib-portal-service-request-card {");
    expect(styles).toContain("display: flex;");
    expect(styles).toContain(".mib-portal-service-request-scroll {");
    expect(styles).toContain("overflow-y: auto;");
    expect(styles).toContain(".mib-portal-request-actions {");
    expect(styles).toContain("flex: none;");
  });

  it("preserves the existing create-request mutation and does not add a service-specific payment or notification path", async () => {
    const portal = await readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8");

    expect(portal).toContain("const createRequest = trpc.customerPortal.createRequest.useMutation");
    expect(portal).toContain("createRequest.mutate({ serviceId: service.id, selections, address: selectedAddress");
    expect(portal).toContain("startNewCardSetup.mutateAsync()");
    expect(portal).toContain("confirmNewCardSetup.mutateAsync");
    expect(portal).not.toContain("paymentIntents.create");
  });
});
