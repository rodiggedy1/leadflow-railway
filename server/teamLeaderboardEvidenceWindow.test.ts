import { describe, expect, it } from "vitest";
import { resolveTeamEvidenceWindow } from "./teamLeaderboardEvidenceWindow";

const capture = new Date("2026-11-20T01:20:00Z");
describe("Sunday-start team evidence week", () => {
  it("matches Nov15–21 and clips the run through the current Eastern Thursday", () => {
    expect(resolveTeamEvidenceWindow({ weekStart: "2026-11-15" }, capture)).toEqual({
      weekStart: "2026-11-15", weekEnd: "2026-11-21", throughDate: "2026-11-19",
      timeZone: "America/New_York", startInclusiveUtc: "2026-11-15T05:00:00.000Z",
      endExclusiveUtc: "2026-11-20T01:20:00.000Z", capturedAtUtc: "2026-11-20T01:20:00.000Z",
    });
  });
  it("uses the next Sunday midnight as the exclusive end for a completed week", () => {
    const result = resolveTeamEvidenceWindow({ weekStart: "2026-11-15" }, new Date("2026-11-24T00:00:00Z"));
    expect(result.endExclusiveUtc).toBe("2026-11-22T05:00:00.000Z");
    expect(result.throughDate).toBe("2026-11-21");
  });
  it("has a 169-hour fall-back week rather than assuming 168 UTC hours", () => {
    const result = resolveTeamEvidenceWindow({ weekStart: "2026-11-01" }, capture);
    expect(result.startInclusiveUtc).toBe("2026-11-01T04:00:00.000Z");
    expect(result.endExclusiveUtc).toBe("2026-11-08T05:00:00.000Z");
    expect((Date.parse(result.endExclusiveUtc) - Date.parse(result.startInclusiveUtc)) / 3_600_000).toBe(169);
  });
  it("has a 167-hour spring-forward week", () => {
    const result = resolveTeamEvidenceWindow({ weekStart: "2026-03-08" }, capture);
    expect(result.startInclusiveUtc).toBe("2026-03-08T05:00:00.000Z");
    expect(result.endExclusiveUtc).toBe("2026-03-15T04:00:00.000Z");
    expect((Date.parse(result.endExclusiveUtc) - Date.parse(result.startInclusiveUtc)) / 3_600_000).toBe(167);
  });
  it.each(["2026-11-16", "2026-02-30", "2026-11-15junk", "2026-13-01", "26-11-15"])("rejects invalid/non-Sunday input %s", weekStart => {
    expect(() => resolveTeamEvidenceWindow({ weekStart }, capture)).toThrow();
  });
  it("rejects a future week rather than inventing empty coverage", () => {
    expect(() => resolveTeamEvidenceWindow({ weekStart: "2026-11-22" }, capture)).toThrow("future");
  });
  it("rejects an invalid capture date", () => {
    expect(() => resolveTeamEvidenceWindow({ weekStart: "2026-11-15" }, new Date("invalid"))).toThrow();
  });
  it("accepts a zero-length capture at exact week start", () => {
    const result = resolveTeamEvidenceWindow({ weekStart: "2026-11-15" }, new Date("2026-11-15T05:00:00Z"));
    expect(result.startInclusiveUtc).toBe(result.endExclusiveUtc);
  });
});
