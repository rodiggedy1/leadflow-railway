import { createHash } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const loginService = read("server/customerPortalLoginService.ts");
const router = read("server/customerPortalRouter.ts");
const handoffRoute = read("server/customerPortalHandoffRoute.ts");
const portal = read("client/src/pages/CustomerPortal.tsx");
const loginCss = read("client/src/pages/customer-portal-login.css");
const manifest = JSON.parse(read("server/versioned-migrations/manifest.json")) as { migrations: Array<{ id: string; mode?: string; sqlFile: string; sha256: string; replayMode: string; postconditionsFile: string }> };

describe("customer portal SMS re-entry contract", () => {
  it("ships two checksum-locked additive tables without destructive or customer-data SQL", () => {
    for (const expected of [
      { id: "0023_create_customer_portal_login_codes", table: "customer_portal_login_codes" },
      { id: "0024_create_customer_portal_login_rate_limits", table: "customer_portal_login_rate_limits" },
    ]) {
      const entry = manifest.migrations.find(item => item.id === expected.id);
      expect(entry).toMatchObject({ id: expected.id, mode: "create-table", replayMode: "verified-idempotent" });
      const sql = read(`server/versioned-migrations/${entry!.sqlFile}`);
      expect(createHash("sha256").update(sql).digest("hex")).toBe(entry!.sha256);
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS \`${expected.table}\``);
      expect(sql).not.toMatch(/^\s*(DROP|TRUNCATE|DELETE|UPDATE|INSERT|ALTER)\b/im);
      const postconditions = JSON.parse(read(`server/versioned-migrations/${entry!.postconditionsFile}`)) as { table: string };
      expect(postconditions.table).toBe(expected.table);
    }
  });

  it("uses a short-lived keyed code hash and atomic single-use verification with failed-attempt lockout", () => {
    expect(loginService).toContain('createHmac("sha256", ENV.cookieSecret)');
    expect(loginService).toContain("randomInt(0, 1_000_000)");
    expect(loginService).toContain("PORTAL_LOGIN_CODE_TTL_MS = 10 * 60 * 1_000");
    expect(loginService).toContain("PORTAL_LOGIN_MAX_FAILED_ATTEMPTS = 5");
    expect(loginService).toContain("PORTAL_LOGIN_LOCK_MS = 10 * 60 * 1_000");
    expect(loginService).toContain("isNull(customerPortalLoginCodes.usedAt)");
    expect(loginService).toContain("gt(customerPortalLoginCodes.expiresAt, now)");
    expect(loginService).toContain("eq(customerPortalLoginCodes.codeHash, codeHash)");
    expect(loginService).toContain("failedAttempts >= PORTAL_LOGIN_MAX_FAILED_ATTEMPTS");
    expect(loginService).toContain("if (!sent.success)");
    expect(loginService).toContain("usedAt: failedAt");
    expect(loginService).not.toMatch(/console\.(?:log|info|warn|error).*code/i);
  });

  it("uses the established direct issuance sequence and never compares a valid submitted code with an arbitrary active row", () => {
    expect(loginService).not.toContain("FOR UPDATE");
    expect(loginService).not.toContain("db.transaction(async tx => {");
    expect(loginService).toContain("const matchingRows = await db.select().from(customerPortalLoginCodes).where(and(eq(customerPortalLoginCodes.accountId, account.id), eq(customerPortalLoginCodes.codeHash, codeHash)");
    expect(loginService).toContain("const matchingCode = matchingRows[0];");
    expect(loginService).toContain("if (!matchingCode) {");
    expect(loginService).toContain(".orderBy(desc(customerPortalLoginCodes.createdAt)).limit(1);");
    expect(loginService).toContain("eq(customerPortalLoginCodes.id, matchingCode.id)");
    expect(loginService).not.toContain("if (active.codeHash !== codeHash)");
  });

  it("applies persisted phone and IP request limits, a server-side resend cooldown, and neutral results", () => {
    expect(loginService).toContain('consumeRateLimit(db, "phone", normalizedPhone || "invalid", PORTAL_LOGIN_PHONE_REQUEST_LIMIT, now)');
    expect(loginService).toContain('consumeRateLimit(db, "ip", safeIp, PORTAL_LOGIN_IP_REQUEST_LIMIT, now)');
    expect(loginService).toContain("PORTAL_LOGIN_RESEND_COOLDOWN_MS");
    expect(loginService).toContain("return { sent: false };");
    expect(router).toContain('return { ok: true, resendAfterSeconds: 60 };');
    expect(router).toContain("if (!account) return { ok: false };");
  });

  it("sets only the established secure portal cookie after successful verification", () => {
    const verificationSegment = router.slice(router.indexOf("verifyLoginCode:"), router.indexOf("staffRequests:"));
    expect(verificationSegment).toContain("signCustomerPortalSession");
    expect(verificationSegment).toContain("CUSTOMER_PORTAL_COOKIE_NAME");
    expect(verificationSegment).toContain("getSessionCookieOptions(ctx.req)");
    expect(verificationSegment).toContain('sameSite: "lax"');
    expect(verificationSegment).toContain("maxAge: ONE_YEAR_MS");
    expect(verificationSegment).toContain('ctx.res.set("Cache-Control", "no-store")');
    expect(verificationSegment).toContain('ctx.res.set("Referrer-Policy", "no-referrer")');
  });

  it("keeps login isolated from leads, bookings, cards, payments, requests, notifications, and the existing handoff", () => {
    const loginProcedureSegment = router.slice(router.indexOf("requestLoginCode:"), router.indexOf("staffRequests:"));
    for (const forbidden of ["createRequest", "startNewCardSetup", "confirmNewCardSetup", "createCustomerPortalAccount", "createPortalHandoff", "booking", "payment", "lead", "notify"]) {
      expect(loginProcedureSegment.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    expect(handoffRoute).toContain("redeemCustomerPortalHandoff");
    expect(handoffRoute).toContain('app.get("/customer-portal/handoff", createCustomerPortalHandoffHandler())');
  });

  it("replaces only the expired-session gate with an accessible phone/code experience", () => {
    expect(portal).toContain("function PortalLoginGate");
    expect(portal).toContain("trpc.customerPortal.requestLoginCode.useMutation()");
    expect(portal).toContain("trpc.customerPortal.verifyLoginCode.useMutation()");
    expect(portal).toContain('autoComplete="one-time-code"');
    expect(portal).toContain('inputMode="numeric"');
    expect(portal).toContain("if (!portal.data?.account) return <PortalLoginGate");
    expect(portal).toContain("portal.refetch()");
    expect(loginCss).toContain(".mib-portal-login-gate");
  });
});
