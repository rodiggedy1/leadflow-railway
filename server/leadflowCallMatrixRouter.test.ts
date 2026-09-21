import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("LeadFlow-owned AI Calls router", () => {
  it("uses only LeadFlow-owned job, progress, schedule, and call contracts", () => {
    const source = read("server/leadflowCallMatrixRouter.ts");
    const leadflowJobsRouter = read("server/leadflowJobsRouter.ts");

    expect(source).toContain("leadflowJobs");
    expect(source).toContain("cleanerPortalJobProgress");
    expect(source).toContain("cleanerPortalJobPhotos");
    expect(source).toContain("schedule_assignments");
    expect(source).toContain("leadflowJobId");
    expect(source).toContain("cleanerProfiles.launch27TeamId");
    expect(source).toContain("INSERT INTO call_log");
    expect(source).toContain("INSERT INTO field_mgmt_calls");
    expect(source).toContain("input.audience === \"customer\" && input.leadflowJobId === null");
    expect(source).toContain("eq(fieldMgmtCalls.vapiCallId, input.vapiCallId)");
    const forbiddenSymbols = new RegExp(["cleaner", "Jobs", "|", "cleaner", "_jobs"].join(""));
    expect(source).not.toMatch(forbiddenSymbols);

    expect(leadflowJobsRouter).toContain('import { leadflowCallMatrixRouter } from "./leadflowCallMatrixRouter";');
    expect(leadflowJobsRouter).toContain("callMatrix: leadflowCallMatrixRouter,");
  });
});
