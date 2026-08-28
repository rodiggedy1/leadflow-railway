export type BookingWidgetServiceId = "standard" | "deep" | "moveout";
export type BookingWidgetQuestionRole = "bedrooms" | "bathrooms" | "extras" | "custom";
export type BookingWidgetQuestionSelectionMode = "single" | "multiple";

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
  demoVersion: 4;
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
  demoVersion: 4,
  brandName: "Book with AI",
  brandLogoUrl: "",
  headerIcon: "✨",
  statusText: "AI booking assistant · online",
  greeting: "Hey! 👋 I can get your cleaning booked in about a minute. Just tell me what you need.",
  inputPlaceholder: "Tell me what you need...",
  addressPlaceholder: "Enter service address...",
  helperText: "Demo only · sample pricing and availability",
  primaryColor: "#171717",
  customerBubbleColor: "#edf2ff",
  quickPrompts: [
    "Deep clean my 3BR tomorrow morning",
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
      prompt: "Anything you want to add?",
      choices: ["No extras", "Fridge", "Oven", "Baseboards", "Fridge + oven"],
      selectionMode: "multiple",
    },
  ],
  openingEyebrow: "I found an opening",
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
  bookingButtonLabel: "Continue — ${price}",
  addressQuestion: "Great choice. What address should we send the team to?",
  addressExample: "123 Main St, Washington, DC",
  paymentConfirmationTemplate: "Perfect. I found your address. For this demo I’ll use a saved {cardBrand} ending in {last4}.",
  demoCardBrand: "Visa",
  demoCardLast4: "4242",
  confirmButtonLabel: "Confirm booking",
  confirmedEyebrow: "✓ Booking confirmed",
  confirmedTitle: "You’re all set.",
  confirmedScheduleTemplate: "{providerName} is scheduled for {day}, {time}.",
  demoPaymentNotice: "Your card is only a demo. No payment was processed.",
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
    const isVersionFour = parsed.demoVersion === 4;
    const isVersionThree = parsed.demoVersion === 3;
    const isVersionTwo = parsed.demoVersion === 2;
    const isSupportedVersion = isVersionFour || isVersionThree || isVersionTwo;
    const rawServices = isSupportedVersion && Array.isArray(parsed.services) ? parsed.services : [];
    const questions = isVersionFour || isVersionThree
      ? normalizeQuestions(parsed.questions, defaults.questions)
      : isVersionTwo
        ? migrateVersionTwoQuestions(parsed)
        : structuredClone(defaults.questions);

    return {
      ...structuredClone(defaults),
      demoVersion: 4,
      brandName: asText(parsed.brandName, defaults.brandName),
      brandLogoUrl: asText(parsed.brandLogoUrl, defaults.brandLogoUrl),
      headerIcon: asText(parsed.headerIcon, defaults.headerIcon),
      statusText: asText(parsed.statusText, defaults.statusText),
      greeting: asText(parsed.greeting, defaults.greeting),
      inputPlaceholder: isSupportedVersion ? asText(parsed.inputPlaceholder, defaults.inputPlaceholder) : defaults.inputPlaceholder,
      addressPlaceholder: isSupportedVersion ? asText(parsed.addressPlaceholder, defaults.addressPlaceholder) : defaults.addressPlaceholder,
      helperText: isSupportedVersion ? asText(parsed.helperText, defaults.helperText) : defaults.helperText,
      primaryColor: asColor(parsed.primaryColor, defaults.primaryColor),
      customerBubbleColor: asColor(parsed.customerBubbleColor, defaults.customerBubbleColor),
      quickPrompts: asStringList(parsed.quickPrompts, defaults.quickPrompts),
      questions,
      openingEyebrow: isSupportedVersion ? asText(parsed.openingEyebrow, defaults.openingEyebrow) : defaults.openingEyebrow,
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
      bookingButtonLabel: isSupportedVersion ? asText(parsed.bookingButtonLabel, defaults.bookingButtonLabel) : defaults.bookingButtonLabel,
      addressQuestion: isSupportedVersion ? asText(parsed.addressQuestion, defaults.addressQuestion) : defaults.addressQuestion,
      addressExample: isSupportedVersion ? asText(parsed.addressExample, defaults.addressExample) : defaults.addressExample,
      paymentConfirmationTemplate: isSupportedVersion ? asText(parsed.paymentConfirmationTemplate, defaults.paymentConfirmationTemplate) : defaults.paymentConfirmationTemplate,
      demoCardBrand: isSupportedVersion ? asText(parsed.demoCardBrand, defaults.demoCardBrand) : defaults.demoCardBrand,
      demoCardLast4: isSupportedVersion ? asText(parsed.demoCardLast4, defaults.demoCardLast4) : defaults.demoCardLast4,
      confirmButtonLabel: isSupportedVersion ? asText(parsed.confirmButtonLabel, defaults.confirmButtonLabel) : defaults.confirmButtonLabel,
      confirmedEyebrow: isSupportedVersion ? asText(parsed.confirmedEyebrow, defaults.confirmedEyebrow) : defaults.confirmedEyebrow,
      confirmedTitle: isSupportedVersion ? asText(parsed.confirmedTitle, defaults.confirmedTitle) : defaults.confirmedTitle,
      confirmedScheduleTemplate: isSupportedVersion ? asText(parsed.confirmedScheduleTemplate, defaults.confirmedScheduleTemplate) : defaults.confirmedScheduleTemplate,
      demoPaymentNotice: isSupportedVersion ? asText(parsed.demoPaymentNotice, defaults.demoPaymentNotice) : defaults.demoPaymentNotice,
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

export function resolveDemoRequest(prompt: string): { serviceId: BookingWidgetServiceId; bedrooms: number } {
  const normalized = prompt.toLowerCase();
  const bedrooms = Number(normalized.match(/(\d+)\s*(?:br|bed|bedroom)/)?.[1] ?? 3);
  if (normalized.includes("move")) return { serviceId: "moveout", bedrooms };
  if (normalized.includes("deep")) return { serviceId: "deep", bedrooms };
  return { serviceId: "standard", bedrooms };
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

export function buildDemoDetailLine(
  fallbackBedrooms: number,
  questions: readonly BookingWidgetQuestionDraft[],
  answers: Readonly<Record<string, string | readonly string[]>>,
): string {
  const parts: string[] = [];
  const bedroomQuestion = questions.find((question) => question.role === "bedrooms");
  const bathroomQuestion = questions.find((question) => question.role === "bathrooms");
  const extrasQuestion = questions.find((question) => question.role === "extras");
  const asAnswers = (value: string | readonly string[] | undefined) => Array.isArray(value) ? value : value ? [value as string] : [];
  const bedroomAnswer = bedroomQuestion ? asAnswers(answers[bedroomQuestion.id])[0] ?? "" : "";
  const bathroomAnswer = bathroomQuestion ? asAnswers(answers[bathroomQuestion.id])[0] ?? "" : "";
  const extrasAnswers = extrasQuestion ? asAnswers(answers[extrasQuestion.id]) : [];

  parts.push(`${numericAnswer(bedroomAnswer) || fallbackBedrooms} bed`);
  if (bathroomAnswer) parts.push(`${numericAnswer(bathroomAnswer)} bath`);
  for (const extra of extrasAnswers) {
    if (!isNoSelectionChoice(extra)) parts.push(extra.trim());
  }
  return [...new Set(parts)].join(" · ");
}

export function isNoSelectionChoice(choice: string): boolean {
  return /^(?:none|no\s+(?:extras?|add[ -]?ons?))$/i.test(choice.trim());
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
