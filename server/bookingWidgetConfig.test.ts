import { describe, expect, it } from "vitest";
import {
  BOOKING_WIDGET_DRAFT_SETTING,
  DEFAULT_BOOKING_WIDGET_DRAFT,
  buildDemoDetailLine,
  formatBookingButtonLabel,
  moveListItem,
  parseBookingWidgetDraft,
  renderBookingWidgetTemplate,
  resolveDemoRequest,
} from "../shared/bookingWidgetConfig";

describe("booking widget interactive demo configuration", () => {
  it("recovers the complete preview-only draft when stored JSON is invalid", () => {
    expect(parseBookingWidgetDraft("not-json")).toEqual(DEFAULT_BOOKING_WIDGET_DRAFT);
  });

  it("migrates the deployed version-two draft and inserts bedrooms before bathrooms", () => {
    const parsed = parseBookingWidgetDraft(JSON.stringify({
      demoVersion: 2,
      brandName: "MIB Booking",
      primaryColor: "#123456",
      quickPrompts: ["Book a clean"],
      bathroomQuestion: "How many baths?",
      bathroomOptions: ["One bath", "Two baths"],
      extrasQuestion: "Add anything?",
      extrasOptions: ["Nothing", "Oven"],
    }));
    expect(parsed.demoVersion).toBe(3);
    expect(parsed.brandName).toBe("MIB Booking");
    expect(parsed.primaryColor).toBe("#123456");
    expect(parsed.quickPrompts[0]).toBe("Book a clean");
    expect(parsed.questions.map((question) => question.role)).toEqual(["bedrooms", "bathrooms", "extras"]);
    expect(parsed.questions[0].prompt).toBe("And how many bedrooms?");
    expect(parsed.questions[1]).toMatchObject({ prompt: "How many baths?", choices: ["One bath", "Two baths"] });
    expect(parsed.questions[2]).toMatchObject({ prompt: "Add anything?", choices: ["Nothing", "Oven"] });
    expect(parsed.services.find((service) => service.id === "deep")?.price).toBe("405");
  });

  it("preserves dynamic custom questions and choices in their configured order", () => {
    const parsed = parseBookingWidgetDraft(JSON.stringify({
      ...DEFAULT_BOOKING_WIDGET_DRAFT,
      questions: [
        ...DEFAULT_BOOKING_WIDGET_DRAFT.questions,
        { id: "pets", role: "custom", prompt: "Any pets?", choices: ["No pets", "Dog", "Cat", "Other"] },
      ],
    }));
    expect(parsed.questions.at(-1)).toEqual({ id: "pets", role: "custom", prompt: "Any pets?", choices: ["No pets", "Dog", "Cat", "Other"] });
  });

  it("reorders list items without mutating the source list", () => {
    const source = ["Bedrooms", "Bathrooms", "Extras"];
    expect(moveListItem(source, 2, 1)).toEqual(["Bedrooms", "Extras", "Bathrooms"]);
    expect(source).toEqual(["Bedrooms", "Bathrooms", "Extras"]);
  });

  it("resolves the supplied prompt into the deep-clean demo with three bedrooms", () => {
    expect(resolveDemoRequest("Deep clean my 3BR tomorrow morning")).toEqual({ serviceId: "deep", bedrooms: 3 });
  });

  it("keeps a selected extra exactly once in the priced summary", () => {
    const answers = { bedrooms: "3 bedrooms", bathrooms: "2 bathrooms", extras: "Fridge" };
    expect(buildDemoDetailLine(3, DEFAULT_BOOKING_WIDGET_DRAFT.questions, answers)).toBe("3 bed · 2 bath · Fridge");
    expect(buildDemoDetailLine(3, DEFAULT_BOOKING_WIDGET_DRAFT.questions, { ...answers, extras: "No extras" })).toBe("3 bed · 2 bath");
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
