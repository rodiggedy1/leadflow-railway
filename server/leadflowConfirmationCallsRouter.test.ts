import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const routerSource = readFileSync(resolve(root, "server/leadflowConfirmationCallsRouter.ts"), "utf8");
const pageSource = readFileSync(resolve(root, "client/src/pages/ConfirmationCallsExactLive.tsx"), "utf8");
const schemaSource = readFileSync(resolve(root, "drizzle/schema.ts"), "utf8");
const migrationSql = readFileSync(resolve(root, "server/versioned-migrations/0041_owned_confirmation_calls.sql"), "utf8");
const migrationPostconditions = JSON.parse(readFileSync(resolve(root, "server/versioned-migrations/0041_owned_confirmation_calls.postconditions.json"), "utf8"));
const manifest = JSON.parse(readFileSync(resolve(root, "server/versioned-migrations/manifest.json"), "utf8"));
const forbiddenJobSymbols = ["cleaner" + "Jobs", "cleaner" + "_jobs"];

describe("LeadFlow-owned Confirmation Calls adapter", () => {
  it("reads the queue only from LeadFlow-owned jobs and owned confirmation records", () => {
    expect(routerSource).toContain("from(leadflowJobs)");
    expect(routerSource).toContain("leadflowJobId: confirmationCalls.leadflowJobId");
    expect(routerSource).toContain("inArray(confirmationCalls.leadflowJobId, jobIds)");
    for (const symbol of forbiddenJobSymbols) expect(routerSource).not.toContain(symbol);
  });

  it("preserves only the explicitly human-triggered send and override actions", () => {
    expect(routerSource).toContain("placeCall: opsChatProcedure");
    expect(routerSource).toContain("overrideOutcome: opsChatProcedure");
    expect(routerSource).toContain("leadflowJobId: job.id");
    expect(routerSource).toContain("sendSms({");
    expect(routerSource).toContain("manualOutcome: input.outcome");
    expect(routerSource).not.toContain("bookingStatus: \"cancelled\"");
    expect(routerSource).not.toMatch(/stage\s*:\s*["']RESOLVED["']/);
  });

  it("points the exact workspace to the owned API", () => {
    expect(pageSource).toContain("trpc.leadflowConfirmationCalls.getJobsForDay.useQuery");
    expect(pageSource).toContain("trpc.leadflowConfirmationCalls.placeCall.useMutation");
    expect(pageSource).toContain("trpc.leadflowConfirmationCalls.overrideOutcome.useMutation");
    expect(pageSource).toContain("leadflowJobId: job.id");
    expect(pageSource).not.toContain("trpc.confirmationCalls.");
  });

  it("migrates confirmation-call identity additively under the managed runner", () => {
    expect(schemaSource).toContain('leadflowJobId: int("leadflowJobId")');
    expect(migrationSql).toContain("MODIFY COLUMN `cleanerJobId` int NULL");
    expect(migrationSql).toContain("ADD COLUMN IF NOT EXISTS `leadflowJobId` int NULL");
    expect(migrationSql).toContain("idx_cc_leadflow_job_id");
    expect(migrationPostconditions).toMatchObject({
      table: "confirmation_calls",
      columns: [
        { name: "cleanerJobId", columnType: "int", nullable: true },
        { name: "leadflowJobId", columnType: "int", nullable: true },
      ],
      indexes: [{ name: "idx_cc_leadflow_job_id", columns: ["leadflowJobId"], unique: false }],
    });
    const entry = manifest.migrations.find((migration: { id: string }) => migration.id === "0041_owned_confirmation_calls");
    expect(entry).toMatchObject({
      mode: "owned-schedule-existing-table-schema",
      sqlFile: "0041_owned_confirmation_calls.sql",
      replayMode: "verified-idempotent",
      postconditionsFile: "0041_owned_confirmation_calls.postconditions.json",
    });
    expect(entry.sha256).toBe(createHash("sha256").update(migrationSql).digest("hex"));
  });
});
