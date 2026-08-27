import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const router = fs.readFileSync(path.join(root, "server", "madisonsMovesRouter.ts"), "utf8");
const panel = fs.readFileSync(path.join(root, "client", "src", "components", "MadisonsMovesPanel.tsx"), "utf8");
const moves = fs.readFileSync(path.join(root, "server", "madison", "moves.ts"), "utf8");

describe("Madison’s Moves review-first contract", () => {
  it("uses an explicit send mutation and rechecks the live move before sending", () => {
    expect(router).toContain("send: agentProcedure");
    expect(router).toContain("export async function sendMadisonMove");
    expect(router).toContain("const liveMoves = await dependencies.listMoves(db)");
    expect(router).toContain("Customer opted out via STOP");
  });

  it("keeps the right-column contact action behind the shared review card", () => {
    expect(panel).toContain("<BulkSmsConfirmCard");
    expect(panel).toContain("onReviewSend={async");
    expect(panel).toContain("Review & send");
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
    expect(capacity).toContain("reactivationEligible");
    expect(capacity).toContain("contacted in a campaign within 7 days");
  });
});
