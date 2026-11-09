import { createContext, useContext, type ReactNode } from "react";
import type { useCanonicalBookingFlow } from "../useCanonicalBookingFlow";
import {
  createBookingArrivalPreference,
  type BookingArrivalMode,
  type BookingArrivalPeriod,
  type BookingArrivalPreference,
} from "@shared/bookingArrival";

export type ApprovedBookFlow = ReturnType<typeof useCanonicalBookingFlow>;

export interface ApprovedBookLocation {
  zip: string;
  street: string;
  apt: string;
  city: string;
  region: string;
}

/** URLs are supplied by the parent; new photographic assets belong on the CDN. */
export interface ApprovedBookAssets {
  rootLogo: string;
  teamPhoto: string;
  organizing: string;
  wipeWalls: string;
  basement: string;
  sweepGarage: string;
}

export interface ApprovedBookContextValue {
  flow: ApprovedBookFlow;
  location: ApprovedBookLocation;
  /** Parent updates location and the canonical full address together, never ZIP alone. */
  setLocation: (change: Partial<ApprovedBookLocation>) => void;
  arrival: BookingArrivalPreference;
  onArrivalChange: (
    mode: BookingArrivalMode,
    period?: BookingArrivalPeriod,
    start?: string
  ) => void;
  /** Date-only UI selection, including temporary clearing; the parent owns validation. */
  dateValue: string;
  dateMin: string;
  onDateChange: (value: string) => void;
  onNext: () => void | Promise<void>;
  onBack: () => void;
  assets: ApprovedBookAssets;
  /** Omit unless connected to an existing, authorized consent implementation. */
  smsConsent?: { value: boolean; onChange: (value: boolean) => void };
  /** Omit unless the parent persists access instructions through canonical notes. */
  entryMethod?: { value: string; onChange: (value: string) => void };
}

const ApprovedBookContext = createContext<ApprovedBookContextValue | null>(
  null
);

export function ApprovedBookProvider({
  value,
  children,
}: {
  value: ApprovedBookContextValue;
  children: ReactNode;
}) {
  return (
    <ApprovedBookContext.Provider value={value}>
      {children}
    </ApprovedBookContext.Provider>
  );
}

export function useApprovedBookContext(): ApprovedBookContextValue {
  const value = useContext(ApprovedBookContext);
  if (!value)
    throw new Error(
      "Approved booking components require ApprovedBookProvider."
    );
  return value;
}

export function useApprovedBookFlow() {
  return useApprovedBookContext().flow;
}

export function useApprovedBookLocation() {
  return useApprovedBookContext().location;
}

export function useApprovedBookArrival() {
  return useApprovedBookContext().arrival;
}

function clockLabel(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return "";
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

/** Presentation only: the shared helper, not this UI, defines window boundaries. */
export function approvedBookExactWindow(start: string) {
  const preference = createBookingArrivalPreference("exact", undefined, start);
  return `${clockLabel(preference.startLocalTime)} – ${clockLabel(preference.endLocalTime)}`;
}

export function approvedBookArrivalLabel(value: BookingArrivalPreference) {
  if (value.mode === "flexible") return "Flexible · 8:30 AM – 5:00 PM";
  if (value.mode === "preferred")
    return `Preferred · ${value.period === "morning" ? "Morning" : "Afternoon"}`;
  return `Exact · ${clockLabel(value.startLocalTime)} – ${clockLabel(value.endLocalTime)}`;
}

export function approvedBookArrivalDiscountTitle(mode: BookingArrivalMode) {
  return mode === "flexible"
    ? "Flexible arrival · 10% off"
    : "Preferred arrival · 5% off";
}
