import type {
  BookingWidgetRecurringFrequency,
  BookingWidgetServiceId,
} from "./bookingWidgetConfig";

export const PUBLIC_BOOKING_PRICING_VERSION = "public-book-v2" as const;
export const PUBLIC_BOOKING_HOURLY_RATE = 70;
export const PUBLIC_BOOKING_CONDITION_ADJUSTMENT_PER_LEVEL = 0.1;

export const PUBLIC_BOOKING_BEDROOM_BASE_PRICES: Readonly<
  Record<number, number>
> = {
  0: 139,
  1: 159,
  2: 209,
  3: 259,
  4: 329,
  5: 389,
  6: 449,
  7: 559,
};

export const PUBLIC_BOOKING_BATHROOM_UNIT_PRICE = 30;

const SERVICE_MULTIPLIERS: Readonly<Record<BookingWidgetServiceId, number>> = {
  standard: 1,
  deep: 1.2,
  moveout: 1.2,
};

const SERVICE_NAMES: Readonly<Record<BookingWidgetServiceId, string>> = {
  standard: "Standard Cleaning",
  deep: "Deep Cleaning",
  moveout: "Move-out Cleaning",
};

const RECURRING_DISCOUNTS: Readonly<
  Record<Exclude<BookingWidgetRecurringFrequency, "one-time">, number>
> = {
  weekly: 20,
  biweekly: 15,
  monthly: 10,
};

export type PublicBookingPricingMode = "home" | "hourly";
export type PublicBookingHomeType =
  | "House"
  | "Apartment"
  | "Townhome"
  | "Condo";

export type PublicBookingExtraSelection = {
  id: string;
  quantity: number;
};

export type PublicBookingPricingInput = {
  pricingMode: PublicBookingPricingMode;
  serviceId: BookingWidgetServiceId;
  bedrooms: number;
  bathrooms: number;
  homeType: PublicBookingHomeType;
  condition: number;
  maidCount: number;
  hourCount: number;
  extras: readonly PublicBookingExtraSelection[];
  recurrence: BookingWidgetRecurringFrequency;
};

export type PublicBookingPricedExtra = {
  id: string;
  label: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
};

export type PublicBookingPriceBreakdown = {
  pricingMode: PublicBookingPricingMode;
  homeServiceBaseTotalCents: number;
  conditionMultiplier: number;
  conditionAdjustmentCents: number;
  hourlyServiceTotalCents: number;
  serviceSubtotalCents: number;
  extrasTotalCents: number;
  firstCleaningTotalCents: number;
  futureVisitBaseTotalCents: number;
  futureVisitTotalCents: number | null;
  discountPercent: number;
  extras: PublicBookingPricedExtra[];
};

export type PublicBookingPriceSnapshot = {
  version: typeof PUBLIC_BOOKING_PRICING_VERSION;
  input: PublicBookingPricingInput;
  serviceName: string;
  breakdown: PublicBookingPriceBreakdown;
};

export const PUBLIC_BOOKING_PRICED_EXTRAS: Readonly<Record<string, { label: string; unitPrice: number; quantityUnit?: string }>> = {
  "inside-cabinets": { label: "Inside Cabinets", unitPrice: 50 },
  "inside-fridge": { label: "Inside Fridge", unitPrice: 45 },
  "inside-oven": { label: "Inside Oven", unitPrice: 45 },
  "interior-windows": { label: "Interior Windows", unitPrice: 10, quantityUnit: "window" },
  basement: { label: "Basement", unitPrice: 60 },
  "organizing-hour": { label: "One Hour of Organizing", unitPrice: 70, quantityUnit: "hour" },
  "laundry-load": { label: "Laundry", unitPrice: 25, quantityUnit: "load" },
  "wipe-walls-room": { label: "Wipe Walls", unitPrice: 20, quantityUnit: "room" },
  "sweep-garage": { label: "Sweep Garage", unitPrice: 30 },
};

/** Server-validated add-ons offered after a public booking is confirmed. */
export const PUBLIC_BOOKING_POST_BOOKING_UPSELLS: Readonly<Record<string, { label: string; unitPriceCents: number; quantityUnit: string }>> = {
  "moving-help": { label: "Moving Help", unitPriceCents: 9900, quantityUnit: "hour" },
  "carpet-cleaning": { label: "Carpet Cleaning", unitPriceCents: 7500, quantityUnit: "room" },
  "exterior-window-cleaning": { label: "Exterior Window Cleaning", unitPriceCents: 7500, quantityUnit: "hour" },
  "junk-removal": { label: "Junk Removal", unitPriceCents: 9900, quantityUnit: "load" },
  "furniture-cleaning": { label: "Furniture Cleaning", unitPriceCents: 9900, quantityUnit: "item" },
  "appliance-cleaning": { label: "Appliance Cleaning", unitPriceCents: 4900, quantityUnit: "appliance" },
  "window-cleaning": { label: "Window Cleaning", unitPriceCents: 9900, quantityUnit: "window" },
  "pet-area-cleaning": { label: "Pet Area Cleaning", unitPriceCents: 7900, quantityUnit: "area" },
};

function assertIntegerRange(
  value: number,
  label: string,
  minimum: number,
  maximum: number
): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${label} must be a whole number from ${minimum} through ${maximum}.`
    );
  }
}

function assertHomeType(value: string): asserts value is PublicBookingHomeType {
  if (!["House", "Apartment", "Townhome", "Condo"].includes(value)) {
    throw new Error("Select a supported home type.");
  }
}

function assertPricingMode(
  value: string
): asserts value is PublicBookingPricingMode {
  if (value !== "home" && value !== "hourly")
    throw new Error("Select a supported pricing mode.");
}

function assertServiceId(
  value: string
): asserts value is BookingWidgetServiceId {
  if (value !== "standard" && value !== "deep" && value !== "moveout")
    throw new Error("Select a supported cleaning type.");
}

function assertFrequency(
  value: string
): asserts value is BookingWidgetRecurringFrequency {
  if (!["one-time", "weekly", "biweekly", "monthly"].includes(value))
    throw new Error("Select a supported recurring frequency.");
}

export function getPublicBookingServiceName(
  serviceId: BookingWidgetServiceId
): string {
  return SERVICE_NAMES[serviceId];
}

export function calculatePublicBookingPrice(
  input: PublicBookingPricingInput
): PublicBookingPriceBreakdown {
  assertPricingMode(input.pricingMode);
  assertServiceId(input.serviceId);
  assertHomeType(input.homeType);
  assertFrequency(input.recurrence);
  assertIntegerRange(input.bedrooms, "Bedrooms", 0, 7);
  assertIntegerRange(input.bathrooms, "Bathrooms", 1, 5);
  assertIntegerRange(input.condition, "Home condition", 1, 10);
  assertIntegerRange(input.maidCount, "Number of maids", 1, 4);
  assertIntegerRange(input.hourCount, "Number of hours", 1, 8);

  const seenExtras = new Set<string>();
  const extras = input.extras
    .map(selection => {
      if (seenExtras.has(selection.id))
        throw new Error(`Duplicate extra: ${selection.id}`);
      seenExtras.add(selection.id);
      assertIntegerRange(
        selection.quantity,
        `Quantity for ${selection.id}`,
        1,
        50
      );
      const extra = PUBLIC_BOOKING_PRICED_EXTRAS[selection.id];
      if (!extra) throw new Error(`Unsupported extra: ${selection.id}`);
      return {
        id: selection.id,
        label: extra.label,
        quantity: selection.quantity,
        unitPriceCents: extra.unitPrice * 100,
        totalCents: extra.unitPrice * selection.quantity * 100,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const homeServiceBaseDollars =
    (PUBLIC_BOOKING_BEDROOM_BASE_PRICES[input.bedrooms] +
      input.bathrooms * PUBLIC_BOOKING_BATHROOM_UNIT_PRICE) *
    SERVICE_MULTIPLIERS[input.serviceId];
  const homeServiceBaseTotalCents = Math.round(homeServiceBaseDollars * 100);
  const conditionMultiplier =
    1 +
    Math.max(0, input.condition - 5) *
      PUBLIC_BOOKING_CONDITION_ADJUSTMENT_PER_LEVEL;
  const hourlyServiceTotalCents =
    input.maidCount * input.hourCount * PUBLIC_BOOKING_HOURLY_RATE * 100;
  const serviceSubtotalCents =
    input.pricingMode === "hourly"
      ? hourlyServiceTotalCents
      : Math.round(homeServiceBaseDollars * conditionMultiplier) * 100;
  const conditionAdjustmentCents =
    input.pricingMode === "home"
      ? serviceSubtotalCents - homeServiceBaseTotalCents
      : 0;
  const extrasTotalCents = extras.reduce(
    (total, extra) => total + extra.totalCents,
    0
  );
  const firstCleaningTotalCents = serviceSubtotalCents + extrasTotalCents;
  const futureVisitBaseTotalCents =
    input.pricingMode === "hourly"
      ? hourlyServiceTotalCents
      : Math.round(homeServiceBaseDollars) * 100;
  const discountPercent =
    input.recurrence === "one-time" ? 0 : RECURRING_DISCOUNTS[input.recurrence];
  const futureVisitTotalCents =
    input.recurrence === "one-time"
      ? null
      : Math.round(
          (input.pricingMode === "hourly"
            ? hourlyServiceTotalCents / 100
            : homeServiceBaseDollars) *
            (1 - discountPercent / 100)
        ) * 100;

  return {
    pricingMode: input.pricingMode,
    homeServiceBaseTotalCents,
    conditionMultiplier,
    conditionAdjustmentCents,
    hourlyServiceTotalCents,
    serviceSubtotalCents,
    extrasTotalCents,
    firstCleaningTotalCents,
    futureVisitBaseTotalCents,
    futureVisitTotalCents,
    discountPercent,
    extras,
  };
}

export function createPublicBookingPriceSnapshot(
  input: PublicBookingPricingInput
): PublicBookingPriceSnapshot {
  return {
    version: PUBLIC_BOOKING_PRICING_VERSION,
    input: {
      ...input,
      extras: input.extras.map(extra => ({ ...extra })),
    },
    serviceName: getPublicBookingServiceName(input.serviceId),
    breakdown: calculatePublicBookingPrice(input),
  };
}

export function isPublicBookingPriceSnapshot(
  value: unknown
): value is PublicBookingPriceSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<PublicBookingPriceSnapshot>;
  return (
    snapshot.version === PUBLIC_BOOKING_PRICING_VERSION &&
    Boolean(snapshot.input && typeof snapshot.input === "object") &&
    Boolean(snapshot.breakdown && typeof snapshot.breakdown === "object") &&
    typeof snapshot.serviceName === "string"
  );
}
