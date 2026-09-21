import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Bookings CRM exact live shell", () => {
  it("reuses the existing booking workspace behavior with the approved CRM presentation", () => {
    const page = read("client/src/pages/BookingsCRMExactLive.tsx");
    const entry = read("client/src/pages/NativeBookings.tsx");
    const app = read("client/src/App.tsx");
    const styles = read("client/src/pages/bookings-crm-exact-live.css");
    const workspace = read("client/src/components/NativeBookingsWorkspace.tsx");

    for (const stylesheet of [
      "operations-crm-review.css",
      "bookings-crm-review.css",
      "bookings-typography-cohesion.css",
      "bookings-avatar-cohesion.css",
      "bookings-customer-avatar-cohesion.css",
      "bookings-portraits.css",
      "bookings-crm-exact-live.css",
    ]) expect(page).toContain(`"./${stylesheet}"`);

    expect(page).toContain('import NativeBookingsWorkspace from "@/components/NativeBookingsWorkspace";');
    expect(page).toContain("<NativeBookingsWorkspace realtimeEnabled={realtimeEnabled}");
    expect(page).toContain('className="ocr-workspace bcr-workspace"');
    expect(page).toContain('className="bcr-booking-list"');
    expect(page).toContain('className="ocr-detail-drawer bcr-workspace-detail"');
    expect(styles).toContain(".bcr-workspace");
    expect(entry).toContain('import BookingsCRMExactLive from "@/pages/BookingsCRMExactLive";');
    expect(entry).toContain("return <BookingsCRMExactLive realtimeEnabled={agentId !== null} />;");
    expect(entry).not.toContain("bookings-reference-sidebar");
    expect(workspace).toContain("render?: (model: any) => ReactNode");
    expect(workspace).toContain("if (render) return <>{render({");
    expect(app).toContain("function AdminBookingsCRMExactReviewRoute() {");
    expect(app).toContain('<ReviewWorkspaceFrame navActivePath="/review/bookings-crm"><NativeBookings /></ReviewWorkspaceFrame>');
    expect(app).toContain('<Route path={"/admin/bookings"} component={AdminBookingsCRMExactReviewRoute} />');

    for (const prohibited of ["cleaner" + "Jobs", "cleaner" + "_jobs"]) {
      expect(page).not.toContain(prohibited);
    }
  });
});
