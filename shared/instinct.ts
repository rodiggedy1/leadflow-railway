import { z } from "zod";

/** Stage 1 contract. This module is client-safe: no DB, model transport or app imports.
 * References are lookup requests, never authorization. All readers receive a scope
 * derived by the server, and revalidate revisions before using stored evidence.
 */
export const INSTINCT_CONTRACT_VERSION = "instinct-stage1-v1" as const;
export const INSTINCT_SOURCE_KINDS = ["sms", "email", "human_call", "ai_call", "phone_unverified"] as const;
export const INSTINCT_SOURCE_STORES = ["conversation_sessions", "inbound_sms", "gmail_thread_meta", "madison_email_drafts", "openphone_call_recordings", "voice_calls", "call_log", "field_mgmt_calls", "confirmation_calls"] as const;
export const INSTINCT_ACTIONS = ["reschedule", "cancel", "book", "address", "service", "extras", "assignment", "payment", "arrival_window", "access_notes", "notes"] as const;
export const sourceKindSchema = z.enum(INSTINCT_SOURCE_KINDS);
export const sourceStoreSchema = z.enum(INSTINCT_SOURCE_STORES);
export const availabilitySchema = z.enum(["complete", "partial", "missing", "malformed"]);
export const outcomeSchema = z.enum(["checking", "no_action", "matches_current", "discrepancy", "review", "analysis_unavailable", "record_unavailable"]);
export const actionTypeSchema = z.enum(INSTINCT_ACTIONS);
export const occurrenceScopeSchema = z.enum(["visit", "subsequent", "series", "unspecified"]);
export const opaqueIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
/** No number coercion: BIGINT IDs must round-trip without IEEE-754 loss. */
export const bigintIdSchema = z.string().regex(/^[1-9]\d*$/);
export const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const revisionSchema = opaqueIdSchema;
export const utcTimestampSchema = z.string().datetime({ offset: false });
export const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
export const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const timeZoneSchema = z.string().min(1).refine(value => {
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
}, "Unknown time zone");
export const timeBasisSchema = z.enum(["provider", "history", "turn", "call_started", "stored_record", "received", "unknown"]);
const nullableText = z.string().nullable();
const countSchema = z.number().int().nonnegative().safe();
const phoneSchema = z.string().regex(/^\+1[2-9]\d{9}$/);
const emailSchema = z.string().email().refine(value => value === value.trim().toLowerCase(), "Email must be conservatively normalized");

export const authorizedScopeSchema = z.object({
  installationScope: opaqueIdSchema,
  sourceAccountKey: opaqueIdSchema,
  authorizationVersion: revisionSchema,
  actor: z.object({ staffId: bigintIdSchema, role: z.literal("admin") }).strict().readonly(),
}).strict().readonly();
export type AuthorizedScope = z.infer<typeof authorizedScopeSchema>;
export type SourceKind = z.infer<typeof sourceKindSchema>;
export type SourceStore = z.infer<typeof sourceStoreSchema>;
export type Availability = z.infer<typeof availabilitySchema>;
export type Outcome = z.infer<typeof outcomeSchema>;
export type ActionType = z.infer<typeof actionTypeSchema>;
export type TimeBasis = z.infer<typeof timeBasisSchema>;

export const evidenceRefSchema = z.object({
  store: sourceStoreSchema,
  sourceKind: sourceKindSchema,
  sourceId: opaqueIdSchema,
  providerId: opaqueIdSchema.nullable(),
  sourceRevision: revisionSchema,
  contextFingerprint: fingerprintSchema,
  sourceAccountKey: opaqueIdSchema,
  sessionId: bigintIdSchema.nullable(),
  threadId: opaqueIdSchema.nullable(),
  occurredAtUtc: utcTimestampSchema.nullable(),
  observedAtUtc: utcTimestampSchema,
  timeBasis: timeBasisSchema,
  handlingEvidence: nullableText,
}).strict().superRefine((ref, ctx) => {
  const allowed: Record<SourceStore, readonly SourceKind[]> = {
    conversation_sessions: ["sms"], inbound_sms: ["sms"],
    gmail_thread_meta: ["email"], madison_email_drafts: ["email"],
    openphone_call_recordings: ["human_call", "phone_unverified"],
    voice_calls: ["ai_call"], call_log: ["ai_call"], field_mgmt_calls: ["ai_call"], confirmation_calls: ["ai_call"],
  };
  if (!allowed[ref.store].includes(ref.sourceKind)) ctx.addIssue({ code: "custom", path: ["sourceKind"], message: "Source kind does not match its allowed store" });
  if (ref.sourceKind === "human_call" && !ref.handlingEvidence?.trim()) ctx.addIssue({ code: "custom", path: ["handlingEvidence"], message: "Human handling requires verified evidence" });
  if (ref.occurredAtUtc !== null && ["unknown", "stored_record", "received"].includes(ref.timeBasis)) ctx.addIssue({ code: "custom", path: ["occurredAtUtc"], message: "Observation time is not original occurrence time" });
  if (ref.timeBasis !== "unknown" && ref.occurredAtUtc === null && !["stored_record", "received"].includes(ref.timeBasis)) ctx.addIssue({ code: "custom", path: ["timeBasis"], message: "An occurrence basis requires the original occurrence" });
}).readonly();
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

export const participantsSchema = z.object({
  from: nullableText, to: z.array(z.string()), cc: z.array(z.string()), replyTo: nullableText,
  businessLine: nullableText, mailbox: nullableText,
}).strict();
/** Offsets throughout this contract are half-open JS UTF-16 code-unit offsets
 * into originalText, not sanitized display text, translations or model output. */
export const originalTurnSchema = z.object({
  turnId: opaqueIdSchema, speaker: nullableText,
  role: z.enum(["customer", "staff", "assistant", "unknown"]),
  text: z.string(), start: countSchema, end: countSchema,
  occurredAtUtc: utcTimestampSchema.nullable(), timeBasis: timeBasisSchema,
}).strict().superRefine((turn, ctx) => {
  if (turn.end < turn.start || turn.end - turn.start !== turn.text.length) ctx.addIssue({ code: "custom", message: "Invalid original turn offsets" });
  if (turn.occurredAtUtc !== null && ["stored_record", "received", "unknown"].includes(turn.timeBasis)) ctx.addIssue({ code: "custom", message: "A stored observation is not a turn occurrence" });
});
export type OriginalTurn = z.infer<typeof originalTurnSchema>;
export const storedEvidenceSchema = z.object({
  ref: evidenceRefSchema,
  originalText: nullableText, originalTurns: z.array(originalTurnSchema),
  translatedText: nullableText,
  participants: participantsSchema,
  direction: z.enum(["inbound", "outbound", "mixed", "unknown"]),
  contentBasis: z.enum(["original_full", "stored_snapshot", "snippet", "summary", "translation_only", "missing"]),
  availability: availabilitySchema, limitations: z.array(z.string()),
}).strict().superRefine((evidence, ctx) => {
  if (evidence.availability === "complete" && (evidence.originalText === null || evidence.contentBasis !== "original_full" || evidence.limitations.length !== 0)) ctx.addIssue({ code: "custom", message: "Complete evidence requires an original full body without capture gaps" });
  if (evidence.availability === "complete" && evidence.ref.sourceKind === "email" && (!evidence.ref.providerId || !evidence.ref.threadId || !evidence.participants.mailbox || !evidence.participants.from || !evidence.participants.to.length || !evidence.ref.occurredAtUtc)) ctx.addIssue({ code: "custom", message: "Complete email requires exact message, mailbox, original participants and date provenance" });
  const ids = new Set<string>();
  let priorEnd = 0;
  for (const turn of evidence.originalTurns) {
    if (ids.has(turn.turnId) || turn.start < priorEnd || evidence.originalText === null || evidence.originalText.slice(turn.start, turn.end) !== turn.text) ctx.addIssue({ code: "custom", path: ["originalTurns"], message: "Turns must match complete original offsets in order" });
    ids.add(turn.turnId); priorEnd = turn.end;
  }
});
export type StoredEvidence = z.infer<typeof storedEvidenceSchema>;

export const citationSchema = z.object({
  ref: evidenceRefSchema, start: countSchema, end: countSchema, exactQuote: z.string().min(1),
}).strict().superRefine((citation, ctx) => {
  if (citation.end <= citation.start || citation.end - citation.start !== citation.exactQuote.length) ctx.addIssue({ code: "custom", message: "Citation range must exactly fit its quote" });
});
export type Citation = z.infer<typeof citationSchema>;
/** Deliberately pure. Zod shape validation alone never authenticates a reference. */
export function sameEvidenceRef(left: EvidenceRef, right: EvidenceRef): boolean {
  return left.store === right.store && left.sourceKind === right.sourceKind && left.sourceId === right.sourceId
    && left.providerId === right.providerId && left.sourceRevision === right.sourceRevision
    && left.contextFingerprint === right.contextFingerprint && left.sourceAccountKey === right.sourceAccountKey
    && left.sessionId === right.sessionId && left.threadId === right.threadId
    && left.occurredAtUtc === right.occurredAtUtc && left.observedAtUtc === right.observedAtUtc
    && left.timeBasis === right.timeBasis && left.handlingEvidence === right.handlingEvidence;
}
export function validateEvidenceRef(ref: unknown, scope: AuthorizedScope, originals: readonly StoredEvidence[]): EvidenceRef {
  const parsed = evidenceRefSchema.parse(ref);
  if (parsed.sourceAccountKey !== scope.sourceAccountKey || !originals.some(item => sameEvidenceRef(item.ref, parsed))) throw new Error("INVALID_SOURCE_REFERENCE");
  return parsed;
}
export function validateCitation(value: unknown, scope: AuthorizedScope, originals: readonly StoredEvidence[]): Citation {
  const citation = citationSchema.parse(value);
  validateEvidenceRef(citation.ref, scope, originals);
  const evidence = originals.find(item => sameEvidenceRef(item.ref, citation.ref));
  if (!evidence || evidence.originalText === null || citation.end > evidence.originalText.length || evidence.originalText.slice(citation.start, citation.end) !== citation.exactQuote) throw new Error("INVALID_CITATION");
  return citation;
}

export const contextManifestEntrySchema = z.object({
  ref: evidenceRefSchema, ordinal: countSchema, originalTextLength: countSchema.nullable(), turnCount: countSchema,
  availability: availabilitySchema,
}).strict();
export const contextManifestSchema = z.object({
  contextId: opaqueIdSchema, revision: revisionSchema, contextFingerprint: fingerprintSchema,
  sourceAccountKey: opaqueIdSchema, entries: z.array(contextManifestEntrySchema),
  complete: z.boolean(), continuation: opaqueIdSchema.nullable(),
  capturedAtUtc: utcTimestampSchema, limitations: z.array(z.string()),
}).strict().superRefine((manifest, ctx) => {
  if (manifest.complete && (manifest.continuation !== null || manifest.limitations.length || manifest.entries.some(entry => entry.availability !== "complete"))) ctx.addIssue({ code: "custom", message: "Incomplete manifest cannot claim complete context" });
  const refs = new Set<string>();
  manifest.entries.forEach((entry, index) => {
    const key = `${entry.ref.store}:${entry.ref.sourceId}`;
    if (entry.ordinal !== index || refs.has(key) || entry.ref.sourceAccountKey !== manifest.sourceAccountKey || entry.ref.contextFingerprint !== manifest.contextFingerprint) ctx.addIssue({ code: "custom", path: ["entries", index], message: "Manifest order, uniqueness, scope or fingerprint conflict" });
    refs.add(key);
  });
});
export type ContextManifest = z.infer<typeof contextManifestSchema>;
export const sourceContextSchema = z.object({ manifest: contextManifestSchema, evidence: z.array(storedEvidenceSchema) }).strict().superRefine((context, ctx) => {
  if (context.manifest.entries.length !== context.evidence.length) ctx.addIssue({ code: "custom", message: "Every manifest entry must be accounted for" });
  context.manifest.entries.forEach((entry, index) => {
    const evidence = context.evidence[index];
    if (!evidence || !sameEvidenceRef(entry.ref, evidence.ref) || entry.originalTextLength !== (evidence.originalText?.length ?? null) || entry.turnCount !== evidence.originalTurns.length || entry.availability !== evidence.availability) ctx.addIssue({ code: "custom", path: ["evidence", index], message: "Context differs from its exact manifest" });
  });
});
export type SourceContext = z.infer<typeof sourceContextSchema>;
export const sourceBoundarySchema = z.object({
  store: sourceStoreSchema, throughId: bigintIdSchema.nullable(), observedAtUtc: utcTimestampSchema,
  availability: availabilitySchema, limitations: z.array(z.string()),
}).strict();
export const inventoryBoundarySchema = z.object({
  inventoryId: opaqueIdSchema, sourceAccountKey: opaqueIdSchema, authorizationVersion: revisionSchema,
  sourceKinds: z.array(sourceKindSchema), families: z.array(sourceBoundarySchema), capturedAtUtc: utcTimestampSchema,
}).strict();
export type InventoryBoundary = z.infer<typeof inventoryBoundarySchema>;
/** Server-owned continuation binding. Cursor serialization/verification belongs to
 * the adapter; an opaque client token must not be trusted as expanded scope. */
export const sourceContinuationSchema = z.object({
  inventoryId: opaqueIdSchema, sourceAccountKey: opaqueIdSchema, authorizationVersion: revisionSchema,
  boundary: inventoryBoundarySchema,
  positions: z.array(z.object({ store: sourceStoreSchema, afterId: bigintIdSchema.nullable(), historyOffset: countSchema }).strict()),
  phase: z.enum(["inventory", "reconciliation"]),
}).strict().superRefine((cursor, ctx) => {
  if (cursor.inventoryId !== cursor.boundary.inventoryId || cursor.sourceAccountKey !== cursor.boundary.sourceAccountKey || cursor.authorizationVersion !== cursor.boundary.authorizationVersion) ctx.addIssue({ code: "custom", message: "Continuation binding conflict" });
});
export type SourceContinuation = z.infer<typeof sourceContinuationSchema>;

export const coverageReceiptSchema = z.object({
  receiptId: opaqueIdSchema, authorizedScope: opaqueIdSchema, sourceAccountKey: opaqueIdSchema,
  sourceKinds: z.array(sourceKindSchema), boundaries: z.array(sourceBoundarySchema),
  continuation: opaqueIdSchema.nullable(),
  read: countSchema, analyzed: countSchema, unprocessed: countSchema, unavailable: countSchema,
  partial: z.boolean(), exclusions: z.array(z.string()), checkedAtUtc: utcTimestampSchema,
}).strict().superRefine((coverage, ctx) => {
  if (coverage.analyzed + coverage.unprocessed + coverage.unavailable !== coverage.read) ctx.addIssue({ code: "custom", message: "Coverage counts must partition observed input" });
  if (!coverage.partial && (coverage.continuation !== null || coverage.unprocessed !== 0 || coverage.unavailable !== 0 || coverage.boundaries.some(boundary => boundary.availability !== "complete"))) ctx.addIssue({ code: "custom", message: "Pending, unavailable or untraversed coverage cannot be complete" });
});
export type CoverageReceipt = z.infer<typeof coverageReceiptSchema>;
export function hasCompleteAnalyzedCoverage(coverage: CoverageReceipt): boolean {
  return coverageReceiptSchema.safeParse(coverage).success && !coverage.partial && coverage.continuation === null
    && coverage.unprocessed === 0 && coverage.unavailable === 0 && coverage.read > 0 && coverage.analyzed === coverage.read;
}

export const verifiedIdentitySchema = z.object({
  installationScope: opaqueIdSchema, sourceAccountKey: opaqueIdSchema,
  phone: phoneSchema.nullable(), email: emailSchema.nullable(), sessionIds: z.array(bigintIdSchema),
  customerPortalAccountId: bigintIdSchema.nullable(),
  decision: z.enum(["verified", "ambiguous", "unavailable"]), reasons: z.array(z.string()),
  evidenceRefs: z.array(evidenceRefSchema), fingerprint: fingerprintSchema.nullable(), displayName: nullableText,
}).strict().superRefine((identity, ctx) => {
  if (identity.evidenceRefs.some(ref => ref.sourceAccountKey !== identity.sourceAccountKey)) ctx.addIssue({ code: "custom", message: "Identity evidence crosses source accounts" });
  if (identity.decision === "verified" && ((!identity.phone && !identity.email) || !identity.evidenceRefs.length || !identity.fingerprint || identity.reasons.length)) ctx.addIssue({ code: "custom", message: "Verified identity requires corroborated contacts and original evidence" });
  if (identity.decision !== "verified" && !identity.reasons.length) ctx.addIssue({ code: "custom", message: "Uncertain identity must explain its limitations" });
});
export type VerifiedIdentity = z.infer<typeof verifiedIdentitySchema>;
export function validateIdentityScope(value: unknown, scope: AuthorizedScope, originals: readonly StoredEvidence[]): VerifiedIdentity {
  const identity = verifiedIdentitySchema.parse(value);
  if (identity.installationScope !== scope.installationScope || identity.sourceAccountKey !== scope.sourceAccountKey) throw new Error("INVALID_IDENTITY_SCOPE");
  identity.evidenceRefs.forEach(ref => validateEvidenceRef(ref, scope, originals));
  return identity;
}

export const arrivalWindowSchema = z.object({ start: localTimeSchema, end: localTimeSchema }).strict().refine(window => window.end > window.start, "Arrival window must have a later end");
export const targetOccurrenceSchema = z.object({
  bookingId: bigintIdSchema.nullable(), jobId: bigintIdSchema.nullable(), launch27BookingId: bigintIdSchema.nullable(),
  bookingSeriesId: bigintIdSchema.nullable(), publicBookingNumber: nullableText,
  scope: occurrenceScopeSchema, localDate: localDateSchema.nullable(), localTime: localTimeSchema.nullable(),
  arrivalWindow: arrivalWindowSchema.nullable(), timeZone: timeZoneSchema.nullable(), occurredAtUtc: utcTimestampSchema.nullable(),
}).strict().superRefine((target, ctx) => {
  if (target.localTime !== null && target.arrivalWindow !== null) ctx.addIssue({ code: "custom", message: "An arrival window is not an exact appointment time" });
});
export type TargetOccurrence = z.infer<typeof targetOccurrenceSchema>;
export const nativeRecordSchema = z.object({
  key: z.string().regex(/^(booking|leadflow:job|series):[1-9]\d*$/),
  source: z.enum(["bookings", "leadflow_jobs", "booking_series"]),
  bookingId: bigintIdSchema.nullable(), jobId: bigintIdSchema.nullable(), launch27BookingId: bigintIdSchema.nullable(), bookingSeriesId: bigintIdSchema.nullable(),
  publicBookingNumber: nullableText,
  customerPhone: phoneSchema.nullable(), customerEmail: emailSchema.nullable(), customerName: nullableText,
  localDate: localDateSchema.nullable(), localTime: localTimeSchema.nullable(), timeZone: timeZoneSchema.nullable(),
  arrivalWindow: arrivalWindowSchema.nullable(), requestedStartAt: z.string().regex(/^\d+$/).nullable(), serviceDateTime: nullableText,
  status: nullableText, address: nullableText, serviceId: nullableText, serviceName: nullableText,
  extras: z.array(z.object({ id: z.string().min(1), label: z.string(), quantity: z.number().nonnegative().finite().nullable() }).strict()).nullable(),
  recurrence: nullableText, teamName: nullableText,
  companyNotes: nullableText, specialRequestNotes: z.array(z.string()).nullable(), customerNotes: nullableText, cleanerFacingNotes: nullableText,
  notesBasis: z.enum(["canonical_composition", "operational_customer_notes", "unavailable"]),
  availability: availabilitySchema, limitations: z.array(z.string()),
  fingerprint: fingerprintSchema, observedAtUtc: utcTimestampSchema, updatedAtUtc: utcTimestampSchema.nullable(),
}).strict().superRefine((record, ctx) => {
  const id = record.source === "bookings" ? record.bookingId : record.source === "leadflow_jobs" ? record.jobId : record.bookingSeriesId;
  const prefix = record.source === "bookings" ? "booking" : record.source === "leadflow_jobs" ? "leadflow:job" : "series";
  if (!id || record.key !== `${prefix}:${id}`) ctx.addIssue({ code: "custom", message: "Native key must name the exact authoritative row" });
  if (record.source === "bookings" && (!record.publicBookingNumber || record.jobId !== null)) ctx.addIssue({ code: "custom", message: "Canonical booking ID and public number are distinct from operational jobs" });
  if (record.source === "booking_series" && !record.bookingId) ctx.addIssue({ code: "custom", message: "Series requires its actual canonical booking link" });
  if (record.localTime !== null && record.arrivalWindow !== null) ctx.addIssue({ code: "custom", message: "A current arrival window is not an exact appointment" });
  if (record.availability === "complete" && record.limitations.length) ctx.addIssue({ code: "custom", message: "Incomplete record cannot be complete" });
});
export type NativeRecord = z.infer<typeof nativeRecordSchema>;
export const nativeSnapshotSchema = z.object({
  snapshotId: opaqueIdSchema, sourceAccountKey: opaqueIdSchema, records: z.array(nativeRecordSchema),
  fingerprint: fingerprintSchema, checkedAtUtc: utcTimestampSchema, availability: availabilitySchema,
  continuation: opaqueIdSchema.nullable(), limitations: z.array(z.string()),
}).strict().superRefine((snapshot, ctx) => {
  if (snapshot.availability === "complete" && (snapshot.continuation !== null || snapshot.limitations.length || snapshot.records.some(record => record.availability !== "complete"))) ctx.addIssue({ code: "custom", message: "Incomplete native snapshot cannot prove current state" });
});
export type NativeSnapshot = z.infer<typeof nativeSnapshotSchema>;
export const occurrenceResolutionSchema = z.object({
  decision: z.enum(["verified", "ambiguous", "unavailable"]), target: targetOccurrenceSchema,
  eligibleRecordKeys: z.array(z.string().regex(/^(booking|leadflow:job|series):[1-9]\d*$/)), reasons: z.array(z.string()),
  snapshot: nativeSnapshotSchema,
}).strict().superRefine((resolution, ctx) => {
  if (resolution.decision === "verified" && (!resolution.eligibleRecordKeys.length || resolution.target.scope === "unspecified" || resolution.snapshot.availability !== "complete" || resolution.reasons.length)) ctx.addIssue({ code: "custom", message: "Verified occurrence requires complete exact native proof" });
  if (resolution.eligibleRecordKeys.some(key => !resolution.snapshot.records.some(record => record.key === key))) ctx.addIssue({ code: "custom", message: "Occurrence key is absent from the native snapshot" });
  if (resolution.decision === "verified" && ["series", "subsequent"].includes(resolution.target.scope) && !resolution.target.bookingSeriesId) ctx.addIssue({ code: "custom", message: "Verified recurring scope requires the actual series link" });
});
export type OccurrenceResolution = z.infer<typeof occurrenceResolutionSchema>;

export const expectationSchema = z.object({
  bookingReference: nullableText, date: localDateSchema.nullable(), originalDate: localDateSchema.nullable(),
  time: localTimeSchema.nullable(), timeKind: z.enum(["exact", "window", "unspecified"]), windowEnd: localTimeSchema.nullable(),
  timeZone: timeZoneSchema.nullable(), scope: occurrenceScopeSchema,
  address: nullableText, serviceName: nullableText, extras: z.array(z.string()).nullable(),
  extrasMode: z.enum(["add", "remove", "replace", "unspecified"]), teamName: nullableText, amountCents: countSchema.nullable(),
  notes: nullableText, notesDestination: z.enum(["cleaner_instructions", "company_notes", "special_request_notes", "customer_notes", "unspecified"]),
}).strict().superRefine((expected, ctx) => {
  if (expected.timeKind === "exact" && (!expected.time || expected.windowEnd !== null)) ctx.addIssue({ code: "custom", message: "Exact time requires one stated time" });
  if (expected.timeKind === "window" && (!expected.time || !expected.windowEnd || expected.windowEnd <= expected.time)) ctx.addIssue({ code: "custom", message: "Requested window requires both ordered endpoints" });
  if (expected.timeKind === "unspecified" && (expected.time !== null || expected.windowEnd !== null)) ctx.addIssue({ code: "custom", message: "Unspecified time cannot contain invented endpoints" });
});
export type Expectation = z.infer<typeof expectationSchema>;
/** Model citations use the server's indexed originals, not model-generated IDs,
 * identities, record keys, SQL or purported verification outcomes. */
export const modelCitationSchema = z.object({ evidenceIndex: countSchema, start: countSchema, end: countSchema, exactQuote: z.string().min(1) }).strict().superRefine((citation, ctx) => {
  if (citation.end <= citation.start || citation.end - citation.start !== citation.exactQuote.length) ctx.addIssue({ code: "custom", message: "Invalid model quote offsets" });
});
export const modelActionSchema = z.object({
  action: actionTypeSchema, agreement: z.enum(["requested", "confirmed", "declined", "unclear"]),
  anchorEvidenceIndex: countSchema, citations: z.array(modelCitationSchema).min(1),
  expected: expectationSchema, explanation: z.string().min(1), confidence: z.number().min(0).max(1),
  ambiguous: z.boolean(), missingParameters: z.array(z.string()), supersededByEvidenceIndex: countSchema.nullable(),
}).strict();
export const analysisOutputSchema = z.object({ actions: z.array(modelActionSchema) }).strict();
export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;
export type ModelAction = z.infer<typeof modelActionSchema>;
export const analysisRequestSchema = z.object({
  context: sourceContextSchema, localDate: localDateSchema.nullable(), timeZone: timeZoneSchema,
  contractVersion: z.literal(INSTINCT_CONTRACT_VERSION), promptVersion: revisionSchema,
  segmentationVersion: revisionSchema, reductionVersion: revisionSchema,
}).strict();
export type AnalysisRequest = z.infer<typeof analysisRequestSchema>;
/** Structured transport schema generated from this exact strict Zod contract.
 * Semantic quote/index and scope checks still run after shape validation. */
export const analysisOutputJsonSchema = z.toJSONSchema(analysisOutputSchema);
export function validateAnalysisOutput(value: unknown, requestValue: AnalysisRequest, scope: AuthorizedScope): AnalysisOutput {
  const request = analysisRequestSchema.parse(requestValue);
  const originals = request.context.evidence;
  if (request.context.manifest.sourceAccountKey !== scope.sourceAccountKey) throw new Error("INVALID_SOURCE_REFERENCE");
  originals.forEach(item => validateEvidenceRef(item.ref, scope, originals));
  const output = analysisOutputSchema.parse(value);
  for (const action of output.actions) {
    if (!originals[action.anchorEvidenceIndex] || !action.citations.some(citation => citation.evidenceIndex === action.anchorEvidenceIndex)
      || (action.supersededByEvidenceIndex !== null && !originals[action.supersededByEvidenceIndex])) throw new Error("INVALID_SOURCE_REFERENCE");
    for (const citation of action.citations) {
      const original = originals[citation.evidenceIndex];
      if (!original) throw new Error("INVALID_SOURCE_REFERENCE");
      validateCitation({ ref: original.ref, start: citation.start, end: citation.end, exactQuote: citation.exactQuote }, scope, originals);
    }
  }
  return output;
}
export const extractionActionSchema = z.object({
  id: opaqueIdSchema, revision: revisionSchema, contextId: opaqueIdSchema,
  action: actionTypeSchema, agreement: z.enum(["requested", "confirmed", "declined", "unclear"]),
  anchorRef: evidenceRefSchema, citations: z.array(citationSchema).min(1), expected: expectationSchema,
  explanation: z.string().min(1), confidence: z.number().min(0).max(1), ambiguous: z.boolean(),
  missingParameters: z.array(z.string()), supersededByRef: evidenceRefSchema.nullable(),
}).strict();
export type ExtractionAction = z.infer<typeof extractionActionSchema>;
export const analysisFailureSchema = z.enum(["MODEL_UNAVAILABLE", "MODEL_TIMEOUT", "MODEL_CONTEXT_CONSTRAINT", "INVALID_MODEL_RESPONSE", "INVALID_SOURCE_REFERENCE", "INVALID_CITATION", "PARTIAL_CONTEXT"]);
export type AnalysisFailure = z.infer<typeof analysisFailureSchema>;
export const analysisReceiptSchema = z.object({
  status: z.enum(["pending", "complete", "partial", "unavailable"]), contextRevision: revisionSchema,
  contextFingerprint: fingerprintSchema, actions: z.array(extractionActionSchema),
  totalSegments: countSchema, completedSegments: countSchema, reductionComplete: z.boolean(),
  failure: analysisFailureSchema.nullable(), limitations: z.array(z.string()),
}).strict().superRefine((receipt, ctx) => {
  if (receipt.completedSegments > receipt.totalSegments) ctx.addIssue({ code: "custom", message: "Completed segments exceed the full manifest" });
  if (receipt.status === "complete" && (!receipt.totalSegments || receipt.completedSegments !== receipt.totalSegments || !receipt.reductionComplete || receipt.failure !== null || receipt.limitations.length)) ctx.addIssue({ code: "custom", message: "Every segment and reduction must succeed for complete analysis" });
  if (receipt.status === "unavailable" && receipt.failure === null) ctx.addIssue({ code: "custom", message: "Unavailable analysis requires an honest failure class" });
});
export type AnalysisReceipt = z.infer<typeof analysisReceiptSchema>;

export const fulfillmentSchema = z.enum(["verified_current", "not_verified", "failed", "unknown"]);
export const notificationSchema = z.enum(["not_required", "not_sent", "prepared", "sent", "recorded_phone_notice", "failed", "unknown"]);
export const deliverySchema = z.enum(["provider_confirmed", "failed", "unknown", "not_supported"]);
export const notificationObservationSchema = z.object({
  issueId: opaqueIdSchema, issueRevision: revisionSchema, requestRevision: revisionSchema,
  transitionId: opaqueIdSchema, channel: z.enum(["sms", "email", "phone"]),
  recipient: z.string().min(1), sendingIdentity: z.string().min(1), payloadFingerprint: fingerprintSchema,
  providerMessageId: opaqueIdSchema.nullable(), observedAtUtc: utcTimestampSchema,
  notification: notificationSchema, delivery: deliverySchema, citations: z.array(citationSchema),
  completeSendScope: z.boolean(), limitations: z.array(z.string()),
}).strict().superRefine((observation, ctx) => {
  if (observation.notification === "not_sent" && !observation.completeSendScope) ctx.addIssue({ code: "custom", message: "Absent rows are not proof of a complete not-sent scope" });
  if (observation.delivery === "provider_confirmed" && (!observation.providerMessageId || observation.channel === "phone")) ctx.addIssue({ code: "custom", message: "Provider delivery requires an exactly associated message observation" });
  if (observation.notification === "recorded_phone_notice" && (observation.channel !== "phone" || !observation.citations.length)) ctx.addIssue({ code: "custom", message: "A phone notice requires exact transcript evidence" });
});
export type NotificationObservation = z.infer<typeof notificationObservationSchema>;
export const verificationResultSchema = z.object({
  outcome: z.enum(["matches_current", "discrepancy", "review", "record_unavailable"]),
  identity: verifiedIdentitySchema, target: targetOccurrenceSchema, snapshot: nativeSnapshotSchema.nullable(),
  explanation: z.string().min(1), limitations: z.array(z.string()), priorityReason: nullableText,
  recordFingerprint: fingerprintSchema.nullable(), checkedAtUtc: utcTimestampSchema,
  fulfillment: fulfillmentSchema, notification: notificationSchema, delivery: deliverySchema,
}).strict().superRefine((verification, ctx) => {
  if (["matches_current", "discrepancy"].includes(verification.outcome) && (verification.identity.decision !== "verified" || !verification.snapshot || verification.snapshot.availability !== "complete" || verification.target.scope === "unspecified" || verification.recordFingerprint !== verification.snapshot.fingerprint || verification.checkedAtUtc !== verification.snapshot.checkedAtUtc)) ctx.addIssue({ code: "custom", message: "Definitive comparison requires fresh, complete exact records" });
  if (verification.fulfillment === "verified_current" && verification.outcome !== "matches_current") ctx.addIssue({ code: "custom", message: "Only a current-state match establishes fulfillment" });
  if (verification.snapshot && verification.snapshot.sourceAccountKey !== verification.identity.sourceAccountKey) ctx.addIssue({ code: "custom", message: "Current records cannot cross authorized source accounts" });
  if (["matches_current", "discrepancy"].includes(verification.outcome)) {
    const target = verification.target;
    const exactKey = target.jobId ? `leadflow:job:${target.jobId}` : target.bookingId ? `booking:${target.bookingId}` : null;
    if (!exactKey || !verification.snapshot?.records.some(record => record.key === exactKey)) ctx.addIssue({ code: "custom", message: "Definitive comparison requires the exact authoritative target row" });
    if (["series", "subsequent"].includes(target.scope) && (!target.bookingSeriesId || !verification.snapshot?.records.some(record => record.key === `series:${target.bookingSeriesId}` && record.bookingId === target.bookingId))) ctx.addIssue({ code: "custom", message: "Recurring comparison requires its exact native series counterpart" });
  }
});
export type VerificationResult = z.infer<typeof verificationResultSchema>;
export const instinctIssueSchema = z.object({
  issueId: opaqueIdSchema, revision: revisionSchema, identity: verifiedIdentitySchema,
  action: actionTypeSchema.nullable(), expectation: expectationSchema.nullable(), target: targetOccurrenceSchema,
  citations: z.array(citationSchema), outcome: outcomeSchema, explanation: z.string(), priorityReason: nullableText,
  recordFingerprint: fingerprintSchema.nullable(), checkedAtUtc: utcTimestampSchema.nullable(),
  coverage: coverageReceiptSchema, analysis: analysisReceiptSchema,
  verification: verificationResultSchema.nullable(),
  fulfillment: fulfillmentSchema, notification: notificationSchema, delivery: deliverySchema,
  supersededBy: opaqueIdSchema.nullable(), transient: z.literal(true),
}).strict().superRefine((issue, ctx) => {
  if (issue.coverage.sourceAccountKey !== issue.identity.sourceAccountKey || issue.coverage.authorizedScope !== issue.identity.installationScope || issue.citations.some(citation => citation.ref.sourceAccountKey !== issue.identity.sourceAccountKey)) ctx.addIssue({ code: "custom", message: "Issue evidence and coverage cross authorized identity scope" });
  if (issue.outcome === "no_action" && (issue.analysis.status !== "complete" || issue.analysis.actions.length || !hasCompleteAnalyzedCoverage(issue.coverage) || issue.action !== null || issue.expectation !== null || issue.fulfillment === "verified_current")) ctx.addIssue({ code: "custom", message: "Pending, failed, incomplete or actionable input cannot be a complete negative finding" });
  if (["matches_current", "discrepancy"].includes(issue.outcome) && (!issue.verification || issue.verification.outcome !== issue.outcome || issue.recordFingerprint !== issue.verification.recordFingerprint || issue.checkedAtUtc !== issue.verification.checkedAtUtc || !issue.citations.length || !issue.action || !issue.expectation)) ctx.addIssue({ code: "custom", message: "Issue comparison must be backed by its exact fresh verification and request" });
  if (issue.outcome === "analysis_unavailable" && issue.analysis.status !== "unavailable") ctx.addIssue({ code: "custom", message: "Analysis unavailable is an actual failed interpretation, not a fabricated finding" });
  if (issue.fulfillment === "verified_current" && issue.outcome !== "matches_current") ctx.addIssue({ code: "custom", message: "Pending or unavailable issues cannot claim verified current fulfillment" });
});
export type InstinctIssue = z.infer<typeof instinctIssueSchema>;

export const STAGE1_CAPABILITIES = Object.freeze({
  mode: "process_local_transient" as const, transient: true as const,
  durableStoreAvailable: false as const, reviewedAvailable: false as const, ownershipAvailable: false as const,
  workerAvailable: false as const, correctionsAvailable: false as const,
});
export const stage1CapabilitiesSchema = z.object({
  mode: z.literal("process_local_transient"), transient: z.literal(true), durableStoreAvailable: z.literal(false),
  reviewedAvailable: z.literal(false), ownershipAvailable: z.literal(false), workerAvailable: z.literal(false), correctionsAvailable: z.literal(false),
}).strict().readonly();
export type Stage1Capabilities = z.infer<typeof stage1CapabilitiesSchema>;
export const issueGroupSchema = z.object({
  groupId: opaqueIdSchema, identity: verifiedIdentitySchema, issues: z.array(instinctIssueSchema),
  requestCount: countSchema, verifiedCustomer: z.boolean(),
}).strict().superRefine((group, ctx) => {
  if (group.requestCount !== group.issues.filter(issue => issue.action !== null && issue.supersededBy === null).length || new Set(group.issues.map(issue => issue.issueId)).size !== group.issues.length) ctx.addIssue({ code: "custom", message: "Request totals count unique current occurrences, not refreshes" });
  if (group.verifiedCustomer !== (group.identity.decision === "verified")) ctx.addIssue({ code: "custom", message: "Group cannot invent verified customer status" });
  if (!group.verifiedCustomer && group.issues.length > 1) ctx.addIssue({ code: "custom", message: "Unresolved provisional identities cannot merge customers" });
  if (group.issues.some(issue => issue.identity.sourceAccountKey !== group.identity.sourceAccountKey || issue.identity.installationScope !== group.identity.installationScope || (group.verifiedCustomer && issue.identity.fingerprint !== group.identity.fingerprint))) ctx.addIssue({ code: "custom", message: "Group contains a different identity scope" });
});
export type IssueGroup = z.infer<typeof issueGroupSchema>;
export const requestBindingSchema = z.object({
  requestId: opaqueIdSchema, contextRevision: revisionSchema.nullable(),
  selectedIssueId: opaqueIdSchema.nullable(), selectedIssueRevision: revisionSchema.nullable(),
}).strict().superRefine((binding, ctx) => {
  if ((binding.selectedIssueId === null) !== (binding.selectedIssueRevision === null)) ctx.addIssue({ code: "custom", message: "Selection requires both issue ID and exact revision" });
});
export type RequestBinding = z.infer<typeof requestBindingSchema>;
export function sameRequestBinding(left: RequestBinding, right: RequestBinding): boolean {
  return left.requestId === right.requestId && left.contextRevision === right.contextRevision
    && left.selectedIssueId === right.selectedIssueId && left.selectedIssueRevision === right.selectedIssueRevision;
}
/** Late responses must not replace a new question, customer or source revision. */
export function validateResponseBinding(value: unknown, expected: RequestBinding): RequestBinding {
  const binding = requestBindingSchema.parse(value);
  if (!sameRequestBinding(binding, requestBindingSchema.parse(expected))) throw new Error("STALE_RESPONSE");
  return binding;
}
export const apiFailureSchema = z.object({
  code: z.enum(["UNAUTHORIZED", "INVALID_SCOPE", "INVALID_SOURCE_REFERENCE", "INVALID_CITATION", "STALE_CONTEXT", "STALE_ISSUE", "SOURCE_UNAVAILABLE", "DB_UNAVAILABLE", "DB_SCHEMA", "DB_TIMEOUT", "DB_READ_FAILED", "MODEL_UNAVAILABLE", "MODEL_TIMEOUT", "INVALID_MODEL_RESPONSE", "DURABLE_STORE_UNAVAILABLE", "UNSUPPORTED_QUESTION"]), retryable: z.boolean(),
}).strict();
export type ApiFailure = z.infer<typeof apiFailureSchema>;
const envelopeShape = { binding: requestBindingSchema, coverage: coverageReceiptSchema, capabilities: stage1CapabilitiesSchema, limitations: z.array(z.string()) };
const dayShape = { localDay: localDateSchema.optional(), cursor: opaqueIdSchema.optional() };
export const sourcesInputSchema = z.object({ sourceKinds: z.array(sourceKindSchema).min(1), ...dayShape }).strict();
export const feedInputSchema = z.object({ filter: z.enum(["all", "urgent", "reviewed"]), ...dayShape }).strict();
export const checkInputSchema = z.object({ sourceRefs: z.array(evidenceRefSchema).min(1), expectedContextRevision: revisionSchema }).strict();
export const selectedIssueInputSchema = z.object({ issueId: opaqueIdSchema, issueRevision: revisionSchema }).strict();
export const evidenceInputSchema = selectedIssueInputSchema;
export const reverifyInputSchema = selectedIssueInputSchema;
export const dayReviewInputSchema = z.object({ localDate: localDateSchema, timeZone: z.literal("America/New_York"), sourceKinds: z.array(sourceKindSchema).min(1), cursor: opaqueIdSchema.optional() }).strict();
export const askInputSchema = z.object({
  threadId: opaqueIdSchema, requestId: opaqueIdSchema, selectedIssueId: opaqueIdSchema.optional(), selectedIssueRevision: revisionSchema.optional(), question: z.string().trim().min(1),
}).strict().superRefine((input, ctx) => {
  if ((input.selectedIssueId === undefined) !== (input.selectedIssueRevision === undefined)) ctx.addIssue({ code: "custom", message: "Question selection must include the exact revision" });
});
/** The complete available recent conversation work unit loaded on THIS page.
 * This is not a claim of complete historical/provider capture. Grouped sources
 * retain every original ref here even when inventory items are canonicalized. */
export const readySourceContextSchema = z.object({ contextFingerprint: fingerprintSchema, refs: z.array(evidenceRefSchema).min(1) }).strict();
export const sourceInventorySchema = z.object({ ...envelopeShape, items: z.array(storedEvidenceSchema), inventory: inventoryBoundarySchema, continuation: opaqueIdSchema.nullable(), readyContexts: z.array(readySourceContextSchema).optional() }).strict().superRefine((inventory, ctx) => {
  if (inventory.inventory.sourceAccountKey !== inventory.coverage.sourceAccountKey || inventory.continuation !== inventory.coverage.continuation
    || inventory.items.some(item => item.ref.sourceAccountKey !== inventory.inventory.sourceAccountKey)) ctx.addIssue({ code: "custom", message: "Inventory account and continuation must match its coverage" });
  const contexts = new Set<string>(); const refs = new Set<string>();
  inventory.readyContexts?.forEach((ready, index) => {
    if (contexts.has(ready.contextFingerprint) || !inventory.items.some(item => item.ref.contextFingerprint === ready.contextFingerprint)) ctx.addIssue({ code: "custom", path: ["readyContexts", index], message: "Ready context must uniquely name a conversation loaded on this page" });
    contexts.add(ready.contextFingerprint);
    ready.refs.forEach((ref, refIndex) => {
      const key = `${ref.store}:${ref.sourceId}`;
      if (refs.has(key) || ref.contextFingerprint !== ready.contextFingerprint || ref.sourceAccountKey !== inventory.inventory.sourceAccountKey
        || !inventory.inventory.families.some(family => family.store === ref.store)
        || (inventory.items.some(item => item.ref.store === ref.store && item.ref.sourceId === ref.sourceId) && !inventory.items.some(item => sameEvidenceRef(item.ref, ref)))) ctx.addIssue({ code: "custom", path: ["readyContexts", index, "refs", refIndex], message: "Ready refs must be unique, exact and scoped to their loaded context and source families" });
      refs.add(key);
    });
    if (inventory.items.some(item => item.ref.contextFingerprint === ready.contextFingerprint && !ready.refs.some(ref => sameEvidenceRef(item.ref, ref)))) ctx.addIssue({ code: "custom", path: ["readyContexts", index], message: "Ready context must include every loaded inventory original" });
  });
});
export const feedSchema = z.object({
  ...envelopeShape, groups: z.array(issueGroupSchema), continuation: opaqueIdSchema.nullable(),
  totals: z.object({ requests: countSchema, customerGroups: countSchema, verifiedCustomers: countSchema, outcomes: z.record(outcomeSchema, countSchema) }).strict(),
  reviewedUnavailable: z.literal(true),
}).strict().superRefine((feed, ctx) => {
  if (feed.totals.customerGroups !== feed.groups.length || feed.totals.requests !== feed.groups.reduce((total, group) => total + group.requestCount, 0) || feed.totals.verifiedCustomers !== feed.groups.filter(group => group.verifiedCustomer).length) ctx.addIssue({ code: "custom", message: "Feed totals must describe the loaded scoped groups" });
});
export const checkResultSchema = z.object({ ...envelopeShape, analysis: analysisReceiptSchema, issues: z.array(instinctIssueSchema), contextRevision: revisionSchema }).strict().superRefine((result, ctx) => {
  if (result.contextRevision !== result.analysis.contextRevision || result.binding.contextRevision !== result.contextRevision
    || result.issues.some(issue => issue.analysis.contextRevision !== result.contextRevision || issue.identity.sourceAccountKey !== result.coverage.sourceAccountKey)) ctx.addIssue({ code: "custom", message: "Check result must bind its exact source revision and account" });
});
export const investigationSchema = z.object({ ...envelopeShape, issue: instinctIssueSchema, evidence: z.array(storedEvidenceSchema), citations: z.array(citationSchema), snapshot: nativeSnapshotSchema.nullable() }).strict().superRefine((result, ctx) => {
  if (result.binding.selectedIssueId !== result.issue.issueId || result.binding.selectedIssueRevision !== result.issue.revision
    || result.issue.identity.sourceAccountKey !== result.coverage.sourceAccountKey || result.evidence.some(item => item.ref.sourceAccountKey !== result.coverage.sourceAccountKey)
    || (result.snapshot && result.snapshot.sourceAccountKey !== result.coverage.sourceAccountKey)) ctx.addIssue({ code: "custom", message: "Investigation must bind selected issue revision and scoped evidence" });
});
export const reverifyResultSchema = z.object({ ...envelopeShape, issue: instinctIssueSchema }).strict().superRefine((result, ctx) => {
  if (result.binding.selectedIssueId !== result.issue.issueId || result.binding.selectedIssueRevision !== result.issue.revision
    || result.issue.identity.sourceAccountKey !== result.coverage.sourceAccountKey) ctx.addIssue({ code: "custom", message: "Reverification must bind exact selected revision and account" });
});
export const dayReviewResultSchema = z.object({ ...envelopeShape, localDate: localDateSchema, timeZone: z.literal("America/New_York"), groups: z.array(issueGroupSchema), continuation: opaqueIdSchema.nullable() }).strict();
export const recordCitationSchema = z.object({ snapshotId: opaqueIdSchema, recordKey: z.string().regex(/^(booking|leadflow:job|series):[1-9]\d*$/), recordFingerprint: fingerprintSchema, field: z.enum(["localDate", "localTime", "arrivalWindow", "status", "address", "serviceName", "extras", "companyNotes", "specialRequestNotes", "customerNotes", "cleanerFacingNotes", "recurrence"]), checkedAtUtc: utcTimestampSchema }).strict();
export type RecordCitation = z.infer<typeof recordCitationSchema>;
export const chatAnswerSchema = z.object({
  ...envelopeShape, threadId: opaqueIdSchema,
  status: z.enum(["answered", "clarification", "unavailable"]), answer: z.string(),
  citations: z.array(citationSchema), recordCitations: z.array(recordCitationSchema),
  comparison: verificationResultSchema.nullable(), failure: apiFailureSchema.nullable(),
}).strict().superRefine((answer, ctx) => {
  if (answer.status === "unavailable" && answer.failure === null) ctx.addIssue({ code: "custom", message: "Unavailable chat needs an honest failure class" });
  if (answer.status === "answered" && answer.failure !== null) ctx.addIssue({ code: "custom", message: "A failed answer cannot claim success" });
});
export type SourcesInput = z.infer<typeof sourcesInputSchema>;
export type FeedInput = z.infer<typeof feedInputSchema>;
export type CheckInput = z.infer<typeof checkInputSchema>;
export type SelectedIssueInput = z.infer<typeof selectedIssueInputSchema>;
export type EvidenceInput = SelectedIssueInput;
export type ReverifyInput = SelectedIssueInput;
export type DayReviewInput = z.infer<typeof dayReviewInputSchema>;
export type AskInput = z.infer<typeof askInputSchema>;
export type SourceInventory = z.infer<typeof sourceInventorySchema>;
export type InstinctFeed = z.infer<typeof feedSchema>;
export type CheckResult = z.infer<typeof checkResultSchema>;
export type Investigation = z.infer<typeof investigationSchema>;
export type ReverifyResult = z.infer<typeof reverifyResultSchema>;
export type DayReviewResult = z.infer<typeof dayReviewResultSchema>;
export type ChatAnswer = z.infer<typeof chatAnswerSchema>;

export const READ_TOOL_NAMES = ["readScopedEvidence", "readExactCustomerRecords", "reverifySelectedIssue", "reviewCoverageDay"] as const;
export const evidenceToolCallSchema = z.discriminatedUnion("name", [
  z.object({ name: z.literal("readScopedEvidence"), input: selectedIssueInputSchema }).strict(),
  z.object({ name: z.literal("readExactCustomerRecords"), input: selectedIssueInputSchema }).strict(),
  z.object({ name: z.literal("reverifySelectedIssue"), input: selectedIssueInputSchema }).strict(),
  z.object({ name: z.literal("reviewCoverageDay"), input: dayReviewInputSchema }).strict(),
]);
export type EvidenceToolCall = z.infer<typeof evidenceToolCallSchema>;
export interface EvidenceTools {
  readonly readScopedEvidence: (scope: AuthorizedScope, input: SelectedIssueInput) => Promise<Investigation>;
  readonly readExactCustomerRecords: (scope: AuthorizedScope, input: SelectedIssueInput) => Promise<NativeSnapshot>;
  readonly reverifySelectedIssue: (scope: AuthorizedScope, input: SelectedIssueInput) => Promise<ReverifyResult>;
  readonly reviewCoverageDay: (scope: AuthorizedScope, input: DayReviewInput) => Promise<DayReviewResult>;
}
export interface SourceReader {
  readonly captureBoundary: (scope: AuthorizedScope, input: SourcesInput) => Promise<InventoryBoundary>;
  readonly inventory: (scope: AuthorizedScope, input: SourcesInput, boundary: InventoryBoundary) => Promise<SourceInventory>;
  readonly readExact: (scope: AuthorizedScope, ref: EvidenceRef) => Promise<StoredEvidence>;
  readonly readContext: (scope: AuthorizedScope, refs: readonly EvidenceRef[], expectedContextRevision: string) => Promise<SourceContext>;
  readonly reconcile: (scope: AuthorizedScope, boundary: InventoryBoundary, cursor?: string) => Promise<SourceInventory>;
}
export interface NativeRecordReader {
  /** Each call establishes a new SELECT snapshot; no cached current-state proof. */
  readonly readCandidates: (scope: AuthorizedScope, identity: VerifiedIdentity, cursor?: string) => Promise<NativeSnapshot>;
  readonly readExact: (scope: AuthorizedScope, identity: VerifiedIdentity, target: TargetOccurrence) => Promise<NativeSnapshot>;
}
export interface IdentityResolver {
  readonly resolve: (scope: AuthorizedScope, context: SourceContext, records: NativeSnapshot) => Promise<VerifiedIdentity>;
  readonly occurrence: (scope: AuthorizedScope, identity: VerifiedIdentity, expected: Expectation, records: NativeSnapshot) => Promise<OccurrenceResolution>;
}
export interface Clock { readonly now: () => Date }
/** Only the read surface of feature-local transient state is injectable here.
 * No business/source write, durable review, owner, command or worker interface. */
export interface ReadonlyInstinctStore {
  readonly capabilities: Stage1Capabilities;
  readonly getIssue: (scope: AuthorizedScope, input: SelectedIssueInput) => Promise<InstinctIssue | null>;
  readonly feed: (scope: AuthorizedScope, input: FeedInput) => Promise<InstinctFeed>;
}

/** Structural copy of the existing server/_core/llm InvokeParams/InvokeResult
 * contract. Type-only assignment tests keep it aligned without importing runtime
 * transport into client/shared code. Optional transport token fields are not
 * feature quotas; Stage 1 does not populate an invented usage ceiling. */
export type ModelRole = "system" | "user" | "assistant" | "tool" | "function";
export type ModelTextContent = { type: "text"; text: string };
export type ModelImageContent = { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };
export type ModelFileContent = { type: "file_url"; file_url: { url: string; mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4" } };
export type ModelMessageContent = string | ModelTextContent | ModelImageContent | ModelFileContent;
export type ModelMessage = { role: ModelRole; content: ModelMessageContent | ModelMessageContent[]; name?: string; tool_call_id?: string };
export type ModelTool = { type: "function"; function: { name: string; description?: string; parameters?: Record<string, unknown> } };
export type ModelToolChoice = "none" | "auto" | "required" | { name: string } | { type: "function"; function: { name: string } };
export type ModelJsonSchema = { name: string; schema: Record<string, unknown>; strict?: boolean };
export type ModelResponseFormat = { type: "text" } | { type: "json_object" } | { type: "json_schema"; json_schema: ModelJsonSchema };
export type InstinctInvokeParams = {
  messages: ModelMessage[]; tools?: ModelTool[]; toolChoice?: ModelToolChoice; tool_choice?: ModelToolChoice;
  maxTokens?: number; max_tokens?: number; outputSchema?: ModelJsonSchema; output_schema?: ModelJsonSchema;
  responseFormat?: ModelResponseFormat; response_format?: ModelResponseFormat;
};
export type ModelToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type InstinctInvokeResult = {
  id: string; created: number; model: string;
  choices: Array<{ index: number; message: { role: ModelRole; content: string | Array<ModelTextContent | ModelImageContent | ModelFileContent>; tool_calls?: ModelToolCall[] }; finish_reason: string | null }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};
export type ModelCallable = (params: InstinctInvokeParams) => Promise<InstinctInvokeResult>;
export interface InstinctServiceDependencies {
  readonly sources: SourceReader; readonly nativeRecords: NativeRecordReader; readonly identity: IdentityResolver;
  readonly model: ModelCallable; readonly clock: Clock; readonly store: ReadonlyInstinctStore;
  readonly ask: (scope: AuthorizedScope, input: AskInput, tools: EvidenceTools) => Promise<ChatAnswer>;
}
/** Same methods used by the authenticated router and injected offline UI harness.
 * Mutation-shaped transport methods remain read-only operationally. */
export interface InstinctApi {
  readonly sources: (input: SourcesInput) => Promise<SourceInventory>;
  readonly feed: (input: FeedInput) => Promise<InstinctFeed>;
  readonly check: (input: CheckInput) => Promise<CheckResult>;
  readonly evidence: (input: EvidenceInput) => Promise<Investigation>;
  readonly reverify: (input: ReverifyInput) => Promise<ReverifyResult>;
  readonly dayReview: (input: DayReviewInput) => Promise<DayReviewResult>;
  readonly ask: (input: AskInput) => Promise<ChatAnswer>;
}
