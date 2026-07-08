/**
 * plannerTypes.ts
 *
 * Pure domain types for the SMS Campaign Audience Planner.
 * No React, no Drizzle, no database models — only the domain objects.
 * Shared between server (planner) and client (UI) via shared/ re-export.
 */

// ─── Rule fields ─────────────────────────────────────────────────────────────

export type RuleField =
  // Booking History
  | "lastBookingDays"       // days since last job
  | "bookingCount"          // total number of bookings
  | "recurringStatus"       // "one-time" | "former-recurring" | "active-recurring"
  | "serviceType"           // e.g. "Standard Cleaning", "Move-out"
  | "bedrooms"
  | "bathrooms"
  // Customer Value
  | "lifetimeRevenue"       // sum of lastBookingPrice across all jobs
  | "avgTicket"             // average lastBookingPrice
  | "lastBookingPrice"      // most recent job price
  // Customer Health
  | "reviewScore"           // customerRating (1–5)
  | "hasComplaint"          // boolean
  | "hasRefund"             // boolean (placeholder — no refund column yet)
  | "hasChargeback"         // boolean (placeholder)
  // Marketing
  | "lastSmsDays"           // days since last outbound SMS
  | "lastEmailDays"         // days since last email (placeholder)
  | "stopStatus"            // boolean — is on STOP list
  | "openRate"              // placeholder
  | "replyRate"             // placeholder
  // AI (heuristic placeholders until real ML)
  | "aiLikelihoodToBook"    // 0–100 score
  | "aiLikelihoodToRespond" // 0–100 score
  // Geography
  | "radiusMiles"           // distance from business address (requires geocoding — Stage 3)
  | "city"
  | "zip";

export type RuleOperator =
  | ">"
  | ">="
  | "<"
  | "<="
  | "="
  | "!="
  | "in"
  | "not_in"
  | "is_true"
  | "is_false";

export interface Rule {
  field: RuleField;
  op: RuleOperator;
  value: string | number | boolean | string[];
}

// ─── Preset audiences ─────────────────────────────────────────────────────────

export type AudiencePresetId =
  | "win-back"
  | "former-recurring"
  | "last-minute-openings"
  | "five-star-no-issues"
  | "high-value"
  | "not-contacted-30d"
  | "due-for-recurring"
  | "spent-over-500"
  | "within-x-miles";

// ─── Audience Definition ──────────────────────────────────────────────────────

export interface AudienceGeography {
  radiusMiles?: number;
  lat?: number;
  lng?: number;
  city?: string;
  zip?: string;
}

export interface AudienceDefinition {
  /**
   * Named preset audiences selected by the user.
   * Each preset expands to a set of include rules inside the planner.
   */
  presets: AudiencePresetId[];

  /**
   * User-defined include rules (from the visual rule builder).
   * Combined with preset rules using AND logic.
   */
  includeRules: Rule[];

  /**
   * Hard exclusion rules. Always applied regardless of include rules.
   * Auto-populated by the planner: STOP, invalid phone, complaint, recently texted.
   * UI may add additional exclusions (e.g. exclude specific zip codes).
   */
  excludeRules: Rule[];

  /** Geography constraints. null = no geography filter. */
  geography: AudienceGeography | null;

  /** Optional planner options */
  options?: {
    /** Max customers to return in sampleIncluded / sampleExcluded. Default: 10 */
    sampleSize?: number;
    /** Days to consider "recently texted". Default: 30 */
    recentSmsDays?: number;
  };
}

// ─── Planner output ───────────────────────────────────────────────────────────

export type ExclusionReason =
  | "STOP_OPT_OUT"
  | "INVALID_PHONE"
  | "OPEN_COMPLAINT"
  | "RECENTLY_TEXTED"
  | "ACTIVE_RECURRING"
  | "REFUND_ON_FILE"
  | "CHARGEBACK_ON_FILE"
  | "DUPLICATE_PHONE";

export interface SampleCustomer {
  /** Obfuscated for privacy: "Jennifer S." */
  displayName: string;
  phoneNormalized: string;
  lastJobDate: string;           // ISO date string
  daysSinceLastBooking: number;
  lastBookingPrice: number;      // dollars
  bookingCount: number;
  frequency: string;
  serviceType: string;
  reviewScore: number | null;
  /** Why this customer was matched — shown in audience preview */
  matchedBecause: string[];
  /**
   * Confidence score 0–100 for this customer match.
   * Heuristic: base 60, +10 per extra matched rule, +15 former recurring, -20 any complaint, capped 98.
   */
  confidence: number;
}

export interface ExcludedCustomer {
  displayName: string;
  phoneNormalized: string;
  reason: ExclusionReason;
  /** Human-readable explanation, e.g. "Opted out via STOP on 2026-03-14" */
  reasonLabel: string;
}

export interface ExclusionBreakdown {
  stopOptOut: number;
  invalidPhone: number;
  openComplaint: number;
  recentlyTexted: number;
  activeRecurring: number;
  duplicate: number;
  other: number;
}

export interface AudienceStats {
  avgDaysSinceLastBooking: number;
  avgLastBookingPrice: number;       // dollars
  avgBookingCount: number;
  recurringPercent: number;          // 0–100
  oneTimePercent: number;            // 0–100
  topServiceTypes: { label: string; count: number }[];
  topFrequencies: { label: string; count: number }[];
  /** null until Stage 3 geocoding is implemented */
  avgDistanceMiles: null;
}

export interface AudienceSummary {
  matchedCustomers: number;
  excludedCustomers: number;
  estimatedRevenue: number;          // matchedCustomers × avgTicket × rebookRate
  estimatedBookings: number;         // matchedCustomers × responseRate × conversionRate
  estimatedReplies: number;          // matchedCustomers × estimatedReplyRate
  averageTicket: number;
  /** null until Stage 3 */
  averageDistance: null;
  /**
   * Quality score 0–100 based on heuristics.
   * +20 former recurring, +15 within 5 miles, +10 90-180 days,
   * -25 recent complaints, -15 avg spend < $100
   */
  qualityScore: number;
  qualityGrade: "A" | "B" | "C" | "D" | "F";
}

export interface PlannerResult {
  summary: AudienceSummary;
  stats: AudienceStats;
  exclusionBreakdown: ExclusionBreakdown;
  sampleIncluded: SampleCustomer[];
  sampleExcluded: ExcludedCustomer[];
  /**
   * SHA-256 of the canonical (key-sorted) JSON of the AudienceDefinition.
   * Used in Stage 4 to link a frozen recipient list to the exact audience version.
   */
  ruleHash: string;
  generatedAt: number;               // Unix ms
  /**
   * Rule fields that are currently supported by the planner (affect live count).
   * The UI uses this to mark unsupported rules as "Not included in live count".
   * The server owns this contract — the client never hardcodes it.
   */
  supportedRuleFields: RuleField[];
}
