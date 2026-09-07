import { createHash, randomBytes } from "crypto";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { customerPortalAccounts, customerPortalHandoffTokens, leadflowJobs } from "../drizzle/schema";
import { getDb } from "./db";
import { extractUSDigits, normalizePhone } from "./utils/phone";
import { ONE_YEAR_MS } from "../shared/const";

type DbClient = NonNullable<Awaited<ReturnType<typeof getDb>>>;
const CUSTOMER_PORTAL_BASE_URL = "https://quote.maidinblack.com";

function insertId(result: unknown, label: string): number {
  const value = Number((result as { insertId?: number }).insertId ?? (result as Array<{ insertId?: number }>)[0]?.insertId);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} insert did not return an ID.`);
  return value;
}

export async function ensureCustomerPortalAccount(db: DbClient, input: { customerName: string; customerPhone: string; customerEmail?: string | null }) {
  const customerPhone = normalizePhone(input.customerPhone);
  if (!customerPhone) throw new Error("Enter a valid U.S. phone number.");
  const existing = await db.select().from(customerPortalAccounts).where(eq(customerPortalAccounts.customerPhone, customerPhone)).limit(1);
  if (existing[0]) return existing[0];
  const now = new Date();
  try {
    const result = await db.insert(customerPortalAccounts).values({ customerName: input.customerName.trim().replace(/\s+/g, " "), customerPhone, customerEmail: input.customerEmail?.trim() || null, createdAt: now, updatedAt: now });
    const id = insertId(result, "Customer portal account");
    const rows = await db.select().from(customerPortalAccounts).where(eq(customerPortalAccounts.id, id)).limit(1);
    if (!rows[0]) throw new Error("Customer portal account could not be loaded.");
    return rows[0];
  } catch (error) {
    const duplicate = error as { code?: string; errno?: number };
    if (duplicate.code !== "ER_DUP_ENTRY" && duplicate.errno !== 1062) throw error;
    const rows = await db.select().from(customerPortalAccounts).where(eq(customerPortalAccounts.customerPhone, customerPhone)).limit(1);
    if (!rows[0]) throw error;
    return rows[0];
  }
}

/**
 * Lazily creates the established portal account only when a valid imported
 * LeadFlow customer asks to sign in. It sends no SMS and never alters a job.
 */
export async function ensureCustomerPortalAccountForLeadflowPhone(db: DbClient, phone: string) {
  const customerPhone = normalizePhone(phone);
  if (!customerPhone) return null;

  const accounts = await db.select().from(customerPortalAccounts).where(eq(customerPortalAccounts.customerPhone, customerPhone)).limit(1);
  if (accounts[0]) return accounts[0];

  const phoneDigits = extractUSDigits(customerPhone);
  if (!phoneDigits) return null;
  const jobs = await db.select({
    customerName: leadflowJobs.customerName,
    customerPhone: leadflowJobs.customerPhone,
    customerEmail: leadflowJobs.customerEmail,
  }).from(leadflowJobs).where(sql`RIGHT(REGEXP_REPLACE(${leadflowJobs.customerPhone}, '[^0-9]', ''), 10) = ${phoneDigits}`)
    .orderBy(desc(leadflowJobs.updatedAt), desc(leadflowJobs.id)).limit(1);
  const job = jobs[0];
  if (!job?.customerPhone) return null;

  return ensureCustomerPortalAccount(db, {
    customerName: job.customerName,
    customerPhone: job.customerPhone,
    customerEmail: job.customerEmail,
  });
}

export async function createCustomerPortalHandoff(db: DbClient, input: { customerName: string; customerPhone: string; customerEmail?: string | null }) {
  const account = await ensureCustomerPortalAccount(db, input);
  const code = randomBytes(32).toString("base64url");
  const now = new Date();
  await db.insert(customerPortalHandoffTokens).values({
    accountId: account.id,
    tokenHash: createHash("sha256").update(code).digest("hex"),
    expiresAt: Date.now() + 15 * 60 * 1_000,
    createdAt: now,
  });
  return code;
}

/**
 * Returns the customer counterpart to the established reusable Cleaner Portal link.
 * It intentionally uses the existing customer handoff route and portal session,
 * while preserving short single-use handoff codes for booking completion.
 */
export async function getOrCreateCustomerPortalMagicLink(db: DbClient, input: { customerName: string; customerPhone: string; customerEmail?: string | null }) {
  const account = await ensureCustomerPortalAccount(db, input);
  const now = Date.now();
  const existing = await db.select({ token: customerPortalHandoffTokens.reusableToken }).from(customerPortalHandoffTokens).where(and(
    eq(customerPortalHandoffTokens.accountId, account.id),
    eq(customerPortalHandoffTokens.reusable, 1),
    sql`${customerPortalHandoffTokens.expiresAt} > ${now}`,
  )).orderBy(desc(customerPortalHandoffTokens.createdAt)).limit(1);
  const reusableToken = existing[0]?.token;
  const code = reusableToken ?? randomBytes(32).toString("base64url");
  if (!reusableToken) {
    await db.insert(customerPortalHandoffTokens).values({
      accountId: account.id,
      tokenHash: createHash("sha256").update(code).digest("hex"),
      expiresAt: now + ONE_YEAR_MS,
      reusable: 1,
      reusableToken: code,
      createdAt: new Date(now),
    });
  }
  return `${CUSTOMER_PORTAL_BASE_URL}/customer-portal/handoff?access=${encodeURIComponent(code)}`;
}

export async function redeemCustomerPortalHandoff(db: DbClient, code: string) {
  const tokenHash = createHash("sha256").update(code).digest("hex");
  const tokens = await db.select().from(customerPortalHandoffTokens).where(and(
    eq(customerPortalHandoffTokens.tokenHash, tokenHash),
    or(eq(customerPortalHandoffTokens.reusable, 1), isNull(customerPortalHandoffTokens.usedAt)),
  )).limit(1);
  const token = tokens[0];
  if (!token || token.expiresAt < Date.now()) return null;
  if (!token.reusable) {
    const now = new Date();
    const result = await db.update(customerPortalHandoffTokens).set({ usedAt: now }).where(and(eq(customerPortalHandoffTokens.id, token.id), isNull(customerPortalHandoffTokens.usedAt)));
    if (Number((result as { affectedRows?: number }).affectedRows ?? 0) !== 1) return null;
  }
  const accounts = await db.select().from(customerPortalAccounts).where(eq(customerPortalAccounts.id, token.accountId)).limit(1);
  return accounts[0] ?? null;
}

export function createCustomerPortalRequestNumber(): string { return `MIB-R${randomBytes(6).toString("hex").toUpperCase()}`; }
