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
  toggleMultiSelectChoice,
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
    expect(parsed.demoVersion).toBe(4);
    expect(parsed.brandName).toBe("MIB Booking");
    expect(parsed.primaryColor).toBe("#123456");
    expect(parsed.quickPrompts[0]).toBe("Book a clean");
    expect(parsed.questions.map((question) => question.role)).toEqual(["bedrooms", "bathrooms", "extras"]);
    expect(parsed.questions[0].prompt).toBe("And how many bedrooms?");
    expect(parsed.questions[1]).toMatchObject({ prompt: "How many baths?", choices: ["One bath", "Two baths"], selectionMode: "single" });
    expect(parsed.questions[2]).toMatchObject({ prompt: "Add anything?", choices: ["Nothing", "Oven"], selectionMode: "multiple" });
    expect(parsed.services.find((service) => service.id === "deep")?.price).toBe("405");
  });

  it("migrates version-three questions to single-choice except extras", () => {
    const versionThree = {
      ...DEFAULT_BOOKING_WIDGET_DRAFT,
      demoVersion: 3,
      questions: DEFAULT_BOOKING_WIDGET_DRAFT.questions.map(({ selectionMode: _selectionMode, ...question }) => question),
    };
    const parsed = parseBookingWidgetDraft(JSON.stringify(versionThree));
    expect(parsed.demoVersion).toBe(4);
    expect(parsed.questions.map((question) => question.selectionMode)).toEqual(["single", "single", "multiple"]);
  });

  it("preserves dynamic custom questions and choices in their configured order", () => {
    const parsed = parseBookingWidgetDraft(JSON.stringify({
      ...DEFAULT_BOOKING_WIDGET_DRAFT,
      questions: [
        ...DEFAULT_BOOKING_WIDGET_DRAFT.questions,
        { id: "pets", role: "custom", prompt: "Any pets?", choices: ["No pets", "Dog", "Cat", "Other"], selectionMode: "multiple" },
      ],
    }));
    expect(parsed.questions.at(-1)).toEqual({ id: "pets", role: "custom", prompt: "Any pets?", choices: ["No pets", "Dog", "Cat", "Other"], selectionMode: "multiple" });
  });

  it("reorders list items without mutating the source list", () => {
    const source = ["Bedrooms", "Bathrooms", "Extras"];
    expect(moveListItem(source, 2, 1)).toEqual(["Bedrooms", "Extras", "Bathrooms"]);
    expect(source).toEqual(["Bedrooms", "Bathrooms", "Extras"]);
  });

  it("resolves the supplied prompt into the deep-clean demo with three bedrooms", () => {
    expect(resolveDemoRequest("Deep clean my 3BR tomorrow morning")).toEqual({ serviceId: "deep", bedrooms: 3 });
  });

  it("keeps every selected extra exactly once in the priced summary", () => {
    const answers = { bedrooms: ["3 bedrooms"], bathrooms: ["2 bathrooms"], extras: ["Fridge", "Oven", "Fridge"] };
    expect(buildDemoDetailLine(3, DEFAULT_BOOKING_WIDGET_DRAFT.questions, answers)).toBe("3 bed · 2 bath · Fridge · Oven");
    expect(buildDemoDetailLine(3, DEFAULT_BOOKING_WIDGET_DRAFT.questions, { ...answers, extras: ["No extras"] })).toBe("3 bed · 2 bath");
  });

  it("toggles multiple choices and keeps No extras mutually exclusive", () => {
    expect(toggleMultiSelectChoice([], "Fridge")).toEqual(["Fridge"]);
    expect(toggleMultiSelectChoice(["Fridge"], "Oven")).toEqual(["Fridge", "Oven"]);
    expect(toggleMultiSelectChoice(["Fridge", "Oven"], "Fridge")).toEqual(["Oven"]);
    expect(toggleMultiSelectChoice(["Fridge", "Oven"], "No extras")).toEqual(["No extras"]);
    expect(toggleMultiSelectChoice(["No extras"], "Baseboards")).toEqual(["Baseboards"]);
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
