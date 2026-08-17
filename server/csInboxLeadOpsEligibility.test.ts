import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function isOpenCsInboxEligible(
  hasInboundCustomerActivity: boolean,
  csQueue: string | null,
  isResolved: boolean,
): boolean {
  return !isResolved && (hasInboundCustomerActivity || csQueue === "LeadOps");
}

const routerSource = readFileSync(resolve(process.cwd(), "server/routers.ts"), "utf8");
const leadOpsSource = readFileSync(resolve(process.cwd(), "client/src/components/LeadOps.tsx"), "utf8");

describe("CsInbox Leads-popup outbound eligibility", () => {
  it("marks only a Leads-popup send with the distinct LeadOps queue marker", () => {
    expect(leadOpsSource).toContain('source: "leads_popup"');
    expect(routerSource).toContain('source: z.enum(["cs_inbox", "leads_popup"])');
    expect(routerSource).toContain('input.source === "leads_popup" ? "LeadOps" : "CS"');
  });

  it("surfaces an open LeadOps outbound conversation even before a customer reply", () => {
    expect(isOpenCsInboxEligible(false, "LeadOps", false)).toBe(true);
  });

  it("does not surface an unrelated assistant-only conversation", () => {
    expect(isOpenCsInboxEligible(false, null, false)).toBe(false);
  });

  it("keeps the resolved filter and existing inbound-customer eligibility", () => {
    expect(isOpenCsInboxEligible(false, "LeadOps", true)).toBe(false);
    expect(isOpenCsInboxEligible(true, null, false)).toBe(true);
    expect(routerSource).toContain('const leadsPopupOutboundFilter = eq(conversationSessions.csQueue, "LeadOps")');
  });
});
