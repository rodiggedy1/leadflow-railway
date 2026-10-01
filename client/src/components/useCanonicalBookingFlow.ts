import { useCallback, useMemo, useState } from "react";
import {
  createCanonicalPricingInput,
  type CanonicalBookingDraft,
} from "@shared/canonicalBooking";
import {
  calculatePublicBookingPrice,
  createPublicBookingPriceSnapshot,
} from "@shared/publicBookingPricing";
import {
  createInitialCanonicalBookingDraft,
  type CanonicalBookingDraftState,
} from "./useCanonicalBookingDraft";

export type CanonicalBookingFlowOptions = {
  stepCount: 8 | 9;
  overrides?: Partial<CanonicalBookingDraft>;
};

export function useCanonicalBookingFlow({ stepCount, overrides = {} }: CanonicalBookingFlowOptions) {
  const [draft, setDraft] = useState<CanonicalBookingDraftState>(() => createInitialCanonicalBookingDraft(overrides));
  const [step, setStepState] = useState(1);
  const [complete, setComplete] = useState(false);
  const setField = useCallback(<K extends keyof CanonicalBookingDraft>(field: K, value: CanonicalBookingDraft[K]) => {
    setDraft(current => ({ ...current, [field]: value }));
  }, []);
  const setStep = useCallback((next: number | ((current: number) => number)) => {
    setStepState(current => {
      const resolved = typeof next === "function" ? next(current) : next;
      return Math.max(1, Math.min(stepCount, resolved));
    });
  }, [stepCount]);
  const pricingInput = useMemo(() => createCanonicalPricingInput(draft), [draft]);
  const pricing = useMemo(() => calculatePublicBookingPrice(pricingInput), [pricingInput]);
  const snapshot = useMemo(() => createPublicBookingPriceSnapshot(pricingInput), [pricingInput]);
  const nameParts = draft.customerName.trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] ?? "";
  const lastName = nameParts.slice(1).join(" ");
  const reset = useCallback(() => {
    setDraft(createInitialCanonicalBookingDraft(overrides));
    setStepState(1);
    setComplete(false);
  }, [overrides]);
  const setExtra = useCallback((id: string, delta: number) => {
    setDraft(current => ({ ...current, extras: { ...current.extras, [id]: Math.max(0, (current.extras[id] ?? 0) + delta) } }));
  }, []);
  return {
    draft,
    setDraft,
    step,
    setStep,
    stepCount,
    complete,
    setComplete,
    pricingInput,
    pricing,
    snapshot,
    setField,
    setExtra,
    setExtras: (extras: CanonicalBookingDraft["extras"] | ((current: CanonicalBookingDraft["extras"]) => CanonicalBookingDraft["extras"])) => setDraft(current => ({ ...current, extras: typeof extras === "function" ? extras(current.extras) : extras })),
    reset,
    service: draft.serviceId,
    serviceId: draft.serviceId,
    setServiceId: (value: CanonicalBookingDraft["serviceId"]) => setField("serviceId", value),
    setService: (value: CanonicalBookingDraft["serviceId"]) => setField("serviceId", value),
    bedrooms: draft.bedrooms,
    setBedrooms: (value: number) => setField("bedrooms", value),
    bathrooms: draft.bathrooms,
    setBathrooms: (value: number) => setField("bathrooms", value),
    homeType: draft.homeType,
    setHomeType: (value: CanonicalBookingDraft["homeType"]) => setField("homeType", value),
    pricingMode: draft.pricingMode,
    setPricingMode: (value: CanonicalBookingDraft["pricingMode"]) => setField("pricingMode", value),
    maidCount: draft.maidCount,
    setMaidCount: (value: number) => setField("maidCount", value),
    hourCount: draft.hourCount,
    setHourCount: (value: number) => setField("hourCount", value),
    condition: draft.condition,
    setCondition: (value: number) => setField("condition", value),
    frequency: draft.frequency,
    setFrequency: (value: CanonicalBookingDraft["frequency"]) => setField("frequency", value),
    extras: draft.extras,
    customerName: draft.customerName,
    setCustomerName: (value: string) => setField("customerName", value),
    firstName,
    lastName,
    setFirstName: (value: string) => setField("customerName", `${value} ${lastName}`.trim()),
    setLastName: (value: string) => setField("customerName", `${firstName} ${value}`.trim()),
    customerPhone: draft.customerPhone,
    setCustomerPhone: (value: string) => setField("customerPhone", value),
    customerEmail: draft.customerEmail,
    setCustomerEmail: (value: string) => setField("customerEmail", value),
    address: draft.address,
    setAddress: (value: string) => setField("address", value),
    requestedLocalDate: draft.requestedLocalDate,
    setRequestedLocalDate: (value: string) => setField("requestedLocalDate", value),
    date: draft.requestedLocalDate,
    setDate: (value: string) => setField("requestedLocalDate", value),
    requestedLocalTime: draft.requestedLocalTime,
    setRequestedLocalTime: (value: string) => setField("requestedLocalTime", value),
    time: draft.requestedLocalTime,
    setTime: (value: string) => setField("requestedLocalTime", value),
    specialRequestNotes: draft.specialRequestNotes,
    setSpecialRequestNotes: (value: string[]) => setField("specialRequestNotes", value),
    notes: draft.specialRequestNotes.join("\n"),
    setNotes: (value: string) => setField("specialRequestNotes", value.split("\n").map(note => note.trim()).filter(Boolean)),
  };
}
