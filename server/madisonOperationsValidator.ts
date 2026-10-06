import { createHash } from "node:crypto";
import type { MadisonActionReadiness } from "@shared/madisonOperations";

export type MadisonReadinessInput = {
  missingParameters?: string[];
  targetResolutionStatus: "RESOLVED" | "PARTIAL" | "UNRESOLVED";
  policyReviewRequired?: boolean;
  currentStateConflicts?: boolean;
};

export type MadisonReadinessResult = {
  readiness: MadisonActionReadiness;
  missingParameters: string[];
};

/**
 * Determines proposal readiness from resolved facts only.
 * It does not inspect message text and performs no persistence or side effects.
 */
export function validateMadisonReadiness(input: MadisonReadinessInput): MadisonReadinessResult {
  const missingParameters = [...new Set(input.missingParameters ?? [])].sort();

  if (input.currentStateConflicts) {
    return { readiness: "CONFLICTING_STATE", missingParameters };
  }

  if (input.targetResolutionStatus !== "RESOLVED") {
    return { readiness: "TARGET_UNRESOLVED", missingParameters };
  }

  if (input.policyReviewRequired) {
    return { readiness: "POLICY_REVIEW_REQUIRED", missingParameters };
  }

  if (missingParameters.length > 0) {
    return { readiness: "MISSING_PARAMETERS", missingParameters };
  }

  return { readiness: "READY_FOR_HUMAN_REVIEW", missingParameters: [] };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

export type MadisonActionFingerprintInput = {
  customerId: string | null;
  bookingId: string | null;
  occurrenceKey: string | null;
  actionType: string;
  operation: string | null;
  parameters: Record<string, unknown>;
  sourceMessageId: string;
};

/**
 * Produces a stable SHA-256 fingerprint for proposal-level idempotency.
 * Object-key order is normalized; array order is intentionally preserved.
 */
export function createMadisonActionFingerprint(input: MadisonActionFingerprintInput): string {
  const canonicalInput = canonicalize(input);
  return createHash("sha256").update(JSON.stringify(canonicalInput)).digest("hex");
}
