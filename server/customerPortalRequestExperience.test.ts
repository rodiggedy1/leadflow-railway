import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { customerPortalAppointmentWindows, firstCustomerPortalBookableDate, getCustomerPortalCalendarGrid, isCustomerPortalBookableDate } from "../client/src/lib/customerPortalAppointment";

const root = process.cwd();

describe("customer portal service request experience", () => {
  it("uses Joe’s four preferred appointment windows and booking calendar range", () => {
    expect(customerPortalAppointmentWindows).toEqual([
      { id: "morning", label: "Morning", detail: "8:00–11:00 AM" },
      { id: "midday", label: "Midday", detail: "11:00 AM–2:00 PM" },
      { id: "afternoon", label: "Afternoon", detail: "2:00–5:00 PM" },
      { id: "evening", label: "Evening", detail: "5:00–7:00 PM" },
    ]);
    const now = new Date(2026, 8, 3, 9, 0, 0, 0);
    const firstDate = firstCustomerPortalBookableDate(now);
    expect(firstDate).toEqual(new Date(2026, 8, 4, 12, 0, 0, 0));
    expect(isCustomerPortalBookableDate(new Date(2026, 8, 3), now)).toBe(false);
    expect(isCustomerPortalBookableDate(new Date(2026, 9, 29), now)).toBe(true);
    expect(isCustomerPortalBookableDate(new Date(2026, 9, 30), now)).toBe(false);
    expect(getCustomerPortalCalendarGrid(new Date(2026, 8, 1))).toHaveLength(42);
  });

  it("keeps service requests first in the list and reuses verified customer data in the form and card", async () => {
    const [portal, router] = await Promise.all([
      readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8"),
      readFile(path.resolve(root, "server/customerPortalRouter.ts"), "utf8"),
    ]);
    expect(portal.indexOf("portal.data.requests.map(request")).toBeLessThan(portal.indexOf("portal.data.cleanings.map(cleaning"));
    expect(portal).toContain('portal.data.requests.map(request => <article className="mib-portal-booking-card"');
    expect(portal).not.toContain('portal.data.requests.map(request => <article className="mib-portal-request-card"');
    expect(portal).toContain('<div className="mib-portal-booking-top"><div><small>HOME SERVICE REQUEST</small>');
    expect(portal).toContain('<div className="mib-portal-booking-grid"><div><CalendarDays />');
    expect(portal).toContain('<div className="mib-portal-booking-footer"><div><i />{request.publicRequestNumber');
    expect(portal).toContain("CustomerPortalAppointmentCalendar");
    expect(portal).toContain("customerPortalAppointmentWindows");
    expect(portal).not.toContain('input type="date"');
    expect(portal).toContain("const [useDifferentAddress, setUseDifferentAddress] = useState(false);");
    expect(portal).toContain("const selectedAddress = useDifferentAddress || !homeAddress ? address.trim() : homeAddress;");
    expect(portal).toContain("Use a different address");
    expect(portal).toContain("Use my home-cleaning address");
    expect(portal).toContain("const savedCardLabel = portal.data.savedCard?.last4");
    expect(portal).toContain("ending in ${portal.data.savedCard.last4}");
    expect(router).toContain("bookingPaymentProfiles");
    expect(router).toContain("innerJoin(bookings, eq(bookingPaymentProfiles.bookingId, bookings.id))");
    expect(router).toContain('profile.paymentStatus === "card_on_file" && Boolean(profile.cardLast4)');
  });

  it("opens home cleaning as a prefilled in-portal rebook without replacing its existing booking lifecycle", async () => {
    const [portal, bookingPage] = await Promise.all([
      readFile(path.resolve(root, "client/src/pages/CustomerPortal.tsx"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/BookNow.tsx"), "utf8"),
    ]);
    expect(portal).toContain('const [showCleaningRebook, setShowCleaningRebook] = useState(false);');
    expect(portal).toContain('onClick={() => setShowCleaningRebook(true)}><Plus /> Book home cleaning');
    expect(portal).toContain('onClick={() => setShowCleaningRebook(true)}><div className="mib-portal-service-icon"><Home /></div>');
    expect(portal).not.toContain('<a className="mib-portal-primary" href="/book-now"><Plus /> Book home cleaning');
    expect(portal).toContain('<BookNow portalRebook={{ customerName: portal.data.account.name, phone: portal.data.account.phone, email: portal.data.account.email, address: homeAddress }} onClose={closeCleaningRebook} />');
    expect(bookingPage).toContain('portalRebook?: { customerName: string; phone: string; email: string | null; address: string };');
    expect(bookingPage).toContain('const [address, setAddress] = useState(portalRebook?.address ?? "");');
    expect(bookingPage).toContain('Use a different address');
    expect(bookingPage).toContain('Use my home-cleaning address');
    expect(bookingPage).toContain('source: embedded ? "widget-popup" : "book-page"');
    expect(bookingPage).toContain('if (portalRebook) return;');
    expect(bookingPage).toContain('window.location.assign("/my-home")');
  });
});
