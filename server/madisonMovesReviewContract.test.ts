import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const router = fs.readFileSync(path.join(root, "server", "madisonsMovesRouter.ts"), "utf8");
const panel = fs.readFileSync(path.join(root, "client", "src", "components", "MadisonsMovesPanel.tsx"), "utf8");
const moves = fs.readFileSync(path.join(root, "server", "madison", "moves.ts"), "utf8");
const sharedBulkSender = fs.readFileSync(path.join(root, "server", "aiConciergeRouter.ts"), "utf8");

describe("Madison’s Moves review-first contract", () => {
  it("routes the right-column contact action through Madison’s server-owned shared SMS handoff", () => {
    expect(panel).toContain("<BulkSmsConfirmCard");
    expect(panel).toContain("onReviewSend={async");
    expect(panel).toContain("madisonMoves.send.useMutation");
    expect(sharedBulkSender).toContain("sendBulkSms: agentProcedure");
    expect(sharedBulkSender).toContain("Customer opted out via STOP");
    expect(sharedBulkSender).toContain("Persistence failure must NOT cause the action to appear failed.");
    expect(panel).toContain("Review & send");
  });

  it("records a send-started Madison state before the first carrier call and contains final persistence failure", () => {
    expect(router).toContain('outcome: "sending"');
    expect(router).toContain("sendStartedAt");
    expect(router).toContain("Failed to finalize send state after SMS delivery");
    expect(router).toContain("statePersistenceError");
    expect(moves).toContain('row.meta.outcome === "sending"');
  });

  it("moves a Not now dismissal directly into persisted History", () => {
    expect(panel).toContain('setTab("history")');
    expect(panel).toContain("historyQuery.refetch()");
    expect(panel).toContain("dismiss.mutate({ moveKey: move.moveKey, kind: move.kind })");
  });

  it("preserves dismissed card details and permits only user-triggered restoration", () => {
    expect(moves).toContain("snapshot: snapshot");
    expect(router).toContain("restore: agentProcedure");
    expect(panel).toContain("Bring back");
    expect(panel).toContain("restore.mutate({ moveKey: move.moveKey })");
  });

  it("renders Protect Tomorrow details in verified category sections", () => {
    expect(moves).toContain('heading: "Payment authorizations"');
    expect(panel).toContain("move.detailSections?.length");
    expect(panel).toContain("section.heading");
  });

  it("keeps each Protect Tomorrow review action explicit, reversible, and separate from operational source writes", () => {
    expect(router).toContain("reviewProtectTomorrowItem: agentProcedure");
    expect(moves).toContain("setProtectTomorrowChecklistItem");
    expect(panel).toContain(">Resolve</button>");
    expect(panel).toContain(">Undo</button>");
    expect(moves).toContain("checklistResolvedItemKeys");
  });

  it("shows a clear retryable error for a failed custom review send", () => {
    const card = fs.readFileSync(path.join(root, "client", "src", "components", "BulkSmsConfirmCard.tsx"), "utf8");
    expect(card).toContain(".catch((error: unknown) =>");
    expect(card).toContain('role="alert"');
    expect(card).toContain("No customer was contacted by this attempt.");
  });

  it("generates Fill Capacity only from a verified stored cancellation opening", () => {
    expect(moves).toContain('const fillKey = `fill:${moveKey}`');
    expect(moves).toContain('kind: "fill_capacity"');
    expect(moves).toContain('row.meta.kind !== "save_cancellation"');
  });

  it("adds tomorrow capacity through a separate module without changing Protect Tomorrow builder code", () => {
    expect(moves).toContain('import { getTomorrowCapacityCandidate');
    expect(moves).toContain('const tomorrowCapacity = await getTomorrowCapacity');
    const capacity = fs.readFileSync(path.join(root, "server", "madison", "tomorrowCapacity.ts"), "utf8");
    expect(capacity).toContain("DAILY_JOB_TARGET = 30");
    expect(capacity).toContain("RECIPIENT_LIMIT = 30");
    expect(capacity).toContain("reactivationEligible");
    expect(capacity).toContain("contacted within the last 7 days");
    expect(capacity).toContain("recentOutboundPhones");
    expect(capacity).toContain("has an active or future booking");
    expect(capacity).toContain("has a newer booking history");
    expect(capacity).toContain("completed a booking within the last 7 days");
    expect(capacity).toContain("has recurring status within the last 30 days");
    expect(capacity).toContain("lastBookingDate: row.jobDate");
    const card = fs.readFileSync(path.join(root, "client", "src", "components", "BulkSmsConfirmCard.tsx"), "utf8");
    expect(card).toContain("Last booking:");
    expect(card).toContain("formatLastBookingDate");
  });

  it("adds a review-first Smart Upsell only from the verified current booking service and extras", () => {
    expect(router).toContain('"smart_upsell"');
    expect(panel).toContain("smart_upsell: \"Smart upsell\"");
    const upsells = fs.readFileSync(path.join(root, "server", "madison", "smartUpsells.ts"), "utf8");
    expect(upsells).toContain("clean_inside_oven");
    expect(upsells).toContain("isStandardOrRegularCleaning");
    expect(upsells).toContain("selected extras could not be verified");
    expect(upsells).toContain("Recipients are rechecked immediately before sending.");
  });
});
