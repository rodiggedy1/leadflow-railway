import { describe, expect, it } from "vitest";
import {
  BOOKING_WIDGET_BEDROOM_BASE_PRICES,
  BOOKING_WIDGET_DRAFT_SETTING,
  BOOKING_WIDGET_EXTRA_CHOICES,
  BOOKING_WIDGET_PRICED_EXTRAS,
  DEFAULT_BOOKING_WIDGET_DRAFT,
  buildDemoDetailLine,
  buildInferredQuestionAnswers,
  calculateBookingWidgetPrice,
  firstNameFromFullName,
  formatBookingButtonLabel,
  formatDemoScheduleSelection,
  formatScheduleQuestion,
  moveListItem,
  parseBookingWidgetDraft,
  renderBookingWidgetTemplate,
  resolveDemoRequest,
  roundBookingWidgetPriceUpToNine,
  toggleMultiSelectChoice,
  validateBookingWidgetIntakeField,
} from "../shared/bookingWidgetConfig";

describe("booking widget interactive demo configuration", () => {
  it("recovers the complete preview-only draft when stored JSON is invalid", () => {
    expect(parseBookingWidgetDraft("not-json")).toEqual(DEFAULT_BOOKING_WIDGET_DRAFT);
  });

  it("migrates the deployed version-two draft and normalizes its extras", () => {
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
    expect(parsed.demoVersion).toBe(7);
    expect(parsed.brandName).toBe("MIB Booking");
    expect(parsed.primaryColor).toBe("#123456");
    expect(parsed.quickPrompts[0]).toBe("Book a clean");
    expect(parsed.questions.map((question) => question.role)).toEqual(["bedrooms", "bathrooms", "extras"]);
    expect(parsed.questions[1]).toMatchObject({ prompt: "How many baths?", choices: ["One bath", "Two baths"], selectionMode: "single" });
    expect(parsed.questions[2]).toMatchObject({ prompt: "Add anything?", choices: BOOKING_WIDGET_EXTRA_CHOICES, selectionMode: "multiple" });
    expect(parsed.services.find((service) => service.id === "deep")?.price).toBe("405");
  });

  it("migrates version-three questions to single-choice except fixed extras", () => {
    const versionThree = {
      ...DEFAULT_BOOKING_WIDGET_DRAFT,
      demoVersion: 3,
      questions: DEFAULT_BOOKING_WIDGET_DRAFT.questions.map(({ selectionMode: _selectionMode, ...question }) => question),
    };
    const parsed = parseBookingWidgetDraft(JSON.stringify(versionThree));
    expect(parsed.demoVersion).toBe(7);
    expect(parsed.questions.map((question) => question.selectionMode)).toEqual(["single", "single", "multiple"]);
  });

  it("migrates a saved version-four draft with complete version-seven intake defaults", () => {
    const versionFour = { ...DEFAULT_BOOKING_WIDGET_DRAFT, demoVersion: 4 } as Record<string, unknown>;
    for (const key of ["combinedDetailsQuestion", "combinedDetailsPlaceholder", "fullNameQuestion", "fullNamePlaceholder", "phoneQuestionTemplate", "phonePlaceholder", "emailQuestion", "emailPlaceholder", "scheduleQuestion", "scheduleQuestionWithDayTemplate", "schedulePlaceholder", "availabilityCheckMessage", "resultTitle", "resultTrustPoints"]) delete versionFour[key];
    const parsed = parseBookingWidgetDraft(JSON.stringify(versionFour));
    expect(parsed.demoVersion).toBe(7);
    expect(parsed.combinedDetailsQuestion).toContain("bedrooms and bathrooms");
    expect(parsed.fullNameQuestion).toBe("Got it. Who should I put the booking under?");
    expect(parsed.phoneQuestionTemplate).toContain("{firstName}");
    expect(parsed.resultTitle).toBe("I can get you in 🎉");
  });

  it("migrates version-five defaults and preserves customized copy", () => {
    const versionFive = {
      ...DEFAULT_BOOKING_WIDGET_DRAFT,
      demoVersion: 5,
      quickPrompts: ["Deep clean my 3BR tomorrow morning", "2BR standard cleaning Saturday", "Move-out clean Friday"],
      questions: DEFAULT_BOOKING_WIDGET_DRAFT.questions.map((question) => question.role === "extras" ? { ...question, prompt: "Anything you want to add?", choices: ["No extras", "Fridge", "Oven", "Baseboards", "Fridge + oven"] } : question),
      fullNameQuestion: "Perfect — who should I put the request under?",
      phoneQuestionTemplate: "Thanks, {firstName}. What’s the best number for arrival updates?",
      emailQuestion: "And where should I send your booking confirmation?",
      scheduleQuestion: "What day and time were you hoping for?",
      scheduleQuestionWithDayTemplate: "What time on {day} were you hoping for?",
      availabilityCheckMessage: "Perfect. Give me a second while I check availability…",
      openingEyebrow: "I found an opening",
      bookingButtonLabel: "Continue — ${price}",
      addressQuestion: "Great choice. What address should we send the team to?",
      paymentConfirmationTemplate: "Perfect. I found your address. For this demo I’ll use a saved {cardBrand} ending in {last4}.",
      confirmButtonLabel: "Confirm booking",
      confirmedScheduleTemplate: "{providerName} is scheduled for {day}, {time}.",
      demoPaymentNotice: "Your card is only a demo. No payment was processed.",
    };
    const migrated = parseBookingWidgetDraft(JSON.stringify(versionFive));
    expect(migrated.demoVersion).toBe(7);
    expect(migrated.quickPrompts[0]).toBe("Deep clean my place");
    expect(migrated.questions.find((question) => question.role === "extras")?.choices).toEqual(BOOKING_WIDGET_EXTRA_CHOICES);
    expect(migrated.fullNameQuestion).toBe("Got it. Who should I put the booking under?");
    expect(migrated.scheduleQuestion).toBe("When would you like us to come?");
    expect(migrated.bookingButtonLabel).toBe("Book for ${price} →");
    expect(migrated.paymentConfirmationTemplate).toBe("Almost done ✨");
    expect(migrated.confirmButtonLabel).toBe("Confirm & book — ${price}");
    expect(parseBookingWidgetDraft(JSON.stringify({ ...versionFive, scheduleQuestion: "Which date works for you?" })).scheduleQuestion).toBe("Which date works for you?");
  });

  it("migrates version-six extras to the fixed catalog while preserving prompt and custom questions", () => {
    const parsed = parseBookingWidgetDraft(JSON.stringify({
      ...DEFAULT_BOOKING_WIDGET_DRAFT,
      demoVersion: 6,
      questions: [
        { id: "bedrooms", role: "bedrooms", prompt: "Bedrooms?", choices: ["1 bedroom"], selectionMode: "single" },
        { id: "extras", role: "extras", prompt: "Choose your add-ons", choices: ["Legacy option"], selectionMode: "single" },
        { id: "pets", role: "custom", prompt: "Any pets?", choices: ["No", "Yes"], selectionMode: "single" },
      ],
    }));
    expect(parsed.demoVersion).toBe(7);
    expect(parsed.questions.find((question) => question.role === "extras")).toMatchObject({ prompt: "Choose your add-ons", choices: BOOKING_WIDGET_EXTRA_CHOICES, selectionMode: "multiple" });
    expect(parsed.questions.find((question) => question.id === "pets")?.choices).toEqual(["No", "Yes"]);
    expect(parsed.helperText).toBe("Demo only · calculated pricing and sample availability");
  });

  it("round-trips editable copy and preserves fixed extras in persisted JSON", () => {
    const savedDraft = { ...DEFAULT_BOOKING_WIDGET_DRAFT, combinedDetailsQuestion: "How many rooms?", resultTitle: "We found a time", resultTrustPoints: ["Insured", "Supplies included", "Guaranteed"] };
    const parsed = parseBookingWidgetDraft(JSON.stringify(savedDraft));
    expect(parsed).toEqual(savedDraft);
    expect(parsed.questions.find((question) => question.role === "extras")?.selectionMode).toBe("multiple");
  });

  it("preserves dynamic custom questions and choices", () => {
    const parsed = parseBookingWidgetDraft(JSON.stringify({ ...DEFAULT_BOOKING_WIDGET_DRAFT, questions: [...DEFAULT_BOOKING_WIDGET_DRAFT.questions, { id: "pets", role: "custom", prompt: "Any pets?", choices: ["No pets", "Dog"], selectionMode: "multiple" }] }));
    expect(parsed.questions.at(-1)).toEqual({ id: "pets", role: "custom", prompt: "Any pets?", choices: ["No pets", "Dog"], selectionMode: "multiple" });
  });

  it("reorders list items without mutation", () => {
    const source = ["Bedrooms", "Bathrooms", "Extras"];
    expect(moveListItem(source, 2, 1)).toEqual(["Bedrooms", "Extras", "Bathrooms"]);
    expect(source).toEqual(["Bedrooms", "Bathrooms", "Extras"]);
  });

  it("extracts only explicit service details, including studio", () => {
    expect(resolveDemoRequest("Deep clean my 3BR and 2 bath house tomorrow")).toEqual({ serviceId: "deep", bedrooms: 3, bathrooms: 2, requestedDay: "Tomorrow" });
    expect(resolveDemoRequest("2 bed 2 bath")).toEqual({ serviceId: "standard", bedrooms: 2, bathrooms: 2 });
    expect(resolveDemoRequest("I need a deep clean")).toEqual({ serviceId: "deep" });
    expect(resolveDemoRequest("Standard clean for my studio and 1 bathroom")).toEqual({ serviceId: "standard", bedrooms: 0, bathrooms: 1 });
  });

  it("pre-fills only explicitly supplied core counts", () => {
    const inferred = buildInferredQuestionAnswers(resolveDemoRequest("Deep clean my 3 bedroom house tomorrow"), DEFAULT_BOOKING_WIDGET_DRAFT.questions);
    expect(inferred.answers).toEqual({ bedrooms: ["3 bedrooms"] });
    expect(inferred.answers.bathrooms).toBeUndefined();
    expect(inferred.answers.extras).toBeUndefined();
    expect(buildInferredQuestionAnswers(resolveDemoRequest("Studio with 1 bath"), DEFAULT_BOOKING_WIDGET_DRAFT.questions).answers).toMatchObject({ bedrooms: ["0 bedrooms"], bathrooms: ["1 bathroom"] });
  });

  it("uses the complete approved bedroom table and fixed extras catalog", () => {
    expect(BOOKING_WIDGET_BEDROOM_BASE_PRICES).toEqual({ 0: 99, 1: 119, 2: 179, 3: 199, 4: 249, 5: 289, 6: 349, 7: 389 });
    expect(BOOKING_WIDGET_PRICED_EXTRAS.map(({ label, unitPrice, quantityUnit }) => ({ label, unitPrice, quantityUnit }))).toEqual([
      { label: "Inside cabinets", unitPrice: 50, quantityUnit: undefined },
      { label: "Inside fridge", unitPrice: 45, quantityUnit: undefined },
      { label: "Inside oven", unitPrice: 45, quantityUnit: undefined },
      { label: "Interior windows", unitPrice: 10, quantityUnit: "window" },
      { label: "Basement", unitPrice: 60, quantityUnit: undefined },
      { label: "One hour of organizing", unitPrice: 60, quantityUnit: undefined },
      { label: "Laundry", unitPrice: 25, quantityUnit: "load" },
      { label: "Wipe walls", unitPrice: 20, quantityUnit: "room" },
      { label: "Sweep garage", unitPrice: 30, quantityUnit: undefined },
    ]);
    for (const [bedrooms, basePrice] of Object.entries(BOOKING_WIDGET_BEDROOM_BASE_PRICES)) expect(calculateBookingWidgetPrice({ serviceId: "standard", bedrooms: Number(bedrooms), bathrooms: 0 }).total).toBe(basePrice);
  });

  it("calculates bathrooms, flat extras, quantity extras, and service uplifts before rounding", () => {
    expect(calculateBookingWidgetPrice({ serviceId: "standard", bedrooms: 2, bathrooms: 2 }).total).toBe(239);
    expect(calculateBookingWidgetPrice({ serviceId: "standard", bedrooms: 2, bathrooms: 2, selectedExtras: ["Inside fridge"] })).toMatchObject({ standardSubtotal: 284, adjustedSubtotal: 284, total: 289 });
    expect(calculateBookingWidgetPrice({ serviceId: "deep", bedrooms: 2, bathrooms: 2, selectedExtras: ["Inside fridge"] })).toMatchObject({ standardSubtotal: 284, serviceMultiplier: 1.2, adjustedSubtotal: 340.8, total: 349 });
    expect(calculateBookingWidgetPrice({ serviceId: "moveout", bedrooms: 2, bathrooms: 2, selectedExtras: ["Inside fridge"] }).total).toBe(349);
    expect(calculateBookingWidgetPrice({ serviceId: "standard", bedrooms: 3, bathrooms: 2, selectedExtras: ["Interior windows", "Laundry", "Wipe walls"], extraQuantities: { "interior-windows": 3, "laundry-load": 2, "wipe-walls-room": 4 } })).toMatchObject({ extrasTotal: 160, standardSubtotal: 419, total: 419 });
  });

  it("rounds every final quote upward to the next amount ending in nine", () => {
    expect(roundBookingWidgetPriceUpToNine(9)).toBe(9);
    expect(roundBookingWidgetPriceUpToNine(10)).toBe(19);
    expect(roundBookingWidgetPriceUpToNine(340.8)).toBe(349);
    expect(roundBookingWidgetPriceUpToNine(481)).toBe(489);
  });

  it("rejects unsupported inputs rather than inventing a price", () => {
    expect(() => calculateBookingWidgetPrice({ serviceId: "standard", bedrooms: 8, bathrooms: 1 })).toThrow("0 through 7");
    expect(() => calculateBookingWidgetPrice({ serviceId: "standard", bedrooms: 2, bathrooms: -1 })).toThrow("non-negative whole number");
    expect(() => calculateBookingWidgetPrice({ serviceId: "standard", bedrooms: 2, bathrooms: 1, selectedExtras: ["Baseboards"] })).toThrow("Unsupported priced extra");
    expect(() => calculateBookingWidgetPrice({ serviceId: "standard", bedrooms: 2, bathrooms: 1, selectedExtras: ["Laundry"] })).toThrow("positive whole-number quantity");
  });

  it("personalizes prompts and validates intake fields", () => {
    expect(firstNameFromFullName("  Jordan Smith ")).toBe("Jordan");
    expect(formatScheduleQuestion(DEFAULT_BOOKING_WIDGET_DRAFT, "Tomorrow")).toBe("What time on Tomorrow works best?");
    expect(validateBookingWidgetIntakeField("fullName", "Jordan")).toBe("Enter a first and last name.");
    expect(validateBookingWidgetIntakeField("fullName", "Jordan Smith")).toBeNull();
    expect(validateBookingWidgetIntakeField("phone", "202-555-0123")).toBeNull();
    expect(validateBookingWidgetIntakeField("email", "jordan@example.com")).toBeNull();
  });

  it("formats quantity-aware extras once in the result detail line", () => {
    const answers = { bedrooms: ["3 bedrooms"], bathrooms: ["2 bathrooms"], extras: ["Inside fridge", "Inside oven", "Inside fridge", "Interior windows"] };
    expect(buildDemoDetailLine(3, DEFAULT_BOOKING_WIDGET_DRAFT.questions, answers, { "interior-windows": 3 })).toBe("3 bedrooms · 2 bathrooms · Inside fridge included · Inside oven included · Interior windows × 3");
    expect(buildDemoDetailLine(3, DEFAULT_BOOKING_WIDGET_DRAFT.questions, { ...answers, extras: ["Nothing extra"] })).toBe("3 bedrooms · 2 bathrooms");
  });

  it("keeps Nothing extra mutually exclusive", () => {
    expect(toggleMultiSelectChoice([], "Inside fridge")).toEqual(["Inside fridge"]);
    expect(toggleMultiSelectChoice(["Inside fridge"], "Inside oven")).toEqual(["Inside fridge", "Inside oven"]);
    expect(toggleMultiSelectChoice(["Inside fridge", "Inside oven"], "Nothing extra")).toEqual(["Nothing extra"]);
    expect(toggleMultiSelectChoice(["Nothing extra"], "Basement")).toEqual(["Basement"]);
  });

  it("formats price, schedule, and confirmation templates", () => {
    expect(formatBookingButtonLabel("Book for ${price} →", "349")).toBe("Book for $349 →");
    expect(formatDemoScheduleSelection(new Date(2026, 5, 5, 12), "9:00 AM")).toBe("June 5 · 9:00 AM");
    expect(renderBookingWidgetTemplate("Saved {cardBrand} ending in {last4}", { cardBrand: "Visa", last4: "4242" })).toBe("Saved Visa ending in 4242");
  });

  it("stores only an internal draft with no publication or activation flag", () => {
    expect(BOOKING_WIDGET_DRAFT_SETTING.key).toBe("bookingWidgetDraft");
    expect(BOOKING_WIDGET_DRAFT_SETTING.description).toContain("does not publish or activate");
    expect(BOOKING_WIDGET_DRAFT_SETTING.value).not.toContain("published");
    expect(BOOKING_WIDGET_DRAFT_SETTING.value).not.toContain("enabled");
  });
});
