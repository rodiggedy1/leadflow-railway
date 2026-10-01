import { useCallback, useState } from "react";
import type {
  BookingWidgetRecurringFrequency,
  BookingWidgetServiceId,
} from "@shared/bookingWidgetConfig";
import type {
  PublicBookingHomeType,
  PublicBookingPricingMode,
} from "@shared/publicBookingPricing";
import type {
  CanonicalBookingDraft,
  CanonicalExtraQuantities,
} from "@shared/canonicalBooking";

function tomorrowIso(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export type CanonicalBookingDraftState = CanonicalBookingDraft;

export function createInitialCanonicalBookingDraft(
  overrides: Partial<CanonicalBookingDraft> = {}
): CanonicalBookingDraft {
  return {
    serviceId: "standard",
    pricingMode: "home",
    bedrooms: 1,
    bathrooms: 1,
    homeType: "House",
    maidCount: 2,
    hourCount: 2,
    condition: 5,
    frequency: "biweekly",
    extras: {},
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    address: "",
    requestedLocalDate: tomorrowIso(),
    requestedLocalTime: "11:00",
    specialRequestNotes: [],
    ...overrides,
  };
}

export function useCanonicalBookingDraft(
  overrides: Partial<CanonicalBookingDraft> = {}
) {
  const [draft, setDraft] = useState<CanonicalBookingDraft>(() =>
    createInitialCanonicalBookingDraft(overrides)
  );
  const setField = useCallback(
    <K extends keyof CanonicalBookingDraft>(
      field: K,
      value: CanonicalBookingDraft[K]
    ) => {
      setDraft(current => ({ ...current, [field]: value }));
    },
    []
  );
  const setExtra = useCallback((id: string, delta: number) => {
    setDraft(current => ({
      ...current,
      extras: {
        ...current.extras,
        [id]: Math.max(0, (current.extras[id] ?? 0) + delta),
      },
    }));
  }, []);
  const setExtras = useCallback((extras: CanonicalExtraQuantities) => {
    setDraft(current => ({ ...current, extras }));
  }, []);
  const reset = useCallback(() => {
    setDraft(createInitialCanonicalBookingDraft(overrides));
  }, [overrides]);
  return {
    draft,
    setDraft,
    setField,
    setExtra,
    setExtras,
    reset,
    serviceId: draft.serviceId,
    setServiceId: (value: BookingWidgetServiceId) => setField("serviceId", value),
    pricingMode: draft.pricingMode,
    setPricingMode: (value: PublicBookingPricingMode) => setField("pricingMode", value),
    bedrooms: draft.bedrooms,
    setBedrooms: (value: number) => setField("bedrooms", value),
    bathrooms: draft.bathrooms,
    setBathrooms: (value: number) => setField("bathrooms", value),
    homeType: draft.homeType,
    setHomeType: (value: PublicBookingHomeType) => setField("homeType", value),
    maidCount: draft.maidCount,
    setMaidCount: (value: number) => setField("maidCount", value),
    hourCount: draft.hourCount,
    setHourCount: (value: number) => setField("hourCount", value),
    condition: draft.condition,
    setCondition: (value: number) => setField("condition", value),
    frequency: draft.frequency,
    setFrequency: (value: BookingWidgetRecurringFrequency) => setField("frequency", value),
    extras: draft.extras,
    customerName: draft.customerName,
    setCustomerName: (value: string) => setField("customerName", value),
    customerPhone: draft.customerPhone,
    setCustomerPhone: (value: string) => setField("customerPhone", value),
    customerEmail: draft.customerEmail,
    setCustomerEmail: (value: string) => setField("customerEmail", value),
    address: draft.address,
    setAddress: (value: string) => setField("address", value),
    date: draft.requestedLocalDate,
    setDate: (value: string) => setField("requestedLocalDate", value),
    time: draft.requestedLocalTime,
    setTime: (value: string) => setField("requestedLocalTime", value),
    notes: draft.specialRequestNotes.join("\n"),
    setNotes: (value: string) =>
      setField(
        "specialRequestNotes",
        value
          .split("\n")
          .map(note => note.trim())
          .filter(Boolean)
      ),
  };
}
