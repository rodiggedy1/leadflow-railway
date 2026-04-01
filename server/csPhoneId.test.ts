import { describe, it, expect } from "vitest";

describe("OPENPHONE_CS_PHONE_NUMBER_ID env var", () => {
  it("should be set to the correct CS line phone number ID", () => {
    const id = process.env.OPENPHONE_CS_PHONE_NUMBER_ID;
    expect(id).toBeTruthy();
    expect(id).toBe("PN0wVLcpCq");
  });
});
