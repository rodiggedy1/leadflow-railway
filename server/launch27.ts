/**
 * Launch27 API Connector
 * Fetches completed bookings for a given date using the Launch27 REST API.
 * Auth: Bearer JWT stored in LAUNCH27_BEARER_TOKEN env variable.
 * Base URL: https://{LAUNCH27_SUBDOMAIN}.launch27.com
 */

import { ENV } from "./_core/env";

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
  totalRevenue: number; // summary.total
  bookingStatus: string; // "completed"
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
  date: string
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
      options: "completed,exclude_forecasted",
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
        totalRevenue: b.summary?.total ?? 0,
        bookingStatus: b.booking_status ?? "completed",
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
    extras: number;
    discount: number;
    revenue: number;
    total: number;
  };
  booking_status: string;
  completed: boolean;
}
