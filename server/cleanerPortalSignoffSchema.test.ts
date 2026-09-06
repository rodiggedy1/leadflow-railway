import { describe, expect, it } from "vitest";
import { cleanerPortalJobSignoffs } from "../drizzle/schema";

describe("isolated customer sign-off schema initialization", () => {
  it("initializes the customer-not-home boolean column at module load", () => {
    expect(cleanerPortalJobSignoffs.customerNotHome.name).toBe("customerNotHome");
  });
});
