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

  it("uses the exact prior review-draft prompt and structured-generation treatment without fake fallbacks", () => {
    const router = read("server/customerPortalReviewRouter.ts");
    expect(router).toContain("You are a review-writing assistant for Maids in Black, a premium home cleaning company in Washington DC.");
    expect(router).toContain("Write 3 different Google review drafts for this cleaning job:");
    expect(router).toContain("Vary in tone and structure (one enthusiastic, one matter-of-fact, one warm/personal)");
    expect(router).toContain('name: "review_drafts"');
    expect(router).not.toContain("Fallback drafts");
  });

  it("replaces the manual Job complete message with one automatic Review deep-link after sign-off", () => {
    const signoff = read("server/cleanerPortalSignoffRouter.ts");
    const cleanerUi = read("client/src/pages/CleanerPortalConnected.tsx");
    const handoff = read("server/customerPortalHandoffRoute.ts");
    expect(signoff).toContain("sendLeadflowCompletionReviewSms(job.id).catch");
    expect(signoff).toContain("fromNumberId: ENV.openPhoneCsNumberId");
    expect(signoff).not.toContain("reviewCompletionSmsClaimedAt");
    expect(signoff).not.toContain("leadflowBookingMessages");
    expect(signoff).toContain("view=review");
    expect(signoff).toContain("getOrCreateCustomerPortalMagicLink");
    expect(signoff).toContain("Hi ${firstName(job.customerName)}! ✨ ${teamDisplay} just finished your clean — your home is sparkling!");
    expect(signoff).toContain("Leave a 5-star Thumbtack review and we'll add a $50 tip to ${teamDisplay}:");
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
