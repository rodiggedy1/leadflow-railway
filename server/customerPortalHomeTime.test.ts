import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { formatCustomerPortalServiceTime } from "../client/src/lib/customerPortalTime";

const root = process.cwd();

describe("Customer Portal Next Cleaning time", () => {
  it("formats confirmed ISO service timestamps in the Eastern business timezone", () => {
    expect(formatCustomerPortalServiceTime("2026-09-10T14:50:00Z")).toBe("10:50 AM");
    expect(formatCustomerPortalServiceTime("2026-01-10T14:50:00Z")).toBe("9:50 AM");
  });

  it("retains a pending fallback and customer-entered local appointment labels", () => {
    expect(formatCustomerPortalServiceTime(null)).toBe("Time will be confirmed");
    expect(formatCustomerPortalServiceTime("Morning (8–10 AM)")).toBe("Morning (8–10 AM)");
  });

  it("uses the formatter only for the Next Cleaning display without changing booking data", () => {
    const home = fs.readFileSync(path.join(root, "client/src/pages/CustomerPortalHome.tsx"), "utf8");
    expect(home).toContain('import { formatCustomerPortalServiceTime } from "@/lib/customerPortalTime"');
    expect(home).toContain("formatCustomerPortalServiceTime(nextBooking?.serviceDateTime)");
    expect(home).not.toMatch(/mutate\(|db\.(insert|update|delete)|sendSms|fetch\(/);
  });
});
