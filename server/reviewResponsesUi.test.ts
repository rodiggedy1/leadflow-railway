import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import type { ReviewEntry, ReviewResponseApi } from "../shared/reviewResponses";

// Keep the UI test completely independent of routers, providers, models and databases.
const gateMocks = vi.hoisted(() => ({ me: vi.fn(), utils: vi.fn(() => { throw new Error("Unauthorized review hook was mounted"); }) }));
vi.mock("@/lib/trpc", () => ({ trpc: { agents: { me: { useQuery: gateMocks.me } }, useUtils: gateMocks.utils } }));
import ReviewResponses, {
  ReviewResponseWorkspace,
  createReviewResponseOperationGuard,
  mergeReviewResponseEntry,
  parseManualReview,
  reviewResponseCanApprove,
  reviewResponseCanDraft,
  reviewResponseMatchesFilters,
} from "../client/src/pages/ReviewResponses";

const root = resolve(import.meta.dirname, "..");
const source = readFileSync(resolve(root, "client/src/pages/ReviewResponses.tsx"), "utf8");
const css = readFileSync(resolve(root, "client/src/pages/review-responses.css"), "utf8");
function entry(overrides: Partial<ReviewEntry> = {}): ReviewEntry {
  // Test-only records are never imported into the customer-facing workspace.
  return {
    key: "a".repeat(64), revision: 3,
    review: { platform: "google", accountId: "test-account", businessId: "test-business", reviewId: "test-review", rating: 5, reviewerName: "Test reviewer", text: "The team was careful.", createdAt: "2026-11-01T12:00:00Z", updatedAt: null, existingResponse: null, negotiationId: null, source: "manual" },
    status: "DRAFT_READY", generatedDraft: "Thanks for your kind words about the team!", approvedText: null, approvedBy: null, approvedAt: null,
    publishedResponse: null, publishedAt: null, generationRequestId: null, generationStartedAt: null,
    severityReasons: [], validationIssues: [], escalationStatus: "not_required", createdAt: 1, updatedAt: 2, events: [],
    ...overrides,
  };
}
const manual = {
  platform: "thumbtack" as const, accountId: "actual-account", businessId: "actual-business", reviewId: "actual-review",
  rating: "4", reviewerName: "", text: "", createdAt: "2026-11-01T12:30:00-05:00", existingResponse: "",
};
function mockApi(): ReviewResponseApi {
  return { list: vi.fn(async () => []), ingest: vi.fn(), generate: vi.fn(), edit: vi.fn(), approve: vi.fn(), acknowledge: vi.fn() };
}

// AST inspection checks the options on every actual useQuery call, not a comment/string match.
const ast = ts.createSourceFile("ReviewResponses.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callsNamed(name: string) {
  const found: ts.CallExpression[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === name) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast); return found;
}

describe("isolated review response draft-only UI", () => {
  it("exports a renderable injected-API workspace and starts with no fabricated records", () => {
    const api = mockApi();
    const html = renderToStaticMarkup(React.createElement(ReviewResponseWorkspace, { api }));
    expect(html).toContain("Review Response Workbench");
    expect(html).toContain("Select a saved review");
    expect(html).toContain("Monitoring off");
    expect(html).toContain("Publishing disabled");
    expect(html).toContain('disabled=""');
    expect(html).toContain('type="text"');
    expect(html).not.toContain("Test reviewer");
    Object.values(api).forEach(fn => expect(fn).not.toHaveBeenCalled());
    expect(source).toContain("useState<ReviewEntry[]>([])");
    expect(source).toContain("No reviews recorded yet");
    expect(source).toContain("No sample data has been substituted");
  });

  it("renders session loading, failed, signed-out and non-admin states without mounting review hooks", () => {
    gateMocks.utils.mockClear();
    const states = [
      { query: { isLoading: true }, title: "Checking administrator access" },
      { query: { isLoading: false, isError: true, error: { message: "Offline session error" } }, title: "Unable to confirm administrator access" },
      { query: { isLoading: false, isError: false, data: null }, title: "Staff sign-in required" },
      { query: { isLoading: false, isError: false, data: { id: 1, isAdmin: false } }, title: "Administrator access required" },
      { query: { isLoading: false, isError: false, data: { id: 1, isAdmin: 1 } }, title: "Administrator access required" },
    ];
    for (const state of states) {
      gateMocks.me.mockReturnValue(state.query);
      expect(renderToStaticMarkup(React.createElement(ReviewResponses))).toContain(state.title);
    }
    expect(gateMocks.utils).not.toHaveBeenCalled();
  });

  it("accepts explicit manual IDs and ISO timestamps without inventing IDs, context or responses", () => {
    const parsed = parseManualReview(manual);
    expect(parsed).toMatchObject({ platform: "thumbtack", source: "manual", reviewId: "actual-review", rating: 4, text: "", createdAt: manual.createdAt, negotiationId: null, existingResponse: null });
    expect(parseManualReview({ ...manual, existingResponse: "Already thanked" }).existingResponse).toBe("Already thanked");
    for (const key of ["accountId", "businessId", "reviewId", "createdAt"] as const) {
      expect(() => parseManualReview({ ...manual, [key]: "" })).toThrow();
    }
    expect(() => parseManualReview({ ...manual, createdAt: "2026-11-01" })).toThrow();
    expect(() => parseManualReview({ ...manual, rating: "" })).toThrow();
    expect(() => parseManualReview({ ...manual, rating: "6" })).toThrow();
    expect(() => parseManualReview({ ...manual, rating: "1.5" })).toThrow();
    expect(source).toContain("Context not matched or verified in this workspace. No name-based matching.");
  });

  it("applies platform, exact star-rating and persisted-status filters independently and together", () => {
    const review = entry();
    expect(reviewResponseMatchesFilters(review, { platform: "all", rating: "all", status: "all" })).toBe(true);
    expect(reviewResponseMatchesFilters(review, { platform: "google", rating: "5", status: "DRAFT_READY" })).toBe(true);
    expect(reviewResponseMatchesFilters(review, { platform: "thumbtack", rating: "5", status: "DRAFT_READY" })).toBe(false);
    expect(reviewResponseMatchesFilters(review, { platform: "google", rating: "4", status: "DRAFT_READY" })).toBe(false);
    expect(reviewResponseMatchesFilters(review, { platform: "google", rating: "5", status: "APPROVED" })).toBe(false);
  });

  it("blocks drafting of existing replies, publication records and unresolved generation states", () => {
    expect(reviewResponseCanDraft(entry())).toBe(true);
    for (const status of ["DRAFTING", "PUBLISHED", "ALREADY_REPLIED", "UNCERTAIN"] as const) {
      expect(reviewResponseCanDraft(entry({ status }))).toBe(false);
    }
    const review = entry();
    expect(reviewResponseCanDraft(entry({ review: { ...review.review, existingResponse: "Existing reply" } }))).toBe(false);
    expect(reviewResponseCanDraft(entry({ publishedResponse: "Recorded public reply" }))).toBe(false);
  });

  it("approves only a saved unchanged validated draft and never reapproves an approved revision", () => {
    const review = entry();
    expect(reviewResponseCanApprove(review, review.generatedDraft!)).toBe(true);
    expect(reviewResponseCanApprove(entry({ status: "NEEDS_APPROVAL" }), review.generatedDraft!)).toBe(true);
    expect(reviewResponseCanApprove(review, "Unsaved changes")).toBe(false);
    expect(reviewResponseCanApprove(review, "")).toBe(false);
    expect(reviewResponseCanApprove(entry({ validationIssues: ["Unsupported claim"] }), review.generatedDraft!)).toBe(false);
    for (const status of ["RECORDED", "APPROVED", "ALREADY_REPLIED", "PUBLISHED", "DRAFTING", "FAILED", "UNCERTAIN"] as const) {
      expect(reviewResponseCanApprove(entry({ status }), review.generatedDraft!)).toBe(false);
    }
  });

  it("retains newer revisions when a stale action or refetch returns", () => {
    const saved = entry({ revision: 9, status: "APPROVED", approvedText: "Saved approval" });
    expect(mergeReviewResponseEntry([saved], entry({ revision: 8 }))).toEqual([saved]);
    const updated = entry({ revision: 10 });
    expect(mergeReviewResponseEntry([saved], updated)).toEqual([updated]);
    const other = entry({ key: "b".repeat(64) });
    expect(mergeReviewResponseEntry([saved], other)).toEqual([other, saved]);
  });

  it("locks synchronously against double generation, approval and overlapping refresh; invalidates late responses", () => {
    const guard = createReviewResponseOperationGuard();
    const token = guard.begin()!;
    expect(guard.busy()).toBe(true);
    expect(guard.begin()).toBeNull();
    expect(guard.current(token)).toBe(true);
    guard.invalidate();
    expect(guard.current(token)).toBe(false);
    const replacement = guard.begin()!;
    expect(replacement).not.toBe(token);
    guard.finish(token);
    expect(guard.busy()).toBe(true);
    expect(guard.begin()).toBeNull();
    guard.finish(replacement);
    expect(guard.busy()).toBe(false);
  });

  it("gates the connected module by the existing admin session and adds no transport or authority", () => {
    const gate = source.slice(source.indexOf("export default function ReviewResponses()"));
    expect(gate).toContain("trpc.agents.me.useQuery");
    expect(gate.indexOf("if (me.data.isAdmin !== true)")).toBeLessThan(gate.indexOf("return <ConnectedReviewResponses"));
    expect(source).toContain("utils.aiActions.reviewResponses.list.fetch");
    expect(source).toContain('refetchType: "none"');
    expect(source).toContain("trpc.aiActions.reviewResponses.status.useQuery");
    for (const action of ["ingest", "generate", "edit", "approve", "acknowledge"]) expect(source).toContain(`trpc.aiActions.reviewResponses.${action}.useMutation({ retry: false })`);
    expect(source).toContain('ingestAsync({ ...review, source: "manual" })');
    expect(source).toContain("status.data.monitoringEnabled !== false");
    expect(source).toContain("status.data.publicationEnabled !== false");
    expect(source).toContain("status.data.autoPublishEnabled !== false");
    expect(source).not.toMatch(/(?<![\w.])(?:fetch|axios|XMLHttpRequest|WebSocket)\s*\(/);
    expect(source).not.toMatch(/reviewResponses\.(?:publish|monitor|enable|send)/);
  });

  it("disables retry, focus refetch, reconnect refetch and intervals on every query", () => {
    const queries = callsNamed("useQuery");
    expect(queries).toHaveLength(2);
    for (const call of queries) {
      const options = call.arguments[1].getText(ast);
      for (const key of ["retry", "refetchOnWindowFocus", "refetchOnReconnect", "refetchInterval"]) expect(options).toContain(`${key}: false`);
    }
    expect(source).not.toMatch(/setInterval|setTimeout|refetchInterval:\s*[0-9]/);
    const startup = source.slice(source.indexOf("useEffect(() =>"), source.indexOf("async function refresh()"));
    expect(startup).toContain("api.list()");
    expect(startup).not.toMatch(/api\.(?:ingest|generate|approve|acknowledge|edit)\(/);
  });

  it("binds edits and approvals to the exact saved revision; acknowledgements never imply approval", () => {
    expect(source).toContain("api.edit({ key: selected.key, text: draftText, expectedRevision: selected.revision })");
    expect(source).toContain("api.approve({ key: selected.key, expectedRevision: selected.revision })");
    expect(source).toContain("api.acknowledge({ key: selected.key, expectedRevision: selected.revision })");
    expect(source).toContain("Management alert acknowledged. This does not approve the draft.");
    expect(source).toContain("Draft saved. Any previous approval is cleared.");
    expect(source).toContain("Approved — not published");
    expect(source).toContain("Refresh before another action. Nothing was published.");
  });

  it("keeps review and generated content as plain React text and creates no calendar, demo mode or unrelated imports", () => {
    expect(source).not.toMatch(/dangerouslySetInnerHTML|ReactMarkdown|DOMParser|innerHTML/);
    expect(source).not.toMatch(/type=["'](?:date|datetime-local)["']|DayPicker|Calendar/);
    const forbiddenDataNames = [["cleaner", "jobs"].join("_"), ["cleaner", "Jobs"].join("")];
    for (const name of forbiddenDataNames) expect(source).not.toContain(name);
    expect(source).not.toMatch(/CsInbox|CommandChat|sms|twilio|gmail|fixture|sampleReviews|demoData/i);
    expect(source).toContain("{selected.review.text ||");
    expect(source).toContain("{selected.approvedText}");
    expect(css).toContain(".rr-page");
    expect(css).toContain("@media(max-width:600px)");
    expect(css).not.toMatch(/(?:^|\n)(?:body|html|:root|\*)\s*\{/);
  });
});
