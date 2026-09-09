import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("customer portal lawn-care booking treatment", () => {
  it("uses the established customer booking-panel presentation only for lawn care", async () => {
    const [portal, bookNow, styles] = await Promise.all([
      readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/BookNow.tsx"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/customer-portal-lawn-care-booking-panel.css"), "utf8"),
    ]);

    expect(portal).toContain('const isLawnCare = service.id === "lawn-yard-care";');
    expect(portal).toContain('className={isLawnCare ? "mib-portal-rebook-overlay" : "mib-portal-modal"}');
    expect(portal).toContain('"mib-booking-panel mib-portal-rebook-panel mib-lawncare-request-panel"');
    expect(portal).toContain("BOOK LAWN &amp; YARD CARE · STEP 1 OF 1");
    expect(portal).toContain("Send lawn-care request");
    expect(portal).toContain("Continue to secure card entry");
    expect(portal).toContain('form={lawnCareCardFormId}');
    expect(portal).toContain('hideSubmit={isLawnCare}');
    expect(portal).toContain('formId={isLawnCare ? lawnCareCardFormId : undefined}');
    expect(styles).toContain(".mib-lawncare-request-panel");
    expect(styles).toContain(".mib-lawncare-request-actions");
    expect(bookNow).toContain("function BookNow(");
    expect(bookNow).not.toContain("lawn-yard-care");
  });

  it("retains the existing lawn-care request and office-notification path rather than converting it to a cleaning booking", async () => {
    const portal = await readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8");

    expect(portal).toContain("const createRequest = trpc.customerPortal.createRequest.useMutation");
    expect(portal).toContain("createRequest.mutate({ serviceId: service.id, selections, address: selectedAddress");
    expect(portal).toContain("const sendRequest = () =>");
    expect(portal).toContain("if (!date || !timeWindow || !canSubmit || paymentChoice !== \"saved\") return;");
    expect(portal).toContain('!isLawnCare && paymentChoice === "new"');
    expect(portal).toContain(': !newCardSetup && <button type="button" className="mib-portal-primary"');
    expect(portal).not.toContain("lawnCareBookingFunnel");
  });
});
