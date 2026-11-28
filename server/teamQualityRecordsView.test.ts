// Phase 2 staff screen for quality records — synthetic SSR only, no network or database.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { QualityRecordsList, TeamQualityRecords, qualityFilterFor } from "../client/src/components/TeamQualityRecords";

const base = { primaryId: null, channel: "sms", detector: "claude_sms", reportedAtMs: Date.parse("2026-11-24T15:00:00Z"), weekStart: "2026-11-22",
  customerPhone: "+12025550111", customerEmail: null, customerName: "Test Customer", evidenceQuote: "The bathroom was not cleaned", evidenceText: "The bathroom was not cleaned at all.",
  sourceRef: null, severity: "medium", serviceDateHint: null, statusNote: null, processingError: null, processingAttempts: 1, updatedBy: null, createdAtMs: 1, updatedAtMs: 1,
  recleanStatus: "none", refundStatus: "none", processingStatus: "ok", status: "open", messages: [] as any[] };
const counted = { ...base, id: 1, sourceKey: "sms:a", category: "cleaning_quality", attribution: "auto", attributionNote: "Matched the only completed visit, 2026-11-23.", leadflowJobId: 1001, teamId: 1,
  messages: [{ ...base, id: 2, primaryId: 1, sourceKey: "review:e1", channel: "review", evidenceQuote: "Still dirty", messages: undefined }] };
const review = { ...base, id: 3, sourceKey: "email:thread:t1", channel: "email", category: "unclassified", attribution: "unattributed", attributionNote: "No completed visit found for this customer in the 7 days before the message.", leadflowJobId: null, teamId: null, evidenceQuote: null, evidenceText: "Customer is upset about the cleaning" };
const billing = { ...base, id: 4, sourceKey: "sms:b", category: "pricing_billing", attribution: "auto", attributionNote: "x", leadflowJobId: 1002, teamId: 2, refundStatus: "requested" };
const failed = { ...base, id: 5, sourceKey: "sms:c", category: "cleaning_quality", attribution: "unattributed", attributionNote: null, leadflowJobId: null, teamId: null, processingStatus: "failed", processingError: "QUALITY_PROCESSING_FAILED" };
const state = vi.hoisted(() => ({ list: {} as any }));
vi.mock("@/lib/trpc", () => {
  const query = (get: () => unknown) => ({ useQuery: () => ({ ...(get() as object), refetch: vi.fn() }) });
  const mutation = { useMutation: () => ({ mutateAsync: vi.fn() }) };
  return { trpc: { leadflowJobs: { leaderboard: { history: {
    qualityRecords: query(() => state.list), reviewRuns: query(() => ({ data: { runs: [] } })), qualityChoices: query(() => ({ data: undefined })),
    qualityAction: mutation, qualityRetry: mutation, importReviewToRecords: mutation, publishFromRecords: mutation,
  } } } } };
});

describe("quality records staff screen", () => {
  it("sorts incidents by the automatic decisions: counted / not the team's responsibility / supporting signals", () => {
    expect([counted, review, billing].map(i => qualityFilterFor(i as any))).toEqual(["counted", "signals", "not_team"]);
    expect(qualityFilterFor({ ...counted, status: "dismissed" } as any)).toBe("dismissed");
  });
  it("shows the automatic results with the original evidence and reason; overrides are optional and failures retry automatically", () => {
    state.list = { data: { agentId: 7, incidents: [counted, review, billing], unprocessed: [failed], teamNames: { "1": "Team Alba (Test)", "2": "Team Bravo (Test)" } }, isError: false };
    const html = renderToStaticMarkup(React.createElement(QualityRecordsList, { agentId: 7, weekStart: "2026-11-22", onChanged: vi.fn() }));
    expect(html).toContain("Counted against a team (1)"); expect(html).toContain("Not the team&#x27;s responsibility (1)"); expect(html).toContain("Supporting signals / no matching visit (1)");
    // The counted list is shown first, with the automatic match and the original customer evidence.
    expect(html).toContain("Cleaning quality · medium · Team Alba (Test) · job 1001");
    expect(html).toContain("Matched automatically: Matched the only completed visit, 2026-11-23.");
    expect(html).toContain("The bathroom was not cleaned at all.");
    expect(html).toContain("Staff override (optional)");
    expect(html).not.toContain("staff should choose");
    for (const control of ["Choose the visit/team", "Dismiss", "Mark resolved", "Category", "Reclean", "Refund", "Merge into…"]) expect(html).toContain(control);
    expect(html).toContain("Records waiting to be processed (1)");
    expect(html).toContain("It is retried automatically each time the scores are recalculated");
    expect(html).toContain("No reply is re-sent.");
    expect(html).toContain("Code: QUALITY_PROCESSING_FAILED");
  });
  it("keeps the panel closed (nothing read) until staff open it, with the live/published toggle always available", () => {
    const html = renderToStaticMarkup(React.createElement(TeamQualityRecords, { agentId: 7, weekStart: "2026-11-22", fromRecords: false, onToggleRecords: vi.fn(), expectedPublicationId: null, onChanged: vi.fn() }));
    expect(html).toContain("Show records"); expect(html).toContain("Show this week&#x27;s automatic scores");
    expect(html).toContain("No staff action is needed; overrides are optional.");
    expect(html).not.toContain("Counted against a team");
    const live = renderToStaticMarkup(React.createElement(TeamQualityRecords, { agentId: 7, weekStart: "2026-11-22", fromRecords: true, onToggleRecords: vi.fn(), expectedPublicationId: null, onChanged: vi.fn() }));
    expect(live).toContain("Publish these scores"); expect(live).toContain("Show published results");
  });
});
