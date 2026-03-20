/**
 * Launch27 API Connector
 * Fetches completed bookings for a given date using the Launch27 REST API.
 * Auth: Bearer JWT stored in LAUNCH27_BEARER_TOKEN env variable.
 * Base URL: https://{LAUNCH27_SUBDOMAIN}.launch27.com
 */

import { ENV } from "./_core/env";

export interface Launch27Team {
  id: number;
  title: string;       // e.g. "Team Solange"
  share: number;       // pay percentage, e.g. 55 = 55%
  bgColor: string;     // team color for UI badges
}

export interface Launch27Booking {
  id: number;
  phone: string; // e.g. "+1 202 384 3991"
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  serviceDate: string; // ISO 8601, e.g. "2026-03-15T12:30:00Z"
  frequency: string; // e.g. "Monthly (10%OFF)"
  address: string; // full address string
  city: string;
  state: string;
  zip: string;
  totalRevenue: number; // summary.total (after discounts/tips)
  baseRevenue: number;  // summary.revenue (before tip)
  bookingStatus: string; // "assigned", "completed", "cancelled"
  completed: boolean;
  teams: Launch27Team[]; // assigned teams with pay share %
  serviceNames: string[]; // e.g. ["1 bedroom"]
  customerNotes: string;
  staffNotes: string;
}

export interface Launch27SyncResult {
  date: string;
  fetched: number;
  bookings: Launch27Booking[];
  error?: string;
}

function getBaseUrl(): string {
  const subdomain = ENV.launch27Subdomain || "maidsinblack";
  return `https://${subdomain}.launch27.com`;
}

function getBearer(): string {
  const token = ENV.launch27BearerToken;
  if (!token) throw new Error("LAUNCH27_BEARER_TOKEN env variable is not set");
  return token;
}

/**
 * Fetch all completed bookings for a specific date (YYYY-MM-DD).
 * Handles pagination automatically (20 per page).
 */
export async function getCompletedBookingsForDate(
  date: string,
  opts?: { includeAll?: boolean } // if true, fetch all bookings (assigned + completed), not just completed
): Promise<Launch27SyncResult> {
  const baseUrl = getBaseUrl();
  const bearer = getBearer();

  const allBookings: Launch27Booking[] = [];
  let offset = 0;
  const limit = 20;

  while (true) {
    const params = new URLSearchParams({
      from: date,
      to: date,
      // When includeAll=true, don't filter by completed — fetch all statuses
      ...(opts?.includeAll ? {} : { options: "completed,exclude_forecasted" }),
      limit: String(limit),
      offset: String(offset),
      sort: "asc",
    });

    const url = `${baseUrl}/v1/staff/bookings?${params.toString()}`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });
    } catch (err) {
      return {
        date,
        fetched: 0,
        bookings: [],
        error: `Network error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (!response.ok) {
      const body = await response.text();
      return {
        date,
        fetched: 0,
        bookings: [],
        error: `Launch27 API error ${response.status}: ${body.substring(0, 200)}`,
      };
    }

    const raw = await response.json() as RawBooking[];

    if (!Array.isArray(raw) || raw.length === 0) break;

    for (const b of raw) {
      allBookings.push({
        id: b.id,
        phone: b.phone ?? "",
        firstName: b.user?.first_name ?? "",
        lastName: b.user?.last_name ?? "",
        fullName: b.user?.name ?? `${b.user?.first_name ?? ""} ${b.user?.last_name ?? ""}`.trim(),
        email: b.user?.email ?? "",
        serviceDate: b.service_date ?? date,
        frequency: b.frequency?.name ?? "",
        address: b.address?.full_address ?? "",
        city: b.address?.city ?? "",
        state: b.address?.state ?? "",
        zip: b.address?.zip ?? "",
        totalRevenue: b.summary?.total ?? 0,
        baseRevenue: b.summary?.revenue ?? 0,
        bookingStatus: b.booking_status ?? "assigned",
        completed: b.completed ?? false,
        teams: (b.teams ?? []).map((t) => ({
          id: t.id,
          title: t.title,
          share: t.share ?? 0,
          bgColor: t.bg_color ?? "#888888",
        })),
        serviceNames: (b.services ?? []).map((s) => s.name),
        customerNotes: b.customer_notes ?? "",
        staffNotes: b.staff_notes ?? "",
      });
    }

    if (raw.length < limit) break; // last page
    offset += limit;
  }

  return {
    date,
    fetched: allBookings.length,
    bookings: allBookings,
  };
}

// ---- Raw API types ----

interface RawBooking {
  id: number;
  phone: string;
  user: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    name: string;
  };
  service_date: string;
  frequency: {
    id: number;
    name: string;
  };
  address: {
    full_address: string;
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  summary: {
    services: number;
    pricing_parameters?: number;
    extras: number;
    discount: number;
    adjustment?: number;
    revenue: number;
    tip?: number;
    total: number;
  };
  booking_status: string;
  completed: boolean;
  teams?: Array<{
    id: number;
    title: string;
    share: number;
    bg_color: string;
    fg_color: string;
    image: string | null;
  }>;
  services?: Array<{
    id: number;
    name: string;
    price: number;
    extras: unknown;
    pricing_parameters?: Array<{
      id: number;
      type: string;
      name: string;
      quantity: number;
      price: number;
      total: number;
    }>;
  }>;
  customer_notes?: string;
  staff_notes?: string;
}
