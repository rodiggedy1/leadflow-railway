import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const prohibitedLegacySymbol = ["cleaner", "Jobs"].join("");

describe("native booking drawer commercial edits", () => {
  it("adds a staff-only native update path with canonical extras and no payment-state restriction", () => {
    const router = read("server/bookingsRouter.ts");
    const updateBlock = router.slice(
      router.indexOf("updateDetails: bookingsAgentProcedure"),
      router.indexOf("cancel: bookingsAgentProcedure")
    );

    for (const marker of [
      "updateDetails: bookingsAgentProcedure",
      "PUBLIC_BOOKING_PRICED_EXTRAS",
      "firstCleaningTotalCents: z",
      "companyNotes: z.string().trim().max(4_000).nullable()",
      "requestedLocalDate: z",
      "requestedLocalTime: z",
      "recurrence: z.enum(NATIVE_BOOKING_RECURRENCES)",
      "nativeBookingFutureVisitTotalCents",
      "requestedStartAt",
    ])
      expect(updateBlock).toContain(marker);
    expect(updateBlock).toContain("bookingSeries");
    expect(updateBlock).toContain("publishNativeBookingRefresh()");
    expect(updateBlock).not.toContain("bookingPaymentProfiles");
    expect(updateBlock).not.toContain('paymentStatus === "authorized"');
    expect(updateBlock).not.toContain('paymentStatus === "captured"');
    expect(updateBlock).not.toContain(prohibitedLegacySymbol);
  });

  it("retains the first-visit only rule in the working CRM drawer", () => {
    const page = read("client/src/pages/BookingsCRMExactLive.tsx");
    const workspace = read("client/src/components/NativeBookingsWorkspace.tsx");

    for (const marker of [
      "NativeBookingCommercialEditor",
      "Extras, price &amp; company notes",
      "Final price ($)",
      "Company notes",
      "Future visits remain",
      'active.source === "booking" && (',
      'active.source === "booking" ? (',
      "updateActiveBookingSchedule",
      "requestedLocalTime",
      "(active.firstCleaningTotalCents ?? 0)",
      "onDraftChange",
      "displayedFirstCleaningTotalCents",
      "displayedExtras",
      "Save booking updates",
      'type="time"',
      "jobTime: model.rescheduleTime",
    ])
      expect(page).toContain(marker);
    expect(page).not.toMatch(
      /active\.source === "booking"\s*&&\s*active\.firstCleaningTotalCents\s*!==\s*null\s*&&\s*<NativeBookingCommercialEditor/
    );
    expect(workspace).toContain("trpc.bookings.updateDetails.useMutation");
    expect(workspace).toContain("updateActiveBookingDetails");
    expect(page).not.toContain('className="bcr-commercial-actions"');
    const footer = page.slice(
      page.indexOf('<footer className="bcr-workspace-detail-footer">'),
      page.indexOf(
        "</footer>",
        page.indexOf('<footer className="bcr-workspace-detail-footer">')
      )
    );
    expect(footer).toContain('className="bcr-save-changes"');
    expect(footer).toContain('className="bcr-cancel-booking"');
    expect(footer.indexOf("bcr-save-changes")).toBeLessThan(
      footer.indexOf("bcr-cancel-booking")
    );
    expect(page).not.toContain(
      "disabled={model.updateBookingDetails.isPending}\n                      onClick={() =>\n                        model.updateActiveBookingSchedule"
    );
  });

  it("supports time edits for imported LeadFlow bookings through the owned job path", () => {
    const router = read("server/leadflowJobsRouter.ts");
    expect(router).toContain("jobTime: z.string().regex");
    expect(router).toContain("businessLocalDateTimeToUtcMs");
    expect(router).toContain("input.jobDate || input.jobTime");
    expect(router).not.toContain(prohibitedLegacySymbol);
  });

  it("uses an additive company-notes migration for the native booking table", () => {
    const schema = read("drizzle/schema.ts");
    const sql = read(
      "server/versioned-migrations/0045_add_booking_company_notes.sql"
    );
    const postconditions = read(
      "server/versioned-migrations/0045_add_booking_company_notes.postconditions.json"
    );
    const manifest = read("server/versioned-migrations/manifest.json");

    expect(schema).toContain('companyNotes: text("companyNotes")');
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS `companyNotes` text NULL");
    expect(postconditions).toContain('"columnType":"text"');
    expect(manifest).toContain('"id": "0045_add_booking_company_notes"');
  });
});
