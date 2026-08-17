import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "server/routers.ts"), "utf8");

describe("CsInbox two-number 90-day inbound SMS eligibility", () => {
  it("uses both configured company number IDs and a true 90-day inbound timestamp", () => {
    expect(source).toContain("const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000");
    expect(source).toContain("const inboundSmsFilter = and(");
    expect(source).toContain("ENV.openPhoneCsNumberId");
    expect(source).toContain("ENV.openPhoneNumberId");
    expect(source).toContain("gte(conversationSessions.lastCustomerMessageTs, ninetyDaysAgo)");
  });

  it("keeps unresolved filtering and linked inbound call visibility", () => {
    expect(source).toContain("resolvedFilter ? and(inboundSmsFilter, resolvedFilter) : inboundSmsFilter");
    expect(source).toContain("EXISTS (SELECT 1 FROM voice_calls vc WHERE vc.sessionId = ${conversationSessions.id})");
  });

  it("removes the prior SMS eligibility condition from the list predicate", () => {
    const listStart = source.indexOf("const ninetyDaysAgo");
    const listEnd = source.indexOf(".orderBy(desc(conversationSessions.updatedAt));", listStart);
    const listPredicate = source.slice(listStart, listEnd);
    expect(listPredicate).not.toContain("cs-inbound-cleaner");
    expect(listPredicate).not.toContain("cs_initiated");
  });
});
