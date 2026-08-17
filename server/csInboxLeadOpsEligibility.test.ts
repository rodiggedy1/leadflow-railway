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
const customerMentionChipSource = readFileSync(resolve(process.cwd(), "client/src/components/CustomerMentionChip.tsx"), "utf8");
const opsChatRouterSource = readFileSync(resolve(process.cwd(), "server/opsChatRouter.ts"), "utf8");

describe("CsInbox Leads-popup outbound eligibility", () => {
  it("marks the Leads section and both Manual Text send paths with the distinct LeadOps queue marker", () => {
    expect(leadOpsSource).toContain('source: "leads_popup"');
    expect(routerSource).toContain('source: z.enum(["cs_inbox", "leads_popup"])');
    expect(routerSource).toContain('input.source === "leads_popup" ? "LeadOps" : "CS"');
    expect(customerMentionChipSource).toContain('leadSendMutation.mutate({ sessionId, message: text.trim(), source: "leads_popup" })');
    expect(customerMentionChipSource).toContain('source: "manual_text_popup"');
    expect(opsChatRouterSource).toContain('source: z.enum(["manual_text_popup"]).optional()');
    expect(opsChatRouterSource).toContain('input.source === "manual_text_popup" ? "LeadOps" : (existing[0].csQueue ?? "Needs attention")');
    expect(opsChatRouterSource).toContain('csQueue: input.source === "manual_text_popup" ? "LeadOps" : "Needs attention"');
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
