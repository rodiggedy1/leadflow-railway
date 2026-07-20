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
  bedrooms: number | null;   // parsed from serviceNames (e.g. "2 bedrooms" → 2)
  bathrooms: number | null;  // summed from pricing_parameters entries with name containing "Bathroom"
  extras: string[];          // internal extra keys, e.g. ["clean_inside_oven", "green_cleaning"]
  customerNotes: string;
  staffNotes: string;
  requestedTeam: string | null;
  // Payment / card status
  hasStripeCard: boolean;
  stripeCustomerId: string | null;
  paymentBrand: string | null;
  paymentLast4: string | null;
  chargesOnHoldCents: number;   // sum of onhold charges in cents (L27 dollars × 100)
  chargesOutstandingCents: number; // outstanding balance in cents
}
export interface Launch27SyncResult {
  date: string;
  fetched: number;
  bookings: Launch27Booking[];
  error?: string;
}

/**
 * Maps L27 extra IDs to our internal extra keys.
 * IDs confirmed from live API response on 2026-07-05.
 */
const L27_EXTRA_ID_TO_KEY: Record<number, string> = {
  74:  "clean_finished_basement",
  76:  "green_cleaning",
  79:  "clean_inside_cabinets",
  80:  "clean_inside_empty_fridge",
  81:  "clean_inside_full_fridge",
  82:  "clean_inside_oven",
  83:  "clean_interior_windows",
  84:  "move_in_move_out",
  85:  "two_hours_organizing",
  86:  "load_of_laundry",
  87:  "i_have_pets",
  88:  "wipe_walls",
  89:  "sweep_garage",
  90:  "balcony_sweep",
  91:  "home_concierge",
  92:  "same_day_booking",
  93:  "clean_inside_microwave",
  94:  "shed_pool_house",
  95:  "wash_dishes",
  96:  "pool_deck",
};

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
    // DEBUG: log raw payment fields from first booking on first page
    if (offset === 0 && raw.length > 0) {
      const b0 = raw[0] as any;
      console.log('[L27-debug] user keys:', Object.keys(b0.user ?? {}));
      console.log('[L27-debug] user.is_stripe_card:', b0.user?.is_stripe_card);
      console.log('[L27-debug] user.stripe_customer_id:', b0.user?.stripe_customer_id);
      console.log('[L27-debug] payment_method_info:', JSON.stringify(b0.payment_method_info));
      console.log('[L27-debug] charges keys:', Object.keys(b0.charges ?? {}));
      console.log('[L27-debug] charges.outstanding:', b0.charges?.outstanding);
      console.log('[L27-debug] charges.onhold length:', (b0.charges?.onhold ?? []).length);
    }
    for (const b of raw) {
      // Parse extras: collect all extra items across all services, map L27 IDs to internal keys
      const extras: string[] = [];
      for (const svc of b.services ?? []) {
        const rawExtras = svc.extras;
        if (!rawExtras || !Array.isArray(rawExtras)) continue;
        for (const e of rawExtras as Array<{ id: number; name: string }>) {
          const key = L27_EXTRA_ID_TO_KEY[e.id];
          if (key && !extras.includes(key)) {
            extras.push(key);
          }
        }
      }

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
        bedrooms: (() => {
          // Parse bedroom count from service name, e.g. "1 bedroom" → 1, "2 bedrooms" → 2
          for (const svc of b.services ?? []) {
            const m = svc.name?.match(/(\d+)\s*bedroom/i);
            if (m) return parseInt(m[1], 10);
          }
          return null;
        })(),
        bathrooms: (() => {
          // Sum bathroom quantities from pricing_parameters across all services
          let total = 0;
          for (const svc of b.services ?? []) {
            for (const pp of svc.pricing_parameters ?? []) {
              if (pp.name?.toLowerCase().includes('bathroom')) {
                total += pp.quantity ?? 0;
              }
            }
          }
          return total > 0 ? total : null;
        })(),
        extras,
        customerNotes: b.customer_notes ?? "",
        staffNotes: b.staff_notes ?? "",
        requestedTeam: b.preferred_cleaner?.name ?? null,
        // Payment / card status (defensive — L27 may return null for any of these)
        hasStripeCard: b.user?.is_stripe_card === true,
        stripeCustomerId: b.user?.stripe_customer_id ?? null,
        paymentBrand: b.payment_method_info?.brand ?? null,
        paymentLast4: b.payment_method_info?.last4 ?? null,
        chargesOnHoldCents: Math.round(
          (b.charges?.onhold ?? []).reduce((sum: number, c: any) => sum + Number(c.amount ?? 0), 0) * 100
        ),
        chargesOutstandingCents: Math.round((b.charges?.outstanding ?? 0) * 100),
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
  preferred_cleaner?: { id: number; name: string } | null;
}
