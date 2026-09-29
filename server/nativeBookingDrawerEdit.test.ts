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
      "firstCleaningTotalCents: z.number().int().min(0)",
      "companyNotes: z.string().trim().max(4_000).nullable()",
    ])
      expect(updateBlock).toContain(marker);
    expect(updateBlock).not.toContain("bookingSeries");
    expect(updateBlock).not.toContain("broadcast");
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
      "Save booking updates",
      "Future visits remain",
      'active.source === "booking" && <NativeBookingCommercialEditor',
      "(active.firstCleaningTotalCents ?? 0)",
    ])
      expect(page).toContain(marker);
    expect(page).not.toMatch(/active\.source === "booking"\s*&&\s*active\.firstCleaningTotalCents\s*!==\s*null\s*&&\s*<NativeBookingCommercialEditor/);
    expect(workspace).toContain("trpc.bookings.updateDetails.useMutation");
    expect(workspace).toContain("updateActiveBookingDetails");
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
