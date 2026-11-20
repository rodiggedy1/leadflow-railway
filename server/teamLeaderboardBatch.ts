import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  teamComplaintCandidateSchema, teamEvidenceWeekInputSchema,
  type TeamComplaintCandidate, type TeamEvidence, type TeamEvidenceWeekInput,
} from "../shared/teamLeaderboardEvidence";
import type {
  TeamBatchManifest, TeamBatchManifestData, TeamBatchReceipt, TeamBatchReceiptData,
  TeamBatchSeal, TeamBatchSourceInput,
} from "../shared/teamLeaderboardBatch";
import type { TeamEvidenceAuditRead, TeamEvidenceCandidateDraft } from "./teamLeaderboardEvidenceService";
import {
  createTeamComplaintDetector, isTeamComplaintAnalysisSource,
  TEAM_COMPLAINT_CANDIDATE_INSTRUCTIONS, validateTeamComplaintExtraction,
  type TeamComplaintDetector,
} from "./teamLeaderboardComplaintDetect";
import { groupTeamComplaintVisits, matchTeamComplaintCandidates } from "./teamLeaderboardComplaintMatch";

export type TeamLeaderboardBatchOptions = {
  readWeek: (input: TeamEvidenceWeekInput) => Promise<TeamEvidenceAuditRead>;
  detect?: TeamComplaintDetector;
  signingKey?: () => string;
  policyRevision?: () => string;
};
export type TeamLeaderboardBatchProgress = {
  eligible: number; completed: number; failed: number; pending: number;
  processingComplete: boolean; provenanceComplete: boolean;
};
export type TeamLeaderboardBatchDraft = TeamEvidenceCandidateDraft & { batch: TeamLeaderboardBatchProgress };
export type TeamLeaderboardBatchMaterializeInput = {
  mode: "unpublished_candidates";
  read: TeamEvidenceAuditRead; manifest: TeamBatchManifest; receipts: TeamBatchReceipt[];
};

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().min(1);
const ownerSchema = z.number().int().positive().safe();
const nullableText = z.string().nullable();
const strings = z.array(z.string());
const sourceSchema = z.object({
  id: text, revision: hashSchema, sourceKind: z.enum(["sms", "email", "human_call", "ai_call", "phone_unverified"]),
  store: text, sourceRowId: z.string(), providerId: nullableText, sessionId: nullableText, threadId: nullableText,
  originalText: nullableText, occurredAtUtc: nullableText, observedAtUtc: nullableText,
  timeBasis: z.enum(["original", "received", "stored", "unknown"]),
  bodyBasis: z.enum(["original", "snapshot", "snippet", "missing"]),
  speakerBasis: z.enum(["customer", "unverified", "non_customer"]),
  customerPhone: nullableText, customerEmail: nullableText, customerName: nullableText,
  businessLine: nullableText, mailboxEmail: nullableText, limitations: strings,
}).strict();
const readSchema = z.object({
  status: z.literal("unpublished_read"), publication: z.null(), scoreResults: z.null(),
  sources: z.object({
    window: z.object({
      weekStart: text, weekEnd: text, throughDate: text, timeZone: z.literal("America/New_York"),
      startInclusiveUtc: text, endExclusiveUtc: text, capturedAtUtc: text,
    }).strict(),
    evidence: z.array(sourceSchema),
    families: z.array(z.object({
      store: z.string(), scannedRows: z.number(), evidenceItems: z.number(), exhausted: z.boolean(),
      status: z.enum(["read", "unavailable"]), limitations: strings,
    }).strict()), collectionComplete: z.boolean(), limitations: strings,
  }).strict(),
  history: z.object({
    visits: z.array(z.object({
      id: z.number(), bookingId: z.number().nullable(), launch27BookingId: z.number().nullable(), publicBookingNumber: nullableText,
      jobDate: z.string(), serviceStartUtc: nullableText, bookingStatus: z.string(), progressStatus: nullableText,
      customerName: z.string(), customerPhone: nullableText, customerEmail: nullableText, address: nullableText,
      storedTeamId: z.number().nullable(), storedTeamName: nullableText,
      progressTeamId: z.number().nullable(), signoffTeamId: z.number().nullable(),
      progressUpdatedAtUtc: nullableText, signoffAtUtc: nullableText, jobUpdatedAtUtc: nullableText,
      customerRating: z.number().nullable(), etaTimestamp: z.number().nullable(),
    }).strict()),
    teams: z.array(z.object({ id: z.number(), name: z.string(), launch27TeamId: z.number().nullable() }).strict()),
    assignments: z.array(z.object({
      id: z.number(), bookingId: z.number(), teamId: z.number().nullable(), teamName: nullableText,
      assignedAtUtc: nullableText, unassignedAtUtc: nullableText, status: z.string(),
    }).strict()), complete: z.boolean(), limitations: strings,
  }).strict(),
}).strict();
const descriptorSchema = z.object({ id: text, revision: hashSchema, hash: hashSchema }).strict();
const manifestSchema = z.object({
  version: z.literal(1), snapshotId: text, ownerId: ownerSchema, policyRevision: text,
  weekStart: text, capturedAtUtc: text, readHash: hashSchema, sources: z.array(descriptorSchema),
}).strict();
const receiptSchema = z.object({
  version: z.literal(1), snapshotId: text, ownerId: ownerSchema, policyRevision: text,
  manifestHash: hashSchema, evidenceId: text, evidenceRevision: hashSchema, sourceHash: hashSchema,
  status: z.enum(["completed", "failed"]), candidates: z.array(teamComplaintCandidateSchema),
  code: z.literal("CANDIDATE_ANALYSIS_FAILED").nullable(),
}).strict();
const sealSchema = z.object({ data: z.unknown(), mac: hashSchema }).strict();
const modeSchema = z.literal("unpublished_candidates");
const sourceInputSchema = z.object({
  mode: modeSchema, manifest: z.unknown(), source: z.unknown(), completedReceipt: z.unknown().optional(),
}).strict();
const materializeInputSchema = z.object({
  mode: modeSchema, read: z.unknown(), manifest: z.unknown(), receipts: z.array(z.unknown()),
}).strict();
const MANIFEST_DOMAIN = "leadflow:team-leaderboard-batch:manifest:v1\0";
const RECEIPT_DOMAIN = "leadflow:team-leaderboard-batch:receipt:v1\0";
function reject(): never { throw new Error("TEAM_BATCH_INVALID_ARTIFACT"); }

/** Plain JSON only: sorted object keys, preserved array order, no lossy coercion,
 * undefined, sparse arrays, non-finite numbers, custom prototypes or cycles. */
function canonical(value: unknown, ancestors = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") { if (!Number.isFinite(value)) reject(); return JSON.stringify(value); }
  if (typeof value !== "object" || ancestors.has(value)) return reject();
  ancestors.add(value);
  try {
    if (Object.getOwnPropertySymbols(value).length) reject();
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) reject();
      return `[${Array.from({ length: value.length }, (_, i) => canonical(value[i], ancestors)).join(",")}]`;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) reject();
    return `{${Object.keys(value).sort().map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!("value" in descriptor)) reject();
      return `${JSON.stringify(key)}:${canonical(descriptor.value, ancestors)}`;
    }).join(",")}}`;
  } finally { ancestors.delete(value); }
}
function hash(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
function clone<T>(value: T): T { canonical(value); return JSON.parse(JSON.stringify(value)) as T; }
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) reject();
  // No parser normalization may change the authenticated immutable payload.
  if (canonical(result.data) !== canonical(value)) reject();
  return result.data;
}
function mac(domain: string, key: string, data: unknown): string {
  return createHmac("sha256", key).update(domain).update(canonical(data)).digest("hex");
}
function seal<T>(domain: string, key: string, data: T): TeamBatchSeal<T> {
  return { data: clone(data), mac: mac(domain, key, data) };
}
function unseal<T>(domain: string, key: string, schema: z.ZodType<T>, value: unknown): TeamBatchSeal<T> {
  const outer = parse(sealSchema, value);
  const expected = Buffer.from(mac(domain, key, outer.data), "hex");
  const supplied = Buffer.from(outer.mac, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) reject();
  return { data: parse(schema, outer.data), mac: outer.mac };
}
function descriptors(read: TeamEvidenceAuditRead): TeamBatchManifestData["sources"] {
  const sources = new Map<string, TeamBatchManifestData["sources"][number]>();
  for (const source of read.sources.evidence) {
    if (!isTeamComplaintAnalysisSource(source)) continue;
    const item = { id: source.id, revision: source.revision, hash: hash(source) };
    // Identical retained sources are a single resumable unit. Conflicting
    // originals remain separate units and all originals remain in matching.
    sources.set(canonical(item), item);
  }
  return Array.from(sources.values());
}

/** Task-local driver owns durable JSON snapshots/receipts. No server store,
 * filesystem, database, expiry, timer, sweeper, scheduling or implicit retry.
 * Supplementary single-flight cannot ensure exactly-once cost if an unsaved
 * response is lost on restart. The driver MUST stop uncertain requests, never
 * automatically resend them; failed receipts need an explicit fresh call
 * selected by --retry-failed, without completedReceipt. Replace that failure
 * artifact with the new receipt; materialize rejects conflicting checkpoints.
 * ownerId is the already-authorized admin identity supplied by the caller, not
 * an identity asserted inside an imported artifact. This is not an auth token.
 */
export function createTeamLeaderboardBatchService(options: TeamLeaderboardBatchOptions) {
  // No configuration reads or detector invocation at import/factory time.
  const singleFlight = new Map<string, Promise<TeamBatchReceipt>>();
  function context(ownerId: number) {
    parse(ownerSchema, ownerId);
    const key = (options.signingKey ?? (() => process.env.JWT_SECRET ?? ""))();
    const policy = (options.policyRevision ?? (() =>
      `${process.env.RAILWAY_GIT_COMMIT_SHA || process.env.COMMIT_SHA || "unknown"}:${hash(TEAM_COMPLAINT_CANDIDATE_INSTRUCTIONS)}`))();
    if (typeof key !== "string" || !key.trim() || typeof policy !== "string" || !policy.trim()) reject();
    return { ownerId, key, policy };
  }
  type Context = ReturnType<typeof context>;
  function authenticatedManifest(ctx: Context, value: unknown): TeamBatchManifest {
    const manifest = unseal(MANIFEST_DOMAIN, ctx.key, manifestSchema, value);
    if (manifest.data.ownerId !== ctx.ownerId || manifest.data.policyRevision !== ctx.policy) reject();
    parse(teamEvidenceWeekInputSchema, { weekStart: manifest.data.weekStart });
    if (new Set(manifest.data.sources.map(item => canonical(item))).size !== manifest.data.sources.length) reject();
    return manifest;
  }
  function authenticatedSource(manifest: TeamBatchManifest, value: unknown): TeamEvidence {
    const source = parse(sourceSchema, value);
    if (!isTeamComplaintAnalysisSource(source) || !manifest.data.sources.some(item =>
      item.id === source.id && item.revision === source.revision && item.hash === hash(source))) reject();
    return source;
  }
  function authenticatedReceipt(ctx: Context, manifest: TeamBatchManifest, source: TeamEvidence, value: unknown): TeamBatchReceipt {
    const receipt = unseal(RECEIPT_DOMAIN, ctx.key, receiptSchema, value);
    const data = receipt.data;
    if (data.ownerId !== ctx.ownerId || data.policyRevision !== ctx.policy
      || data.snapshotId !== manifest.data.snapshotId || data.manifestHash !== hash(manifest)
      || data.evidenceId !== source.id || data.evidenceRevision !== source.revision || data.sourceHash !== hash(source)) reject();
    if (data.status === "completed") {
      if (data.code !== null) reject();
      validateTeamComplaintExtraction({ candidates: data.candidates }, source);
    } else if (data.code !== "CANDIDATE_ANALYSIS_FAILED" || data.candidates.length !== 0) reject();
    return receipt;
  }
  return Object.freeze({
    prepare: async (ownerId: number, weekInput: TeamEvidenceWeekInput): Promise<{ read: TeamEvidenceAuditRead; manifest: TeamBatchManifest }> => {
      const ctx = context(ownerId);
      const week = parse(teamEvidenceWeekInputSchema, weekInput);
      const read = parse(readSchema, await options.readWeek(week));
      if (read.sources.window.weekStart !== week.weekStart) reject();
      const data: TeamBatchManifestData = {
        version: 1, snapshotId: randomUUID(), ownerId, policyRevision: ctx.policy,
        weekStart: week.weekStart, capturedAtUtc: read.sources.window.capturedAtUtc,
        readHash: hash(read), sources: descriptors(read),
      };
      return { read, manifest: seal(MANIFEST_DOMAIN, ctx.key, data) };
    },
    analyzeSource: async (ownerId: number, input: TeamBatchSourceInput): Promise<TeamBatchReceipt> => {
      const ctx = context(ownerId);
      const parsed = parse(sourceInputSchema, input);
      const manifest = authenticatedManifest(ctx, parsed.manifest);
      const source = authenticatedSource(manifest, parsed.source);
      if (parsed.completedReceipt !== undefined) {
        const receipt = authenticatedReceipt(ctx, manifest, source, parsed.completedReceipt);
        if (receipt.data.status !== "completed") reject();
        return receipt;
      }
      const cacheKey = hash({ manifest, source, keyHash: hash(ctx.key) });
      let work = singleFlight.get(cacheKey);
      if (!work) {
        // Defer invocation until this promise is registered, including injected
        // detectors. Never modify concurrency/retry behavior of the old runner.
        work = Promise.resolve().then(async () => {
          let candidates: TeamComplaintCandidate[] = [];
          let status: TeamBatchReceiptData["status"] = "completed";
          try {
            const detect = options.detect ?? createTeamComplaintDetector();
            candidates = validateTeamComplaintExtraction({ candidates: await detect(clone(source)) }, source);
          } catch { status = "failed"; }
          const data: TeamBatchReceiptData = {
            version: 1, snapshotId: manifest.data.snapshotId, ownerId, policyRevision: ctx.policy,
            manifestHash: hash(manifest), evidenceId: source.id, evidenceRevision: source.revision, sourceHash: hash(source),
            status, candidates, code: status === "failed" ? "CANDIDATE_ANALYSIS_FAILED" : null,
          };
          return seal(RECEIPT_DOMAIN, ctx.key, data);
        });
        singleFlight.set(cacheKey, work);
        // Completed results are only a supplementary same-process cache. A
        // failure remains retryable on a later explicitly selected fresh call.
        void work.then(result => {
          if (result.data.status === "failed") singleFlight.delete(cacheKey);
        }, () => singleFlight.delete(cacheKey));
      }
      return clone(await work);
    },
    materialize: (ownerId: number, input: TeamLeaderboardBatchMaterializeInput): TeamLeaderboardBatchDraft => {
      const ctx = context(ownerId);
      const parsed = parse(materializeInputSchema, input);
      const manifest = authenticatedManifest(ctx, parsed.manifest);
      const read = parse(readSchema, parsed.read);
      if (hash(read) !== manifest.data.readHash || read.sources.window.weekStart !== manifest.data.weekStart
        || read.sources.window.capturedAtUtc !== manifest.data.capturedAtUtc
        || canonical(descriptors(read)) !== canonical(manifest.data.sources)) reject();
      const retained = new Map<string, TeamBatchReceipt>();
      for (const value of parsed.receipts) {
        const outer = parse(sealSchema, value);
        const data = parse(receiptSchema, outer.data);
        const source = read.sources.evidence.find(item => item.id === data.evidenceId
          && item.revision === data.evidenceRevision && hash(item) === data.sourceHash);
        if (!source) reject();
        authenticatedSource(manifest, source);
        const receipt = authenticatedReceipt(ctx, manifest, source, value);
        const id = canonical({ id: source.id, revision: source.revision, hash: hash(source) });
        const previous = retained.get(id);
        if (previous && canonical(previous) !== canonical(receipt)) reject();
        retained.set(id, receipt);
      }
      const candidates: TeamComplaintCandidate[] = [];
      const analyzedEvidenceIds: string[] = [];
      const failures: TeamEvidenceCandidateDraft["analysis"]["failures"] = [];
      let completed = 0, failed = 0;
      for (const descriptor of manifest.data.sources) {
        const receipt = retained.get(canonical(descriptor));
        if (!receipt) continue;
        if (receipt.data.status === "completed") {
          completed++; candidates.push(...receipt.data.candidates); analyzedEvidenceIds.push(descriptor.id);
        } else { failed++; failures.push({ evidenceId: descriptor.id, code: "CANDIDATE_ANALYSIS_FAILED" }); }
      }
      const notAnalyzedEvidenceIds = read.sources.evidence.filter(source =>
        !isTeamComplaintAnalysisSource(source) && source.speakerBasis !== "non_customer").map(source => source.id);
      const eligible = manifest.data.sources.length;
      const batch: TeamLeaderboardBatchProgress = {
        eligible, completed, failed, pending: eligible - completed - failed,
        processingComplete: completed === eligible,
        provenanceComplete: read.sources.collectionComplete && read.history.complete && !notAnalyzedEvidenceIds.length,
      };
      const matches = matchTeamComplaintCandidates(candidates, read.sources.evidence, read.history, read.sources.window);
      return {
        ...read, batch,
        analysis: {
          status: "unpublished_candidates", complete: batch.processingComplete && batch.provenanceComplete,
          analyzedEvidenceIds, notAnalyzedEvidenceIds, failures,
        }, matches, visitGroups: groupTeamComplaintVisits(matches),
        verifiedComplaintCount: null, verifiedRecleanRefundCount: null,
      };
    },
  });
}
export type TeamLeaderboardBatchService = ReturnType<typeof createTeamLeaderboardBatchService>;
