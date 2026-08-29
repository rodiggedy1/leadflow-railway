export type BookingWidgetServiceId = "standard" | "deep" | "moveout";
export type BookingWidgetQuestionRole = "bedrooms" | "bathrooms" | "extras" | "custom";
export type BookingWidgetQuestionSelectionMode = "single" | "multiple";
export type BookingWidgetIntakeField = "fullName" | "phone" | "email" | "schedule";
export type BookingWidgetRecurringFrequency = "one-time" | "weekly" | "biweekly" | "monthly";

export type BookingWidgetRecurringOption = {
  id: Exclude<BookingWidgetRecurringFrequency, "one-time">;
  label: string;
  discountPercent: number;
  badge?: string;
};

export type BookingWidgetPricedExtra = {
  id: string;
  label: string;
  unitPrice: number;
  quantityUnit?: "window" | "load" | "room";
};

export type BookingWidgetPriceBreakdown = {
  bedroomBasePrice: number;
  bathroomTotal: number;
  baseCleaningTotal: number;
  extrasTotal: number;
  standardSubtotal: number;
  serviceMultiplier: number;
  serviceAdjustment: number;
  adjustedSubtotal: number;
  total: number;
};

export const BOOKING_WIDGET_BEDROOM_BASE_PRICES: Readonly<Record<number, number>> = {
  0: 99,
  1: 119,
  2: 179,
  3: 199,
  4: 249,
  5: 289,
  6: 349,
  7: 389,
};

export const BOOKING_WIDGET_BATHROOM_UNIT_PRICE = 30;

export const BOOKING_WIDGET_PRICED_EXTRAS: readonly BookingWidgetPricedExtra[] = [
  { id: "inside-cabinets", label: "Inside cabinets", unitPrice: 50 },
  { id: "inside-fridge", label: "Inside fridge", unitPrice: 45 },
  { id: "inside-oven", label: "Inside oven", unitPrice: 45 },
  { id: "interior-windows", label: "Interior windows", unitPrice: 10, quantityUnit: "window" },
  { id: "basement", label: "Basement", unitPrice: 60 },
  { id: "organizing-hour", label: "One hour of organizing", unitPrice: 60 },
  { id: "laundry-load", label: "Laundry", unitPrice: 25, quantityUnit: "load" },
  { id: "wipe-walls-room", label: "Wipe walls", unitPrice: 20, quantityUnit: "room" },
  { id: "sweep-garage", label: "Sweep garage", unitPrice: 30 },
] as const;

export const BOOKING_WIDGET_EXTRA_CHOICES = ["Nothing extra", ...BOOKING_WIDGET_PRICED_EXTRAS.map((extra) => extra.label)] as const;

export const BOOKING_WIDGET_RECURRING_OPTIONS: readonly BookingWidgetRecurringOption[] = [
  { id: "weekly", label: "Weekly", discountPercent: 20 },
  { id: "biweekly", label: "Every 2 weeks", discountPercent: 15, badge: "MOST POPULAR" },
  { id: "monthly", label: "Monthly", discountPercent: 10 },
] as const;

export function calculateBookingWidgetRecurringPrice(
  firstCleaningTotal: number,
  frequency: BookingWidgetRecurringFrequency,
): number | null {
  if (!Number.isFinite(firstCleaningTotal) || firstCleaningTotal < 0) {
    throw new Error("First-clean total must be a non-negative number.");
  }
  if (frequency === "one-time") return null;
  const option = BOOKING_WIDGET_RECURRING_OPTIONS.find((item) => item.id === frequency);
  if (!option) throw new Error(`Unsupported recurring frequency: ${frequency}`);
  return Math.round(firstCleaningTotal * (1 - option.discountPercent / 100));
}

export function findBookingWidgetPricedExtra(choice: string): BookingWidgetPricedExtra | undefined {
  const normalized = choice.trim().toLowerCase();
  return BOOKING_WIDGET_PRICED_EXTRAS.find((extra) => extra.label.toLowerCase() === normalized);
}

export function formatBookingWidgetExtraSelection(choice: string, quantities: Readonly<Record<string, number>> = {}): string {
  if (isNoSelectionChoice(choice)) return choice.trim();
  const pricedExtra = findBookingWidgetPricedExtra(choice);
  if (!pricedExtra?.quantityUnit) return pricedExtra?.label ?? choice.trim();
  const quantity = quantities[pricedExtra.id];
  return quantity ? `${pricedExtra.label} × ${quantity}` : pricedExtra.label;
}

export function calculateBookingWidgetPrice(input: {
  serviceId: BookingWidgetServiceId;
  bedrooms: number;
  bathrooms: number;
  selectedExtras?: readonly string[];
  extraQuantities?: Readonly<Record<string, number>>;
}): BookingWidgetPriceBreakdown {
  if (!Number.isInteger(input.bedrooms) || BOOKING_WIDGET_BEDROOM_BASE_PRICES[input.bedrooms] === undefined) {
    throw new Error("Bedrooms must be a whole number from 0 through 7.");
  }
  if (!Number.isInteger(input.bathrooms) || input.bathrooms < 0) {
    throw new Error("Bathrooms must be a non-negative whole number.");
  }

  const bedroomBasePrice = BOOKING_WIDGET_BEDROOM_BASE_PRICES[input.bedrooms];
  const bathroomTotal = input.bathrooms * BOOKING_WIDGET_BATHROOM_UNIT_PRICE;
  const baseCleaningTotal = bedroomBasePrice + bathroomTotal;
  const selectedExtras = [...new Set((input.selectedExtras ?? []).map((choice) => choice.trim()).filter(Boolean))]
    .filter((choice) => !isNoSelectionChoice(choice));
  const extrasTotal = selectedExtras.reduce((total, choice) => {
    const pricedExtra = findBookingWidgetPricedExtra(choice);
    if (!pricedExtra) throw new Error(`Unsupported priced extra: ${choice}`);
    if (!pricedExtra.quantityUnit) return total + pricedExtra.unitPrice;
    const quantity = input.extraQuantities?.[pricedExtra.id];
    if (!Number.isInteger(quantity) || (quantity ?? 0) < 1) {
      throw new Error(`${pricedExtra.label} requires a positive whole-number quantity.`);
    }
    return total + pricedExtra.unitPrice * quantity;
  }, 0);
  const standardSubtotal = baseCleaningTotal + extrasTotal;
  const serviceMultiplier = input.serviceId === "standard" ? 1 : 1.2;
  const adjustedSubtotal = Math.round(standardSubtotal * serviceMultiplier * 100) / 100;
  const serviceAdjustment = Math.round((adjustedSubtotal - standardSubtotal) * 100) / 100;
  const total = Math.round(adjustedSubtotal);

  return {
    bedroomBasePrice,
    bathroomTotal,
    baseCleaningTotal,
    extrasTotal,
    standardSubtotal,
    serviceMultiplier,
    serviceAdjustment,
    adjustedSubtotal,
    total,
  };
}

export type BookingWidgetResolvedRequest = {
  serviceId: BookingWidgetServiceId;
  bedrooms?: number;
  bathrooms?: number;
  requestedDay?: string;
};

export type BookingWidgetServiceDraft = {
  id: BookingWidgetServiceId;
  name: string;
  price: string;
  availabilityDay: string;
  availabilityTime: string;
  providerName: string;
  rating: string;
  completedJobs: string;
};

export type BookingWidgetQuestionDraft = {
  id: string;
  role: BookingWidgetQuestionRole;
  prompt: string;
  choices: string[];
  selectionMode: BookingWidgetQuestionSelectionMode;
};

export type BookingWidgetDraftConfig = {
  demoVersion: 7;
  brandName: string;
  brandLogoUrl: string;
  headerIcon: string;
  statusText: string;
  greeting: string;
  inputPlaceholder: string;
  addressPlaceholder: string;
  helperText: string;
  primaryColor: string;
  customerBubbleColor: string;
  quickPrompts: string[];
  questions: BookingWidgetQuestionDraft[];
  combinedDetailsQuestion: string;
  combinedDetailsPlaceholder: string;
  fullNameQuestion: string;
  fullNamePlaceholder: string;
  phoneQuestionTemplate: string;
  phonePlaceholder: string;
  emailQuestion: string;
  emailPlaceholder: string;
  scheduleQuestion: string;
  scheduleQuestionWithDayTemplate: string;
  schedulePlaceholder: string;
  availabilityCheckMessage: string;
  resultTitle: string;
  resultTrustPoints: string[];
  openingEyebrow: string;
  services: [BookingWidgetServiceDraft, BookingWidgetServiceDraft, BookingWidgetServiceDraft];
  bookingButtonLabel: string;
  addressQuestion: string;
  addressExample: string;
  paymentConfirmationTemplate: string;
  demoCardBrand: string;
  demoCardLast4: string;
  confirmButtonLabel: string;
  confirmedEyebrow: string;
  confirmedTitle: string;
  confirmedScheduleTemplate: string;
  demoPaymentNotice: string;
  finalReminder: string;
};

export const DEFAULT_BOOKING_WIDGET_DRAFT: BookingWidgetDraftConfig = {
  demoVersion: 7,
  brandName: "Book with AI",
  brandLogoUrl: "",
  headerIcon: "✨",
  statusText: "AI booking assistant · online",
  greeting: "Hey! 👋 I can get your cleaning booked in about a minute. Just tell me what you need.",
  inputPlaceholder: "Tell me what you need...",
  addressPlaceholder: "Enter service address...",
  helperText: "Demo only · calculated pricing and sample availability",
  primaryColor: "#171717",
  customerBubbleColor: "#edf2ff",
  quickPrompts: [
    "Deep clean my place",
    "2BR standard cleaning Saturday",
    "Move-out clean Friday",
  ],
  questions: [
    {
      id: "bedrooms",
      role: "bedrooms",
      prompt: "And how many bedrooms?",
      choices: ["1 bedroom", "2 bedrooms", "3 bedrooms", "4 bedrooms", "5+ bedrooms"],
      selectionMode: "single",
    },
    {
      id: "bathrooms",
      role: "bathrooms",
      prompt: "And how many bathrooms?",
      choices: ["1 bathroom", "2 bathrooms", "3 bathrooms", "4 bathrooms"],
      selectionMode: "single",
    },
    {
      id: "extras",
      role: "extras",
      prompt: "Got it. Anything you’d like us to add?",
      choices: [...BOOKING_WIDGET_EXTRA_CHOICES],
      selectionMode: "multiple",
    },
  ],
  combinedDetailsQuestion: "Got it — how many bedrooms and bathrooms?",
  combinedDetailsPlaceholder: "For example: 2 bed 2 bath",
  fullNameQuestion: "Got it. Who should I put the booking under?",
  fullNamePlaceholder: "Enter your full name...",
  phoneQuestionTemplate: "Thanks, {firstName}. What’s the best number for booking and arrival updates?",
  phonePlaceholder: "Enter your phone number...",
  emailQuestion: "And where should I send your confirmation and receipt?",
  emailPlaceholder: "Enter your email address...",
  scheduleQuestion: "When would you like us to come?",
  scheduleQuestionWithDayTemplate: "What time on {day} works best?",
  schedulePlaceholder: "Enter your preferred day and time...",
  availabilityCheckMessage: "Got it. Give me a second while I check availability…",
  resultTitle: "I can get you in 🎉",
  resultTrustPoints: ["Vetted & insured professional", "Cleaning supplies included", "Satisfaction guarantee"],
  openingEyebrow: "Available appointment",
  services: [
    {
      id: "standard",
      name: "Standard cleaning",
      price: "189",
      availabilityDay: "Saturday",
      availabilityTime: "1:00–3:00 PM",
      providerName: "Sparkle Home Cleaning",
      rating: "4.9",
      completedJobs: "482",
    },
    {
      id: "deep",
      name: "Deep cleaning",
      price: "405",
      availabilityDay: "Tomorrow",
      availabilityTime: "9:00–11:00 AM",
      providerName: "Sparkle Home Cleaning",
      rating: "4.9",
      completedJobs: "482",
    },
    {
      id: "moveout",
      name: "Move-out cleaning",
      price: "289",
      availabilityDay: "Friday",
      availabilityTime: "9:00–11:00 AM",
      providerName: "Sparkle Home Cleaning",
      rating: "4.9",
      completedJobs: "482",
    },
  ],
  bookingButtonLabel: "Book for ${price} →",
  addressQuestion: "Great — where are we cleaning?",
  addressExample: "123 Main St, Washington, DC",
  paymentConfirmationTemplate: "Almost done ✨",
  demoCardBrand: "Visa",
  demoCardLast4: "4242",
  confirmButtonLabel: "Confirm & book — ${price}",
  confirmedEyebrow: "✓ Booking confirmed",
  confirmedTitle: "You’re all set.",
  confirmedScheduleTemplate: "Your cleaning is scheduled for {day}.",
  demoPaymentNotice: "Visual demo only. No card details are collected or stored, and no payment will be processed.",
  finalReminder: "I’ll handle the reminders and let you know when your cleaner is on the way.\n✨",
};

function asText(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function asStringList(value: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const normalized = value.filter((item): item is string => typeof item === "string");
  return normalized.length > 0 ? normalized : [...fallback];
}

function isQuestionRole(value: unknown): value is BookingWidgetQuestionRole {
  return value === "bedrooms" || value === "bathrooms" || value === "extras" || value === "custom";
}

function normalizeQuestions(value: unknown, fallback: readonly BookingWidgetQuestionDraft[]): BookingWidgetQuestionDraft[] {
  if (!Array.isArray(value)) return structuredClone(fallback);
  const seenIds = new Set<string>();
  return value.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const source = raw as Partial<BookingWidgetQuestionDraft>;
    let id = asText(source.id, `question-${index + 1}`).trim() || `question-${index + 1}`;
    while (seenIds.has(id)) id = `${id}-${index + 1}`;
    seenIds.add(id);
    const role = isQuestionRole(source.role) ? source.role : "custom";
    const selectionMode = source.selectionMode === "multiple"
      ? "multiple"
      : source.selectionMode === "single"
        ? "single"
        : role === "extras"
          ? "multiple"
          : "single";
    return [{
      id,
      role,
      prompt: asText(source.prompt, `Question ${index + 1}`),
      choices: asStringList(source.choices, ["Option 1", "Option 2"]),
      selectionMode,
    }];
  });
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function migrateVersionFiveText(value: unknown, legacyDefault: string, nextDefault: string): string {
  const normalized = asText(value, nextDefault);
  return normalized === legacyDefault ? nextDefault : normalized;
}

function migrateVersionFiveQuestions(questions: BookingWidgetQuestionDraft[]): BookingWidgetQuestionDraft[] {
  const nextExtras = DEFAULT_BOOKING_WIDGET_DRAFT.questions.find((question) => question.role === "extras");
  const legacyExtrasChoices = ["No extras", "Fridge", "Oven", "Baseboards", "Fridge + oven"];
  return questions.map((question) => {
    if (question.role !== "extras" || !nextExtras) return question;
    return {
      ...question,
      prompt: question.prompt === "Anything you want to add?" ? nextExtras.prompt : question.prompt,
      choices: sameStringList(question.choices, legacyExtrasChoices) ? [...nextExtras.choices] : question.choices,
    };
  });
}

function normalizeAuthoritativeExtrasQuestion(questions: BookingWidgetQuestionDraft[]): BookingWidgetQuestionDraft[] {
  return questions.map((question) => question.role === "extras" ? {
    ...question,
    choices: [...BOOKING_WIDGET_EXTRA_CHOICES],
    selectionMode: "multiple",
  } : question);
}

function migrateVersionTwoQuestions(parsed: Record<string, unknown>): BookingWidgetQuestionDraft[] {
  return [
    structuredClone(DEFAULT_BOOKING_WIDGET_DRAFT.questions[0]),
    {
      id: "bathrooms",
      role: "bathrooms",
      prompt: asText(parsed.bathroomQuestion, "And how many bathrooms?"),
      choices: asStringList(parsed.bathroomOptions, ["1 bathroom", "2 bathrooms", "3 bathrooms", "4 bathrooms"]),
      selectionMode: "single",
    },
    {
      id: "extras",
      role: "extras",
      prompt: asText(parsed.extrasQuestion, "Anything you want to add?"),
      choices: asStringList(parsed.extrasOptions, ["No extras", "Fridge", "Oven", "Baseboards", "Fridge + oven"]),
      selectionMode: "multiple",
    },
  ];
}

export function parseBookingWidgetDraft(raw?: string | null): BookingWidgetDraftConfig {
  if (!raw) return structuredClone(DEFAULT_BOOKING_WIDGET_DRAFT);

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const defaults = DEFAULT_BOOKING_WIDGET_DRAFT;
    const isVersionSeven = parsed.demoVersion === 7;
    const isVersionSix = parsed.demoVersion === 6;
    const isVersionFive = parsed.demoVersion === 5;
    const isVersionFour = parsed.demoVersion === 4;
    const isVersionThree = parsed.demoVersion === 3;
    const isVersionTwo = parsed.demoVersion === 2;
    const isSupportedVersion = isVersionSeven || isVersionSix || isVersionFive || isVersionFour || isVersionThree || isVersionTwo;
    const rawServices = isSupportedVersion && Array.isArray(parsed.services) ? parsed.services : [];
    const normalizedQuestions = isVersionSeven || isVersionSix || isVersionFive || isVersionFour || isVersionThree
      ? normalizeQuestions(parsed.questions, defaults.questions)
      : isVersionTwo
        ? migrateVersionTwoQuestions(parsed)
        : structuredClone(defaults.questions);
    const migratedQuestions = isVersionFive ? migrateVersionFiveQuestions(normalizedQuestions) : normalizedQuestions;
    const questions = normalizeAuthoritativeExtrasQuestion(migratedQuestions);
    const quickPrompts = asStringList(parsed.quickPrompts, defaults.quickPrompts);
    if (isVersionFive && quickPrompts[0] === "Deep clean my 3BR tomorrow morning") quickPrompts[0] = defaults.quickPrompts[0];

    return {
      ...structuredClone(defaults),
      demoVersion: 7,
      brandName: asText(parsed.brandName, defaults.brandName),
      brandLogoUrl: asText(parsed.brandLogoUrl, defaults.brandLogoUrl),
      headerIcon: asText(parsed.headerIcon, defaults.headerIcon),
      statusText: asText(parsed.statusText, defaults.statusText),
      greeting: asText(parsed.greeting, defaults.greeting),
      inputPlaceholder: isSupportedVersion ? asText(parsed.inputPlaceholder, defaults.inputPlaceholder) : defaults.inputPlaceholder,
      addressPlaceholder: isSupportedVersion ? asText(parsed.addressPlaceholder, defaults.addressPlaceholder) : defaults.addressPlaceholder,
      helperText: isVersionSeven
        ? asText(parsed.helperText, defaults.helperText)
        : isSupportedVersion
          ? migrateVersionFiveText(parsed.helperText, "Demo only · sample pricing and availability", defaults.helperText)
          : defaults.helperText,
      primaryColor: asColor(parsed.primaryColor, defaults.primaryColor),
      customerBubbleColor: asColor(parsed.customerBubbleColor, defaults.customerBubbleColor),
      quickPrompts,
      questions,
      combinedDetailsQuestion: isVersionSeven || isVersionSix ? asText(parsed.combinedDetailsQuestion, defaults.combinedDetailsQuestion) : defaults.combinedDetailsQuestion,
      combinedDetailsPlaceholder: isVersionSeven || isVersionSix ? asText(parsed.combinedDetailsPlaceholder, defaults.combinedDetailsPlaceholder) : defaults.combinedDetailsPlaceholder,
      fullNameQuestion: isVersionFive ? migrateVersionFiveText(parsed.fullNameQuestion, "Perfect — who should I put the request under?", defaults.fullNameQuestion) : isSupportedVersion ? asText(parsed.fullNameQuestion, defaults.fullNameQuestion) : defaults.fullNameQuestion,
      fullNamePlaceholder: isSupportedVersion ? asText(parsed.fullNamePlaceholder, defaults.fullNamePlaceholder) : defaults.fullNamePlaceholder,
      phoneQuestionTemplate: isVersionFive ? migrateVersionFiveText(parsed.phoneQuestionTemplate, "Thanks, {firstName}. What’s the best number for arrival updates?", defaults.phoneQuestionTemplate) : isSupportedVersion ? asText(parsed.phoneQuestionTemplate, defaults.phoneQuestionTemplate) : defaults.phoneQuestionTemplate,
      phonePlaceholder: isSupportedVersion ? asText(parsed.phonePlaceholder, defaults.phonePlaceholder) : defaults.phonePlaceholder,
      emailQuestion: isVersionFive ? migrateVersionFiveText(parsed.emailQuestion, "And where should I send your booking confirmation?", defaults.emailQuestion) : isSupportedVersion ? asText(parsed.emailQuestion, defaults.emailQuestion) : defaults.emailQuestion,
      emailPlaceholder: isSupportedVersion ? asText(parsed.emailPlaceholder, defaults.emailPlaceholder) : defaults.emailPlaceholder,
      scheduleQuestion: isVersionFive ? migrateVersionFiveText(parsed.scheduleQuestion, "What day and time were you hoping for?", defaults.scheduleQuestion) : isSupportedVersion ? asText(parsed.scheduleQuestion, defaults.scheduleQuestion) : defaults.scheduleQuestion,
      scheduleQuestionWithDayTemplate: isVersionFive ? migrateVersionFiveText(parsed.scheduleQuestionWithDayTemplate, "What time on {day} were you hoping for?", defaults.scheduleQuestionWithDayTemplate) : isSupportedVersion ? asText(parsed.scheduleQuestionWithDayTemplate, defaults.scheduleQuestionWithDayTemplate) : defaults.scheduleQuestionWithDayTemplate,
      schedulePlaceholder: isSupportedVersion ? asText(parsed.schedulePlaceholder, defaults.schedulePlaceholder) : defaults.schedulePlaceholder,
      availabilityCheckMessage: isVersionFive ? migrateVersionFiveText(parsed.availabilityCheckMessage, "Perfect. Give me a second while I check availability…", defaults.availabilityCheckMessage) : isSupportedVersion ? asText(parsed.availabilityCheckMessage, defaults.availabilityCheckMessage) : defaults.availabilityCheckMessage,
      resultTitle: isVersionSeven || isVersionSix ? asText(parsed.resultTitle, defaults.resultTitle) : defaults.resultTitle,
      resultTrustPoints: isVersionSeven || isVersionSix ? asStringList(parsed.resultTrustPoints, defaults.resultTrustPoints) : [...defaults.resultTrustPoints],
      openingEyebrow: isVersionFive ? migrateVersionFiveText(parsed.openingEyebrow, "I found an opening", defaults.openingEyebrow) : isSupportedVersion ? asText(parsed.openingEyebrow, defaults.openingEyebrow) : defaults.openingEyebrow,
      services: defaults.services.map((fallback, index) => {
        const service = rawServices[index] as Partial<BookingWidgetServiceDraft> | undefined;
        return {
          id: fallback.id,
          name: asText(service?.name, fallback.name),
          price: asText(service?.price, fallback.price),
          availabilityDay: asText(service?.availabilityDay, fallback.availabilityDay),
          availabilityTime: asText(service?.availabilityTime, fallback.availabilityTime),
          providerName: asText(service?.providerName, fallback.providerName),
          rating: asText(service?.rating, fallback.rating),
          completedJobs: asText(service?.completedJobs, fallback.completedJobs),
        };
      }) as BookingWidgetDraftConfig["services"],
      bookingButtonLabel: isVersionFive ? migrateVersionFiveText(parsed.bookingButtonLabel, "Continue — ${price}", defaults.bookingButtonLabel) : isSupportedVersion ? asText(parsed.bookingButtonLabel, defaults.bookingButtonLabel) : defaults.bookingButtonLabel,
      addressQuestion: isVersionFive ? migrateVersionFiveText(parsed.addressQuestion, "Great choice. What address should we send the team to?", defaults.addressQuestion) : isSupportedVersion ? asText(parsed.addressQuestion, defaults.addressQuestion) : defaults.addressQuestion,
      addressExample: isSupportedVersion ? asText(parsed.addressExample, defaults.addressExample) : defaults.addressExample,
      paymentConfirmationTemplate: isSupportedVersion ? migrateVersionFiveText(parsed.paymentConfirmationTemplate, "Perfect. I found your address. For this demo I’ll use a saved {cardBrand} ending in {last4}.", defaults.paymentConfirmationTemplate) : defaults.paymentConfirmationTemplate,
      demoCardBrand: isSupportedVersion ? asText(parsed.demoCardBrand, defaults.demoCardBrand) : defaults.demoCardBrand,
      demoCardLast4: isSupportedVersion ? asText(parsed.demoCardLast4, defaults.demoCardLast4) : defaults.demoCardLast4,
      confirmButtonLabel: isSupportedVersion ? migrateVersionFiveText(parsed.confirmButtonLabel, "Confirm booking", defaults.confirmButtonLabel) : defaults.confirmButtonLabel,
      confirmedEyebrow: isSupportedVersion ? asText(parsed.confirmedEyebrow, defaults.confirmedEyebrow) : defaults.confirmedEyebrow,
      confirmedTitle: isSupportedVersion ? asText(parsed.confirmedTitle, defaults.confirmedTitle) : defaults.confirmedTitle,
      confirmedScheduleTemplate: isVersionFive ? migrateVersionFiveText(parsed.confirmedScheduleTemplate, "{providerName} is scheduled for {day}, {time}.", defaults.confirmedScheduleTemplate) : isSupportedVersion ? asText(parsed.confirmedScheduleTemplate, defaults.confirmedScheduleTemplate) : defaults.confirmedScheduleTemplate,
      demoPaymentNotice: isSupportedVersion ? migrateVersionFiveText(parsed.demoPaymentNotice, "Your card is only a demo. No payment was processed.", defaults.demoPaymentNotice) : defaults.demoPaymentNotice,
      finalReminder: isSupportedVersion ? asText(parsed.finalReminder, defaults.finalReminder) : defaults.finalReminder,
    };
  } catch {
    return structuredClone(DEFAULT_BOOKING_WIDGET_DRAFT);
  }
}

export function formatBookingButtonLabel(label: string, price: string): string {
  return label.replaceAll("${price}", `$${price || "0"}`);
}

export function renderBookingWidgetTemplate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, value), template);
}

export function resolveDemoRequest(prompt: string): BookingWidgetResolvedRequest {
  const normalized = prompt.toLowerCase();
  const bedrooms = normalized.includes("studio") ? "0" : normalized.match(/(\d+)\s*(?:br|bed|bedrooms?)/)?.[1];
  const bathrooms = normalized.match(/(\d+)\s*(?:ba|bath|bathrooms?)/)?.[1];
  const requestedDay = normalized.match(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/)?.[1];
  const serviceId: BookingWidgetServiceId = normalized.includes("move")
    ? "moveout"
    : normalized.includes("deep")
      ? "deep"
      : "standard";
  return {
    serviceId,
    ...(bedrooms ? { bedrooms: Number(bedrooms) } : {}),
    ...(bathrooms ? { bathrooms: Number(bathrooms) } : {}),
    ...(requestedDay ? { requestedDay: requestedDay[0].toUpperCase() + requestedDay.slice(1) } : {}),
  };
}

function answerForCount(question: BookingWidgetQuestionDraft, count: number, singular: string, plural: string): string {
  return question.choices.find((choice) => Number(choice.match(/\d+/)?.[0]) === count)
    ?? `${count} ${count === 1 ? singular : plural}`;
}

export function buildInferredQuestionAnswers(
  resolved: BookingWidgetResolvedRequest,
  questions: readonly BookingWidgetQuestionDraft[],
): { answers: Record<string, string[]>; inferredQuestionIds: string[] } {
  const answers: Record<string, string[]> = {};
  const inferredQuestionIds: string[] = [];
  for (const question of questions) {
    const count = question.role === "bedrooms" ? resolved.bedrooms : question.role === "bathrooms" ? resolved.bathrooms : undefined;
    if (count === undefined) continue;
    answers[question.id] = [answerForCount(question, count, question.role === "bedrooms" ? "bedroom" : "bathroom", question.role === "bedrooms" ? "bedrooms" : "bathrooms")];
    inferredQuestionIds.push(question.id);
  }
  return { answers, inferredQuestionIds };
}

export function getBookingWidgetRoomCount(
  role: "bedrooms" | "bathrooms",
  questions: readonly BookingWidgetQuestionDraft[],
  answers: Readonly<Record<string, string | readonly string[]>>,
): number | undefined {
  const question = questions.find((item) => item.role === role);
  if (!question) return undefined;
  const value = answers[question.id];
  const firstAnswer = Array.isArray(value) ? value[0] : value;
  const match = firstAnswer?.match(/\d+/)?.[0];
  return match === undefined ? undefined : Number(match);
}

export function firstNameFromFullName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "there";
}

export function formatScheduleQuestion(config: BookingWidgetDraftConfig, requestedDay?: string): string {
  return requestedDay
    ? renderBookingWidgetTemplate(config.scheduleQuestionWithDayTemplate, { day: requestedDay })
    : config.scheduleQuestion;
}

export function formatDemoScheduleSelection(date: Date, time: string): string {
  const day = date.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  return `${day} · ${time.trim()}`;
}

export function validateBookingWidgetIntakeField(field: BookingWidgetIntakeField, value: string): string | null {
  const trimmed = value.trim();
  if (field === "fullName") {
    return trimmed.split(/\s+/).filter(Boolean).length >= 2 ? null : "Enter a first and last name.";
  }
  if (field === "phone") {
    const digitCount = trimmed.replace(/\D/g, "").length;
    return digitCount >= 10 && digitCount <= 15 ? null : "Enter a valid phone number.";
  }
  if (field === "email") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? null : "Enter a valid email address.";
  }
  return trimmed.length >= 3 ? null : "Enter your preferred day and time.";
}

export function moveListItem<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length || fromIndex === toIndex) return [...items];
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function numericAnswer(value?: string): string {
  if (!value) return "";
  return value.match(/\d+\+?/)?.[0] ?? value.trim();
}

function roomCountLabel(value: string, fallback: number | undefined, room: "bedroom" | "bathroom"): string {
  const count = numericAnswer(value) || (fallback === undefined ? "" : String(fallback));
  if (!count) return "";
  return `${count} ${count === "1" ? room : `${room}s`}`;
}

export function buildDemoDetailLine(
  fallbackBedrooms: number,
  questions: readonly BookingWidgetQuestionDraft[],
  answers: Readonly<Record<string, string | readonly string[]>>,
  extraQuantities: Readonly<Record<string, number>> = {},
): string {
  const parts: string[] = [];
  const bedroomQuestion = questions.find((question) => question.role === "bedrooms");
  const bathroomQuestion = questions.find((question) => question.role === "bathrooms");
  const extrasQuestion = questions.find((question) => question.role === "extras");
  const asAnswers = (value: string | readonly string[] | undefined) => Array.isArray(value) ? value : value ? [value as string] : [];
  const bedroomAnswer = bedroomQuestion ? asAnswers(answers[bedroomQuestion.id])[0] ?? "" : "";
  const bathroomAnswer = bathroomQuestion ? asAnswers(answers[bathroomQuestion.id])[0] ?? "" : "";
  const extrasAnswers = extrasQuestion ? asAnswers(answers[extrasQuestion.id]) : [];

  parts.push(roomCountLabel(bedroomAnswer, fallbackBedrooms, "bedroom"));
  if (bathroomAnswer) parts.push(roomCountLabel(bathroomAnswer, undefined, "bathroom"));
  for (const extra of extrasAnswers) {
    if (isNoSelectionChoice(extra)) continue;
    const pricedExtra = findBookingWidgetPricedExtra(extra);
    const quantity = pricedExtra?.quantityUnit ? extraQuantities[pricedExtra.id] : undefined;
    parts.push(quantity ? `${pricedExtra?.label ?? extra.trim()} × ${quantity}` : `${pricedExtra?.label ?? extra.trim()} included`);
  }
  return [...new Set(parts.filter(Boolean))].join(" · ");
}

export function isNoSelectionChoice(choice: string): boolean {
  return /^(?:none|nothing(?:\s+extra)?|no\s+(?:extras?|add[ -]?ons?))$/i.test(choice.trim());
}

export function toggleMultiSelectChoice(selected: readonly string[], choice: string): string[] {
  const trimmed = choice.trim();
  if (!trimmed) return [...selected];
  const alreadySelected = selected.some((item) => item.toLowerCase() === trimmed.toLowerCase());
  if (isNoSelectionChoice(trimmed)) return alreadySelected ? [] : [trimmed];
  const withoutNoSelection = selected.filter((item) => !isNoSelectionChoice(item));
  if (alreadySelected) return withoutNoSelection.filter((item) => item.toLowerCase() !== trimmed.toLowerCase());
  return [...withoutNoSelection, trimmed];
}

export const BOOKING_WIDGET_DRAFT_SETTING = {
  key: "bookingWidgetDraft",
  value: JSON.stringify(DEFAULT_BOOKING_WIDGET_DRAFT),
  label: "Booking Widget Draft",
  description: "Internal draft configuration for the Book with AI widget. Saving does not publish or activate the customer-facing widget.",
  fieldType: "json",
} as const;
