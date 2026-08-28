import { describe, expect, it } from "vitest";
import {
  BOOKING_WIDGET_DRAFT_SETTING,
  DEFAULT_BOOKING_WIDGET_DRAFT,
  buildDemoDetailLine,
  formatBookingButtonLabel,
  parseBookingWidgetDraft,
  renderBookingWidgetTemplate,
  resolveDemoRequest,
} from "../shared/bookingWidgetConfig";

describe("booking widget interactive demo configuration", () => {
  it("recovers the complete preview-only draft when stored JSON is invalid", () => {
    expect(parseBookingWidgetDraft("not-json")).toEqual(DEFAULT_BOOKING_WIDGET_DRAFT);
  });

  it("upgrades the earlier simple preview while preserving its safe brand choices", () => {
    const parsed = parseBookingWidgetDraft(JSON.stringify({ brandName: "MIB Booking", primaryColor: "#123456", quickPrompts: ["Book a clean"] }));
    expect(parsed.demoVersion).toBe(2);
    expect(parsed.brandName).toBe("MIB Booking");
    expect(parsed.primaryColor).toBe("#123456");
    expect(parsed.quickPrompts[0]).toBe("Book a clean");
    expect(parsed.bathroomOptions).toHaveLength(4);
    expect(parsed.extrasOptions).toHaveLength(5);
    expect(parsed.services.find((service) => service.id === "deep")?.price).toBe("405");
  });

  it("resolves the supplied prompt into the deep-clean demo with three bedrooms", () => {
    expect(resolveDemoRequest("Deep clean my 3BR tomorrow morning")).toEqual({ serviceId: "deep", bedrooms: 3 });
  });

  it("keeps a selected extra exactly once in the priced summary", () => {
    expect(buildDemoDetailLine(3, "2 bathrooms", "Fridge")).toBe("3 bed · 2 bath · Fridge");
    expect(buildDemoDetailLine(3, "2 bathrooms", "No extras")).toBe("3 bed · 2 bath");
  });

  it("formats price and confirmation templates deterministically", () => {
    expect(formatBookingButtonLabel("Continue — ${price}", "405")).toBe("Continue — $405");
    expect(renderBookingWidgetTemplate("Saved {cardBrand} ending in {last4}", { cardBrand: "Visa", last4: "4242" })).toBe("Saved Visa ending in 4242");
  });

  it("stores only an internal draft with no publication or activation flag", () => {
    expect(BOOKING_WIDGET_DRAFT_SETTING.key).toBe("bookingWidgetDraft");
    expect(BOOKING_WIDGET_DRAFT_SETTING.description).toContain("does not publish or activate");
    expect(BOOKING_WIDGET_DRAFT_SETTING.value).not.toContain("published");
    expect(BOOKING_WIDGET_DRAFT_SETTING.value).not.toContain("enabled");
  });
});
