import { describe, expect, it } from "vitest";
import {
  BOOKING_WIDGET_DRAFT_SETTING,
  DEFAULT_BOOKING_WIDGET_DRAFT,
  buildDemoDetailLine,
  buildInferredQuestionAnswers,
  firstNameFromFullName,
  formatBookingButtonLabel,
  formatScheduleQuestion,
  moveListItem,
  parseBookingWidgetDraft,
  renderBookingWidgetTemplate,
  resolveDemoRequest,
  toggleMultiSelectChoice,
  validateBookingWidgetIntakeField,
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
    expect(parsed.demoVersion).toBe(5);
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
    expect(parsed.demoVersion).toBe(5);
    expect(parsed.questions.map((question) => question.selectionMode)).toEqual(["single", "single", "multiple"]);
  });

  it("migrates a saved version-four draft with complete customer-intake defaults", () => {
    const versionFour = { ...DEFAULT_BOOKING_WIDGET_DRAFT, demoVersion: 4 } as Record<string, unknown>;
    for (const key of ["fullNameQuestion", "fullNamePlaceholder", "phoneQuestionTemplate", "phonePlaceholder", "emailQuestion", "emailPlaceholder", "scheduleQuestion", "scheduleQuestionWithDayTemplate", "schedulePlaceholder", "availabilityCheckMessage"]) {
      delete versionFour[key];
    }
    const parsed = parseBookingWidgetDraft(JSON.stringify(versionFour));
    expect(parsed.demoVersion).toBe(5);
    expect(parsed.fullNameQuestion).toBe("Perfect — who should I put the request under?");
    expect(parsed.phoneQuestionTemplate).toContain("{firstName}");
    expect(parsed.availabilityCheckMessage).toContain("check availability");
  });

  it("round-trips editable intake copy and multi-select mode through the persisted JSON draft", () => {
    const savedDraft = {
      ...DEFAULT_BOOKING_WIDGET_DRAFT,
      fullNameQuestion: "Who is this booking for?",
      phoneQuestionTemplate: "Thanks, {firstName}. Which phone should receive updates?",
      emailQuestion: "Where should confirmation go?",
      scheduleQuestionWithDayTemplate: "Which time on {day} works best?",
      availabilityCheckMessage: "Checking the schedule now…",
    };
    const parsed = parseBookingWidgetDraft(JSON.stringify(savedDraft));
    expect(parsed).toEqual(savedDraft);
    expect(parsed.questions.find((question) => question.role === "extras")?.selectionMode).toBe("multiple");
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

  it("extracts only explicitly supplied service details and requested day", () => {
    expect(resolveDemoRequest("Deep clean my 3BR and 2 bath house tomorrow")).toEqual({ serviceId: "deep", bedrooms: 3, bathrooms: 2, requestedDay: "Tomorrow" });
    expect(resolveDemoRequest("I need a deep clean")).toEqual({ serviceId: "deep" });
  });

  it("pre-fills and skips only core service questions found in the opening request", () => {
    const resolved = resolveDemoRequest("Deep clean my 3 bedroom house tomorrow");
    const inferred = buildInferredQuestionAnswers(resolved, DEFAULT_BOOKING_WIDGET_DRAFT.questions);
    expect(inferred.answers).toEqual({ bedrooms: ["3 bedrooms"] });
    expect(inferred.inferredQuestionIds).toEqual(["bedrooms"]);
    expect(inferred.answers.bathrooms).toBeUndefined();
    expect(inferred.answers.extras).toBeUndefined();
  });

  it("can pre-fill both bedrooms and bathrooms while leaving extras unanswered", () => {
    const inferred = buildInferredQuestionAnswers(
      resolveDemoRequest("Deep clean my 3 bedrooms and 2 bathrooms tomorrow"),
      DEFAULT_BOOKING_WIDGET_DRAFT.questions,
    );
    expect(inferred.answers).toEqual({ bedrooms: ["3 bedrooms"], bathrooms: ["2 bathrooms"] });
    expect(inferred.inferredQuestionIds).toEqual(["bedrooms", "bathrooms"]);
    expect(inferred.answers.extras).toBeUndefined();
  });

  it("personalizes the phone prompt and scheduling question deterministically", () => {
    expect(firstNameFromFullName("  Jordan Smith ")).toBe("Jordan");
    expect(formatScheduleQuestion(DEFAULT_BOOKING_WIDGET_DRAFT, "Tomorrow")).toBe("What time on Tomorrow were you hoping for?");
    expect(formatScheduleQuestion(DEFAULT_BOOKING_WIDGET_DRAFT)).toBe("What day and time were you hoping for?");
  });

  it("validates every required customer-intake field before advancing", () => {
    expect(validateBookingWidgetIntakeField("fullName", "Jordan")).toBe("Enter a first and last name.");
    expect(validateBookingWidgetIntakeField("fullName", "Jordan Smith")).toBeNull();
    expect(validateBookingWidgetIntakeField("phone", "202-555-0123")).toBeNull();
    expect(validateBookingWidgetIntakeField("phone", "555-12")).toBe("Enter a valid phone number.");
    expect(validateBookingWidgetIntakeField("email", "jordan@example.com")).toBeNull();
    expect(validateBookingWidgetIntakeField("email", "jordan@invalid")).toBe("Enter a valid email address.");
    expect(validateBookingWidgetIntakeField("schedule", "Tomorrow at 10 AM")).toBeNull();
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
