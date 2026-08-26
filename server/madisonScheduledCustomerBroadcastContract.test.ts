import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const router = readFileSync(new URL("./aiConciergeRouter.ts", import.meta.url), "utf8");
const parser = readFileSync(new URL("./conciergeParser.ts", import.meta.url), "utf8");
const card = readFileSync(new URL("../client/src/components/BulkSmsConfirmCard.tsx", import.meta.url), "utf8");

describe("Madison scheduled customer broadcast contract", () => {
  it("uses a distinct customer action and leaves team broadcast routing in place", () => {
    expect(parser).toContain('"text_scheduled_customers"');
    expect(router).toContain('if (plan.action === "text_scheduled_customers")');
    expect(router).toContain("handleTextCleaners");
    expect(router).toContain("draftCleanerMessage");
  });

  it("keeps an editable, explicit-send review card and rechecks STOP before customer send", () => {
    expect(card).toContain("onClick={handleSend}");
    expect(card).toContain("setExcluded");
    expect(router).toContain('input.audience === "customer"');
    expect(router).toContain("smsOptOuts.phone");
    expect(router).toContain("appendCsOutboundMessage");
  });
});
