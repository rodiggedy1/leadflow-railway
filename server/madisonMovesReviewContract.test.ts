import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const router = fs.readFileSync(path.join(root, "server", "madisonsMovesRouter.ts"), "utf8");
const panel = fs.readFileSync(path.join(root, "client", "src", "components", "MadisonsMovesPanel.tsx"), "utf8");

describe("Madison’s Moves review-first contract", () => {
  it("uses an explicit send mutation and rechecks the live move before sending", () => {
    expect(router).toContain("send: agentProcedure");
    expect(router).toContain("const liveMoves = await listMadisonMoves(db)");
    expect(router).toContain("Customer opted out via STOP");
  });

  it("keeps the right-column contact action behind the shared review card", () => {
    expect(panel).toContain("<BulkSmsConfirmCard");
    expect(panel).toContain("onReviewSend={async");
    expect(panel).toContain("Review & send");
  });

  it("generates Fill Capacity only from a verified stored cancellation opening", () => {
    const moves = fs.readFileSync(path.join(root, "server", "madison", "moves.ts"), "utf8");
    expect(moves).toContain('const fillKey = `fill:${moveKey}`');
    expect(moves).toContain('kind: "fill_capacity"');
    expect(moves).toContain('row.meta.kind !== "save_cancellation"');
  });
});
