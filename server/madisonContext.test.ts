import { describe, expect, it } from "vitest";
import { buildMadisonPhoneCandidates, resolveMadisonContext } from "./madisonContext";

function fakeDb(rows: unknown[][]) {
  let call = 0;
  const chain = {
    select() { return chain; },
    from() { return chain; },
    where() { return chain; },
    orderBy() { return chain; },
    limit() { return Promise.resolve(rows[call++] ?? []); },
  };
  return chain as any;
}

describe("Madison LeadFlow context", () => {
  it("builds exact normalized phone candidates without guessing a customer", () => {
    expect(buildMadisonPhoneCandidates("(202) 555-0101")).toEqual([
      "(202) 555-0101",
      "2025550101",
      "+12025550101",
    ]);
  });

  it("resolves a matching native booking and LeadFlow job", async () => {
    const result = await resolveMadisonContext(
      "+12025550101",
      false,
      undefined,
      fakeDb([
        [{ id: 42, customerName: "Alex Customer", customerPhone: "+12025550101", requestedLocalDate: "2026-10-08", requestedLocalTime: "11:00" }],
        [{ id: 77, bookingId: 42, customerName: "Alex Customer", customerPhone: "+12025550101", serviceDateTime: "2026-10-08 11:00", teamName: "Team North" }],
      ]),
    );

    expect(result).toMatchObject({
      isCleaner: false,
      customerName: "Alex Customer",
      bookingId: 42,
      leadflowJobId: 77,
      teamName: "Team North",
      serviceDateTime: "2026-10-08 11:00",
    });
  });

  it("returns unresolved context when neither owned source matches", async () => {
    const result = await resolveMadisonContext(
      "+12025550199",
      false,
      "Unknown Sender",
      fakeDb([[], []]),
    );

    expect(result).toEqual({
      isCleaner: false,
      senderName: "Unknown Sender",
      customerName: "Unknown Sender",
    });
    expect(result.bookingId).toBeUndefined();
    expect(result.leadflowJobId).toBeUndefined();
  });

  it("does not guess when the phone maps to multiple unrelated bookings", async () => {
    const result = await resolveMadisonContext(
      "+12025550199",
      false,
      "Unknown Sender",
      fakeDb([
        [
          { id: 101, customerName: "First Customer", customerPhone: "+12025550199", requestedLocalDate: "2026-10-08", requestedLocalTime: "09:00" },
          { id: 102, customerName: "Second Customer", customerPhone: "+12025550199", requestedLocalDate: "2026-10-09", requestedLocalTime: "09:00" },
        ],
        [],
      ]),
    );

    expect(result.bookingId).toBeUndefined();
    expect(result.leadflowJobId).toBeUndefined();
    expect(result.customerName).toBe("Unknown Sender");
  });

  it("does not query booking data for a caller already identified as a cleaner", async () => {
    let queried = false;
    const db = { select() { queried = true; return this; } } as any;
    const result = await resolveMadisonContext("+12025550101", true, "Team Member", db);

    expect(result).toEqual({
      isCleaner: true,
      senderName: "Team Member",
      cleanerPhone: "+12025550101",
    });
    expect(queried).toBe(false);
  });
});
