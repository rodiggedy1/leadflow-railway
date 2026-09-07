import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const router = readFileSync(path.join(root, "server/customerPortalRouter.ts"), "utf8");
const controlTower = readFileSync(path.join(root, "client/src/components/ControlTowerTab.tsx"), "utf8");

describe("staff customer portal magic-link control", () => {
  it("uses an admin/agent-only customer portal procedure and the existing reusable customer link helper", () => {
    const procedure = router.slice(router.indexOf("staffMagicLink:"), router.indexOf("me: publicProcedure"));
    expect(procedure).toContain("staffMagicLink: adminAgentProcedure");
    expect(procedure).toContain("getOrCreateCustomerPortalMagicLink(db, input)");
    expect(procedure).toContain("customerName: z.string().trim().min(1)");
    expect(procedure).toContain("customerPhone: z.string().trim().min(1)");
    expect(procedure).not.toContain("sendSms");
    expect(procedure).not.toContain("cleanerMagicLinkTokens");
  });

  it("places a copy-only Customer My Home action beside the existing job-card Magic Link action", () => {
    expect(controlTower).toContain("trpc.customerPortal.staffMagicLink.useMutation");
    expect(controlTower).toContain("Copy Customer My Home Link");
    expect(controlTower).toContain("Customer My Home link copied!");
    expect(controlTower).toContain("This job needs a customer name and phone number.");
    expect(controlTower).toContain("copyCustomerMagicLink(selectedJob)");
    expect(controlTower).not.toContain("sendJobSms.mutate({ customerMagic");
  });
});
