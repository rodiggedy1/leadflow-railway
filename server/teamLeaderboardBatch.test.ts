import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamBatchManifest, TeamBatchReceipt, TeamBatchSourceInput } from "../shared/teamLeaderboardBatch";
import type { TeamComplaintCandidate, TeamEvidence } from "../shared/teamLeaderboardEvidence";
import type { TeamEvidenceAuditRead } from "./teamLeaderboardEvidenceService";
import {
  createTeamLeaderboardBatchService,
  type TeamLeaderboardBatchMaterializeInput, type TeamLeaderboardBatchOptions,
} from "./teamLeaderboardBatch";
import { createTeamEvidenceService } from "./teamLeaderboardEvidenceService";
import { resolveTeamEvidenceWindow } from "./teamLeaderboardEvidenceWindow";
import { TEAM_COMPLAINT_CANDIDATE_INSTRUCTIONS } from "./teamLeaderboardComplaintDetect";

// Any accidental live runner invocation fails locally; the default delegation
// test supplies the very same existing passive runner, with a synthetic result.
vi.mock("./instinct/claudeAgentClient", () => ({ runInitialLeadDraft: vi.fn() }));
import { runInitialLeadDraft } from "./instinct/claudeAgentClient";

const owner = 17, key = "offline-synthetic-key", policy = "offline-policy:v1";
const week = { weekStart: "2026-11-15" };
const now = new Date("2026-11-20T01:20:00Z");
const source = (changes: Partial<TeamEvidence> = {}): TeamEvidence => ({
  id: "sms:1", revision: "a".repeat(64), sourceKind: "sms", store: "messages", sourceRowId: "1", providerId: "provider-1",
  sessionId: null, threadId: null, originalText: "The kitchen was dirty", occurredAtUtc: "2026-11-18T15:00:00Z",
  observedAtUtc: "2026-11-18T15:01:00Z", timeBasis: "original", bodyBasis: "original", speakerBasis: "customer",
  customerPhone: "+17035550101", customerEmail: null, customerName: "Synthetic Customer", businessLine: null, mailboxEmail: null,
  limitations: [], ...changes,
});
const candidate = (s = source(), changes: Partial<TeamComplaintCandidate> = {}): TeamComplaintCandidate => ({
  evidenceId: s.id, evidenceRevision: s.revision, summary: "Kitchen complaint", category: "cleaning_quality",
  evidenceQuotes: ["The kitchen was dirty"], references: [], ...changes,
});
const audit = (sources = [source()]): TeamEvidenceAuditRead => ({
  status: "unpublished_read", publication: null, scoreResults: null,
  sources: { window: resolveTeamEvidenceWindow(week, now), evidence: sources, families: [], collectionComplete: true, limitations: [] },
  history: {
    teams: [{ id: 2, name: "Synthetic Team", launch27TeamId: 200 }], assignments: [], complete: true, limitations: [],
    visits: [{ id: 1, bookingId: null, launch27BookingId: 300, publicBookingNumber: "LF-300", jobDate: "2026-11-17",
      serviceStartUtc: "2026-11-17T13:00:00Z", bookingStatus: "completed", progressStatus: "completed", customerName: "Synthetic Customer",
      customerPhone: "+17035550101", customerEmail: null, address: "Synthetic address", storedTeamId: 2, storedTeamName: "Synthetic Team",
      progressTeamId: 2, signoffTeamId: 2, progressUpdatedAtUtc: "2026-11-17T16:00:00Z", signoffAtUtc: "2026-11-17T15:59:00Z",
      jobUpdatedAtUtc: "2026-11-17T16:00:00Z", customerRating: null, etaTimestamp: null }],
  },
});
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
const hash = (v: unknown) => createHash("sha256").update(canonical(v)).digest("hex");
function resign<T extends TeamBatchManifest | TeamBatchReceipt>(artifact: T, domain: "manifest" | "receipt"): T {
  artifact.mac = createHmac("sha256", key).update(`leadflow:team-leaderboard-batch:${domain}:v1\0`).update(canonical(artifact.data)).digest("hex");
  return artifact;
}
function reorder<T>(v: T): T {
  if (Array.isArray(v)) return v.map(reorder) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).reverse().map(([k, value]) => [k, reorder(value)])) as T;
  return v;
}
function fixture(read = audit(), detect = vi.fn(async (s: TeamEvidence) => [candidate(s)]), overrides: Partial<TeamLeaderboardBatchOptions> = {}) {
  const readWeek = vi.fn(async () => copy(read));
  const options: TeamLeaderboardBatchOptions = { readWeek, detect, signingKey: () => key, policyRevision: () => policy, ...overrides };
  const service = createTeamLeaderboardBatchService(options);
  return { readWeek, detect, options, service };
}
const input = (manifest: TeamBatchManifest, s = source(), completedReceipt?: TeamBatchReceipt): TeamBatchSourceInput => ({
  mode: "unpublished_candidates", manifest, source: s, ...(completedReceipt ? { completedReceipt } : {}),
});
const material = (snapshot: { read: TeamEvidenceAuditRead; manifest: TeamBatchManifest }, receipts: TeamBatchReceipt[] = []): TeamLeaderboardBatchMaterializeInput => ({
  mode: "unpublished_candidates", ...snapshot, receipts,
});
afterEach(() => { vi.unstubAllEnvs(); vi.mocked(runInitialLeadDraft).mockReset(); });

describe("local signed resumable unpublished batch", () => {
  it("is passive at factory time and prepare only reads/signs without model calls", async () => {
    const f = fixture(); expect(f.readWeek).not.toHaveBeenCalled(); expect(f.detect).not.toHaveBeenCalled();
    const snapshot = await f.service.prepare(owner, week);
    expect(f.readWeek).toHaveBeenCalledWith(week); expect(f.detect).not.toHaveBeenCalled();
    expect(snapshot.manifest.data.ownerId).toBe(owner);
    expect(snapshot.manifest.data.readHash).toBe(hash(snapshot.read));
    expect(snapshot.manifest.data.sources).toEqual([{ id: source().id, revision: source().revision, hash: hash(source()) }]);
    expect(snapshot.manifest.mac).toMatch(/^[a-f0-9]{64}$/);
    expect(runInitialLeadDraft).not.toHaveBeenCalled();
  });
  it("retains unavailable family gaps with deliberately empty row identity", async () => {
    const gap = source({ id: "family-gap", sourceRowId: "", originalText: null, bodyBasis: "missing", timeBasis: "unknown", speakerBasis: "unverified", customerPhone: null, limitations: ["Source family unavailable/incomplete"] });
    const read = audit([source(), gap]);
    read.sources.collectionComplete = false;
    read.sources.families.push({ store: "unavailable-family", scannedRows: 0, evidenceItems: 0, exhausted: false, status: "unavailable", limitations: ["DB_UNAVAILABLE"] });
    const f = fixture(read); const snapshot = await f.service.prepare(owner, week);
    expect(snapshot.read.sources.evidence).toContainEqual(gap);
    expect(snapshot.manifest.data.sources).toHaveLength(1);
    const result = f.service.materialize(owner, material(snapshot));
    expect(result.analysis.notAnalyzedEvidenceIds).toContain("family-gap");
    expect(result.batch.provenanceComplete).toBe(false);
    expect(f.detect).not.toHaveBeenCalled();
  });
  it("delegates to the exact existing runner and instructions with the complete original source", async () => {
    const f = fixture(audit(), undefined, { detect: undefined });
    vi.mocked(runInitialLeadDraft).mockResolvedValue({ finalSmsText: JSON.stringify({ candidates: [candidate()] }) } as never);
    const snapshot = await f.service.prepare(owner, week);
    const result = await f.service.analyzeSource(owner, input(snapshot.manifest));
    expect(result.data.status).toBe("completed");
    expect(runInitialLeadDraft).toHaveBeenCalledTimes(1);
    expect(runInitialLeadDraft).toHaveBeenCalledWith({ systemPrompt: TEAM_COMPLAINT_CANDIDATE_INSTRUCTIONS, userPrompt: JSON.stringify({ source: source() }) });
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "17", null])("rejects malformed owner %s before any work", async id => {
    const f = fixture(); await expect(f.service.prepare(id as number, week)).rejects.toThrow();
    expect(f.readWeek).not.toHaveBeenCalled(); expect(f.detect).not.toHaveBeenCalled();
  });
  it.each(["", " ", undefined])("fails closed on missing/empty signing key %s", async value => {
    const f = fixture(audit(), undefined, { signingKey: () => value as string });
    await expect(f.service.prepare(owner, week)).rejects.toThrow(); expect(f.readWeek).not.toHaveBeenCalled();
  });
  it("uses only existing JWT_SECRET and runtime commit plus instruction hash by default", async () => {
    vi.stubEnv("JWT_SECRET", key); vi.stubEnv("RAILWAY_GIT_COMMIT_SHA", "offline-commit");
    const f = fixture(audit(), undefined, { signingKey: undefined, policyRevision: undefined });
    const snapshot = await f.service.prepare(owner, week);
    expect(snapshot.manifest.data.policyRevision).toBe(`offline-commit:${hash(TEAM_COMPLAINT_CANDIDATE_INSTRUCTIONS)}`);
    vi.stubEnv("JWT_SECRET", "");
    await expect(f.service.analyzeSource(owner, input(snapshot.manifest))).rejects.toThrow(); expect(f.detect).not.toHaveBeenCalled();
  });
  it.each([
    ["wrong owner", { owner: owner + 1 }], ["wrong key", { signingKey: () => "other-key" }],
    ["wrong policy", { policyRevision: () => "other-policy" }], ["empty policy", { policyRevision: () => "" }],
  ])("rejects %s before detector invocation", async (_, change) => {
    const f = fixture(); const snapshot = await f.service.prepare(owner, week);
    const service = createTeamLeaderboardBatchService({ ...f.options, ...change });
    await expect(service.analyzeSource("owner" in change ? change.owner! : owner, input(snapshot.manifest))).rejects.toThrow();
    expect(() => service.materialize("owner" in change ? change.owner! : owner, material(snapshot))).toThrow();
    expect(f.detect).not.toHaveBeenCalled();
  });
  it.each(["ownerId", "snapshotId", "policyRevision", "weekStart", "capturedAtUtc", "readHash", "sources", "mac"])("rejects tampered manifest %s", async field => {
    const f = fixture(); const snapshot = await f.service.prepare(owner, week); const manifest = copy(snapshot.manifest);
    if (field === "mac") manifest.mac = "0".repeat(64);
    else (manifest.data as unknown as Record<string, unknown>)[field] = field === "sources" ? [] : "tampered";
    await expect(f.service.analyzeSource(owner, input(manifest))).rejects.toThrow(); expect(f.detect).not.toHaveBeenCalled();
  });
  it.each([
    ["text", { originalText: "Substituted body" }], ["contact", { customerPhone: "+17035559999" }],
    ["customer", { customerName: "Impostor" }], ["revision", { revision: "b".repeat(64) }],
    ["ID", { id: "sms:2" }], ["speaker", { speakerBasis: "non_customer" }], ["body", { bodyBasis: "snippet" }],
    ["limitation", { limitations: ["substitute"] }], ["timestamp", { occurredAtUtc: "2026-11-19T14:00:00Z" }],
  ] as Array<[string, Partial<TeamEvidence>]>) ("rejects changed source %s before model work", async (_, change) => {
    const f = fixture(); const snapshot = await f.service.prepare(owner, week);
    await expect(f.service.analyzeSource(owner, input(snapshot.manifest, source(change)))).rejects.toThrow();
    expect(f.detect).not.toHaveBeenCalled();
  });
  it("rejects malformed/extra imported source identity fields before model work", async () => {
    const f = fixture(); const snapshot = await f.service.prepare(owner, week);
    await expect(f.service.analyzeSource(owner, input(snapshot.manifest, { ...source(), teamId: 2 } as TeamEvidence))).rejects.toThrow();
    await expect(f.service.analyzeSource(owner, input(snapshot.manifest, null as unknown as TeamEvidence))).rejects.toThrow();
    expect(f.detect).not.toHaveBeenCalled();
  });
  it.each(["publication", "collection", "evidence", "window", "history", "team", "assignment", "historyCoverage"])("rejects changed immutable read %s", async field => {
    const f = fixture(); const snapshot = await f.service.prepare(owner, week); const changed = copy(snapshot);
    if (field === "publication") (changed.read as unknown as { publication: unknown }).publication = { published: true };
    if (field === "collection") changed.read.sources.collectionComplete = false;
    if (field === "evidence") changed.read.sources.evidence[0].customerEmail = "intruder@example.test";
    if (field === "window") changed.read.sources.window.throughDate = "2026-11-18";
    if (field === "history") changed.read.history.visits[0].customerPhone = "+17035559999";
    if (field === "team") changed.read.history.teams[0].name = "Other Team";
    if (field === "assignment") changed.read.history.assignments.push({ id: 1, bookingId: 1, teamId: 3, teamName: "Other", assignedAtUtc: null, unassignedAtUtc: null, status: "assigned" });
    if (field === "historyCoverage") changed.read.history.complete = false;
    expect(() => f.service.materialize(owner, material(changed))).toThrow(); expect(f.detect).not.toHaveBeenCalled();
  });
  it.each(["status", "candidates", "snapshotId", "ownerId", "policyRevision", "manifestHash", "sourceHash", "evidenceRevision", "evidenceId", "code", "mac"])("rejects tampered receipt %s including on replay", async field => {
    const f = fixture(); const snapshot = await f.service.prepare(owner, week); const receipt = await f.service.analyzeSource(owner, input(snapshot.manifest));
    const tampered = copy(receipt);
    if (field === "mac") tampered.mac = "1".repeat(64);
    else (tampered.data as unknown as Record<string, unknown>)[field] = field === "candidates" ? [] : "tampered";
    await expect(f.service.analyzeSource(owner, input(snapshot.manifest, source(), tampered))).rejects.toThrow();
    expect(() => f.service.materialize(owner, material(snapshot, [tampered]))).toThrow(); expect(f.detect).toHaveBeenCalledTimes(1);
  });
  it("rejects validly signed but semantically invalid receipt quotes, revisions and status/code", async () => {
    const f = fixture(); const snapshot = await f.service.prepare(owner, week); const receipt = await f.service.analyzeSource(owner, input(snapshot.manifest));
    const changes: Array<(r: TeamBatchReceipt) => void> = [
      r => { r.data.candidates[0].evidenceQuotes = ["Invented quote"]; },
      r => { r.data.candidates[0].evidenceRevision = "b".repeat(64); },
      r => { r.data.candidates[0].evidenceRevision = "invalid"; },
      r => { r.data.candidates[0].references = [{ kind: "booking", value: "LF-999", quote: "The kitchen" }]; },
      r => { r.data.code = "CANDIDATE_ANALYSIS_FAILED"; },
      r => { r.data.status = "failed"; r.data.code = "CANDIDATE_ANALYSIS_FAILED"; },
      r => { r.data.ownerId++; }, r => { r.data.sourceHash = "f".repeat(64); },
    ];
    for (const change of changes) {
      const bad = copy(receipt); change(bad); resign(bad, "receipt");
      await expect(f.service.analyzeSource(owner, input(snapshot.manifest, source(), bad))).rejects.toThrow();
      expect(() => f.service.materialize(owner, material(snapshot, [bad]))).toThrow();
    }
    expect(f.detect).toHaveBeenCalledTimes(1);
  });
  it("domain separates manifest and receipt MACs", async () => {
    const f = fixture(); const snapshot = await f.service.prepare(owner, week);
    await expect(f.service.analyzeSource(owner, input(resign(copy(snapshot.manifest), "receipt")))).rejects.toThrow();
    const receipt = await f.service.analyzeSource(owner, input(snapshot.manifest));
    expect(() => f.service.materialize(owner, material(snapshot, [resign(copy(receipt), "manifest")]))).toThrow();
  });
  it("rejects mixing a source or receipt from another snapshot", async () => {
    const f = fixture(); const first = await f.service.prepare(owner, week);
    const second = await fixture(audit([source({ originalText: "Changed original" })])).service.prepare(owner, week);
    await expect(f.service.analyzeSource(owner, input(first.manifest, second.read.sources.evidence[0]))).rejects.toThrow();
    const receipt = await f.service.analyzeSource(owner, input(first.manifest));
    const sameReadSnapshot = await f.service.prepare(owner, week);
    await expect(f.service.analyzeSource(owner, input(sameReadSnapshot.manifest, source(), receipt))).rejects.toThrow();
    expect(() => f.service.materialize(owner, material(sameReadSnapshot, [receipt]))).toThrow();
    expect(f.detect).toHaveBeenCalledTimes(1);
  });
  it("ignores object key order in read/source/seal/candidate hashes and replay", async () => {
    const f = fixture(); const snapshot = await f.service.prepare(owner, week);
    const receipt = await f.service.analyzeSource(owner, reorder(input(snapshot.manifest)));
    const replay = await f.service.analyzeSource(owner, reorder(input(snapshot.manifest, source(), receipt)));
    expect(replay).toEqual(receipt); expect(f.detect).toHaveBeenCalledTimes(1);
    expect(f.service.materialize(owner, reorder(material(snapshot, [receipt, reorder(receipt)]))).batch.completed).toBe(1);
  });
  it("successful empty candidate receipt completes and replays after restart with no model work", async () => {
    const f = fixture(audit(), vi.fn(async () => [])); const snapshot = await f.service.prepare(owner, week);
    const receipt = await f.service.analyzeSource(owner, input(snapshot.manifest)); expect(receipt.data.candidates).toEqual([]);
    const restarted = fixture();
    expect(await restarted.service.analyzeSource(owner, input(snapshot.manifest, source(), copy(receipt)))).toEqual(receipt);
    const draft = restarted.service.materialize(owner, material(copy(snapshot), [copy(receipt)]));
    expect(draft.batch).toEqual({ eligible: 1, completed: 1, failed: 0, pending: 0, processingComplete: true, provenanceComplete: true });
    expect(draft.analysis.complete).toBe(true); expect(draft.matches).toEqual([]); expect(draft.verifiedComplaintCount).toBeNull();
    expect(restarted.detect).not.toHaveBeenCalled(); expect(restarted.readWeek).not.toHaveBeenCalled();
  });
  it("restores an interrupted partial batch from signed artifacts in a new service instance", async () => {
    const items = [source(), source({ id: "email:2", revision: "b".repeat(64), sourceKind: "email", providerId: "provider-2" })];
    const f = fixture(audit(items)); const snapshot = await f.service.prepare(owner, week);
    const receipt = await f.service.analyzeSource(owner, input(snapshot.manifest, items[0]));
    expect(f.service.materialize(owner, material(snapshot, [receipt])).batch).toMatchObject({ eligible: 2, completed: 1, pending: 1, processingComplete: false });
    const diskJson = JSON.stringify({ ...snapshot, receipts: [receipt] });
    const saved = JSON.parse(diskJson) as typeof snapshot & { receipts: TeamBatchReceipt[] };
    const restarted = fixture();
    expect(restarted.service.materialize(owner, material(saved, saved.receipts)).analysis.complete).toBe(false);
    expect(await restarted.service.analyzeSource(owner, input(saved.manifest, saved.read.sources.evidence[0], saved.receipts[0]))).toEqual(receipt);
    const remaining = await restarted.service.analyzeSource(owner, input(saved.manifest, saved.read.sources.evidence[1]));
    const result = restarted.service.materialize(owner, material(saved, [...saved.receipts, remaining]));
    expect(result.batch.processingComplete).toBe(true); expect(result.visitGroups).toHaveLength(1); expect(result.visitGroups[0].evidenceIds).toEqual(items.map(s => s.id));
    expect(restarted.detect).toHaveBeenCalledTimes(1); expect(restarted.readWeek).not.toHaveBeenCalled();
  });
  it("single-flights concurrent identical requests and shields its supplementary result from caller mutation", async () => {
    let release!: (c: TeamComplaintCandidate[]) => void;
    const detect = vi.fn(() => new Promise<TeamComplaintCandidate[]>(resolve => { release = resolve; }));
    const f = fixture(audit(), detect); const snapshot = await f.service.prepare(owner, week);
    const first = f.service.analyzeSource(owner, input(snapshot.manifest));
    const second = f.service.analyzeSource(owner, reorder(input(snapshot.manifest)));
    await Promise.resolve(); expect(detect).toHaveBeenCalledTimes(1); release([candidate()]);
    const [a, b] = await Promise.all([first, second]); expect(a).toEqual(b);
    a.data.candidates.length = 0;
    expect((await f.service.analyzeSource(owner, input(snapshot.manifest))).data.candidates).toHaveLength(1); expect(detect).toHaveBeenCalledTimes(1);
  });
  it("keeps failures distinct and retryable with no automatic call, exposes no exception data", async () => {
    const detect = vi.fn(async (s: TeamEvidence) => [candidate(s)]).mockRejectedValueOnce(new Error("secret provider key and customer text"));
    const f = fixture(audit(), detect); const snapshot = await f.service.prepare(owner, week);
    const failed = await f.service.analyzeSource(owner, input(snapshot.manifest));
    expect(failed.data).toMatchObject({ status: "failed", candidates: [], code: "CANDIDATE_ANALYSIS_FAILED" }); expect(JSON.stringify(failed)).not.toContain("secret");
    const draft = f.service.materialize(owner, material(snapshot, [failed]));
    expect(draft.batch).toMatchObject({ completed: 0, failed: 1, pending: 0, processingComplete: false }); expect(draft.analysis.complete).toBe(false);
    await expect(f.service.analyzeSource(owner, input(snapshot.manifest, source(), failed))).rejects.toThrow();
    expect(detect).toHaveBeenCalledTimes(1);
    // Driver --retry-failed selects one fresh explicit request, replacing its
    // previous failure artifact rather than merging conflicting checkpoints.
    const completed = await f.service.analyzeSource(owner, input(snapshot.manifest));
    expect(completed.data.status).toBe("completed"); expect(detect).toHaveBeenCalledTimes(2);
    expect(f.service.materialize(owner, material(snapshot, [completed])).analysis.complete).toBe(true);
    for (const receipts of [[failed, completed], [completed, failed]]) expect(() => f.service.materialize(owner, material(snapshot, receipts))).toThrow();
  });
  it("deduplicates exact replay and rejects conflicting successful receipts", async () => {
    const f = fixture(); const snapshot = await f.service.prepare(owner, week); const receipt = await f.service.analyzeSource(owner, input(snapshot.manifest));
    expect(f.service.materialize(owner, material(snapshot, [receipt, copy(receipt)])).matches).toHaveLength(1);
    const conflict = copy(receipt); conflict.data.candidates = []; resign(conflict, "receipt");
    expect(() => f.service.materialize(owner, material(snapshot, [receipt, conflict]))).toThrow();
  });
  it.each([
    { evidenceQuotes: ["invented"] }, { evidenceRevision: "b".repeat(64) }, { evidenceRevision: "invalid" },
    { evidenceId: "other" }, { evidenceQuotes: [] }, { references: [{ kind: "booking", value: "not literal", quote: "The kitchen" }] },
  ] as Array<Partial<TeamComplaintCandidate>>) ("validates injected detector extraction unchanged: %j", async change => {
    const f = fixture(audit(), vi.fn(async (s: TeamEvidence) => [candidate(s, change)]));
    const snapshot = await f.service.prepare(owner, week); const receipt = await f.service.analyzeSource(owner, input(snapshot.manifest));
    expect(receipt.data.status).toBe("failed"); expect(receipt.data.candidates).toEqual([]);
    expect(f.service.materialize(owner, material(snapshot, [receipt])).batch.processingComplete).toBe(false);
  });
  it("preserves eligibility and all excluded gap IDs, distinguishing processing/provenance completeness", async () => {
    const items = [source(), source({ id: "empty", originalText: " " }), source({ id: "missing", bodyBasis: "missing", originalText: null }),
      source({ id: "snippet", bodyBasis: "snippet" }), source({ id: "translation", bodyBasis: "snapshot", limitations: ["Stored translation is a non-original variant"] }),
      source({ id: "outbound", speakerBasis: "non_customer" })];
    const f = fixture(audit(items)); const snapshot = await f.service.prepare(owner, week);
    expect(snapshot.manifest.data.sources).toHaveLength(1); expect(f.detect).not.toHaveBeenCalled();
    const receipt = await f.service.analyzeSource(owner, input(snapshot.manifest)); const draft = f.service.materialize(owner, material(snapshot, [receipt]));
    expect(draft.analysis.notAnalyzedEvidenceIds).toEqual(["empty", "missing", "snippet", "translation"]);
    expect(draft.batch).toMatchObject({ eligible: 1, completed: 1, processingComplete: true, provenanceComplete: false }); expect(draft.analysis.complete).toBe(false);
    for (const s of items.slice(1)) await expect(f.service.analyzeSource(owner, input(snapshot.manifest, s))).rejects.toThrow();
    expect(f.detect).toHaveBeenCalledTimes(1);
  });
  it.each(["collection", "history"]) ("retains incomplete %s provenance after processing completes", async field => {
    const read = audit(); if (field === "collection") read.sources.collectionComplete = false; else read.history.complete = false;
    const f = fixture(read); const snapshot = await f.service.prepare(owner, week); const receipt = await f.service.analyzeSource(owner, input(snapshot.manifest));
    const draft = f.service.materialize(owner, material(snapshot, [receipt]));
    expect(draft.batch.processingComplete).toBe(true); expect(draft.batch.provenanceComplete).toBe(false); expect(draft.analysis.complete).toBe(false);
  });
  it("has no hidden source limit or artifact expiry and never invokes analysis during materialization", async () => {
    const read = audit(Array.from({ length: 1201 }, (_, i) => source({ id: `sms:${i}`, sourceRowId: `${i}` })));
    read.sources.window.capturedAtUtc = "2000-01-01T00:00:00Z";
    const f = fixture(read); const snapshot = await f.service.prepare(owner, week);
    expect(snapshot.manifest.data.sources).toHaveLength(1201);
    expect(f.service.materialize(owner, material(snapshot)).batch.pending).toBe(1201); expect(f.detect).not.toHaveBeenCalled();
  });
  it.each([undefined, "read", "verified", "unpublished_read", null])("requires literal unpublished candidate mode %s", async mode => {
    const f = fixture(); const snapshot = await f.service.prepare(owner, week);
    await expect(f.service.analyzeSource(owner, { ...input(snapshot.manifest), mode } as TeamBatchSourceInput)).rejects.toThrow();
    expect(() => f.service.materialize(owner, { ...material(snapshot), mode } as TeamLeaderboardBatchMaterializeInput)).toThrow(); expect(f.detect).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON, sparse arrays, extra fields, and changed week before model calls", async () => {
    const f = fixture(); await expect(f.service.prepare(owner, { weekStart: "2026-11-16" })).rejects.toThrow(); expect(f.readWeek).not.toHaveBeenCalled();
    const snapshot = await f.service.prepare(owner, week);
    const circular = copy(snapshot.manifest) as TeamBatchManifest & { cycle?: unknown }; circular.cycle = circular;
    for (const manifest of [null, {}, { ...snapshot.manifest, extra: true }, circular, { ...snapshot.manifest, mac: "x" }, { ...snapshot.manifest, data: undefined }])
      await expect(f.service.analyzeSource(owner, input(manifest as TeamBatchManifest))).rejects.toThrow();
    const sparse = material(snapshot); sparse.receipts = new Array(1); expect(() => f.service.materialize(owner, sparse)).toThrow();
    await expect(f.service.analyzeSource(owner, { ...input(snapshot.manifest), read: snapshot.read } as TeamBatchSourceInput)).rejects.toThrow(); expect(f.detect).not.toHaveBeenCalled();
  });
  it("rejects a validly signed manifest that omits eligible sources or disagrees with the immutable week", async () => {
    const f = fixture(); const snapshot = await f.service.prepare(owner, week);
    const omitted = copy(snapshot); omitted.manifest.data.sources = []; resign(omitted.manifest, "manifest");
    expect(() => f.service.materialize(owner, material(omitted))).toThrow();
    const changed = copy(snapshot); changed.manifest.data.weekStart = "2026-11-08"; resign(changed.manifest, "manifest");
    expect(() => f.service.materialize(owner, material(changed))).toThrow();
    const malformed = fixture({ ...audit(), status: "published" } as unknown as TeamEvidenceAuditRead);
    await expect(malformed.service.prepare(owner, week)).rejects.toThrow();
  });
  it("matches monolithic behavior and exception grouping using FULL originals and prior history", async () => {
    const items = [source(), source({ id: "call:2", revision: "b".repeat(64), sourceKind: "phone_unverified", speakerBasis: "unverified", providerId: "p2" }),
      source({ id: "email:3", revision: "c".repeat(64), originalText: "The kitchen was dirty two visits ago", providerId: "p3" }),
      source({ id: "email:4", revision: "d".repeat(64), originalText: "The kitchen was dirty on 2026-11-10", providerId: "p4" }),
      source({ id: "conflict:5", bodyBasis: "snippet", originalText: "Conflicting provider original", providerId: "provider-1" })];
    const read = audit(items); read.history.visits.push({ ...read.history.visits[0], id: 9, jobDate: "2026-11-10", serviceStartUtc: "2026-11-10T13:00:00Z",
      progressUpdatedAtUtc: "2026-11-10T16:00:00Z", signoffAtUtc: "2026-11-10T15:59:00Z", jobUpdatedAtUtc: "2026-11-10T16:00:00Z" });
    const detect = vi.fn(async (s: TeamEvidence) => [candidate(s, s.id === "email:3" ? { references: [{ kind: "unresolved", value: null, quote: "two visits ago" }] }
      : s.id === "email:4" ? { references: [{ kind: "service_date", value: "2026-11-10", quote: "2026-11-10" }] } : {})]);
    const monolithic = await createTeamEvidenceService({ port: { select: vi.fn(async () => []) }, clock: () => now,
      readEvidence: async () => copy(read.sources), readHistory: async () => copy(read.history), detect }).analyzeWeek(week);
    const f = fixture(read, detect); const snapshot = await f.service.prepare(owner, week); const receipts: TeamBatchReceipt[] = [];
    for (const s of items.slice(0, 4)) receipts.push(await f.service.analyzeSource(owner, input(snapshot.manifest, s)));
    const { batch, ...result } = f.service.materialize(owner, material(snapshot, receipts.reverse()));
    expect(result).toEqual(monolithic); expect(batch).toMatchObject({ completed: 4, processingComplete: true, provenanceComplete: false });
    expect(result.matches[0].limitations).toContain("same_provider_conflicting_evidence_retained");
    expect(result.matches[1].reviewReasons).toContain("call_speaker_unverified_fault_not_verified"); expect(result.matches[1].status).toBe("matched");
    expect(result.matches[2].reviewReasons).toContain("unresolved_explicit_reference"); expect(result.matches[2].visit).toBeNull();
    expect(result.matches[3].visit?.id).toBe(9); expect(result.matches[3].includedInRequestedWeek).toBe(false);
    expect(result.visitGroups).toHaveLength(2); expect(result.visitGroups[0].evidenceIds).toEqual(["sms:1", "call:2"]);
    expect(result.matches.every(m => !m.verified && !m.eligibleForScore)).toBe(true); expect(result.scoreResults).toBeNull(); expect(result.publication).toBeNull();
  });
});
