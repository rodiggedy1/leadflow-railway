/**
 * Regression tests for priority-aware ETA card selection.
 *
 * Root cause (2026-07-21): when a manual "success" ETA card and an "unclear"
 * voicemail card share the same createdAt timestamp, the DB's nondeterministic
 * ordering could surface the "unclear" card, hiding the valid manual ETA.
 *
 * The fix uses a priority-aware selection function (extracted here for testing)
 * instead of relying on DB insertion order alone.
 */

import { describe, it, expect } from "vitest";

// ─── Inline the selection logic (mirrors fieldMgmtRouter.ts) ─────────────────

type EtaCardMeta = {
  resultType: "success" | "no_answer" | "unclear" | "dispatcher_needed";
  etaTimeStr: string | null;
  etaStatus: string | null;
  cleanerStatement: string | null;
  clientNotified: boolean;
  step: string | null;
  clientSmsBody: string | null;
  recordingUrl: string | null;
  transcript: string | null;
  vapiCallId: string | null;
  scheduledTime: string | null;
};

type EtaCardRow = {
  id: number;
  cleanerJobId: number | null;
  metadata: string | null;
  createdAt: Date;
};

function etaCardPriority(meta: EtaCardMeta): number {
  if (meta.resultType === "success" && meta.etaStatus) return 0;
  if (meta.resultType === "no_answer" || meta.resultType === "dispatcher_needed") return 1;
  return 2; // unclear or success without etaStatus
}

function selectBestEtaCard(rows: EtaCardRow[]): Map<number, { meta: EtaCardMeta; id: number; priority: number }> {
  const result = new Map<number, { meta: EtaCardMeta; createdAt: Date; id: number; priority: number }>();
  for (const row of rows) {
    const jobId = row.cleanerJobId;
    if (!jobId) continue;
    let meta: EtaCardMeta;
    try {
      meta = JSON.parse(row.metadata ?? "{}") as EtaCardMeta;
    } catch { continue; }
    const priority = etaCardPriority(meta);
    const existing = result.get(jobId);
    if (!existing) {
      result.set(jobId, { meta, createdAt: row.createdAt, id: row.id, priority });
      continue;
    }
    const betterPriority = priority < existing.priority;
    const samePriorityNewerTime = priority === existing.priority && row.createdAt > existing.createdAt;
    const samePriorityTimeHigherId =
      priority === existing.priority &&
      row.createdAt.getTime() === existing.createdAt.getTime() &&
      row.id > existing.id;
    if (betterPriority || samePriorityNewerTime || samePriorityTimeHigherId) {
      result.set(jobId, { meta, createdAt: row.createdAt, id: row.id, priority });
    }
  }
  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRow(
  id: number,
  jobId: number,
  resultType: EtaCardMeta["resultType"],
  etaStatus: string | null,
  cleanerStatement: string,
  createdAt: Date
): EtaCardRow {
  const meta: EtaCardMeta = {
    resultType,
    etaStatus,
    etaTimeStr: etaStatus ? "8:30 AM" : null,
    cleanerStatement,
    clientNotified: false,
    step: "eta_call_1",
    clientSmsBody: null,
    recordingUrl: null,
    transcript: null,
    vapiCallId: null,
    scheduledTime: null,
  };
  return { id, cleanerJobId: jobId, metadata: JSON.stringify(meta), createdAt };
}

const JOB = 3870009;
const T0 = new Date("2026-07-21T12:00:17.000Z");

// ─── Test 1: same-timestamp tie — success must win over unclear ───────────────

describe("ETA card selection — same-timestamp tie", () => {
  it("prefers success+etaStatus over unclear when both share the same createdAt", () => {
    const unclear = makeRow(16620022, JOB, "unclear", null, "(no speech detected)", T0);
    const success = makeRow(16620023, JOB, "success", "on_time", "Cleaner set ETA manually via picker", T0);

    // Simulate DB returning unclear first (nondeterministic ordering)
    const selected = selectBestEtaCard([unclear, success]);
    const card = selected.get(JOB);

    expect(card).toBeDefined();
    expect(card!.meta.resultType).toBe("success");
    expect(card!.meta.etaStatus).toBe("on_time");
    expect(card!.meta.cleanerStatement).toBe("Cleaner set ETA manually via picker");
  });

  it("prefers success+etaStatus even when it has a lower id than unclear", () => {
    // Reverse the IDs: success was inserted first (lower id), unclear inserted after
    const success = makeRow(16620022, JOB, "success", "on_time", "Cleaner set ETA manually via picker", T0);
    const unclear = makeRow(16620023, JOB, "unclear", null, "(no speech detected)", T0);

    const selected = selectBestEtaCard([unclear, success]);
    const card = selected.get(JOB);

    expect(card!.meta.resultType).toBe("success");
    expect(card!.meta.etaStatus).toBe("on_time");
  });
});

// ─── Test 2: delayed unclear callback inserted AFTER a valid success ──────────

describe("ETA card selection — delayed unclear callback after valid success", () => {
  it("keeps the earlier success card when a later unclear callback arrives", () => {
    const T_success = new Date("2026-07-21T12:00:17.000Z");
    const T_unclear  = new Date("2026-07-21T12:00:45.000Z"); // 28 seconds later

    const success = makeRow(16620023, JOB, "success", "on_time", "Cleaner set ETA manually via picker", T_success);
    const unclear  = makeRow(16620031, JOB, "unclear", null, "Sorry, mailbox is full.", T_unclear);

    // Simulate DB returning unclear first (it has a later createdAt, so DESC order puts it first)
    const selected = selectBestEtaCard([unclear, success]);
    const card = selected.get(JOB);

    expect(card).toBeDefined();
    expect(card!.meta.resultType).toBe("success");
    expect(card!.meta.etaStatus).toBe("on_time");
    expect(card!.meta.cleanerStatement).toBe("Cleaner set ETA manually via picker");
  });

  it("uses a later success card when a newer AI call confirms ETA after an earlier unclear", () => {
    const T_unclear  = new Date("2026-07-21T12:00:17.000Z");
    const T_success  = new Date("2026-07-21T12:02:00.000Z"); // AI call succeeded 2 min later

    const unclear = makeRow(16620022, JOB, "unclear", null, "(no speech detected)", T_unclear);
    const success = makeRow(16620040, JOB, "success", "on_time", "right on time", T_success);

    const selected = selectBestEtaCard([unclear, success]);
    const card = selected.get(JOB);

    expect(card!.meta.resultType).toBe("success");
    expect(card!.meta.cleanerStatement).toBe("right on time");
  });
});
