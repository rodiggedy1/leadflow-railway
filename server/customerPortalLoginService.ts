import { createHmac, randomInt } from "crypto";
import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { customerPortalAccounts, customerPortalLoginCodes } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { normalizePhone } from "./utils/phone";

type DbClient = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type LoginAccount = typeof customerPortalAccounts.$inferSelect;

export const PORTAL_LOGIN_CODE_TTL_MS = 10 * 60 * 1_000;
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
  if (Array.isArray(result)) {
    return Number((result[0] as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
  }
  return Number((result as { affectedRows?: number }).affectedRows ?? 0);
}

function keyedHash(value: string) {
  return createHmac("sha256", ENV.cookieSecret).update(value).digest("hex");
}

function loginCodeHash(accountId: number, code: string) {
  return keyedHash(`customer-portal-login:${accountId}:${code}`);
}

export async function requestCustomerPortalLoginCode(db: DbClient, input: { phone: string }, dependencies: Partial<PortalLoginDependencies> = {}) {
  const resolvedDependencies = { ...defaultDependencies, ...dependencies };
  const normalizedPhone = normalizePhone(input.phone);
  const now = resolvedDependencies.now();
  if (!normalizedPhone) return { sent: false };

  const accounts = await db.select().from(customerPortalAccounts).where(eq(customerPortalAccounts.customerPhone, normalizedPhone)).limit(1);
  const account = accounts[0];
  if (!account) return { sent: false };

  const activeCodes = await db.select().from(customerPortalLoginCodes).where(and(eq(customerPortalLoginCodes.accountId, account.id), isNull(customerPortalLoginCodes.usedAt), gt(customerPortalLoginCodes.expiresAt, now))).limit(1);

  const code = resolvedDependencies.generateCode();
  if (!/^\d{6}$/.test(code)) throw new Error("Portal login code generator returned an invalid code.");
  const codeHash = loginCodeHash(account.id, code);
  const createdAt = new Date(now);
  await db.update(customerPortalLoginCodes).set({ usedAt: createdAt, updatedAt: createdAt }).where(and(eq(customerPortalLoginCodes.accountId, account.id), isNull(customerPortalLoginCodes.usedAt), gt(customerPortalLoginCodes.expiresAt, now)));
  await db.insert(customerPortalLoginCodes).values({ accountId: account.id, codeHash, expiresAt: now + PORTAL_LOGIN_CODE_TTL_MS, usedAt: null, failedAttempts: 0, lockedUntil: null, createdAt, updatedAt: createdAt });
  let sent: { success: boolean };
  try {
    sent = await resolvedDependencies.sendCode(normalizedPhone, code);
  } catch {
    sent = { success: false };
  }
  if (!sent.success) {
    const failedAt = new Date(resolvedDependencies.now());
    await db.update(customerPortalLoginCodes).set({ usedAt: failedAt, updatedAt: failedAt }).where(and(eq(customerPortalLoginCodes.codeHash, codeHash), isNull(customerPortalLoginCodes.usedAt)));
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
  const result = await db.update(customerPortalLoginCodes).set({ usedAt: new Date(now), updatedAt: new Date(now) }).where(and(eq(customerPortalLoginCodes.accountId, account.id), eq(customerPortalLoginCodes.codeHash, codeHash), isNull(customerPortalLoginCodes.usedAt), gt(customerPortalLoginCodes.expiresAt, now)));
  return affectedRows(result) === 1 ? account : null;
}
