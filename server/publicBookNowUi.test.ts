import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("public Book Now UI contract", () => {
  const appSource = read("client/src/App.tsx");
  const pageSource = read("client/src/pages/BookNow.tsx");
  const cssSource = read("client/src/pages/book-now.css");

  it("adds a separate lazy public /book-now route without replacing the working /book route", () => {
    expect(appSource).toContain('const Book = lazy(() => import("./pages/Book"))');
    expect(appSource).toContain('const BookNow = lazy(() => import("./pages/BookNow"))');
    expect(appSource).toContain('<Route path={"/book"} component={Book} />');
    expect(appSource).toContain('<Route path={"/book-now"} component={BookNow} />');
  });

  it("uses the existing public widget configuration and authoritative shared pricing contracts", () => {
    expect(pageSource).toContain("trpc.bookings.getPublicWidgetConfig.useQuery");
    expect(pageSource).toContain("parseBookingWidgetDraft");
    expect(pageSource).toContain("calculateBookingWidgetPrice");
    expect(pageSource).toContain("calculateBookingWidgetRecurringPrice");
    expect(pageSource).toContain("BOOKING_WIDGET_PRICED_EXTRAS.map");
    expect(pageSource).toContain("BOOKING_WIDGET_RECURRING_OPTIONS.map");
    expect(pageSource).toContain("config.services.map");
  });

  it("keeps this first phase UI-only with no booking, lead, Stripe, or payment write", () => {
    expect(pageSource).not.toContain("useMutation");
    expect(pageSource).not.toContain("bookingFunnel.begin");
    expect(pageSource).not.toContain("bookingFunnel.update");
    expect(pageSource).not.toContain("bookings.prepare");
    expect(pageSource).not.toContain("stripe.confirm");
    expect(pageSource).toContain("UI preview only.");
    expect(pageSource).toContain("No card data is collected or stored.");
    expect(pageSource).toContain("<input disabled");
  });

  it("preserves the supplied four-step composition and live summary interaction", () => {
    expect(pageSource).toContain("STEP {step} OF 4");
    expect(pageSource).toContain("BUILD YOUR CLEANING");
    expect(pageSource).toContain("YOUR APPOINTMENT");
    expect(pageSource).toContain("YOUR DETAILS");
    expect(pageSource).toContain("SECURE YOUR APPOINTMENT");
    expect(pageSource).toContain("book-now-summary-list");
    expect(pageSource).toContain("book-now-appointment-preview");
    expect(pageSource).toContain("book-now-confirmation-card");
  });

  it("preserves the supplied desktop geometry and responsive single-column behavior", () => {
    expect(cssSource).toContain("width:min(1180px,100%)");
    expect(cssSource).toContain("grid-template-columns:minmax(0,1fr) 355px");
    expect(cssSource).toContain("border-radius:22px");
    expect(cssSource).toContain("position:sticky;top:20px");
    expect(cssSource).toContain("@media(max-width:850px)");
    expect(cssSource).toContain(".book-now-layout{grid-template-columns:1fr}");
    expect(cssSource).toContain("@media(max-width:560px)");
  });

  it("does not hardcode a fabricated customer rating, review count, or testimonial", () => {
    expect(pageSource).not.toMatch(/2,100|4\.9 from|customer review|testimonial/i);
  });
});
