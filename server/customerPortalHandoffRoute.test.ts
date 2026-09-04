import type { Request, Response } from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CUSTOMER_PORTAL_COOKIE_NAME, ONE_YEAR_MS } from "../shared/const";
import { createCustomerPortalHandoffHandler } from "./customerPortalHandoffRoute";

const validCode = "a".repeat(43);

function responseCapture() {
  const response = {
    set: vi.fn().mockReturnThis(),
    cookie: vi.fn().mockReturnThis(),
    redirect: vi.fn().mockReturnThis(),
  };
  return response as unknown as Response & typeof response;
}

describe("customer portal server handoff", () => {
  it("retains hashed, expiring, single-use token redemption tied to the linked portal account", async () => {
    const source = await readFile(path.resolve(process.cwd(), "server/customerPortalService.ts"), "utf8");
    expect(source).toContain('tokenHash: createHash("sha256").update(code).digest("hex")');
    expect(source).toContain("expiresAt: Date.now() + 15 * 60 * 1_000");
    expect(source).toContain("isNull(customerPortalHandoffTokens.usedAt)");
    expect(source).toContain("affectedRows ?? 0) !== 1");
    expect(source).toContain("eq(customerPortalAccounts.id, token.accountId)");
  });

  it("consumes a valid one-time code, sets a host-only secure portal cookie, and redirects before the portal renders", async () => {
    const redeem = vi.fn().mockResolvedValue({ id: 42, customerName: "Jamie Lee", customerPhone: "+13025550199" });
    const sign = vi.fn().mockResolvedValue("signed-portal-session");
    const handler = createCustomerPortalHandoffHandler({ getDb: vi.fn().mockResolvedValue({} as any), redeem: redeem as any, sign });
    const response = responseCapture();

    await handler({ query: { access: validCode } } as unknown as Request, response);

    expect(redeem).toHaveBeenCalledWith(expect.anything(), validCode);
    expect(response.set).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(response.set).toHaveBeenCalledWith("Referrer-Policy", "no-referrer");
    expect(response.cookie).toHaveBeenCalledWith(CUSTOMER_PORTAL_COOKIE_NAME, "signed-portal-session", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: ONE_YEAR_MS,
    });
    expect(response.redirect).toHaveBeenCalledWith(303, "/my-home");
  });

  it("safely redirects without a session when a code is expired, reused, malformed, or otherwise invalid", async () => {
    const redeem = vi.fn().mockResolvedValue(null);
    const handler = createCustomerPortalHandoffHandler({ getDb: vi.fn().mockResolvedValue({} as any), redeem: redeem as any, sign: vi.fn() });
    const expiredResponse = responseCapture();
    const malformedResponse = responseCapture();

    await handler({ query: { access: validCode } } as unknown as Request, expiredResponse);
    await handler({ query: { access: "not-a-valid-one-time-code" } } as unknown as Request, malformedResponse);

    expect(expiredResponse.cookie).not.toHaveBeenCalled();
    expect(expiredResponse.redirect).toHaveBeenCalledWith(303, "/my-home");
    expect(malformedResponse.cookie).not.toHaveBeenCalled();
    expect(malformedResponse.redirect).toHaveBeenCalledWith(303, "/my-home");
    expect(redeem).toHaveBeenCalledTimes(1);
  });
});
