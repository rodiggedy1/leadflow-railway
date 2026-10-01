import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("internal booking additional services", () => {
  it("uses the approved nine-step catalog and submits explicit quantities", () => {
    const page = read("client/src/pages/InternalBooking.tsx");
    expect(page).toContain('"Additional services"');
    expect(page).toContain("ADDITIONAL_SERVICES");
    expect(page).toContain("additionalServices: Object.entries(additionalServices)");
    expect(page).toContain("pricing.firstCleaningTotalCents + additionalServicesTotalCents");
    expect(page).toContain('"carpet-cleaning"');
    expect(page).toContain('"exterior-window-cleaning"');
    expect(page).toContain('"pet-area-cleaning"');
  });

  it("validates and persists add-ons on LeadFlow-owned booking and job rows", () => {
    const router = read("server/bookingsRouter.ts");
    expect(router).toContain("PUBLIC_BOOKING_POST_BOOKING_UPSELLS");
    expect(router).toContain("additionalServices");
    expect(router).toContain("applyInternalAdditionalServices");
    expect(router).toContain("booking.firstCleaningTotalCents");
    expect(router).toContain("leadflowJobs");
    expect(router).not.toMatch(/cleanerJobs|cleaner_jobs/);
  });
});
