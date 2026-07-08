/**
 * SafetyFilter.ts
 *
 * Composable safety checks applied to a planner's matched customer set
 * during the freeze pass. Each check is an independent pure function.
 *
 * Usage:
 *   const checks = buildDefaultSafetyChecks(optOutPhones, recentlySentPhones, complaintPhones);
 *   const result = applySafetyChecks(candidates, checks);
 *
 * Adding a new check (VIP exclusion, legal hold, do-not-market, etc.) is
 * a one-line change: push a new SafetyCheck into the array.
 *
 * No DB access. No tRPC. Pure functions only.
 */

import type { ExclusionReason } from "./plannerTypes";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A candidate customer produced by the AudiencePlanner's matched set.
 * Contains only the fields needed for safety evaluation.
 */
export interface SafetyCandidate {
  completedJobId: number;
  phone: string;
  phoneNormalized: string;
  firstName: string;
  name: string;
  address: string;
  serviceType: string;
  lastBookingPrice: number;
  lastJobDate: string;
  frequency: string;
}

/** A candidate that passed all safety checks — ready to be frozen. */
export interface ValidatedRecipient extends SafetyCandidate {
  /** Rendered, personalized SMS message for this recipient. */
  personalizedMessage: string;
}

/** A candidate that was excluded by one or more safety checks. */
export interface ExcludedRecipient {
  phoneNormalized: string;
  displayName: string;
  reason: ExclusionReason;
  reasonLabel: string;
}

/** Result of running all safety checks against a candidate set. */
export interface SafetyFilterResult {
  valid: ValidatedRecipient[];
  excluded: ExcludedRecipient[];
  breakdown: {
    stopOptOut: number;
    invalidPhone: number;
    openComplaint: number;
    recentlyTexted: number;
    duplicate: number;
    other: number;
  };
}

/**
 * A single composable safety check.
 *
 * Returns an ExclusionReason + label if the candidate should be excluded,
 * or null if the candidate passes this check.
 */
export type SafetyCheck = (
  candidate: SafetyCandidate
) => { reason: ExclusionReason; label: string } | null;

// ─── Individual check factories ───────────────────────────────────────────────

/**
 * Excludes customers who have opted out via STOP.
 * Uses the global opt-out phone set (normalized E.164).
 */
export function stopCheck(optOutPhones: Set<string>): SafetyCheck {
  return (candidate) => {
    if (optOutPhones.has(candidate.phoneNormalized)) {
      return {
        reason: "STOP_OPT_OUT",
        label: "Customer has opted out via STOP",
      };
    }
    return null;
  };
}

/**
 * Excludes customers with an open complaint on file.
 * Uses a set of normalized phones with active complaints.
 */
export function complaintCheck(complaintPhones: Set<string>): SafetyCheck {
  return (candidate) => {
    if (complaintPhones.has(candidate.phoneNormalized)) {
      return {
        reason: "OPEN_COMPLAINT",
        label: "Customer has an open complaint on file",
      };
    }
    return null;
  };
}

/**
 * Excludes customers who were texted within the recent window.
 * Uses a set of normalized phones that received an outbound SMS recently.
 */
export function recentSmsCheck(recentlySentPhones: Set<string>): SafetyCheck {
  return (candidate) => {
    if (recentlySentPhones.has(candidate.phoneNormalized)) {
      return {
        reason: "RECENTLY_TEXTED",
        label: "Customer was texted within the last 30 days",
      };
    }
    return null;
  };
}

/**
 * Excludes duplicate phone numbers — only the first occurrence passes.
 * Maintains a seen set internally; must be called in order.
 *
 * NOTE: This check is stateful. Create a new instance per filter run.
 */
export function duplicateCheck(): SafetyCheck {
  const seen = new Set<string>();
  return (candidate) => {
    if (seen.has(candidate.phoneNormalized)) {
      return {
        reason: "DUPLICATE_PHONE",
        label: "Duplicate phone number — already included in recipient list",
      };
    }
    seen.add(candidate.phoneNormalized);
    return null;
  };
}

/**
 * Excludes candidates with an invalid or missing phone number.
 * A valid phone must be E.164 format: +1XXXXXXXXXX (12 chars for US).
 */
export function invalidPhoneCheck(): SafetyCheck {
  return (candidate) => {
    const phone = candidate.phoneNormalized;
    const isValid = /^\+1\d{10}$/.test(phone);
    if (!isValid) {
      return {
        reason: "INVALID_PHONE",
        label: `Phone number "${phone}" is not a valid US number`,
      };
    }
    return null;
  };
}

// ─── Default check set ────────────────────────────────────────────────────────

/**
 * Builds the default safety check array used by AudienceFreezer.
 * Order matters: checks are applied in sequence, first match wins.
 *
 * To add a new check (VIP exclusion, legal hold, do-not-market):
 *   return [...defaultChecks, myNewCheck(params)];
 */
export function buildDefaultSafetyChecks(
  optOutPhones: Set<string>,
  recentlySentPhones: Set<string>,
  complaintPhones: Set<string>
): SafetyCheck[] {
  return [
    invalidPhoneCheck(),       // always first — invalid phones can't receive SMS
    stopCheck(optOutPhones),   // STOP opt-outs
    complaintCheck(complaintPhones), // open complaints
    recentSmsCheck(recentlySentPhones), // recently texted
    duplicateCheck(),          // always last — dedupes after all other filters
  ];
}

// ─── Core applySafetyChecks function ─────────────────────────────────────────

/**
 * Applies an ordered array of safety checks to a candidate set.
 *
 * For each candidate, runs checks in order. First failing check wins.
 * Passing candidates are returned as ValidatedRecipient with a
 * personalized message rendered from the template.
 *
 * @param candidates   Matched customers from the AudiencePlanner
 * @param checks       Ordered array of SafetyCheck functions
 * @param template     SMS message template with {{first_name}} / {{area}} placeholders
 */
export function applySafetyChecks(
  candidates: SafetyCandidate[],
  checks: SafetyCheck[],
  template: string
): SafetyFilterResult {
  const valid: ValidatedRecipient[] = [];
  const excluded: ExcludedRecipient[] = [];
  const breakdown = {
    stopOptOut: 0,
    invalidPhone: 0,
    openComplaint: 0,
    recentlyTexted: 0,
    duplicate: 0,
    other: 0,
  };

  for (const candidate of candidates) {
    let exclusion: { reason: ExclusionReason; label: string } | null = null;

    for (const check of checks) {
      const result = check(candidate);
      if (result) {
        exclusion = result;
        break; // first failing check wins
      }
    }

    if (exclusion) {
      excluded.push({
        phoneNormalized: candidate.phoneNormalized,
        displayName: obfuscateName(candidate.name),
        reason: exclusion.reason,
        reasonLabel: exclusion.label,
      });

      // Tally breakdown
      switch (exclusion.reason) {
        case "STOP_OPT_OUT":      breakdown.stopOptOut++;     break;
        case "INVALID_PHONE":     breakdown.invalidPhone++;   break;
        case "OPEN_COMPLAINT":    breakdown.openComplaint++;  break;
        case "RECENTLY_TEXTED":   breakdown.recentlyTexted++; break;
        case "DUPLICATE_PHONE":   breakdown.duplicate++;      break;
        default:                  breakdown.other++;          break;
      }
    } else {
      valid.push({
        ...candidate,
        personalizedMessage: renderTemplate(template, candidate),
      });
    }
  }

  return { valid, excluded, breakdown };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Renders an SMS template for a specific recipient.
 * Supported placeholders: {{first_name}}, {{area}}
 */
function renderTemplate(template: string, candidate: SafetyCandidate): string {
  const area = extractArea(candidate.address);
  return template
    .replace(/\{\{first_name\}\}/gi, candidate.firstName || "there")
    .replace(/\{\{area\}\}/gi, area || "your area");
}

/**
 * Extracts a neighborhood/area label from an address string.
 * Returns the city portion if available, otherwise the ZIP code.
 * Falls back to empty string.
 */
function extractArea(address: string): string {
  if (!address) return "";
  // Try to extract city from "123 Main St, City, ST 12345"
  const parts = address.split(",").map((p) => p.trim());
  if (parts.length >= 2) {
    return parts[parts.length - 2] || "";
  }
  // Try to extract ZIP
  const zipMatch = address.match(/\b\d{5}\b/);
  return zipMatch ? zipMatch[0] : "";
}

/**
 * Obfuscates a full name for display: "Jennifer Smith" → "Jennifer S."
 */
function obfuscateName(name: string): string {
  if (!name) return "Unknown";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}
