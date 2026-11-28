// Phase 2: weekly scores and publication from saved quality records; one-time import of a finished review. No I/O.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createTeamLeaderboardHistoryService, LEGACY_TEAM_WEEK_ID } from "./teamLeaderboardHistoryService";
import type { ReviewRecord, TeamHistoryRepository } from "./teamLeaderboardHistoryRepository";
import type { TeamWeekCounts, StoredIncident } from "./teamLeaderboardHistoryMetrics";
import { TEAM_SCORE_METRICS } from "../shared/teamLeaderboard";
import { rankAssessedScores } from "../shared/teamLeaderboardReviewScores";

const copy = <T>(value: T): T => structuredClone(value);
function memory() {
  const records = new Map<string, ReviewRecord>(); const pointers = new Map<string, string>();
  const repository: TeamHistoryRepository = {
    async insert(value) { if (records.has(value.id)) return false; records.set(value.id, copy(value)); return true; },
    async get(key) { return records.has(key) ? copy(records.get(key)!) : null; },
    async listRuns(week) { return Array.from(records.values()).filter(v => v.weekStart === week).map(copy); },
    async update(key, patch) { Object.assign(records.get(key)!, copy(patch)); },
    async latestPublications() { return Array.from(pointers.values()).map(key => copy(records.get(key)!)); },
    async publish(key, snapshot, expected, actor, now, fallback) {
      const value = records.get(key)!;
      if ((pointers.get(value.weekStart) ?? fallback ?? null) !== expected) throw new Error("PUBLICATION_CONFLICT");
      Object.assign(value, { status: "published", publication: copy(snapshot), publishedAtMs: now, publishedBy: actor }); pointers.set(value.weekStart, key); return copy(value);
    },
  };
  return { records, pointers, repository };
}
const row = (id: string, jobs: number) => ({ id, name: `Synthetic ${id}`, eligibleJobs: jobs,
  metrics: Object.fromEntries(TEAM_SCORE_METRICS.map(({ key }) => [key, { successful: jobs, eligible: jobs, complete: true }])) as any });
const counts = (complete = true): TeamWeekCounts => ({ period: { weekStart: "2026-11-22", weekEnd: "2026-11-28", weekConvention: "Sunday-start", coverageStart: "2026-11-22", coverageEnd: "2026-11-24" },
  teams: [row("1", 8), row("2", 8)], complete, warnings: [] });
const incident = (id: number, change: Partial<StoredIncident> = {}): StoredIncident => ({ id, teamId: 1, leadflowJobId: 100 + id, category: "cleaning_quality", attribution: "auto",
  status: "open", recleanStatus: "none", refundStatus: "none", processingStatus: "ok", reportedAtMs: Date.parse("2026-11-24T15:00:00Z"), severity: "medium", jobDate: "2026-11-23", ...change });
function setup(incidents: StoredIncident[], complete = true) {
  const store = memory(), record = vi.fn(async () => ({ duplicate: false, processed: true }));
  const service = createTeamLeaderboardHistoryService({ repository: store.repository, readWeek: vi.fn(), readCounts: vi.fn(async () => counts(complete)),
    quality: { readIncidents: vi.fn(async () => copy(incidents)), record }, now: () => Date.parse("2026-11-24T20:00:00Z") });
  return { ...store, service, record };
}

describe("scores from saved quality records (no AI review)", () => {
  it("counts each team-attributable incident once and ignores refund-only, office, unclassified, dismissed and unattributed records", async () => {
    const env = setup([incident(1), incident(2, { recleanStatus: "completed", refundStatus: "issued" }), incident(3, { teamId: 2, category: "team_service" }),
      incident(4, { category: "pricing_billing", refundStatus: "requested" }), incident(5, { category: "unclassified", refundStatus: "requested" }),
      incident(6, { status: "dismissed" }), incident(7, { attribution: "unattributed", teamId: null, leadflowJobId: null }), incident(8, { processingStatus: "failed" })]);
    const { snapshot, countsComplete } = await env.service.live("2026-11-22");
    expect(countsComplete).toBe(true);
    expect(snapshot.details["1"]).toMatchObject({ complaintCases: 2, confirmedRecoveryCases: 1, refundRequests: 1 });
    expect(snapshot.details["2"]).toMatchObject({ complaintCases: 1, confirmedRecoveryCases: 0 });
    const ranked = rankAssessedScores(snapshot.publication.teams, snapshot.details);
    expect(ranked.map(t => [t.id, t.rank])).toEqual([["2", 1], ["1", 2]]);
    expect(env.record).not.toHaveBeenCalled();
  });
  it("publishes from records with the existing publication pointer, and only with complete job counts", async () => {
    const env = setup([incident(1)]);
    const result = await env.service.publishFromRecords(42, { requestId: "11111111-1111-4111-8111-111111111111", weekStart: "2026-11-22", expectedPublicationId: null });
    expect(result).toMatchObject({ id: "11111111-1111-4111-8111-111111111111", weekStart: "2026-11-22" });
    expect(env.records.get(result.id)!.payload.source).toBe("quality_records");
    expect((await env.service.published({ weekStart: "2026-11-22" })).publication.publishedLabel).toBe("Calculated from saved quality records");
    // Same request again: the same publication, not a second one.
    expect(await env.service.publishFromRecords(42, { requestId: result.id, weekStart: "2026-11-22", expectedPublicationId: result.id })).toMatchObject({ id: result.id });
    const incomplete = setup([incident(1)], false);
    await expect(incomplete.service.publishFromRecords(42, { requestId: "22222222-2222-4222-8222-222222222222", weekStart: "2026-11-22", expectedPublicationId: null })).rejects.toThrow("WEEK_REVIEW_NOT_READY");
    expect(LEGACY_TEAM_WEEK_ID).toBeTruthy();
  });
  it("imports a finished review's findings once, keyed to the original message so a live label is not duplicated", async () => {
    const env = setup([]);
    const reviewId = "33333333-3333-4333-8333-333333333333";
    const match = (evidenceId: string, status: string, category: string) => ({ candidate: { evidenceId, evidenceRevision: "a".repeat(64), summary: "Synthetic summary", category, evidenceQuotes: ["quote"], references: [] },
      status, visit: status === "matched" ? { id: 501, serviceDate: "2026-11-23" } : null, team: status === "matched" ? { id: 1 } : null, reportAtUtc: "2026-11-24T15:00:00Z" });
    env.records.set(reviewId, { id: reviewId, weekStart: "2026-11-22", ownerId: 42, createdAtMs: 1, updatedAtMs: 1, status: "completed", progress: null, publication: null, publishedAtMs: null, publishedBy: null,
      payload: { counts: counts(), read: { sources: { evidence: [{ id: "ev-sms", sourceKind: "sms", providerId: "OP-123", customerPhone: "+12025550111" }, { id: "ev-call", sourceKind: "ai_call" }] } } as any,
        outcome: { candidates: [], visitGroups: [], validOutput: true, rejectedCandidateCount: 0, verifiedComplaintCount: null, verifiedRecleanRefundCount: null, publication: null, scoreResults: null,
          matches: [match("ev-sms", "matched", "cleaning_quality"), match("ev-call", "unattributed", "refund_request")] } as any } });
    const result = await env.service.importReview(reviewId);
    expect(result).toEqual({ reviewId, added: 2, duplicates: 0, failed: 0 });
    expect(env.record.mock.calls[0][0]).toMatchObject({ sourceKey: "sms:OP-123", leadflowJobId: 501, category: "cleaning_quality", channel: "review" });
    // A refund request alone is never auto-classified as a team issue.
    expect(env.record.mock.calls[1][0]).toMatchObject({ sourceKey: "review:ev-call", leadflowJobId: null, category: "unclassified", refundRequested: true });
  });
});

describe("migration 0083 (owner-approved table)", () => {
  it("is appended to the manifest with the exact SQL hash and verified postconditions", () => {
    const manifest = JSON.parse(readFileSync(new URL("./versioned-migrations/manifest.json", import.meta.url), "utf8"));
    const entry = manifest.migrations.find((m: { id: string }) => m.id === "0083_create_team_quality_incidents");
    const sql = readFileSync(new URL(`./versioned-migrations/${entry.sqlFile}`, import.meta.url));
    expect(entry).toMatchObject({ mode: "create-table", replayMode: "verified-idempotent", sha256: createHash("sha256").update(sql).digest("hex") });
    expect(manifest.migrations.at(-1).id).toBe("0083_create_team_quality_incidents");
    const post = JSON.parse(readFileSync(new URL(`./versioned-migrations/${entry.postconditionsFile}`, import.meta.url), "utf8"));
    expect(post.columns.find((c: { name: string }) => c.name === "id")).toMatchObject({ autoIncrement: true });
    expect(post.indexes.find((i: { name: string }) => i.name === "team_quality_incidents_source")).toEqual({ name: "team_quality_incidents_source", columns: ["sourceKey"], unique: true });
    expect(sql.toString()).toMatch(/^-- Owner-approved Phase 2 table/);
    expect(sql.toString()).not.toMatch(/\b(ALTER|DROP|INSERT|UPDATE|DELETE)\b/i);
  });
});
