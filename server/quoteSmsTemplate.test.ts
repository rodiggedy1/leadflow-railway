import { describe, expect, it } from "vitest";
import { buildDefaultQuoteSms } from "../shared/quoteSmsTemplate";

describe("buildDefaultQuoteSms", () => {
  const url = "https://quote.maidinblack.com/welcome/Bella?beds=1&baths=1&type=Standard+Cleaning&price=149";

  it("uses the approved default wording with a conditional discount paragraph", () => {
    expect(buildDefaultQuoteSms({ firstName: "Bella", welcomeUrl: url, hasDiscount: true })).toBe(
      `Hi Bella! Your custom quote is ready 🖤 Tap below to check out your pricing and grab your clean.

We've also added a nice discount for you as well 🎁

${url}

Booking's easy on our end, just need your phone, email, and address and we'll take it from there. Questions? Just reply here, happy to help.`
    );
  });

  it("omits the discount paragraph when no discount is applied", () => {
    const message = buildDefaultQuoteSms({ firstName: "Bella", welcomeUrl: url, hasDiscount: false });

    expect(message).not.toContain("We've also added a nice discount");
    expect(message).toContain(url);
  });
});
