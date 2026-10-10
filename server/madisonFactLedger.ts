export type MadisonFactStatus = "current" | "superseded" | "disputed" | "unverified";
export type MadisonFactSourceType = "customer_message" | "leadflow_context" | "employee" | "external_system";
export type MadisonFactValidationStatus = "unverified" | "validated" | "rejected";

export type MadisonFactEvent = {
  factKey: string;
  value: string;
  sourceType: MadisonFactSourceType;
  sourceMessageId?: string;
  sourceRecordId?: string;
  status?: MadisonFactStatus;
  validationStatus?: MadisonFactValidationStatus;
  evidenceExcerpt?: string;
  normalizationContext?: Record<string, unknown> | null;
  confidence?: number;
  observedAt: string;
  validUntil?: string;
  supersedesFactId?: string;
  eventId: string;
};

export type MadisonCurrentFact = MadisonFactEvent & {
  status: MadisonFactStatus;
};

export type MadisonFactProjection = {
  current: MadisonCurrentFact[];
  superseded: MadisonCurrentFact[];
  disputed: MadisonCurrentFact[];
  unverified: MadisonCurrentFact[];
  conflicts: string[];
};

function finiteConfidence(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function sameFactValue(left: MadisonFactEvent, right: MadisonFactEvent): boolean {
  return left.value.trim().toLowerCase() === right.value.trim().toLowerCase();
}

/**
 * Projects append-only fact evidence into the latest usable state.
 * The input remains immutable: superseded evidence is retained for audit.
 */
export function projectMadisonFacts(
  events: readonly MadisonFactEvent[],
  now = new Date(),
): MadisonFactProjection {
  const ordered = [...events].sort((left, right) => {
    const timeDelta = new Date(left.observedAt).getTime() - new Date(right.observedAt).getTime();
    return timeDelta || left.eventId.localeCompare(right.eventId);
  });
  const latestByKey = new Map<string, MadisonFactEvent>();
  const supersededIds = new Set<string>();
  const conflicts = new Set<string>();

  for (const event of ordered) {
    if (!event.factKey.trim() || !event.value.trim()) continue;
    if (event.supersedesFactId) supersededIds.add(event.supersedesFactId);
    const previous = latestByKey.get(event.factKey);
    if (previous && !sameFactValue(previous, event) && !event.supersedesFactId) {
      conflicts.add(event.factKey);
    }
    latestByKey.set(event.factKey, event);
  }

  const projected = ordered.map((event): MadisonCurrentFact => {
    const latest = latestByKey.get(event.factKey);
    const expired = event.validUntil ? new Date(event.validUntil).getTime() <= now.getTime() : false;
    const explicitlySuperseded = supersededIds.has(event.eventId);
    const isLatest = latest?.eventId === event.eventId;
    let status: MadisonFactStatus = event.status ?? "current";
    if (explicitlySuperseded || (isLatest && expired)) status = "superseded";
    else if (conflicts.has(event.factKey) && isLatest) status = "disputed";
    else if (isLatest && event.sourceType === "external_system") status = "current";
    else if (isLatest && event.sourceType === "leadflow_context") status = "current";
    else if (isLatest && finiteConfidence(event.confidence) >= 0.8) status = "current";
    return { ...event, status };
  });

  return {
    current: projected.filter((fact) => fact.status === "current"),
    superseded: projected.filter((fact) => fact.status === "superseded"),
    disputed: projected.filter((fact) => fact.status === "disputed"),
    unverified: projected.filter((fact) => fact.status === "unverified"),
    conflicts: [...conflicts].sort(),
  };
}

export type MadisonReplayOperation = "none" | "reschedule_booking" | "cancel_booking";

export type MadisonReplayInput = {
  events: readonly MadisonFactEvent[];
  operation: MadisonReplayOperation;
  requiredOperationFacts?: readonly string[];
  bookingTargetResolved: boolean;
  currentStateVerified: boolean;
  availabilityVerified: boolean;
  now?: Date;
};

export type MadisonReplayResult = {
  facts: MadisonFactProjection;
  reply: {
    outcome: "ready_for_human_approval" | "clarification_required" | "blocked_conflicting_facts";
    reasonCodes: string[];
  };
  operation: {
    outcome:
      | "not_requested"
      | "ready_for_human_approval"
      | "clarification_required"
      | "blocked_conflicting_facts"
      | "blocked_unresolved_target"
      | "blocked_current_state"
      | "blocked_availability";
    missingFacts: string[];
    reasonCodes: string[];
  };
};

/**
 * Replays a conversation fact state without sending, mutating, or querying data.
 * Reply safety and booking execution readiness are intentionally independent.
 */
export function replayMadisonDecision(input: MadisonReplayInput): MadisonReplayResult {
  const facts = projectMadisonFacts(input.events, input.now);
  const requiredFacts = [...new Set(input.requiredOperationFacts ?? [])];
  const currentKeys = new Set(facts.current.map((fact) => fact.factKey));
  const missingFacts = requiredFacts.filter((factKey) => !currentKeys.has(factKey));
  const replyReasonCodes: string[] = [];
  const operationReasonCodes: string[] = [];

  if (facts.conflicts.length > 0) replyReasonCodes.push("conflicting_conversation_facts");
  if (missingFacts.length > 0) replyReasonCodes.push("reply_requests_missing_facts");
  const replyOutcome = facts.conflicts.length > 0
    ? "blocked_conflicting_facts"
    : missingFacts.length > 0
      ? "clarification_required"
      : "ready_for_human_approval";

  if (input.operation === "none") {
    return {
      facts,
      reply: { outcome: replyOutcome, reasonCodes: replyReasonCodes },
      operation: { outcome: "not_requested", missingFacts, reasonCodes: [] },
    };
  }
  if (facts.conflicts.length > 0) operationReasonCodes.push("conflicting_conversation_facts");
  if (missingFacts.length > 0) operationReasonCodes.push("required_operation_facts_missing");
  if (!input.bookingTargetResolved) operationReasonCodes.push("booking_target_unresolved");
  if (!input.currentStateVerified) operationReasonCodes.push("current_state_not_verified");
  if (input.operation === "reschedule_booking" && !input.availabilityVerified) operationReasonCodes.push("availability_not_verified");

  let operationOutcome: MadisonReplayResult["operation"]["outcome"] = "ready_for_human_approval";
  if (facts.conflicts.length > 0) operationOutcome = "blocked_conflicting_facts";
  else if (!input.bookingTargetResolved) operationOutcome = "blocked_unresolved_target";
  else if (missingFacts.length > 0) operationOutcome = "clarification_required";
  else if (!input.currentStateVerified) operationOutcome = "blocked_current_state";
  else if (input.operation === "reschedule_booking" && !input.availabilityVerified) operationOutcome = "blocked_availability";

  return {
    facts,
    reply: { outcome: replyOutcome, reasonCodes: replyReasonCodes },
    operation: { outcome: operationOutcome, missingFacts, reasonCodes: operationReasonCodes },
  };
}
