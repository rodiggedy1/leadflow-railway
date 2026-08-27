import { describe, expect, it, vi } from "vitest";
import { sendMadisonMove } from "./madisonsMovesRouter";

describe("Madison’s Moves send safeguards", () => {
  const reviewedMoveRecipients = [{ name: "Eligible Customer", phone: "+12025550123" }];

  function dependencies(options: { liveRecipients: typeof reviewedMoveRecipients; stopPhones?: string[] }) {
    const sendSms = vi.fn();
    const db = { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(async () => (options.stopPhones ?? []).map((phone) => ({ phone }))) })) })) };
    return {
      sendSms,
      deps: {
        getDb: async () => db,
        listMoves: async () => [{ moveKey: "fill:cancel:714:2026-08-28", kind: "fill_capacity" as const, draftMessage: "Opening available", recipients: options.liveRecipients }],
        sendSms,
        appendCsOutboundMessage: vi.fn(),
        csNumberId: "cs-number",
      },
    };
  }

  it("rejects a stale recipient through the real send path before SMS delivery", async () => {
    const { deps, sendSms } = dependencies({ liveRecipients: [] });
    await expect(sendMadisonMove({}, { moveKey: "fill:cancel:714:2026-08-28", recipients: reviewedMoveRecipients, message: "Opening available" }, deps as any))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: "No selected recipients remain eligible." });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("blocks a newly STOP-opted Fill Capacity recipient through the real send path before SMS delivery", async () => {
    const { deps, sendSms } = dependencies({ liveRecipients: reviewedMoveRecipients, stopPhones: ["+12025550123"] });
    await expect(sendMadisonMove({}, { moveKey: "fill:cancel:714:2026-08-28", recipients: reviewedMoveRecipients, message: "Opening available" }, deps as any))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: "No selected recipients remain eligible after STOP protection." });
    expect(sendSms).not.toHaveBeenCalled();
  });
});
