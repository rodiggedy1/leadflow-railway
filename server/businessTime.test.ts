import { describe, expect, it } from "vitest";
import { getBusinessDayStart } from "./businessTime";

describe("getBusinessDayStart", () => {
  it("keeps the Eastern business day on the prior date after UTC midnight", () => {
    expect(
      getBusinessDayStart(new Date("2026-10-07T01:28:30.000Z")).toISOString()
    ).toBe("2026-10-06T04:00:00.000Z");
  });

  it("uses the standard-time Eastern offset in winter", () => {
    expect(
      getBusinessDayStart(new Date("2026-01-15T18:00:00.000Z")).toISOString()
    ).toBe("2026-01-15T05:00:00.000Z");
  });

  it("uses the daylight-time Eastern offset in summer", () => {
    expect(
      getBusinessDayStart(new Date("2026-07-15T18:00:00.000Z")).toISOString()
    ).toBe("2026-07-15T04:00:00.000Z");
  });
});
