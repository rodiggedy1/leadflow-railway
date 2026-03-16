/**
 * campaignRouter.ts
 * Handles reactivation campaign management:
 *  - CSV import & eligibility filtering
 *  - Campaign CRUD
 *  - Throttled SMS send engine
 *  - Reply routing back to conversation engine
 */

import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { router, protectedProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { reactivationCampaigns, reactivationContacts, conversationSessions } from "../drizzle/schema";
import { sendSms } from "./openphone";
import { notifyOwner } from "./_core/notification";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Frequencies that indicate an ACTIVE recurring customer — never contact */
const RECURRING_FREQUENCIES = new Set([
  "Bi-weekly (15%OFF)",
  "Monthly (10%OFF)",
  "Weekly (20%OFF)",
  "Tri-weekly (10%OFF)",
  "Bi-monthly",
]);

/** Default reactivation message template */
export const DEFAULT_REACTIVATION_TEMPLATE =
  "Hi [Name]! 👋 It's been a while since your last home cleaning with Maids in Black. We miss you! As a returning customer, we'd love to offer you 10% off your next clean. Reply YES to book and we'll take care of everything on our end.";

// ─── Phone normalization ──────────────────────────────────────────────────────

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return "+" + digits;
}

// ─── CSV parsing & eligibility ────────────────────────────────────────────────

interface CsvRow {
  "Transaction ID": string;
  Date: string;
  "First Name": string;
  "Last Name": string;
  "Full Name": string;
  Phone: string;
  Email: string;
  Frequency: string;
  [key: string]: string;
}

interface EligibleContact {
  phone: string;
  phoneRaw: string;
  name: string;
  firstName: string;
  email: string;
  lastBookingDate: string; // YYYY-MM-DD
  daysSince: number;
  bookingCount: number;
  lastPrice: number | null; // Final Amount from CSV (dollars)
  segment: "6-12mo" | "1-2yr";
}

/**
 * Parse a CSV string and return eligible reactivation contacts.
 * Rules:
 *  1. Last booking frequency must NOT be a recurring type
 *  2. Last booking must be 6–24 months ago
 *  3. Phone must be normalizable to a valid US number
 */
export function parseAndFilterCsv(
  csvText: string,
  referenceDate: Date = new Date()
): { eligible: EligibleContact[]; stats: Record<string, number> } {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { eligible: [], stats: {} };

  // Parse header
  const headerLine = lines[0].replace(/^\uFEFF/, ""); // strip BOM
  const headers = parseCsvLine(headerLine);

    const customers = new Map<
    string,
    {
      name: string;
      firstName: string;
      phoneRaw: string;
      email: string;
      lastDate: Date;
      lastFrequency: string;
      bookingCount: number;
      lastPrice: number | null;
    }
  >();

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    if (values.length < headers.length) continue;

    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (values[idx] ?? "").trim();
    });

    const phoneRaw = row["Phone"] ?? "";
    const phone = normalizePhone(phoneRaw);
    if (!phone || phone.length < 10) continue;

    const dateStr = row["Date"] ?? "";
    let date: Date;
    try {
      // Format: MM/DD/YYYY
      const [m, d, y] = dateStr.split("/");
      date = new Date(Number(y), Number(m) - 1, Number(d));
      if (isNaN(date.getTime())) continue;
    } catch {
      continue;
    }

    const frequency = row["Frequency"] ?? "";
    const existing = customers.get(phone);

    const finalAmountRaw = row["Final Amount"] ?? row["Amount Paid by the Customer"] ?? "";
    const lastPrice = parseFloat(finalAmountRaw.replace(/[^0-9.]/g, "")) || null;

    if (!existing) {
      customers.set(phone, {
        name: (row["Full Name"] ?? `${row["First Name"]} ${row["Last Name"]}`).trim(),
        firstName: (row["First Name"] ?? "").trim(),
        phoneRaw,
        email: (row["Email"] ?? "").trim(),
        lastDate: date,
        lastFrequency: frequency,
        bookingCount: 1,
        lastPrice: lastPrice,
      });
    } else {
      existing.bookingCount++;
      if (date > existing.lastDate) {
        existing.lastDate = date;
        existing.lastFrequency = frequency;
        existing.lastPrice = lastPrice;
      }
    }
  }

  const stats = {
    total: customers.size,
    excludedRecurring: 0,
    excludedRecent: 0,
    excludedTooOld: 0,
    eligible: 0,
  };

  const eligible: EligibleContact[] = [];
  const now = referenceDate;

  for (const [phone, c] of Array.from(customers.entries())) {
    const daysSince = Math.floor(
      (now.getTime() - c.lastDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (RECURRING_FREQUENCIES.has(c.lastFrequency)) {
      stats.excludedRecurring++;
      continue;
    }

    if (daysSince < 180) {
      stats.excludedRecent++;
      continue;
    }

    if (daysSince > 730) {
      stats.excludedTooOld++;
      continue;
    }

    const segment: "6-12mo" | "1-2yr" = daysSince < 365 ? "6-12mo" : "1-2yr";

    eligible.push({
      phone,
      phoneRaw: c.phoneRaw,
      name: c.name,
      firstName: c.firstName || c.name.split(" ")[0] || c.name,
      email: c.email,
      lastBookingDate: c.lastDate.toISOString().split("T")[0],
      daysSince,
      bookingCount: c.bookingCount,
      lastPrice: c.lastPrice,
      segment,
    });

    stats.eligible++;
  }

  return { eligible, stats };
}

/** Simple CSV line parser that handles quoted fields */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ─── Message rendering ────────────────────────────────────────────────────────

export function renderMessage(template: string, contact: { firstName: string; name: string }): string {
  return template
    .replace(/\[Name\]/gi, contact.firstName || contact.name)
    .replace(/\[FirstName\]/gi, contact.firstName || contact.name)
    .replace(/\[FullName\]/gi, contact.name);
}

// ─── Campaign router ──────────────────────────────────────────────────────────

export const campaignRouter = router({
  /**
   * Parse a CSV and return the eligible contacts preview.
   * Does NOT persist anything — just analysis.
   */
  previewCsv: protectedProcedure
    .input(
      z.object({
        csvText: z.string().min(1).max(10_000_000), // up to ~10MB
      })
    )
    .mutation(async ({ input }) => {
      const { eligible, stats } = parseAndFilterCsv(input.csvText);
      const warm = eligible.filter((c) => c.segment === "6-12mo");
      const lapsed = eligible.filter((c) => c.segment === "1-2yr");
      return {
        stats,
        warm: warm.slice(0, 200), // preview cap
        lapsed: lapsed.slice(0, 200),
        warmTotal: warm.length,
        lapsedTotal: lapsed.length,
      };
    }),

  /**
   * Create a campaign from a CSV upload.
   * Parses the CSV, filters eligible contacts, stores them as PENDING.
   * Does NOT send any SMS — campaign starts in DRAFT status.
   */
  createFromCsv: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        messageTemplate: z.string().min(10).max(1000),
        segment: z.enum(["6-12mo", "1-2yr", "all"]),
        batchSize: z.number().int().min(1).max(200).default(50),
        csvText: z.string().min(1).max(10_000_000),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const { eligible } = parseAndFilterCsv(input.csvText);

      // Filter by selected segment
      const contacts =
        input.segment === "all"
          ? eligible
          : eligible.filter((c) => c.segment === input.segment);

      if (contacts.length === 0) {
        throw new Error("No eligible contacts found for the selected segment");
      }

      // Create campaign record
      const [result] = await db.insert(reactivationCampaigns).values({
        name: input.name,
        messageTemplate: input.messageTemplate,
        segment: input.segment,
        status: "DRAFT",
        batchSize: input.batchSize,
        totalContacts: contacts.length,
        sentCount: 0,
        repliedCount: 0,
        bookedCount: 0,
      });

      const campaignId = (result as any).insertId as number;

      // Bulk insert contacts in chunks of 500
      const CHUNK = 500;
      for (let i = 0; i < contacts.length; i += CHUNK) {
        const chunk = contacts.slice(i, i + CHUNK);
        await db.insert(reactivationContacts).values(
          chunk.map((c) => ({
            campaignId,
            phone: c.phone,
            phoneRaw: c.phoneRaw,
            name: c.name,
            firstName: c.firstName,
            email: c.email,
            lastBookingDate: c.lastBookingDate,
            daysSince: c.daysSince,
            bookingCount: c.bookingCount,
            lastPrice: c.lastPrice ? Math.round(c.lastPrice) : null,
            discountPct: 10,
            segment: c.segment,
            status: "PENDING" as const,
          }))
        );
      }

      return { campaignId, contactCount: contacts.length };
    }),

  /** List all campaigns with aggregate stats including live bookedRevenue */
  list: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const campaigns = await db
      .select()
      .from(reactivationCampaigns)
      .orderBy(desc(reactivationCampaigns.createdAt));
    // Compute bookedRevenue per campaign by joining contacts → sessions
    const revenueRows = await db
      .select({
        campaignId: reactivationContacts.campaignId,
        bookedRevenue: sql<number>`COALESCE(SUM(
          CASE WHEN ${conversationSessions.isBooked} = 1
          THEN COALESCE(${conversationSessions.bookedAmount}, CAST(${conversationSessions.quotedPrice} AS UNSIGNED), 0)
          ELSE 0 END
        ), 0)`,
      })
      .from(reactivationContacts)
      .innerJoin(conversationSessions, eq(reactivationContacts.sessionId, conversationSessions.id))
      .groupBy(reactivationContacts.campaignId);
    const revenueMap = new Map(revenueRows.map(r => [r.campaignId, Number(r.bookedRevenue)]));
    return campaigns.map(c => ({
      ...c,
      bookedRevenue: revenueMap.get(c.id) ?? 0,
    }));
  }),

  /** Get live stats for a single campaign (bookedRevenue + rates) */
  stats: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [campaign] = await db
        .select()
        .from(reactivationCampaigns)
        .where(eq(reactivationCampaigns.id, input.id));
      if (!campaign) return null;
      const [revenueRow] = await db
        .select({
          bookedRevenue: sql<number>`COALESCE(SUM(
            CASE WHEN ${conversationSessions.isBooked} = 1
            THEN COALESCE(${conversationSessions.bookedAmount}, CAST(${conversationSessions.quotedPrice} AS UNSIGNED), 0)
            ELSE 0 END
          ), 0)`,
        })
        .from(reactivationContacts)
        .innerJoin(conversationSessions, eq(reactivationContacts.sessionId, conversationSessions.id))
        .where(eq(reactivationContacts.campaignId, input.id));
      const bookedRevenue = Number(revenueRow?.bookedRevenue ?? 0);
      const replyRate = campaign.sentCount > 0
        ? Math.round((campaign.repliedCount / campaign.sentCount) * 100)
        : 0;
      const conversionRate = campaign.repliedCount > 0
        ? Math.round((campaign.bookedCount / campaign.repliedCount) * 100)
        : 0;
      return {
        ...campaign,
        bookedRevenue,
        replyRate,
        conversionRate,
      };
    }),

  /** Get a single campaign with its contacts */
  get: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;

      const [campaign] = await db
        .select()
        .from(reactivationCampaigns)
        .where(eq(reactivationCampaigns.id, input.id));

      if (!campaign) return null;

      const contacts = await db
        .select()
        .from(reactivationContacts)
        .where(eq(reactivationContacts.campaignId, input.id))
        .orderBy(reactivationContacts.createdAt);

      return { campaign, contacts };
    }),

  /** Update campaign status (DRAFT → ACTIVE, ACTIVE → PAUSED, etc.) */
  updateStatus: protectedProcedure
    .input(
      z.object({
        id: z.number().int(),
        status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "COMPLETED"]),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db
        .update(reactivationCampaigns)
        .set({ status: input.status })
        .where(eq(reactivationCampaigns.id, input.id));

      // If activating, trigger the first batch
      if (input.status === "ACTIVE") {
        sendNextBatch(input.id).catch(console.error);
      }

      return { ok: true };
    }),

  /** Delete a DRAFT campaign and its contacts */
  delete: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Only allow deleting DRAFT campaigns
      const [campaign] = await db
        .select()
        .from(reactivationCampaigns)
        .where(eq(reactivationCampaigns.id, input.id));

      if (!campaign) throw new Error("Campaign not found");
      if (campaign.status !== "DRAFT") {
        throw new Error("Only DRAFT campaigns can be deleted");
      }

      await db
        .delete(reactivationContacts)
        .where(eq(reactivationContacts.campaignId, input.id));

      await db
        .delete(reactivationCampaigns)
        .where(eq(reactivationCampaigns.id, input.id));

      return { ok: true };
    }),

  /** Get contacts for a campaign with optional status filter */
  getContacts: protectedProcedure
    .input(
      z.object({
        campaignId: z.number().int(),
        status: z
          .enum(["PENDING", "SENT", "REPLIED", "BOOKED", "OPTED_OUT"])
          .optional(),
        limit: z.number().int().min(1).max(500).default(100),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { contacts: [], total: 0 };

      const conditions = [eq(reactivationContacts.campaignId, input.campaignId)];
      if (input.status) {
        conditions.push(eq(reactivationContacts.status, input.status));
      }

      const contacts = await db
        .select()
        .from(reactivationContacts)
        .where(and(...conditions))
        .orderBy(reactivationContacts.createdAt)
        .limit(input.limit)
        .offset(input.offset);

      const [countRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(reactivationContacts)
        .where(and(...conditions));

      return { contacts, total: Number(countRow?.count ?? 0) };
    }),
});

// ─── Throttled send engine ────────────────────────────────────────────────────

/**
 * Sends the next batch of pending contacts for a campaign.
 * Respects the campaign's batchSize (per-hour throttle).
 * Called when a campaign is activated or when a batch completes.
 */
export async function sendNextBatch(campaignId: number): Promise<void> {
  const db = await getDb();
    if (!db) return;

    const [campaign] = await db
      .select()
      .from(reactivationCampaigns)
      .where(eq(reactivationCampaigns.id, campaignId));

    if (!campaign || campaign.status !== "ACTIVE") return;

  // Get next batch of PENDING contacts
  const pending = await db
    .select()
    .from(reactivationContacts)
    .where(
      and(
        eq(reactivationContacts.campaignId, campaignId),
        eq(reactivationContacts.status, "PENDING")
      )
    )
    .limit(campaign.batchSize);

  if (pending.length === 0) {
    // All contacts sent — mark campaign complete
    await db
      .update(reactivationCampaigns)
      .set({ status: "COMPLETED" })
      .where(eq(reactivationCampaigns.id, campaignId));

    await notifyOwner({
      title: `Campaign "${campaign.name}" completed`,
      content: `All ${campaign.totalContacts} contacts have been messaged. Sent: ${campaign.sentCount}, Replied: ${campaign.repliedCount}, Booked: ${campaign.bookedCount}`,
    }).catch(() => {});
    // notifyOwner signature: ({ title, content })
    return;
  }

  let sentThisBatch = 0;

  for (const contact of pending) {
    try {
      const message = renderMessage(campaign.messageTemplate, {
        firstName: contact.firstName ?? "",
        name: contact.name ?? "",
      });

      await sendSms({ to: contact.phone, content: message });

      // Create a conversation session for this contact so inbound replies are routed correctly
      const [sessionResult] = await db.insert(conversationSessions).values({
        leadPhone: contact.phone,
        leadName: contact.name ?? "",
        stage: "REACTIVATION",
        leadSource: "reactivation",
        reactivationLastPrice: contact.lastPrice ?? null,
        reactivationDiscountPct: contact.discountPct ?? 10,
        messageHistory: "[]",
        aiMode: 1,
        isBooked: 0,
      });
      const sessionId = (sessionResult as any).insertId as number;

      // Mark as SENT and link session
      await db
        .update(reactivationContacts)
        .set({ status: "SENT", sentAt: new Date(), sessionId })
        .where(eq(reactivationContacts.id, contact.id));

      sentThisBatch++;
    } catch (err) {
      console.error(`[Campaign] Failed to send to ${contact.phone}:`, err);
    }

    // Small delay between sends to avoid rate limits (100ms)
    await new Promise((r) => setTimeout(r, 100));
  }

  // Update campaign sent count and lastSentAt
  await db
    .update(reactivationCampaigns)
    .set({
      sentCount: sql`${reactivationCampaigns.sentCount} + ${sentThisBatch}`,
      lastSentAt: new Date(),
    })
    .where(eq(reactivationCampaigns.id, campaignId));

  // Schedule next batch in 1 hour if there are more pending
  const [remaining] = await db
    .select({ count: sql<number>`count(*)` })
    .from(reactivationContacts)
    .where(
      and(
        eq(reactivationContacts.campaignId, campaignId),
        eq(reactivationContacts.status, "PENDING")
      )
    );

  if (Number(remaining?.count ?? 0) > 0) {
    console.log(
      `[Campaign ${campaignId}] Sent ${sentThisBatch} messages. Next batch in 1 hour.`
    );
    setTimeout(() => sendNextBatch(campaignId).catch(console.error), 60 * 60 * 1000);
  }
}

/**
 * Called by the webhook handler when an inbound SMS matches a reactivation contact.
 * Updates the contact status to REPLIED and increments the campaign counter.
 */
export async function markReactivationContactReplied(
  phone: string
): Promise<{ campaignId: number; contactId: number } | null> {
  const db = await getDb();
  if (!db) return null;

  // Find the most recent SENT contact for this phone
  const [contact] = await db
    .select()
    .from(reactivationContacts)
    .where(
      and(
        eq(reactivationContacts.phone, phone),
        eq(reactivationContacts.status, "SENT")
      )
    )
    .orderBy(desc(reactivationContacts.sentAt))
    .limit(1);

  if (!contact) return null;

  await db
    .update(reactivationContacts)
    .set({ status: "REPLIED", repliedAt: new Date() })
    .where(eq(reactivationContacts.id, contact.id));

  // Increment campaign replied count
  await db
    .update(reactivationCampaigns)
    .set({
      repliedCount: sql`${reactivationCampaigns.repliedCount} + 1`,
    })
    .where(eq(reactivationCampaigns.id, contact.campaignId));

  return { campaignId: contact.campaignId, contactId: contact.id };
}

/**
 * Called when a reactivation session is marked as BOOKED.
 * Finds the linked reactivation contact and increments the campaign bookedCount.
 * Also updates the contact status to BOOKED.
 */
export async function markReactivationContactBooked(
  sessionId: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // Find the reactivation contact linked to this session
  const [contact] = await db
    .select()
    .from(reactivationContacts)
    .where(eq(reactivationContacts.sessionId, sessionId))
    .limit(1);
  if (!contact) return; // not a reactivation lead
  // Only increment once (avoid double-counting if called multiple times)
  if (contact.status === "BOOKED") return;
  await db
    .update(reactivationContacts)
    .set({ status: "BOOKED" })
    .where(eq(reactivationContacts.id, contact.id));
  await db
    .update(reactivationCampaigns)
    .set({
      bookedCount: sql`${reactivationCampaigns.bookedCount} + 1`,
    })
    .where(eq(reactivationCampaigns.id, contact.campaignId));
}
