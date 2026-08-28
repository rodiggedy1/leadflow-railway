export type BookingWidgetServiceId = "standard" | "deep" | "moveout";

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

export type BookingWidgetDraftConfig = {
  demoVersion: 2;
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
  quickPrompts: [string, string, string];
  bathroomQuestion: string;
  bathroomOptions: [string, string, string, string];
  extrasQuestion: string;
  extrasOptions: [string, string, string, string, string];
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
  demoVersion: 2,
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
  bathroomQuestion: "And how many bathrooms?",
  bathroomOptions: ["1 bathroom", "2 bathrooms", "3 bathrooms", "4 bathrooms"],
  extrasQuestion: "Anything you want to add?",
  extrasOptions: ["No extras", "Fridge", "Oven", "Baseboards", "Fridge + oven"],
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

function asTuple<T extends string>(value: unknown, fallback: readonly T[]): T[] {
  const source = Array.isArray(value) ? value : [];
  return fallback.map((item, index) => asText(source[index], item) as T);
}

export function parseBookingWidgetDraft(raw?: string | null): BookingWidgetDraftConfig {
  if (!raw) return structuredClone(DEFAULT_BOOKING_WIDGET_DRAFT);

  try {
    const parsed = JSON.parse(raw) as Partial<BookingWidgetDraftConfig>;
    const defaults = DEFAULT_BOOKING_WIDGET_DRAFT;
    const isCurrentDemo = parsed.demoVersion === 2;
    const services = isCurrentDemo && Array.isArray(parsed.services) ? parsed.services : [];

    return {
      ...structuredClone(defaults),
      demoVersion: 2,
      brandName: asText(parsed.brandName, defaults.brandName),
      brandLogoUrl: asText(parsed.brandLogoUrl, defaults.brandLogoUrl),
      headerIcon: asText(parsed.headerIcon, defaults.headerIcon),
      statusText: asText(parsed.statusText, defaults.statusText),
      greeting: asText(parsed.greeting, defaults.greeting),
      inputPlaceholder: isCurrentDemo ? asText(parsed.inputPlaceholder, defaults.inputPlaceholder) : defaults.inputPlaceholder,
      addressPlaceholder: isCurrentDemo ? asText(parsed.addressPlaceholder, defaults.addressPlaceholder) : defaults.addressPlaceholder,
      helperText: isCurrentDemo ? asText(parsed.helperText, defaults.helperText) : defaults.helperText,
      primaryColor: asColor(parsed.primaryColor, defaults.primaryColor),
      customerBubbleColor: asColor(parsed.customerBubbleColor, defaults.customerBubbleColor),
      quickPrompts: asTuple(parsed.quickPrompts, defaults.quickPrompts) as BookingWidgetDraftConfig["quickPrompts"],
      bathroomQuestion: isCurrentDemo ? asText(parsed.bathroomQuestion, defaults.bathroomQuestion) : defaults.bathroomQuestion,
      bathroomOptions: asTuple(isCurrentDemo ? parsed.bathroomOptions : undefined, defaults.bathroomOptions) as BookingWidgetDraftConfig["bathroomOptions"],
      extrasQuestion: isCurrentDemo ? asText(parsed.extrasQuestion, defaults.extrasQuestion) : defaults.extrasQuestion,
      extrasOptions: asTuple(isCurrentDemo ? parsed.extrasOptions : undefined, defaults.extrasOptions) as BookingWidgetDraftConfig["extrasOptions"],
      openingEyebrow: isCurrentDemo ? asText(parsed.openingEyebrow, defaults.openingEyebrow) : defaults.openingEyebrow,
      services: defaults.services.map((fallback, index) => {
        const service = services[index] as Partial<BookingWidgetServiceDraft> | undefined;
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
      bookingButtonLabel: isCurrentDemo ? asText(parsed.bookingButtonLabel, defaults.bookingButtonLabel) : defaults.bookingButtonLabel,
      addressQuestion: isCurrentDemo ? asText(parsed.addressQuestion, defaults.addressQuestion) : defaults.addressQuestion,
      addressExample: isCurrentDemo ? asText(parsed.addressExample, defaults.addressExample) : defaults.addressExample,
      paymentConfirmationTemplate: isCurrentDemo ? asText(parsed.paymentConfirmationTemplate, defaults.paymentConfirmationTemplate) : defaults.paymentConfirmationTemplate,
      demoCardBrand: isCurrentDemo ? asText(parsed.demoCardBrand, defaults.demoCardBrand) : defaults.demoCardBrand,
      demoCardLast4: isCurrentDemo ? asText(parsed.demoCardLast4, defaults.demoCardLast4) : defaults.demoCardLast4,
      confirmButtonLabel: isCurrentDemo ? asText(parsed.confirmButtonLabel, defaults.confirmButtonLabel) : defaults.confirmButtonLabel,
      confirmedEyebrow: isCurrentDemo ? asText(parsed.confirmedEyebrow, defaults.confirmedEyebrow) : defaults.confirmedEyebrow,
      confirmedTitle: isCurrentDemo ? asText(parsed.confirmedTitle, defaults.confirmedTitle) : defaults.confirmedTitle,
      confirmedScheduleTemplate: isCurrentDemo ? asText(parsed.confirmedScheduleTemplate, defaults.confirmedScheduleTemplate) : defaults.confirmedScheduleTemplate,
      demoPaymentNotice: isCurrentDemo ? asText(parsed.demoPaymentNotice, defaults.demoPaymentNotice) : defaults.demoPaymentNotice,
      finalReminder: isCurrentDemo ? asText(parsed.finalReminder, defaults.finalReminder) : defaults.finalReminder,
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

export function buildDemoDetailLine(bedrooms: number, bathrooms: string, extra: string): string {
  const bathroomCount = bathrooms.match(/\d+/)?.[0] ?? bathrooms.trim();
  const parts = [`${bedrooms} bed`, `${bathroomCount || "1"} bath`];
  if (extra.trim() && extra.trim().toLowerCase() !== "no extras") parts.push(extra.trim());
  return parts.join(" · ");
}

export const BOOKING_WIDGET_DRAFT_SETTING = {
  key: "bookingWidgetDraft",
  value: JSON.stringify(DEFAULT_BOOKING_WIDGET_DRAFT),
  label: "Booking Widget Draft",
  description: "Internal draft configuration for the Book with AI widget. Saving does not publish or activate the customer-facing widget.",
  fieldType: "json",
} as const;
