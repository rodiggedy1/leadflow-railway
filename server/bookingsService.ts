import { createHash } from "crypto";
import {
  BOOKING_WIDGET_PRICED_EXTRAS,
  DEFAULT_BOOKING_WIDGET_DRAFT,
  calculateBookingWidgetPrice,
  calculateBookingWidgetRecurringPrice,
} from "../shared/bookingWidgetConfig";
import {
  NATIVE_BOOKING_PRICING_VERSION,
  type BeginBookingPaymentInput,
  type BookingPriceSnapshot,
  type CaptureBookingLeadInput,
  type PrepareBookingInput,
  type PrepareBookingResult,
  type SafePreparedBookingSummary,
  type UpdateBookingLeadInput,
} from "../shared/booking";
import { normalizePhone } from "./utils/phone";
import { businessLocalDateTimeToUtcMs } from "./utils/businessTime";

export class NativeBookingInputError extends Error {}
export class NativeBookingIdempotencyConflictError extends Error {}

export type PreparedNativeBooking = {
  publicBookingNumber: string;
  idempotencyKey: string;
  commandHash: string;
  source: PrepareBookingInput["surface"];
  funnelStage: "lead" | "pending_payment";
  status: "needs_attention" | "pending_payment";
  availabilityStatus: "requested";
  assignmentStatus: "unassigned";
  paymentStatus: "not_started" | "pending";
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  serviceId: PrepareBookingInput["service"]["serviceId"];
  serviceName: string;
  bedrooms: number;
  bathrooms: number;
  extras: BookingPriceSnapshot["extras"];
  specialRequestNotes: string[];
  address: string;
  requestedLocalDate: string;
  requestedLocalTime: string;
  requestedTimeZone: string;
  requestedStartAt: number;
  recurrence: PrepareBookingInput["recurrence"];
  recurringIntentStatus: "intent_pending" | null;
  pricingVersion: typeof NATIVE_BOOKING_PRICING_VERSION;
  firstCleaningTotalCents: number;
  futureVisitTotalCents: number | null;
  priceSnapshot: BookingPriceSnapshot;
  expiresAt: null;
  summary: SafePreparedBookingSummary;
};

export type PersistedBookingIdentity = {
  publicBookingNumber: string;
  commandHash: string;
};

export type PersistPreparedBooking = (
  prepared: PreparedNativeBooking,
) => Promise<{ booking: PersistedBookingIdentity; created: boolean }>;

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function publicBookingNumberFor(idempotencyKey: string): string {
  return `MIB-${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 12).toUpperCase()}`;
}

export function buildPreparedNativeBooking(
  input: PrepareBookingInput | CaptureBookingLeadInput,
  options: { nowMs: number; timeZone: string; funnelStage?: "lead" | "pending_payment" },
): { type: "price_changed"; result: Extract<PrepareBookingResult, { type: "price_changed" }> } | { type: "ready"; prepared: PreparedNativeBooking } {
  const phone = normalizePhone(input.customer.phone);
  if (!phone) throw new NativeBookingInputError("Enter a valid US phone number.");

  const requestedStartAt = businessLocalDateTimeToUtcMs(
    input.requestedSchedule.localDate,
    input.requestedSchedule.localTime,
    options.timeZone,
  );
  if (requestedStartAt <= options.nowMs) throw new NativeBookingInputError("Requested time must be in the future.");

  const seenExtras = new Set<string>();
  const extras = [...input.service.extras]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((selected) => {
      if (seenExtras.has(selected.id)) throw new NativeBookingInputError(`Duplicate extra: ${selected.id}`);
      seenExtras.add(selected.id);
      const catalog = BOOKING_WIDGET_PRICED_EXTRAS.find((extra) => extra.id === selected.id);
      if (!catalog) throw new NativeBookingInputError(`Unsupported extra: ${selected.id}`);
      if (!catalog.quantityUnit && selected.quantity !== 1) {
        throw new NativeBookingInputError(`${catalog.label} does not support a quantity.`);
      }
      const quantity = catalog.quantityUnit ? selected.quantity : 1;
      return {
        id: catalog.id,
        label: catalog.label,
        quantity,
        unitPriceCents: catalog.unitPrice * 100,
        totalCents: catalog.unitPrice * quantity * 100,
      };
    });

  const extraQuantities = Object.fromEntries(extras.map((extra) => [extra.id, extra.quantity]));
  const breakdown = calculateBookingWidgetPrice({
    serviceId: input.service.serviceId,
    bedrooms: input.service.bedrooms,
    bathrooms: input.service.bathrooms,
    selectedExtras: extras.map((extra) => extra.label),
    extraQuantities,
  });
  const totalCents = Math.round(breakdown.total * 100);
  const recurringPrice = calculateBookingWidgetRecurringPrice(breakdown.total, input.recurrence);
  const serviceName = DEFAULT_BOOKING_WIDGET_DRAFT.services.find((service) => service.id === input.service.serviceId)?.name;
  if (!serviceName) throw new NativeBookingInputError("Unsupported service type.");

  const priceSnapshot: BookingPriceSnapshot = {
    version: NATIVE_BOOKING_PRICING_VERSION,
    serviceId: input.service.serviceId,
    serviceName,
    bedrooms: input.service.bedrooms,
    bathrooms: input.service.bathrooms,
    extras,
    breakdown,
    firstCleaningTotalCents: totalCents,
    recurringFrequency: input.recurrence,
    futureVisitTotalCents: recurringPrice === null ? null : recurringPrice * 100,
  };

  if (
    input.acceptedPricing.version !== NATIVE_BOOKING_PRICING_VERSION ||
    input.acceptedPricing.totalCents !== totalCents
  ) {
    return {
      type: "price_changed",
      result: {
        type: "price_changed",
        pricingVersion: NATIVE_BOOKING_PRICING_VERSION,
        totalCents,
        priceSnapshot,
      },
    };
  }

  const customerName = normalizeText(input.customer.fullName);
  const customerEmail = input.customer.email?.trim().toLowerCase() ?? "";
  const address = normalizeText(input.address ?? "");
  const specialRequestNotes = input.service.specialRequestNotes.map(normalizeText).filter(Boolean);
  const materialCommand = {
    customer: { fullName: customerName, phone, email: customerEmail },
    service: {
      serviceId: input.service.serviceId,
      bedrooms: input.service.bedrooms,
      bathrooms: input.service.bathrooms,
      extras: extras.map(({ id, quantity }) => ({ id, quantity })),
      specialRequestNotes,
    },
    address,
    requestedSchedule: {
      localDate: input.requestedSchedule.localDate,
      localTime: input.requestedSchedule.localTime,
      timeZone: options.timeZone,
      requestedStartAt,
    },
    recurrence: input.recurrence,
    acceptedPricing: {
      version: NATIVE_BOOKING_PRICING_VERSION,
      totalCents,
    },
  };
  const commandHash = hashJson(materialCommand);
  const futureVisitTotalCents = recurringPrice === null ? null : recurringPrice * 100;
  const summary: SafePreparedBookingSummary = {
    customerName,
    serviceName,
    homeSummary: input.service.bedrooms === 0
      ? `Studio · ${input.service.bathrooms} bath${input.service.bathrooms === 1 ? "" : "s"}`
      : `${input.service.bedrooms} bed · ${input.service.bathrooms} bath${input.service.bathrooms === 1 ? "" : "s"}`,
    address,
    requestedLocalDate: input.requestedSchedule.localDate,
    requestedLocalTime: input.requestedSchedule.localTime,
    requestedTimeZone: options.timeZone,
    totalCents,
    recurrence: input.recurrence,
    futureVisitTotalCents,
  };

  return {
    type: "ready",
    prepared: {
      publicBookingNumber: publicBookingNumberFor(input.idempotencyKey),
      idempotencyKey: input.idempotencyKey,
      commandHash,
      source: input.surface,
      funnelStage: options.funnelStage ?? "lead",
      status: options.funnelStage === "pending_payment" ? "pending_payment" : "needs_attention",
      availabilityStatus: "requested",
      assignmentStatus: "unassigned",
      paymentStatus: options.funnelStage === "pending_payment" ? "pending" : "not_started",
      customerName,
      customerPhone: phone,
      customerEmail,
      serviceId: input.service.serviceId,
      serviceName,
      bedrooms: input.service.bedrooms,
      bathrooms: input.service.bathrooms,
      extras,
      specialRequestNotes,
      address,
      requestedLocalDate: input.requestedSchedule.localDate,
      requestedLocalTime: input.requestedSchedule.localTime,
      requestedTimeZone: options.timeZone,
      requestedStartAt,
      recurrence: input.recurrence,
      recurringIntentStatus: input.recurrence === "one-time" ? null : "intent_pending",
      pricingVersion: NATIVE_BOOKING_PRICING_VERSION,
      firstCleaningTotalCents: totalCents,
      futureVisitTotalCents,
      priceSnapshot,
      expiresAt: null,
      summary,
    },
  };
}

export async function prepareNativeBooking(
  input: PrepareBookingInput | CaptureBookingLeadInput | BeginBookingPaymentInput,
  options: { nowMs: number; timeZone: string; persist: PersistPreparedBooking },
  behavior: { funnelStage?: "lead" | "pending_payment"; requireCompleteCustomer?: boolean } = {},
): Promise<PrepareBookingResult> {
  if (behavior.requireCompleteCustomer !== false && (!input.customer.email || !input.address)) {
    throw new NativeBookingInputError("Complete the customer email and address before booking.");
  }
  const built = buildPreparedNativeBooking(input, { ...options, funnelStage: behavior.funnelStage });
  if (built.type === "price_changed") return built.result;
  const persisted = await options.persist(built.prepared);
  if (persisted.booking.commandHash !== built.prepared.commandHash) {
    throw new NativeBookingIdempotencyConflictError("IDEMPOTENCY_CONFLICT");
  }
  return {
    type: "prepared",
    publicBookingNumber: persisted.booking.publicBookingNumber,
    status: "needs_attention",
    created: persisted.created,
    replayed: !persisted.created,
    summary: built.prepared.summary,
  };
}

export function updatePreparedNativeBooking(
  existing: { customerEmail: string; address: string },
  input: UpdateBookingLeadInput | BeginBookingPaymentInput,
): { customerEmail: string; address: string } {
  if ("service" in input) {
    return { customerEmail: input.customer.email.trim().toLowerCase(), address: normalizeText(input.address) };
  }
  return {
    customerEmail: input.email ? input.email.trim().toLowerCase() : existing.customerEmail,
    address: input.address ? normalizeText(input.address) : existing.address,
  };
}
