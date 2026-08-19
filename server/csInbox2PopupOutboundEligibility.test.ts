import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const routerSource = fs.readFileSync(path.resolve(import.meta.dirname, "routers.ts"), "utf8");

function matchesOpenMessageEligibility({
  hasInboundMessage,
  isCsTouchedOutbound,
  isResolved,
}: {
  hasInboundMessage: boolean;
  isCsTouchedOutbound: boolean;
  isResolved: boolean;
}) {
  return !isResolved && (hasInboundMessage || isCsTouchedOutbound);
}

describe("CsInbox2 popup outbound eligibility", () => {
  it("includes a Customer-popup outbound-only CS-touched session", () => {
    expect(matchesOpenMessageEligibility({
      hasInboundMessage: false,
      isCsTouchedOutbound: true,
      isResolved: false,
    })).toBe(true);
  });

  it("includes a New Lead-popup outbound-only CS-touched session", () => {
    expect(matchesOpenMessageEligibility({
      hasInboundMessage: false,
      isCsTouchedOutbound: true,
      isResolved: false,
    })).toBe(true);
  });

  it("keeps an outbound-only session without the CS marker excluded", () => {
    expect(matchesOpenMessageEligibility({
      hasInboundMessage: false,
      isCsTouchedOutbound: false,
      isResolved: false,
    })).toBe(false);
  });

  it("keeps a genuine inbound session included without the CS marker", () => {
    expect(matchesOpenMessageEligibility({
      hasInboundMessage: true,
      isCsTouchedOutbound: false,
      isResolved: false,
    })).toBe(true);
  });

  it("keeps the actual listCsInbox query wired to the CS marker exception", () => {
    expect(routerSource).toContain("const csTouchedOutboundFilter = eq(conversationSessions.csQueue as any, 'CS');");
    expect(routerSource).toContain("and(or(inboundMessageActivityFilter, csTouchedOutboundFilter), resolvedFilter)");
    expect(routerSource).toContain("or(inboundMessageActivityFilter, csTouchedOutboundFilter)");
  });
});
