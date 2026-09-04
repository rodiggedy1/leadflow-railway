import { createHash, randomBytes } from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { customerPortalAccounts, customerPortalHandoffTokens } from "../drizzle/schema";
import { normalizePhone } from "./utils/phone";

type DbClient = Awaited<ReturnType<typeof import("./db").getDb>>;

function insertId(result: unknown, label: string): number {
  const value = Number((result as { insertId?: number }).insertId ?? (result as Array<{ insertId?: number }>)[0]?.insertId);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} insert did not return an ID.`);
  return value;
}

export function normalizeCustomerPortalPhone(phone: string): string {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error("Enter a valid U.S. phone number.");
  return normalized;
}

export async function ensureCustomerPortalAccount(db: NonNullable<DbClient>, input: { customerName: string; customerPhone: string; customerEmail?: string | null }) {
  const customerName = input.customerName.trim().replace(/\s+/g, " ");
  const customerPhone = normalizeCustomerPortalPhone(input.customerPhone);
  const existing = await db.select().from(customerPortalAccounts).where(eq(customerPortalAccounts.customerPhone, customerPhone)).limit(1);
  if (existing[0]) return existing[0];
  const now = new Date();
  try {
    const result = await db.insert(customerPortalAccounts).values({
      customerName,
      customerPhone,
      customerEmail: input.customerEmail?.trim() || null,
      createdAt: now,
      updatedAt: now,
    });
    const accountId = insertId(result, "Customer portal account");
    const rows = await db.select().from(customerPortalAccounts).where(eq(customerPortalAccounts.id, accountId)).limit(1);
    if (!rows[0]) throw new Error("Customer portal account could not be loaded.");
    return rows[0];
  } catch (error) {
    const duplicate = error as { code?: string; errno?: number; message?: string };
    if (duplicate.code !== "ER_DUP_ENTRY" && duplicate.errno !== 1062 && !duplicate.message?.includes("Duplicate entry")) throw error;
    const rows = await db.select().from(customerPortalAccounts).where(eq(customerPortalAccounts.customerPhone, customerPhone)).limit(1);
    if (!rows[0]) throw error;
    return rows[0];
  }
}

export async function createCustomerPortalHandoff(db: NonNullable<DbClient>, account: typeof customerPortalAccounts.$inferSelect): Promise<string> {
  const code = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(code).digest("hex");
  const now = new Date();
  await db.insert(customerPortalHandoffTokens).values({
    accountId: account.id,
    tokenHash,
    expiresAt: Date.now() + 15 * 60_000,
    usedAt: null,
    createdAt: now,
  });
  return code;
}

export async function redeemCustomerPortalHandoff(db: NonNullable<DbClient>, code: string) {
  const tokenHash = createHash("sha256").update(code).digest("hex");
  const tokens = await db.select().from(customerPortalHandoffTokens).where(and(eq(customerPortalHandoffTokens.tokenHash, tokenHash), isNull(customerPortalHandoffTokens.usedAt))).limit(1);
  const token = tokens[0];
  if (!token || token.expiresAt < Date.now()) return null;
  const now = new Date();
  const result = await db.update(customerPortalHandoffTokens).set({ usedAt: now }).where(and(eq(customerPortalHandoffTokens.id, token.id), isNull(customerPortalHandoffTokens.usedAt)));
  const affected = Number((result as { affectedRows?: number }).affectedRows ?? (result as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0);
  if (affected !== 1) return null;
  const accounts = await db.select().from(customerPortalAccounts).where(eq(customerPortalAccounts.id, token.accountId)).limit(1);
  return accounts[0] ?? null;
}

export function createCustomerPortalRequestNumber(): string {
  return `MIB-R${randomBytes(6).toString("hex").toUpperCase()}`;
}
