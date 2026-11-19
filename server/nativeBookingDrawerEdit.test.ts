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
    const implementation = router.slice(
      router.indexOf("const updateCanonicalBookingDetailsInputSchema"),
      router.indexOf("export const bookingsRouter")
    ) + updateBlock;
    expect(updateBlock).toContain("updateCanonicalBookingDetails(tx, input)");

    for (const marker of [
      "updateDetails: bookingsAgentProcedure",
      "PUBLIC_BOOKING_PRICED_EXTRAS",
      "firstCleaningTotalCents: z",
      "companyNotes: z.string().trim().max(4_000).nullable()",
      "requestedLocalDate: bookingRescheduleDateSchema",
      "requestedLocalTime: bookingRescheduleTimeSchema",
      "recurrence: z.enum(NATIVE_BOOKING_RECURRENCES)",
      "nativeBookingFutureVisitTotalCents",
      "requestedStartAt",
    ])
      expect(implementation).toContain(marker);
    expect(implementation).toContain("bookingSeries");
    expect(updateBlock).toContain("publishNativeBookingRefresh()");
    expect(implementation).not.toContain("bookingPaymentProfiles");
    expect(implementation).not.toContain('paymentStatus === "authorized"');
    expect(implementation).not.toContain('paymentStatus === "captured"');
    expect(implementation).not.toContain(prohibitedLegacySymbol);
  });

  it("coordinates native amount scope with extras and notes through the existing single footer save", () => {
    const page = read("client/src/pages/BookingsCRMExactLive.tsx");
    const workspace = read("client/src/components/NativeBookingsWorkspace.tsx");
    const amountEditor = read("client/src/components/NativeBookingAmountEditor.tsx");

    for (const marker of [
      "NativeBookingCommercialEditor",
      "Extras, price &amp; company notes",
      "Final price ($)",
      "Company notes",
      "Future visits remain",
      'active.source === "booking" && (',
      'active.source === "booking" ? (',
      "updateActiveBookingSchedule",
      "onDraftChange",
      "displayedFirstCleaningTotalCents",
      "displayedExtras",
      "Save booking updates",
    ])
      expect(page + amountEditor).toContain(marker);
    expect(amountEditor).toContain("This job only");
    expect(amountEditor).toContain("This and future jobs");
    expect(amountEditor).toContain("trpc.bookings.updateManualAmount.useMutation");
    expect(amountEditor).not.toContain("Save amount");
    expect(amountEditor).not.toContain("bcr-native-amount-save");
    expect(amountEditor).toContain("Use Save booking updates below");
    expect(amountEditor).toContain("No payment is charged or refunded");
    expect(amountEditor).toContain("NativeBookingAmountSaveControl");
    expect(amountEditor).toContain("saveControlRef.current = control");
    expect(amountEditor).toContain("onSaveStateChange({ identity, dirty, canSave })");
    expect(amountEditor).toContain("if (!options?.deferRefresh) onAmountUpdated()");
    expect(page).toContain("saveControlRef={amountSaveControlRef}");
    expect(page).toContain("onSaveStateChange={onAmountSaveStateChange}");
    expect(page).not.toContain("use Save amount to change the total");
    expect(page).toContain("active.originalFirstCleaningTotalCents ?? active.firstCleaningTotalCents");
    expect(page).not.toMatch(
      /active\.source === "booking"\s*&&\s*active\.firstCleaningTotalCents\s*!==\s*null\s*&&\s*<NativeBookingCommercialEditor/
    );
    expect(workspace).toContain("trpc.bookings.updateDetails.useMutation");
    expect(workspace).toContain("updateActiveBookingDetails");
    expect(workspace).toContain("isValidDateKey");
    expect(workspace).toContain("dates.filter(isValidDateKey)");
    expect(page).not.toContain('className="bcr-commercial-actions"');
    const footer = page.slice(
      page.indexOf('<footer className="bcr-workspace-detail-footer">'),
      page.indexOf(
        "</footer>",
        page.indexOf('<footer className="bcr-workspace-detail-footer">')
      )
    );
    expect(footer).toContain('className="bcr-save-changes"');
    expect(footer.match(/className="bcr-save-changes"/g)).toHaveLength(1);
    expect(footer).toContain("const amountControl = amountSaveControlRef.current");
    expect(footer).toContain("amountControl.identity !== amountIdentity");
    expect(footer).toContain("amountControl.dirty && !amountControl.canSave");
    expect(footer).toContain("model.bookingSavePending");
    expect(footer).toContain("model.detailQuery.isFetching");
    expect(footer).toContain("const detailsChanged =");
    expect(footer).toContain("model.updateActiveBookingDetails");
    expect(footer).toContain("beforeSubmit: amountControl.dirty");
    expect(footer).toContain("amountControl.save({ deferRefresh: true })");
    expect(footer).toContain('className="bcr-cancel-booking"');
    expect(footer.indexOf("bcr-save-changes")).toBeLessThan(
      footer.indexOf("bcr-cancel-booking")
    );
    expect(page).not.toContain(
      "disabled={model.updateBookingDetails.isPending}\n                      onClick={() =>\n                        model.updateActiveBookingSchedule"
    );
  });

  it("retains the existing details mutation, schedule confirmation and payment/link action paths", () => {
    const workspace = read("client/src/components/NativeBookingsWorkspace.tsx");
    const page = read("client/src/pages/BookingsCRMExactLive.tsx");
    const detailsSave = workspace.slice(
      workspace.indexOf("const updateActiveBookingDetails ="),
      workspace.indexOf("const updateActiveBookingSchedule =")
    );
    expect(detailsSave).toContain("beforeSubmit?: () => Promise<boolean>");
    expect(detailsSave).toContain("detailsChanged: boolean");
    expect(detailsSave).toContain("updateBookingDetails.mutateAsync");
    expect(detailsSave).toContain("requestScheduleSave(");
    expect(detailsSave).toContain("if (!await options.beforeSubmit())");
    expect(detailsSave).toContain("if (!options || options.detailsChanged || changed)");
    expect(detailsSave).toContain("refreshBookingAndFunnelQueries()");
    expect(detailsSave).not.toContain("updateManualAmount");
    for (const marker of [
      "<BookingPaymentActions", "<PortalRequestPaymentActions", "<BookingTeamMagicLink",
      "<BookingPayrollPanel active={active} model={model}", "onClick={model.copyCustomerMagicLink}",
      "onClick={model.updateActiveRecordSchedule}", "onClick={model.cancelActiveRecord}",
      "totalCents={active.originalFirstCleaningTotalCents ?? active.firstCleaningTotalCents}",
      "holdTotalCents={active.firstCleaningTotalCents}",
    ]) expect(page).toContain(marker);
    for (const source of [detailsSave, page]) expect(source).not.toContain(prohibitedLegacySymbol);
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
