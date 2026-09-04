import { readFile } from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";
import { CUSTOMER_PORTAL_SERVICES } from "../shared/customerPortalServices";

const root = process.cwd();

describe("customer portal isolation", () => {
  it("contains the complete twelve-service catalog with service-specific form fields", () => {
    expect(CUSTOMER_PORTAL_SERVICES).toHaveLength(12);
    expect(CUSTOMER_PORTAL_SERVICES.map(service => service.id)).toEqual(["tv-mounting", "furniture-assembly", "picture-hanging", "minor-home-repairs", "handyman", "plumbing", "electrical-lighting", "interior-painting", "moving-help", "lawn-yard-care", "junk-removal", "pressure-washing"]);
    expect(CUSTOMER_PORTAL_SERVICES.every(service => service.fields.length > 0)).toBe(true);
  });

  it("adds no portal dependency to existing widget, bookings workspace, payment, or booking-page sources", async () => {
    const files = ["client/src/components/NativeBookingsWorkspace.tsx", "client/src/pages/BookNow.tsx", "client/src/components/BookingPaymentCheckout.tsx", "server/bookingPaymentRouter.ts", "server/widgetEmbed.ts"];
    for (const file of files) {
      const source = await readFile(path.resolve(root, file), "utf8");
      expect(source).not.toContain("customerPortal");
      expect(source).not.toContain("customer_portal");
    }
  });

  it("keeps customer portal procedures limited to the dedicated router and route", async () => {
    const [app, router] = await Promise.all([readFile(path.resolve(root, "client/src/App.tsx"), "utf8"), readFile(path.resolve(root, "server/routers.ts"), "utf8")]);
    expect(app).toContain('const CustomerPortal = lazy(() => import("./pages/CustomerPortal"));');
    expect(app).toContain('<Route path={"/my-home"} component={CustomerPortal} />');
    expect(router).toContain("customerPortal: customerPortalRouter");
  });
});
