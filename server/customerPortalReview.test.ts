import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");

describe("LeadFlow-owned Customer Portal review workflow", () => {
  it("uses completed LeadFlow jobs and authenticated customer ownership without legacy cleaner-job storage", () => {
    const router = read("server/customerPortalReviewRouter.ts");
    expect(router).toContain("getCustomerPortalSessionFromRequest");
    expect(router).toContain("cleanerPortalJobProgress");
    expect(router).toContain('eq(cleanerPortalJobProgress.jobStatus, "completed")');
    expect(router).toContain("RIGHT(REGEXP_REPLACE");
    expect(router).not.toContain("cleanerJobs");
    expect(router).not.toContain("sendSms");
  });

  it("preserves the approved rating gate and sends only low ratings to Command Chat", () => {
    const router = read("server/customerPortalReviewRouter.ts");
    expect(router).toContain("if (input.rating <= 3)");
    expect(router).toContain('channel: "command"');
    expect(router).toContain("broadcastOpsUpdate");
    expect(router).toContain("if (job.customerRating !== 5)");
    expect(router).toContain("THUMBTACK_REVIEW_URL");
    expect(router).toContain("https://www.thumbtack.com/reviews/services/382987965776199683/write-customer-review");
  });

  it("uses editable customer-supported draft text and does not add fake review fallbacks", () => {
    const router = read("server/customerPortalReviewRouter.ts");
    expect(router).toContain("Use only the stated team, service, selected highlights, and customer note.");
    expect(router).toContain("Do not invent service details, outcomes, names, or facts.");
    expect(router).not.toContain("Fallback drafts");
  });

  it("replaces the manual Job complete message with one automatic Review deep-link after sign-off", () => {
    const signoff = read("server/cleanerPortalSignoffRouter.ts");
    const cleanerUi = read("client/src/pages/CleanerPortalConnected.tsx");
    const handoff = read("server/customerPortalHandoffRoute.ts");
    expect(signoff).toContain("reviewCompletionSmsClaimedAt");
    expect(signoff).toContain("view=review");
    expect(signoff).toContain("getOrCreateCustomerPortalMagicLink");
    expect(signoff).toContain("Hi ${firstName(job.customerName)} — your cleaning is complete.");
    expect(cleanerUi).not.toContain('label: "Job complete"');
    expect(handoff).toContain('requestedView === "review" ? "/my-home?view=review"');
  });

  it("registers an idempotent additive LeadFlow review-field migration with the exact manifest checksum", () => {
    const migration = read("server/versioned-migrations/0033_add_leadflow_job_review_fields.sql");
    const manifest = JSON.parse(read("server/versioned-migrations/manifest.json")) as { migrations: Array<{ id: string; sha256: string; mode: string }> };
    const entry = manifest.migrations.find(item => item.id === "0033_add_leadflow_job_review_fields");
    expect(entry?.mode).toBe("additive-columns-existing-table");
    expect(entry?.sha256).toBe(createHash("sha256").update(migration).digest("hex"));
    expect(migration.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(10);
    expect(migration).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/i);
  });
});
