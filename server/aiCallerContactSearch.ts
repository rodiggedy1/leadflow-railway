import { TRPCError } from "@trpc/server";
import { desc, or, sql, type SQL } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import { z } from "zod";
import { bookings, cleanerProfiles, completedJobs, leadflowJobs, quoteLeads } from "../drizzle/schema";
import {
  normalizeContactSearchQuery,
  type AiCallerContactSearchResult,
} from "../shared/aiCallerContactSearch";
import { agentProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { normalizePhone } from "./utils/phone";

function literalPattern(query: string): string {
  // Explicit ESCAPE avoids relying on MySQL's backslash SQL mode. All query
  // characters, including %, _, backslashes and the escape itself, stay literal.
  // Tokens remain ordered while allowing repeated spaces or a middle name.
  return `%${query.split(" ").map(token => token.replace(/[!%_\\]/g, "!$&")).join("%")}%`;
}

function contactCondition(name: AnyMySqlColumn, phone: AnyMySqlColumn, query: string): SQL {
  const nameMatch = sql`lower(${name}) like ${literalPattern(query)} escape '!'`;
  if (!/^[+\d\s()./\[\]–—-]+$/.test(query)) return nameMatch;
  const digits = query.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (!digits) return nameMatch;

  // Contiguous digit matching avoids the false positives of %3%0%2... (which
  // also matches intervening digits). No SQL regex or unbound user input.
  let formattedPhone: SQL = sql`${phone}`;
  for (const punctuation of [" ", "(", ")", "-", ".", "+", "/", "[", "]", "\t", "\r", "\n", "\u00a0", "–", "—"]) {
    formattedPhone = sql`replace(${formattedPhone}, ${punctuation}, '')`;
  }
  return or(nameMatch, sql`${formattedPhone} like ${`%${digits}%`}`)!;
}

/** Additive contact lookup only: no date, status, assignment, or booking gates. */
export const aiCallerContactSearch = agentProcedure
  .input(z.object({
    query: z.string().max(100).transform(normalizeContactSearchQuery).pipe(z.string().min(1)),
  }))
  .query(async ({ input }): Promise<AiCallerContactSearchResult[]> => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    const results: AiCallerContactSearchResult[] = [];
    const seenPhones = new Set<string>();
    const append = (contact: AiCallerContactSearchResult) => {
      // Canonicalize valid US numbers only for dedup; retain the source phone
      // for display/calling and never merge all missing or invalid numbers.
      const phoneKey = normalizePhone(contact.phone) ?? contact.phone;
      if (phoneKey && seenPhones.has(phoneKey)) return;
      if (phoneKey) seenPhones.add(phoneKey);
      results.push(contact);
    };

    const pastCustomers = await db
      .select({ id: completedJobs.id, name: completedJobs.name, phone: completedJobs.phone,
        address: completedJobs.address, serviceType: completedJobs.serviceType, jobDate: completedJobs.jobDate })
      .from(completedJobs)
      .where(contactCondition(completedJobs.name, completedJobs.phone, input.query))
      .orderBy(desc(completedJobs.createdAt))
      .limit(8);
    for (const contact of pastCustomers) append({
      id: `job-${contact.id}`, source: "customer", name: contact.name ?? "Unknown", phone: contact.phone,
      context: [contact.serviceType, contact.address, contact.jobDate].filter(Boolean).join(" · "),
    });

    const ownedCustomers = await db
      .select({ id: leadflowJobs.id, name: leadflowJobs.customerName, phone: leadflowJobs.customerPhone,
        address: leadflowJobs.jobAddress, serviceType: leadflowJobs.serviceName, jobDate: leadflowJobs.jobDate })
      .from(leadflowJobs)
      .where(contactCondition(leadflowJobs.customerName, leadflowJobs.customerPhone, input.query))
      .orderBy(desc(leadflowJobs.createdAt))
      .limit(8);
    for (const contact of ownedCustomers) append({
      id: `leadflow-job-${contact.id}`, source: "customer", name: contact.name ?? "Unknown", phone: contact.phone,
      context: [contact.serviceType, contact.address, contact.jobDate].filter(Boolean).join(" · "),
    });

    const bookingCustomers = await db
      .select({ id: bookings.id, name: bookings.customerName, phone: bookings.customerPhone,
        address: bookings.address, serviceType: bookings.serviceName, jobDate: bookings.requestedLocalDate })
      .from(bookings)
      .where(contactCondition(bookings.customerName, bookings.customerPhone, input.query))
      .orderBy(desc(bookings.createdAt))
      .limit(8);
    for (const contact of bookingCustomers) append({
      id: `booking-${contact.id}`, source: "customer", name: contact.name, phone: contact.phone,
      context: [contact.serviceType, contact.address, contact.jobDate].filter(Boolean).join(" · "),
    });

    const leads = await db
      .select({ id: quoteLeads.id, name: quoteLeads.name, phone: quoteLeads.phone, serviceType: quoteLeads.serviceType })
      .from(quoteLeads)
      .where(contactCondition(quoteLeads.name, quoteLeads.phone, input.query))
      .orderBy(desc(quoteLeads.createdAt))
      .limit(5);
    for (const contact of leads) append({
      id: `lead-${contact.id}`, source: "lead", name: contact.name, phone: contact.phone,
      context: ["Lead", contact.serviceType].filter(Boolean).join(" · "),
    });

    const teams = await db
      .select({ id: cleanerProfiles.id, name: cleanerProfiles.name, phone: cleanerProfiles.phone })
      .from(cleanerProfiles)
      .where(contactCondition(cleanerProfiles.name, cleanerProfiles.phone, input.query))
      .limit(5);
    for (const contact of teams) append({
      id: `cleaner-${contact.id}`, source: "cleaner", name: contact.name, phone: contact.phone, context: "Cleaner",
    });

    return results.slice(0, 10);
  });
