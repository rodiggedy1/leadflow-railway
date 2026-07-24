/**
 * server/madison/comms/validator.ts
 *
 * Entity resolution for the comms domain.
 * Delegates to the same DB queries used by handleTextClient and handleTextCleaners
 * in aiConciergeRouter.ts — no new logic, just repackaged for the Madison pipeline.
 */
import { eq, like, desc, and } from "drizzle-orm";
import { cleanerProfiles, cleanerJobs, completedJobs } from "../../../drizzle/schema";
import { getTodayET, offsetServiceDate } from "../../conciergeTime";
import { normalizePhoneLegacy } from "../../utils/phone";
import type { CommsPlan } from "./schema/commsPlanSchema";

type Db = NonNullable<Awaited<ReturnType<typeof import("../../db").getDb>>>;

export interface CommsRecipient {
  entityType: "customer" | "cleaner";
  entityId: string;
  displayName: string;
  phone: string;
  contextLabel: string;
}

export type ValidatorResult =
  | { kind: "resolved"; recipients: CommsRecipient[]; targetDescription: string; excludedCount: number; excludedReasons: string[] }
  | { kind: "disambiguation"; targetRef: string; messageHint: string | null; matches: CommsRecipient[] }
  | { kind: "needs_clarification"; reason: string }
  | { kind: "not_found"; message: string };

const GROUP_PATTERNS = [
  /\beveryone\b/i,
  /\ball\b.*\bcleaner/i,
  /\bcleaner.*\btoday\b/i,
  /\bcleaner.*\btomorrow\b/i,
  /\btoday.?s\s+cleaner/i,
  /\btomorrow.?s\s+cleaner/i,
  /\bworking\s+(today|tomorrow)/i,
  /\bscheduled\s+(today|tomorrow)/i,
  /\beveryone\s+scheduled/i,
  /\bthe\s+team\b/i,
  /\bthe\s+whole\s+team\b/i,
];

const JOB_PATTERN = /\bjob\s+(\d+)/i;

function normalizePhone(p: string): string {
  return normalizePhoneLegacy(p);
}

function resolveDateForScope(dateScope: string, specificDate: string | null): string {
  if (dateScope === "tomorrow") return offsetServiceDate(getTodayET(), 1);
  if (dateScope === "specific" && specificDate) return specificDate;
  return getTodayET();
}

// ── Customer search (mirrors handleTextClient) ────────────────────────────────
async function resolveCustomer(
  name: string,
  messageHint: string | null,
  db: Db
): Promise<ValidatorResult> {
  const q = `%${name.trim()}%`;
  const rows = await db
    .select({
      phone: completedJobs.phone,
      name: completedJobs.name,
      address: completedJobs.address,
      lastBookingPrice: completedJobs.lastBookingPrice,
      jobDate: completedJobs.jobDate,
    })
    .from(completedJobs)
    .where(like(completedJobs.name, q))
    .orderBy(desc(completedJobs.jobDate))
    .limit(30);

  const byPhone = new Map<string, { phone: string; name: string; totalCleans: number; ltv: number; lastJobDate: string | null; city: string | null }>();
  for (const r of rows) {
    const key = r.phone;
    const existing = byPhone.get(key);
    if (existing) {
      existing.ltv += r.lastBookingPrice ?? 0;
      existing.totalCleans += 1;
      if (!existing.lastJobDate || (r.jobDate && r.jobDate > existing.lastJobDate)) existing.lastJobDate = r.jobDate ?? null;
    } else {
      byPhone.set(key, {
        phone: key,
        name: r.name ?? "",
        city: r.address ? r.address.split(",").slice(-2, -1)[0]?.trim() ?? null : null,
        ltv: r.lastBookingPrice ?? 0,
        totalCleans: 1,
        lastJobDate: r.jobDate ?? null,
      });
    }
  }

  const matches = Array.from(byPhone.values()).sort((a, b) => b.totalCleans - a.totalCleans).slice(0, 6);
  if (matches.length === 0) return { kind: "not_found", message: `No customer found matching "${name}".` };

  if (matches.length === 1) {
    const c = matches[0];
    return {
      kind: "resolved",
      recipients: [{ entityType: "customer", entityId: `customer:${c.phone}`, displayName: c.name, phone: normalizePhone(c.phone), contextLabel: "Customer" }],
      targetDescription: c.name,
      excludedCount: 0,
      excludedReasons: [],
    };
  }

  return {
    kind: "disambiguation",
    targetRef: name,
    messageHint,
    matches: matches.map(c => ({ entityType: "customer" as const, entityId: `customer:${c.phone}`, displayName: c.name, phone: normalizePhone(c.phone), contextLabel: c.lastJobDate ? `Last job: ${c.lastJobDate}` : "Customer" })),
  };
}

// ── Cleaner search (mirrors resolveTextTargets name path) ─────────────────────
async function resolveCleaner(
  name: string,
  db: Db
): Promise<ValidatorResult> {
  const hint = name.toLowerCase().trim();
  const profiles = await db
    .select({ id: cleanerProfiles.id, name: cleanerProfiles.name, phone: cleanerProfiles.phone })
    .from(cleanerProfiles)
    .where(eq(cleanerProfiles.isActive, 1));

  const hintWords = hint.split(/\s+/).filter(Boolean);
  const matched = profiles.filter(p => {
    const pName = p.name.toLowerCase();
    if (pName.includes(hint) || hint.includes(pName)) return true;
    if (hintWords.length >= 2 && hintWords.every(w => pName.includes(w))) return true;
    const firstName = pName.split(" ")[0];
    if (firstName.length >= 4 && hint === firstName) return true;
    return false;
  });

  if (matched.length === 0) return { kind: "not_found", message: `No cleaner found matching "${name}".` };

  const recipients: CommsRecipient[] = matched
    .filter(p => p.phone)
    .map(p => ({ entityType: "cleaner", entityId: `cleaner:${p.id}`, displayName: p.name, phone: normalizePhone(p.phone!), contextLabel: "Cleaner" }));

  if (recipients.length === 0) return { kind: "not_found", message: `Found cleaner "${matched[0].name}" but no phone on file.` };

  return {
    kind: "resolved",
    recipients,
    targetDescription: recipients.map(r => r.displayName).join(", "),
    excludedCount: matched.length - recipients.length,
    excludedReasons: matched.length > recipients.length ? [`${matched.length - recipients.length} cleaner(s) excluded — no phone on file`] : [],
  };
}

// ── Group target (all cleaners on a date) ─────────────────────────────────────
async function resolveGroup(
  dateScope: string,
  specificDate: string | null,
  db: Db
): Promise<ValidatorResult> {
  const date = resolveDateForScope(dateScope, specificDate);
  const dateLabel = dateScope === "tomorrow" ? "tomorrow" : dateScope === "specific" ? date : "today";

  const jobs = await db
    .select({
      cleanerProfileId: cleanerJobs.cleanerProfileId,
      cleanerName: cleanerJobs.cleanerName,
      phone: cleanerProfiles.phone,
    })
    .from(cleanerJobs)
    .leftJoin(cleanerProfiles, eq(cleanerJobs.cleanerProfileId, cleanerProfiles.id))
    .where(eq(cleanerJobs.jobDate, date));

  const seen = new Set<number>();
  const recipients: CommsRecipient[] = [];
  const noPhone: string[] = [];

  for (const j of jobs) {
    if (!j.cleanerProfileId || seen.has(j.cleanerProfileId)) continue;
    seen.add(j.cleanerProfileId);
    const name = j.cleanerName ?? "Unknown";
    if (!j.phone) { noPhone.push(name); continue; }
    recipients.push({ entityType: "cleaner", entityId: `cleaner:${j.cleanerProfileId}`, displayName: name, phone: normalizePhone(j.phone), contextLabel: `Working ${dateLabel}` });
  }

  const excludedReasons: string[] = [];
  if (noPhone.length > 0) excludedReasons.push(`${noPhone.length} cleaner(s) excluded — no phone: ${noPhone.slice(0, 3).join(", ")}${noPhone.length > 3 ? ` +${noPhone.length - 3} more` : ""}`);

  if (recipients.length === 0 && noPhone.length === 0) return { kind: "not_found", message: `No cleaners found working ${dateLabel}.` };

  return { kind: "resolved", recipients, targetDescription: `cleaners working ${dateLabel}`, excludedCount: noPhone.length, excludedReasons };
}

// ── Job-scoped customer ───────────────────────────────────────────────────────
async function resolveJobCustomer(jobId: string, db: Db): Promise<ValidatorResult> {
  const id = parseInt(jobId, 10);
  if (isNaN(id)) return { kind: "not_found", message: `Invalid job ID: "${jobId}".` };

  const [job] = await db
    .select({ customerPhone: cleanerJobs.customerPhone, customerName: cleanerJobs.customerName, jobDate: cleanerJobs.jobDate })
    .from(cleanerJobs)
    .where(eq(cleanerJobs.id, id))
    .limit(1);

  if (!job) return { kind: "not_found", message: `No job found with ID ${jobId}.` };
  if (!job.customerPhone) return { kind: "not_found", message: `Job ${jobId} found (${job.customerName ?? "unknown"}) but no phone on file.` };

  const phone = normalizePhone(job.customerPhone);
  const name = job.customerName ?? "Customer";
  return {
    kind: "resolved",
    recipients: [{ entityType: "customer", entityId: `customer:${phone}`, displayName: name, phone, contextLabel: job.jobDate ? `Job on ${job.jobDate}` : "Customer" }],
    targetDescription: name,
    excludedCount: 0,
    excludedReasons: [],
  };
}

// ── Main resolver ─────────────────────────────────────────────────────────────
export async function resolveCommsTarget(plan: CommsPlan, db: Db): Promise<ValidatorResult> {
  const { targetRef, messageHint, dateScope, specificDate } = plan;

  if (!messageHint || messageHint.trim() === "") {
    return { kind: "needs_clarification", reason: `What would you like me to say to ${targetRef}?` };
  }

  // Job-scoped
  const jobMatch = JOB_PATTERN.exec(targetRef);
  if (jobMatch) return resolveJobCustomer(jobMatch[1], db);

  // Group
  if (GROUP_PATTERNS.some(p => p.test(targetRef))) return resolveGroup(dateScope, specificDate, db);

  // Named individual — search customers AND cleaners in parallel, merge for disambiguation
  const [customerResult, cleanerResult] = await Promise.all([
    resolveCustomer(targetRef, messageHint, db),
    resolveCleaner(targetRef, db),
  ]);

  // Exactly one side found a single match — return it directly
  if (customerResult.kind === "resolved" && cleanerResult.kind === "not_found") return customerResult;
  if (cleanerResult.kind === "resolved" && customerResult.kind === "not_found") return cleanerResult;

  // Collect all matches from both sides
  const allMatches: CommsRecipient[] = [
    ...(customerResult.kind === "resolved" ? customerResult.recipients :
        customerResult.kind === "disambiguation" ? customerResult.matches : []),
    ...(cleanerResult.kind === "resolved" ? cleanerResult.recipients :
        cleanerResult.kind === "disambiguation" ? cleanerResult.matches : []),
  ];

  if (allMatches.length === 0) return { kind: "not_found", message: `No one found matching "${targetRef}".` };
  if (allMatches.length === 1) {
    const r = allMatches[0];
    return { kind: "resolved", recipients: [r], targetDescription: r.displayName, excludedCount: 0, excludedReasons: [] };
  }

  return { kind: "disambiguation", targetRef, messageHint, matches: allMatches };
}
