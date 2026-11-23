import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import {
  leadCallNotesAvailabilityInputSchema,
  type LeadCallNotesAvailabilityInput,
  type LeadCallNotesAvailabilityResult,
} from "../shared/leadCallNotesAvailability";
import { normalizePhone } from "./utils/phone";

type DbPort = { execute(query: SQL): Promise<unknown> };
type Row = Record<string, unknown>;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;
async function rows(db: DbPort, query: SQL): Promise<Row[]> {
  const result = await db.execute(query);
  if (!Array.isArray(result) || !Array.isArray(result[0])) throw new Error("Call notes availability query returned an invalid result.");
  return result[0] as Row[];
}

/** Passive read-only seam: one session lookup and at most three grouped history reads. */
export function createLeadCallNotesAvailabilityReader(getDb: () => Promise<DbPort | null>) {
  return { async read(rawInput: LeadCallNotesAvailabilityInput): Promise<LeadCallNotesAvailabilityResult> {
    const input = leadCallNotesAvailabilityInputSchema.parse(rawInput);
    const leads = input.leads.map(lead => ({ ...lead, canonicalPhone: normalizePhone(lead.phone), hasCalls: false as boolean | null }));
    const result = (): LeadCallNotesAvailabilityResult => ({ leads: leads.map(({ key, hasCalls }) => ({ key, hasCalls })) });
    const sessionIds = Array.from(new Set(leads.flatMap(lead => lead.sessionId === null ? [] : [lead.sessionId])));
    if (!sessionIds.length && !leads.some(lead => lead.canonicalPhone)) return result();
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable. Call notes availability could not be loaded." });
    if (sessionIds.length) {
      const ids = sql.join(sessionIds.map(id => sql`${id}`), sql`, `);
      const sessions = await rows(db, sql`SELECT id, leadPhone FROM conversation_sessions WHERE id IN (${ids})`);
      const byId = new Map(sessions.map(session => [Number(session.id), session]));
      for (const lead of leads) {
        if (lead.sessionId === null) continue;
        const session = byId.get(lead.sessionId);
        const canonicalPhone = normalizePhone(text(session?.leadPhone));
        if (!session || (lead.phone !== null && lead.canonicalPhone !== canonicalPhone)) lead.hasCalls = null;
        lead.canonicalPhone = lead.hasCalls === null ? null : canonicalPhone;
      }
    }
    const phones = new Set(leads.flatMap(lead => lead.canonicalPhone ? [lead.canonicalPhone] : []));
    if (!phones.size) return result();
    // The same complete historical forms as the popup; never suffix/name/session-only matching.
    const forms = sql.join(Array.from(phones).flatMap(phone => [phone, phone.slice(1), phone.slice(2)]).map(form => sql`${form}`), sql`, `);
    // TIMESTAMP columns must represent a finite nonnegative time, like the popup's timestamp helper.
    // The epoch comparison rejects historical zero dates; it is not a deployment-date cutoff.
    const usableDate = (column: SQL) => sql`(${column} >= '1970-01-01 00:00:00' AND UNIX_TIMESTAMP(${column}) >= 0)`;
    const voice = await rows(db, sql`SELECT callerPhone FROM voice_calls WHERE callerPhone IN (${forms})
      AND ${usableDate(sql`createdAt`)} GROUP BY callerPhone`);
    const staff = await rows(db, sql`SELECT callerPhone FROM openphone_call_recordings WHERE callerPhone IN (${forms})
      AND ${usableDate(sql`callStartedAt`)} GROUP BY callerPhone`);
    const outbound = await rows(db, sql`SELECT calledPhone FROM call_log WHERE calledTarget = 'client' AND calledPhone IN (${forms})
      AND (firedAt >= 0 OR ${usableDate(sql`createdAt`)}) GROUP BY calledPhone`);
    const available = new Set<string>();
    for (const row of [...voice, ...staff, ...outbound]) {
      const phone = normalizePhone(text(row.callerPhone ?? row.calledPhone));
      if (phone && phones.has(phone)) available.add(phone);
    }
    for (const lead of leads) {
      if (lead.canonicalPhone) lead.hasCalls = available.has(lead.canonicalPhone);
    }
    return result();
  } };
}

/** Importing this module never initializes the application, DB, router or a transport. */
export async function getLeadCallNotesAvailability(input: LeadCallNotesAvailabilityInput): Promise<LeadCallNotesAvailabilityResult> {
  return createLeadCallNotesAvailabilityReader(async () => (await import("./db")).getDb()).read(input);
}
