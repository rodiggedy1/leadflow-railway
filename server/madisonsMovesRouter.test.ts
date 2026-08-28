import { describe, expect, it, vi } from "vitest";
import { recordMadisonFillCapacityContact, sendMadisonMove } from "./madisonsMovesRouter";

describe("Madison’s Moves send safeguards", () => {
  const reviewedMoveRecipients = [{ name: "Eligible Customer", phone: "+12025550123" }];

  it("writes a successful Fill Capacity recipient to the existing seven-day contact ledger shape", async () => {
    const values = vi.fn(async () => ({ insertId: 1 }));
    const db = { insert: vi.fn(() => ({ values })) };

    await recordMadisonFillCapacityContact({ db, phone: "+12025550123" });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      campaignId: -1,
      phone: "+12025550123",
      bookingCount: 0,
      status: "SENT",
      sentAt: expect.any(Date),
    }));
  });

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
        recordRecentContact: vi.fn(),
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

  it("returns the real SMS success when final move-state persistence fails and leaves no automatic retry path", async () => {
    const sendSms = vi.fn().mockResolvedValue({ success: true, messageId: "op-message-1" });
    const stopQuery = { from: vi.fn(() => ({ where: vi.fn(async () => []) })) };
    const moveQuery = { from: vi.fn(() => ({ where: vi.fn(async () => []) })) };
    const db = {
      select: vi.fn().mockReturnValueOnce(stopQuery).mockReturnValueOnce(moveQuery),
      insert: vi.fn(() => ({ values: vi.fn(async () => ({ insertId: 99 })) })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => { throw new Error("history write unavailable"); }) })) })),
    };
    const result = await sendMadisonMove({}, { moveKey: "fill:cancel:714:2026-08-28", recipients: reviewedMoveRecipients, message: "Opening available" }, {
      getDb: async () => db as any,
      listMoves: async () => [{ moveKey: "fill:cancel:714:2026-08-28", kind: "fill_capacity" as const, headline: "Fill capacity", draftMessage: "Opening available", recipients: reviewedMoveRecipients }],
      sendSms,
      appendCsOutboundMessage: vi.fn(),
      recordRecentContact: vi.fn(),
      csNumberId: "cs-number",
    } as any);

    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ message: "Sent to 1 customer.", statePersistenceError: true, results: [{ success: true }] });
  });

  it("records every successful Fill Capacity recipient and finalizes the move as sent", async () => {
    const recipients = [
      { name: "First Customer", phone: "+1 (202) 555-0101" },
      { name: "Second Customer", phone: "+1 (202) 555-0102" },
    ];
    const sendSms = vi.fn()
      .mockResolvedValueOnce({ success: true, messageId: "op-message-1" })
      .mockResolvedValueOnce({ success: true, messageId: "op-message-2" });
    const recordRecentContact = vi.fn().mockResolvedValue(undefined);
    const finalSets: any[] = [];
    const db = {
      select: vi.fn()
        .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(async () => []) })) })
        .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(async () => []) })) }),
      insert: vi.fn(() => ({ values: vi.fn(async () => ({ insertId: 99 })) })),
      update: vi.fn(() => ({ set: vi.fn((value) => { finalSets.push(value); return { where: vi.fn(async () => undefined) }; }) })),
    };

    const result = await sendMadisonMove({}, { moveKey: "capacity:2026-08-29", recipients, message: "Opening available" }, {
      getDb: async () => db as any,
      listMoves: async () => [{ moveKey: "capacity:2026-08-29", kind: "fill_capacity" as const, headline: "Fill capacity", draftMessage: "Opening available", recipients }],
      sendSms,
      appendCsOutboundMessage: vi.fn(),
      recordRecentContact,
      csNumberId: "cs-number",
    } as any);

    expect(recordRecentContact).toHaveBeenNthCalledWith(1, { db, phone: "+12025550101" });
    expect(recordRecentContact).toHaveBeenNthCalledWith(2, { db, phone: "+12025550102" });
    expect(JSON.parse(finalSets.at(-1).metadata)).toMatchObject({ outcome: "sent", sentCount: 2, recentContactLoggedCount: 2, recentContactLogFailedCount: 0 });
    expect(result).toMatchObject({ message: "Sent to 2 customers.", results: [{ success: true }, { success: true }] });
  });

  it("records only successful recipients when a Fill Capacity batch partially fails", async () => {
    const recipients = [
      { name: "Successful Customer", phone: "+12025550101" },
      { name: "Failed Customer", phone: "+12025550102" },
    ];
    const sendSms = vi.fn()
      .mockResolvedValueOnce({ success: true, messageId: "op-message-1" })
      .mockResolvedValueOnce({ success: false });
    const recordRecentContact = vi.fn().mockResolvedValue(undefined);
    const db = {
      select: vi.fn()
        .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(async () => []) })) })
        .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(async () => []) })) }),
      insert: vi.fn(() => ({ values: vi.fn(async () => ({ insertId: 99 })) })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
    };

    const result = await sendMadisonMove({}, { moveKey: "capacity:2026-08-29", recipients, message: "Opening available" }, {
      getDb: async () => db as any,
      listMoves: async () => [{ moveKey: "capacity:2026-08-29", kind: "fill_capacity" as const, headline: "Fill capacity", draftMessage: "Opening available", recipients }],
      sendSms,
      appendCsOutboundMessage: vi.fn(),
      recordRecentContact,
      csNumberId: "cs-number",
    } as any);

    expect(recordRecentContact).toHaveBeenCalledOnce();
    expect(recordRecentContact).toHaveBeenCalledWith({ db, phone: "+12025550101" });
    expect(result.results).toEqual([
      { name: "Successful Customer", phone: "+12025550101", success: true },
      { name: "Failed Customer", phone: "+12025550102", success: false },
    ]);
  });

  it("does not send to or record a recipient removed during review", async () => {
    const liveRecipients = [
      { name: "Selected Customer", phone: "+12025550101" },
      { name: "Removed Customer", phone: "+12025550102" },
    ];
    const requestedRecipients = [liveRecipients[0]];
    const sendSms = vi.fn().mockResolvedValue({ success: true, messageId: "op-message-1" });
    const recordRecentContact = vi.fn().mockResolvedValue(undefined);
    const db = {
      select: vi.fn()
        .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(async () => []) })) })
        .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(async () => []) })) }),
      insert: vi.fn(() => ({ values: vi.fn(async () => ({ insertId: 99 })) })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
    };

    await sendMadisonMove({}, { moveKey: "capacity:2026-08-29", recipients: requestedRecipients, message: "Opening available" }, {
      getDb: async () => db as any,
      listMoves: async () => [{ moveKey: "capacity:2026-08-29", kind: "fill_capacity" as const, headline: "Fill capacity", draftMessage: "Opening available", recipients: liveRecipients }],
      sendSms,
      appendCsOutboundMessage: vi.fn(),
      recordRecentContact,
      csNumberId: "cs-number",
    } as any);

    expect(sendSms).toHaveBeenCalledOnce();
    expect(sendSms).toHaveBeenCalledWith(expect.objectContaining({ to: "+12025550101" }));
    expect(recordRecentContact).toHaveBeenCalledOnce();
    expect(recordRecentContact).toHaveBeenCalledWith({ db, phone: "+12025550101" });
  });

  it("does not record recent contact when every SMS fails", async () => {
    const sendSms = vi.fn().mockResolvedValue({ success: false });
    const recordRecentContact = vi.fn();
    const finalSets: any[] = [];
    const db = {
      select: vi.fn()
        .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(async () => []) })) })
        .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(async () => []) })) }),
      insert: vi.fn(() => ({ values: vi.fn(async () => ({ insertId: 99 })) })),
      update: vi.fn(() => ({ set: vi.fn((value) => { finalSets.push(value); return { where: vi.fn(async () => undefined) }; }) })),
    };

    const result = await sendMadisonMove({}, { moveKey: "capacity:2026-08-29", recipients: reviewedMoveRecipients, message: "Opening available" }, {
      getDb: async () => db as any,
      listMoves: async () => [{ moveKey: "capacity:2026-08-29", kind: "fill_capacity" as const, headline: "Fill capacity", draftMessage: "Opening available", recipients: reviewedMoveRecipients }],
      sendSms,
      appendCsOutboundMessage: vi.fn(),
      recordRecentContact,
      csNumberId: "cs-number",
    } as any);

    expect(recordRecentContact).not.toHaveBeenCalled();
    expect(JSON.parse(finalSets.at(-1).metadata)).toMatchObject({ outcome: "failed", sentCount: 0, recentContactLoggedCount: 0 });
    expect(result.message).toBe("No messages were sent.");
  });

  it("surfaces a ledger warning without changing a real SMS success into a failure", async () => {
    const sendSms = vi.fn().mockResolvedValue({ success: true, messageId: "op-message-1" });
    const recordRecentContact = vi.fn().mockRejectedValue(new Error("ledger unavailable"));
    const db = {
      select: vi.fn()
        .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(async () => []) })) })
        .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(async () => []) })) }),
      insert: vi.fn(() => ({ values: vi.fn(async () => ({ insertId: 99 })) })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
    };

    const result = await sendMadisonMove({}, { moveKey: "capacity:2026-08-29", recipients: reviewedMoveRecipients, message: "Opening available" }, {
      getDb: async () => db as any,
      listMoves: async () => [{ moveKey: "capacity:2026-08-29", kind: "fill_capacity" as const, headline: "Fill capacity", draftMessage: "Opening available", recipients: reviewedMoveRecipients }],
      sendSms,
      appendCsOutboundMessage: vi.fn(),
      recordRecentContact,
      csNumberId: "cs-number",
    } as any);

    expect(result.results).toEqual([{ name: "Eligible Customer", phone: "+12025550123", success: true }]);
    expect(result).toMatchObject({ recentContactPersistenceError: true });
    expect(result.message).toContain("Sent to 1 customer.");
    expect(result.message).toContain("not added to the recent-contact safeguard");
  });
});
