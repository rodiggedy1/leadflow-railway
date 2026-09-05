import { createHmac, randomInt } from "crypto";
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { customerPortalAccounts, customerPortalLoginCodes, customerPortalLoginRateLimits } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { normalizePhone } from "./utils/phone";

type DbClient = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type LoginAccount = typeof customerPortalAccounts.$inferSelect;

export const PORTAL_LOGIN_CODE_TTL_MS = 10 * 60 * 1_000;
export const PORTAL_LOGIN_RESEND_COOLDOWN_MS = 60 * 1_000;
export const PORTAL_LOGIN_REQUEST_WINDOW_MS = 15 * 60 * 1_000;
export const PORTAL_LOGIN_PHONE_REQUEST_LIMIT = 3;
export const PORTAL_LOGIN_IP_REQUEST_LIMIT = 12;
export const PORTAL_LOGIN_MAX_FAILED_ATTEMPTS = 5;
export const PORTAL_LOGIN_LOCK_MS = 10 * 60 * 1_000;

export type PortalLoginDependencies = {
  now: () => number;
  generateCode: () => string;
  sendCode: (phone: string, code: string) => Promise<{ success: boolean }>;
};

const defaultDependencies: PortalLoginDependencies = {
  now: () => Date.now(),
  generateCode: () => randomInt(0, 1_000_000).toString().padStart(6, "0"),
  sendCode: async () => ({ success: false }),
};

function affectedRows(result: unknown) {
  return Number((result as { affectedRows?: number }).affectedRows ?? 0);
}

function keyedHash(value: string) {
  return createHmac("sha256", ENV.cookieSecret).update(value).digest("hex");
}

function loginCodeHash(accountId: number, code: string) {
  return keyedHash(`customer-portal-login:${accountId}:${code}`);
}

function loginRateKey(scope: string, rawValue: string) {
  return keyedHash(`customer-portal-login-rate:${scope}:${rawValue}`);
}

async function consumeRateLimit(db: DbClient, scope: "phone" | "ip", rawValue: string, limit: number, now: number) {
  const keyHash = loginRateKey(scope, rawValue);
  const rows = await db.select().from(customerPortalLoginRateLimits).where(and(eq(customerPortalLoginRateLimits.scope, scope), eq(customerPortalLoginRateLimits.keyHash, keyHash))).limit(1);
  const current = rows[0];
  const date = new Date(now);
  if (!current) {
    try {
      await db.insert(customerPortalLoginRateLimits).values({ scope, keyHash, windowStartedAt: now, requestCount: 1, updatedAt: date });
      return true;
    } catch {
      return false;
    }
  }
  if (current.windowStartedAt <= now - PORTAL_LOGIN_REQUEST_WINDOW_MS) {
    const result = await db.update(customerPortalLoginRateLimits).set({ windowStartedAt: now, requestCount: 1, updatedAt: date }).where(and(eq(customerPortalLoginRateLimits.id, current.id), eq(customerPortalLoginRateLimits.requestCount, current.requestCount)));
    return affectedRows(result) === 1;
  }
  if (current.requestCount >= limit) return false;
  const result = await db.update(customerPortalLoginRateLimits).set({ requestCount: current.requestCount + 1, updatedAt: date }).where(and(eq(customerPortalLoginRateLimits.id, current.id), eq(customerPortalLoginRateLimits.requestCount, current.requestCount)));
  return affectedRows(result) === 1;
}

export async function requestCustomerPortalLoginCode(db: DbClient, input: { phone: string; requestIp: string }, dependencies: Partial<PortalLoginDependencies> = {}) {
  const resolvedDependencies = { ...defaultDependencies, ...dependencies };
  const normalizedPhone = normalizePhone(input.phone);
  const now = resolvedDependencies.now();
  const safeIp = input.requestIp.slice(0, 128) || "unknown";
  const [phoneAllowed, ipAllowed] = await Promise.all([
    consumeRateLimit(db, "phone", normalizedPhone || "invalid", PORTAL_LOGIN_PHONE_REQUEST_LIMIT, now),
    consumeRateLimit(db, "ip", safeIp, PORTAL_LOGIN_IP_REQUEST_LIMIT, now),
  ]);
  if (!phoneAllowed || !ipAllowed || !normalizedPhone) return { sent: false };

  const accounts = await db.select().from(customerPortalAccounts).where(eq(customerPortalAccounts.customerPhone, normalizedPhone)).limit(1);
  const account = accounts[0];
  if (!account) return { sent: false };

  const issuance = await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM customer_portal_accounts WHERE id = ${account.id} FOR UPDATE`);
    const activeCodes = await tx.select().from(customerPortalLoginCodes).where(and(eq(customerPortalLoginCodes.accountId, account.id), isNull(customerPortalLoginCodes.usedAt), gt(customerPortalLoginCodes.expiresAt, now))).orderBy(desc(customerPortalLoginCodes.createdAt)).limit(1);
    if (activeCodes[0] && activeCodes[0].createdAt.getTime() > now - PORTAL_LOGIN_RESEND_COOLDOWN_MS) return null;

    const code = resolvedDependencies.generateCode();
    if (!/^\d{6}$/.test(code)) throw new Error("Portal login code generator returned an invalid code.");
    const codeHash = loginCodeHash(account.id, code);
    const createdAt = new Date(now);
    await tx.update(customerPortalLoginCodes).set({ usedAt: createdAt, updatedAt: createdAt }).where(and(eq(customerPortalLoginCodes.accountId, account.id), isNull(customerPortalLoginCodes.usedAt), gt(customerPortalLoginCodes.expiresAt, now)));
    await tx.insert(customerPortalLoginCodes).values({ accountId: account.id, codeHash, expiresAt: now + PORTAL_LOGIN_CODE_TTL_MS, usedAt: null, failedAttempts: 0, lockedUntil: null, createdAt, updatedAt: createdAt });
    return { code, codeHash };
  });
  if (!issuance) return { sent: false };
  let sent: { success: boolean };
  try {
    sent = await resolvedDependencies.sendCode(normalizedPhone, issuance.code);
  } catch {
    sent = { success: false };
  }
  if (!sent.success) {
    const failedAt = new Date(resolvedDependencies.now());
    await db.update(customerPortalLoginCodes).set({ usedAt: failedAt, updatedAt: failedAt }).where(and(eq(customerPortalLoginCodes.codeHash, issuance.codeHash), isNull(customerPortalLoginCodes.usedAt)));
    return { sent: false };
  }
  return { sent: true };
}

export async function verifyCustomerPortalLoginCode(db: DbClient, input: { phone: string; code: string }, now = Date.now()): Promise<LoginAccount | null> {
  const normalizedPhone = normalizePhone(input.phone);
  if (!normalizedPhone || !/^\d{6}$/.test(input.code)) return null;
  const accounts = await db.select().from(customerPortalAccounts).where(eq(customerPortalAccounts.customerPhone, normalizedPhone)).limit(1);
  const account = accounts[0];
  if (!account) return null;
  const codeHash = loginCodeHash(account.id, input.code);
  const matchingRows = await db.select().from(customerPortalLoginCodes).where(and(eq(customerPortalLoginCodes.accountId, account.id), eq(customerPortalLoginCodes.codeHash, codeHash), isNull(customerPortalLoginCodes.usedAt), gt(customerPortalLoginCodes.expiresAt, now), or(isNull(customerPortalLoginCodes.lockedUntil), lt(customerPortalLoginCodes.lockedUntil, now)))).limit(1);
  const matchingCode = matchingRows[0];
  if (!matchingCode) {
    const activeRows = await db.select().from(customerPortalLoginCodes).where(and(eq(customerPortalLoginCodes.accountId, account.id), isNull(customerPortalLoginCodes.usedAt), gt(customerPortalLoginCodes.expiresAt, now), or(isNull(customerPortalLoginCodes.lockedUntil), lt(customerPortalLoginCodes.lockedUntil, now)))).orderBy(desc(customerPortalLoginCodes.createdAt)).limit(1);
    const active = activeRows[0];
    if (!active) return null;
    const failedAttempts = active.failedAttempts + 1;
    await db.update(customerPortalLoginCodes).set({ failedAttempts, lockedUntil: failedAttempts >= PORTAL_LOGIN_MAX_FAILED_ATTEMPTS ? now + PORTAL_LOGIN_LOCK_MS : null, updatedAt: new Date(now) }).where(and(eq(customerPortalLoginCodes.id, active.id), eq(customerPortalLoginCodes.failedAttempts, active.failedAttempts), isNull(customerPortalLoginCodes.usedAt)));
    return null;
  }
  const result = await db.update(customerPortalLoginCodes).set({ usedAt: new Date(now), updatedAt: new Date(now) }).where(and(eq(customerPortalLoginCodes.id, matchingCode.id), eq(customerPortalLoginCodes.codeHash, codeHash), isNull(customerPortalLoginCodes.usedAt), gt(customerPortalLoginCodes.expiresAt, now), or(isNull(customerPortalLoginCodes.lockedUntil), lt(customerPortalLoginCodes.lockedUntil, now))));
  return affectedRows(result) === 1 ? account : null;
}
