import { describe, expect, it } from "vitest";
import {
  batchCsInboxPhonesForNameLookup,
  mergeCsInboxNameMaps,
} from "@shared/csInboxPhoneNameBatching";

function phones(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `202555${String(index).padStart(4, "0")}`);
}

describe("CsInbox2 phone-name enrichment batching", () => {
  it.each([
    [99, 1],
    [100, 1],
    [101, 2],
    [250, 3],
  ])("splits %i phones into %i request batches", (phoneCount, expectedBatches) => {
    const batches = batchCsInboxPhonesForNameLookup(phones(phoneCount));

    expect(batches).toHaveLength(expectedBatches);
    expect(batches.every(batch => batch.length <= 100)).toBe(true);
    expect(batches.flat()).toHaveLength(phoneCount);
  });

  it("deduplicates normalized phone numbers before batching", () => {
    const batches = batchCsInboxPhonesForNameLookup([
      "+1 (202) 555-0100",
      "2025550100",
      "202-555-0101",
      "not-a-phone",
    ]);

    expect(batches).toEqual([["2025550100", "2025550101"]]);
  });

  it("merges mappings so each card can use its matching resolved name", () => {
    const nameMap = mergeCsInboxNameMaps([
      { "2025550100": "Avery Johnson" },
      undefined,
      { "2025550101": "Morgan Lee" },
    ]);

    expect(nameMap["2025550100"]).toBe("Avery Johnson");
    expect(nameMap["2025550101"]).toBe("Morgan Lee");
  });
});
