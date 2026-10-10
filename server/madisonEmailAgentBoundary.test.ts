import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.resolve(import.meta.dirname, "madisonEmailAgent.ts"), "utf8");

describe("Madison Email operational data boundary", () => {
  it("resolves email context from LeadFlow-owned jobs only", () => {
    const legacyJobSymbol = ["cleaner", "Jobs"].join("");
    const legacyTable = ["cleaner", "_jobs"].join("");
    const legacyProfiles = ["cleaner", "Profiles"].join("");

    expect(source).toContain("leadflowJobs");
    expect(source).toContain("from(leadflowJobs)");
    expect(source).toContain("leadflowJobId: job?.id");
    expect(source).not.toContain(legacyJobSymbol);
    expect(source).not.toContain(legacyTable);
    expect(source).not.toContain(legacyProfiles);
  });
});
