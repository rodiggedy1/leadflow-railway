import { and, eq, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, agents, type Agent, cleanerMagicLinkTokens, conversationSessions } from "../drizzle/schema";
import type { InferInsertModel } from "drizzle-orm";
import { ENV } from './_core/env';
import { randomBytes } from "crypto";

// ── Phone normalization guard ─────────────────────────────────────────────────
// TiDB does not support stored triggers, so we enforce E.164 normalization here
// at the application layer. Every insert/update that touches leadPhone MUST go
// through normalizeLeadPhone() so no code path can store a non-E.164 number.

/**
 * Normalizes a US phone string to E.164 (+1XXXXXXXXXX).
 * Placeholder phones (thumbtack-sms-*, bark-sms-*, yelp-*, etc.) are passed through unchanged.
 * This is the single source of truth — mirrors the logic in normalizePhone() in routers.ts.
 */
export function normalizeLeadPhone(phone: string): string {
  // Pass through placeholder / non-numeric phones
  if (/^[a-zA-Z]/.test(phone)) return phone;
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  // Already E.164 or unrecognized — return as-is
  return phone;
}

type SessionInsertValues = InferInsertModel<typeof conversationSessions>;

/**
 * Safe wrapper around insertSession(db, ...).
 * Automatically normalizes leadPhone to E.164 before the insert.
 * Use this instead of calling db.insert(conversationSessions) directly.
 */
export async function insertSession(
  db: ReturnType<typeof drizzle>,
  values: SessionInsertValues
) {
  const normalized = { ...values, leadPhone: normalizeLeadPhone(values.leadPhone as string) };
  return db.insert(conversationSessions).values(normalized as any);
}

let _db: ReturnType<typeof drizzle> | null = null;

/**
 * Reset the DB singleton so the next call to getDb() creates a fresh connection.
 * Call this whenever a fatal connection error (ECONNRESET, ECONNREFUSED, etc.) is
 * detected so the pool can recover without a server restart.
 */
export function resetDb() {
  _db = null;
}

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      // timezone: 'Z' forces mysql2 to serialize JavaScript Date objects as UTC strings,
      // preventing a 4-hour offset that occurs when the production container's system
      // timezone (America/New_York) causes mysql2 to format dates as local time strings
      // which MySQL then stores as-is, making them 4 hours ahead of actual UTC.
      _db = drizzle(process.env.DATABASE_URL, { connection: { timezone: 'Z' } } as any);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    // Reset the DB singleton on connection errors so the pool can recover
    // on the next request without requiring a server restart.
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT') {
      console.warn('[Database] Connection error detected — resetting DB singleton for recovery');
      resetDb();
    }
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }
  try {
    const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
    return result.length > 0 ? result[0] : undefined;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT') {
      console.warn('[Database] Connection error in getUserByOpenId — resetting DB singleton');
      resetDb();
    }
    throw error;
  }
}

// ── Agent DB helpers ──────────────────────────────────────────────────────────

export async function getAgentByEmail(email: string): Promise<Agent | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(agents).where(eq(agents.email, email)).limit(1);
  return result[0];
}

export async function getAgentById(id: number): Promise<Agent | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  return result[0];
}

export async function getAllAgents(): Promise<Agent[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(agents).orderBy(agents.createdAt);
}

export async function createAgent(data: {
  name: string;
  email: string;
  passwordHash: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(agents).values({
    name: data.name,
    email: data.email,
    passwordHash: data.passwordHash,
    isActive: 1,
  });
}

export async function setAgentActive(id: number, isActive: 0 | 1): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(agents).set({ isActive }).where(eq(agents.id, id));
}

// ── Magic Link helpers ────────────────────────────────────────────────────────

const BASE_URL = "https://quote.maidinblack.com";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Returns the magic login URL for a cleaner.
 * Reuses the existing valid 30-day token if one exists; otherwise creates a new one.
 * Safe to call from any server-side code (fieldMgmtEngine, cleanerRouter, etc.).
 */
export async function getOrCreateCleanerMagicLink(cleanerProfileId: number): Promise<string> {
  const db = await getDb();
  if (!db) {
    // Fallback: return the plain portal URL if DB is unavailable
    return `${BASE_URL}/cleaner`;
  }

  const now = new Date();

  // Look for an existing valid (non-expired) token for this cleaner
  const existing = await db
    .select({ token: cleanerMagicLinkTokens.token })
    .from(cleanerMagicLinkTokens)
    .where(
      and(
        eq(cleanerMagicLinkTokens.cleanerProfileId, cleanerProfileId),
        gt(cleanerMagicLinkTokens.expiresAt, now)
      )
    )
    .orderBy(cleanerMagicLinkTokens.createdAt)
    .limit(1);

  if (existing[0]) {
    return `${BASE_URL}/auth/cleaner-callback?token=${existing[0].token}`;
  }

  // No valid token — create a new one
  const rawToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + THIRTY_DAYS_MS);

  await db.insert(cleanerMagicLinkTokens).values({
    cleanerProfileId,
    token: rawToken,
    expiresAt,
  });

  console.log(`[MagicLink] Created new token for cleanerProfileId=${cleanerProfileId}, expires ${expiresAt.toISOString()}`);
  return `${BASE_URL}/auth/cleaner-callback?token=${rawToken}`;
}
