import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const home = fs.readFileSync(path.join(root, "client/src/pages/CustomerPortalHome.tsx"), "utf8");
const styles = fs.readFileSync(path.join(root, "client/src/pages/customer-portal-next-cleaning-spacing.css"), "utf8");

describe("Customer Portal home contact and Next Cleaning layout", () => {
  it("offers a direct Customer Service text link without adding a call option or automatic send", () => {
    expect(home).toContain('href="sms:+12028885362">Text us</a>');
    expect(home).not.toContain("Call us");
    expect(home).not.toContain("sendSms(");
  });

  it("keeps actions close to the Next Cleaning details in the shortened desktop card", () => {
    expect(styles).toContain("aspect-ratio:3.6/1");
    expect(styles).toContain("padding:22px 24px");
    expect(styles).toContain(".mib-customer-home__hero-actions{position:static");
    expect(styles).toContain("margin:18px 0 0");
  });
});
