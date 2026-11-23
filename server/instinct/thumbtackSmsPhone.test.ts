import { describe, expect, it } from "vitest";
import { normalizeThumbtackSmsPhone } from "../../shared/thumbtackSmsPhone";

describe("Thumbtack-only Quo recipient formatting", () => {
  it.each([
    ["(703) 555-1234", "+17035551234"],
    ["7035551234", "+17035551234"],
    ["1-703-555-1234", "+17035551234"],
    ["+17035551234", "+17035551234"],
    ["1201551234", "+11201551234"],
    ["+11205550199", "+11205550199"],
    ["+17031551234", "+17031551234"],
    ["+44 7700 900123", "+447700900123"],
    ["+44", "+44"],
    ["+2561234", "+2561234"],
    ["+123456789012345", "+123456789012345"],
    ["123", "123"],
    ["12345678", "12345678"],
  ])("formats %s as %s without extra number restrictions", (input, output) => {
    expect(normalizeThumbtackSmsPhone(input)).toBe(output);
  });
  it.each([undefined, null, 123, "", "not a number", "+012345", "+1", "+1234567890123456", "12", "123456789", "++17035551234"])
  ("does not invent an out-of-contract recipient from %j", input => {
    expect(normalizeThumbtackSmsPhone(input)).toBeNull();
  });
});
