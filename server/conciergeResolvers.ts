/**
 * conciergeResolvers.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Entity resolution, field normalization, shared context loading,
 * typed resolvers, and the resolveQuery orchestrator.
 */

import { and, desc, eq, gte, inArray, like, ne, or, sql } from "drizzle-orm";
import { cleanerJobs, cleanerProfiles, completedJobs, conversationSessions } from "../drizzle/schema";
import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import {
  DEFAULT_TIME_SCOPE,
  type AccessData,
  type AddressData,
  type AmbiguousEntity,
  type AssignmentData,
  type CleanerJobRow,
  type ClarificationResult,
  type CompletedJobRow,
  type EntityResolution,
  type EntityResolutionMap,
  type EtaData,
  type FieldRequest,
  type HistoryData,
  type JobStatusData,
  type MergedJobRow,
  type NotesData,
  type PaymentStatusData,
  type PricingData,
  type QueryPlan,
  type QueryResult,
  type QueryResultStatus,
  type RequestedField,
  type ResolvedCleaner,
  type ResolvedCustomer,
  type ResolvedField,
  type ResolvedTeam,
  type ScheduleData,
  type SharedContext,
  type SummaryData,
  type TimeScope,
  type TimeScopeType,
  normalizeJobStatus,
} from "./conciergeQuery";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1: Entity resolution
// ─────────────────────────────────────────────────────────────────────────────

function digits10(phone: string): string {
  return phone.replace(/[^\d]/g, "").slice(-10);
}

async function resolveCustomerEntity(
  name: string,
  db: Db
): Promise<EntityResolution> {
  const q = `%${name.trim()}%`;

  // Search completedJobs first (has phone)
  const compRows = await db
    .select({ name: completedJobs.name, phone: completedJobs.phone, address: completedJobs.address })
    .from(completedJobs)
    .where(like(completedJobs.name, q))
    .orderBy(desc(completedJobs.jobDate))
    .limit(5);

  // Also search cleanerJobs.customerName
  const cjRows = await db
    .select({ customerName: cleanerJobs.customerName, customerPhone: cleanerJobs.customerPhone, jobAddress: cleanerJobs.jobAddress })
    .from(cleanerJobs)
    .where(like(cleanerJobs.customerName, q))
    .orderBy(desc(cleanerJobs.jobDate))
    .limit(5);

  // Deduplicate by phone10
  const seen = new Map<string, { name: string; phone: string; hint: string }>();
  for (const r of compRows) {
    if (!r.phone) continue;
    const p10 = digits10(r.phone);
    if (!seen.has(p10)) seen.set(p10, { name: r.name ?? name, phone: r.phone, hint: r.address?.slice(0, 30) ?? "" });
  }
  for (const r of cjRows) {
    if (!r.customerPhone) continue;
    const p10 = digits10(r.customerPhone);
    if (!seen.has(p10)) {
      const phone = `+1${p10}`;
      seen.set(p10, { name: r.customerName ?? name, phone, hint: r.jobAddress?.slice(0, 30) ?? "" });
    }
  }

  const candidates = Array.from(seen.values());

  if (candidates.length === 0) {
    return { type: "unresolved", query: name };
  }

  if (candidates.length === 1) {
    const c = candidates[0];
    const p10 = digits10(c.phone);
    const e164 = c.phone.startsWith("+") ? c.phone : `+1${p10}`;
    return { type: "customer", name: c.name, phone: e164, phone10: p10 };
  }

  // Multiple distinct customers with same name
  return {
    type: "ambiguous",
    query: name,
    candidates: candidates.map(c => ({
      name: c.name,
      hint: c.hint,
      entityType: "customer" as const,
    })),
  };
}

async function resolveCleanerEntity(name: string, db: Db): Promise<EntityResolution> {
  const q = `%${name.trim()}%`;
  const rows = await db
    .select({ id: cleanerProfiles.id, name: cleanerProfiles.name, phone: cleanerProfiles.phone })
    .from(cleanerProfiles)
    .where(and(like(cleanerProfiles.name, q), eq(cleanerProfiles.isActive, 1)))
    .limit(5);

  if (rows.length === 0) return { type: "unresolved", query: name };
  if (rows.length === 1) {
    return { type: "cleaner", name: rows[0].name, cleanerProfileId: rows[0].id, phone: rows[0].phone ?? undefined };
  }
  return {
    type: "ambiguous",
    query: name,
    candidates: rows.map(r => ({ name: r.name, hint: `cleaner #${r.id}`, entityType: "cleaner" as const })),
  };
}

async function resolveTeamEntity(name: string, db: Db): Promise<EntityResolution> {
  // Teams are stored in cleanerJobs.teamName — find distinct team names matching
  const q = `%${name.trim()}%`;
  const rows = await db
    .selectDistinct({ teamName: cleanerJobs.teamName, teamId: cleanerJobs.teamId })
    .from(cleanerJobs)
    .where(like(cleanerJobs.teamName, q))
    .limit(5);

  const teams = rows.filter(r => r.teamName != null);
  if (teams.length === 0) return { type: "unresolved", query: name };
  if (teams.length === 1) {
    return { type: "team", name: teams[0].teamName!, teamId: teams[0].teamId ?? undefined };
  }
  return {
    type: "ambiguous",
    query: name,
    candidates: teams.map(r => ({ name: r.teamName!, hint: "", entityType: "team" as const })),
  };
}

export async function resolveEntities(
  plan: QueryPlan,
  db: Db
): Promise<EntityResolutionMap> {
  const [customer, cleaner, team] = await Promise.all([
    plan.entities.customerName
      ? resolveCustomerEntity(plan.entities.customerName, db)
      : Promise.resolve(null),
    plan.entities.cleanerName && plan.entities.cleanerName !== plan.entities.customerName
      ? resolveCleanerEntity(plan.entities.cleanerName, db)
      : Promise.resolve(null),
    plan.entities.teamName
      ? resolveTeamEntity(plan.entities.teamName, db)
      : Promise.resolve(null),
  ]);

  // If customerName === cleanerName (ambiguous name), try to resolve as both
  // and pick whichever resolves
  let effectiveCustomer = customer;
  let effectiveCleaner = cleaner;
  if (plan.entities.customerName && plan.entities.customerName === plan.entities.cleanerName) {
    const [cust, clean] = await Promise.all([
      resolveCustomerEntity(plan.entities.customerName, db),
      resolveCleanerEntity(plan.entities.cleanerName, db),
    ]);
    effectiveCustomer = cust.type !== "unresolved" ? cust : null;
    effectiveCleaner = clean.type !== "unresolved" ? clean : null;
  }

  return { customer: effectiveCustomer, cleaner: effectiveCleaner, team, job: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: Normalize field requests (per-field effective time scopes)
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeFieldRequests(
  requestedFields: RequestedField[],
  userTimeScope: TimeScope
): FieldRequest[] {
  const userExplicit = userTimeScope.type !== null;
  return requestedFields.map(field => ({
    field,
    effectiveTimeScope: userExplicit
      ? userTimeScope
      : { type: DEFAULT_TIME_SCOPE[field], specificDate: null, originalPhrase: null },
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3: Shared context loading
// ─────────────────────────────────────────────────────────────────────────────

function getTodayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function getTomorrowET(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function getYesterdayET(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function scopeToDateRange(scope: TimeScope): { from: string | null; to: string | null; exactDate: string | null } {
  const today = getTodayET();
  const t = scope.type;
  if (!t) return { from: null, to: null, exactDate: null };
  if (t === "today") return { from: today, to: today, exactDate: today };
  if (t === "yesterday") { const y = getYesterdayET(); return { from: y, to: y, exactDate: y }; }
  if (t === "tomorrow") { const tm = getTomorrowET(); return { from: tm, to: tm, exactDate: tm }; }
  if (t === "specific_date" && scope.specificDate) return { from: scope.specificDate, to: scope.specificDate, exactDate: scope.specificDate };
  if (t === "this_week") { const d = new Date(); d.setDate(d.getDate() - 7); return { from: d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }), to: null, exactDate: null }; }
  if (t === "last_week") { const d = new Date(); d.setDate(d.getDate() - 14); const e = new Date(); e.setDate(e.getDate() - 7); return { from: d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }), to: e.toLocaleDateString("en-CA", { timeZone: "America/New_York" }), exactDate: null }; }
  if (t === "next_week") { const d = new Date(); d.setDate(d.getDate() + 7); return { from: today, to: d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }), exactDate: null }; }
  if (t === "this_month") { const d = new Date(); d.setDate(d.getDate() - 30); return { from: d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }), to: null, exactDate: null }; }
  if (t === "last_month") { const d = new Date(); d.setDate(d.getDate() - 60); const e = new Date(); e.setDate(e.getDate() - 30); return { from: d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }), to: e.toLocaleDateString("en-CA", { timeZone: "America/New_York" }), exactDate: null }; }
  if (t === "last_appointment") return { from: null, to: today, exactDate: null };
  if (t === "next_appointment") return { from: today, to: null, exactDate: null };
  return { from: null, to: null, exactDate: null }; // all_time
}

function dedupeKey(j: { completedJobId?: number | null; bookingId?: number | null; jobAddress?: string | null; jobDate?: string | null }): string {
  if (j.completedJobId) return `completed:${j.completedJobId}`;
  if (j.bookingId) return `booking:${j.bookingId}`;
  return `legacy:${(j.jobAddress ?? "").toLowerCase().slice(0, 30)}:${j.jobDate ?? ""}`;
}

async function loadContextForEntity(
  entity: EntityResolution,
  timeScope: TimeScope,
  db: Db
): Promise<SharedContext> {
  const { from, to, exactDate } = scopeToDateRange(timeScope);
  const isToday = timeScope.type === "today";

  // Build cleanerJobs conditions
  const cjConds: any[] = [
    ne(cleanerJobs.bookingStatus, "cancelled"),
    ne(cleanerJobs.bookingStatus, "rescheduled"),
  ];

  if (entity.type === "customer") {
    const p10 = entity.phone10;
    cjConds.push(sql`REGEXP_REPLACE(${cleanerJobs.customerPhone}, '[^0-9]', '') = ${p10}`);
  } else if (entity.type === "cleaner") {
    cjConds.push(eq(cleanerJobs.cleanerProfileId, (entity as ResolvedCleaner).cleanerProfileId));
  } else if (entity.type === "team") {
    const teamEntity = entity as ResolvedTeam;
    if (teamEntity.teamId) {
      cjConds.push(eq(cleanerJobs.teamId, teamEntity.teamId));
    } else {
      cjConds.push(like(cleanerJobs.teamName, `%${teamEntity.name}%`));
    }
  }

  if (exactDate) {
    cjConds.push(eq(cleanerJobs.jobDate, exactDate));
  } else {
    if (from) cjConds.push(gte(cleanerJobs.jobDate, from));
    if (to) cjConds.push(sql`${cleanerJobs.jobDate} <= ${to}`);
  }

  const cjRows = await db
    .select({
      id: cleanerJobs.id,
      completedJobId: cleanerJobs.completedJobId,
      bookingId: cleanerJobs.bookingId,
      cleanerProfileId: cleanerJobs.cleanerProfileId,
      cleanerName: cleanerJobs.cleanerName,
      teamName: cleanerJobs.teamName,
      teamId: cleanerJobs.teamId,
      jobDate: cleanerJobs.jobDate,
      serviceDateTime: cleanerJobs.serviceDateTime,
      customerName: cleanerJobs.customerName,
      customerPhone: cleanerJobs.customerPhone,
      jobAddress: cleanerJobs.jobAddress,
      serviceType: cleanerJobs.serviceType,
      bookingStatus: cleanerJobs.bookingStatus,
      customerNotes: cleanerJobs.customerNotes,
      staffNotes: cleanerJobs.staffNotes,
      jobRevenue: cleanerJobs.jobRevenue,
      jobStatus: cleanerJobs.jobStatus,
      etaTimestamp: cleanerJobs.etaTimestamp,
      etaTimeStr: cleanerJobs.etaTimeStr,
      etaSource: cleanerJobs.etaSource,
      delayMinutes: cleanerJobs.delayMinutes,
      requestedTeam: cleanerJobs.requestedTeam,
      frequency: cleanerJobs.frequency,
      customerRating: cleanerJobs.customerRating,
      customerComplaint: cleanerJobs.customerComplaint,
    })
    .from(cleanerJobs)
    .where(and(...cjConds))
    .orderBy(desc(cleanerJobs.jobDate), cleanerJobs.serviceDateTime)
    .limit(50);

  // completedJobs — skip for today (historical-only table)
  let compRows: CompletedJobRow[] = [];
  if (!isToday && entity.type === "customer") {
    const custEntity = entity as ResolvedCustomer;
    const compConds: any[] = [eq(completedJobs.phone, custEntity.phone)];
    if (from) compConds.push(gte(completedJobs.jobDate, from));
    if (to) compConds.push(sql`${completedJobs.jobDate} <= ${to}`);

    compRows = await db
      .select({
        id: completedJobs.id,
        jobDate: completedJobs.jobDate,
        name: completedJobs.name,
        address: completedJobs.address,
        lastBookingPrice: completedJobs.lastBookingPrice,
        frequency: completedJobs.frequency,
        phone: completedJobs.phone,
        serviceType: completedJobs.serviceType,
      })
      .from(completedJobs)
      .where(and(...compConds))
      .orderBy(desc(completedJobs.jobDate))
      .limit(timeScope.type === "all_time" ? 100 : 50);
  }

  // Deduplicate: prefer cleanerJobs row when both exist
  const seenKeys = new Set<string>();
  const mergedJobs: MergedJobRow[] = [];

  for (const j of cjRows) {
    const key = dedupeKey({ completedJobId: j.completedJobId, bookingId: j.bookingId, jobAddress: j.jobAddress, jobDate: j.jobDate });
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    mergedJobs.push({
      source: "cleaner_jobs",
      id: j.id,
      jobDate: j.jobDate,
      teamName: j.teamName,
      cleanerName: j.cleanerName,
      customerName: j.customerName,
      jobAddress: j.jobAddress,
      serviceDateTime: j.serviceDateTime,
      jobStatus: normalizeJobStatus(j.jobStatus),
      jobRevenue: j.jobRevenue,
      lastBookingPrice: null,
      customerNotes: j.customerNotes,
      staffNotes: j.staffNotes,
      etaTimestamp: j.etaTimestamp,
      etaTimeStr: j.etaTimeStr,
      etaSource: j.etaSource,
      delayMinutes: j.delayMinutes,
      frequency: j.frequency,
      serviceType: j.serviceType,
      bookingId: j.bookingId,
      completedJobId: j.completedJobId,
    });
  }

  for (const j of compRows) {
    const key = dedupeKey({ completedJobId: j.id, bookingId: null, jobAddress: j.address, jobDate: j.jobDate });
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    mergedJobs.push({
      source: "completed_jobs",
      id: j.id,
      jobDate: j.jobDate,
      teamName: null,
      cleanerName: null,
      customerName: j.name,
      jobAddress: j.address,
      serviceDateTime: null,
      jobStatus: "completed",
      jobRevenue: null,
      lastBookingPrice: j.lastBookingPrice,
      customerNotes: null,
      staffNotes: null,
      etaTimestamp: null,
      etaTimeStr: null,
      etaSource: null,
      delayMinutes: null,
      frequency: j.frequency,
      serviceType: j.serviceType,
      bookingId: null,
      completedJobId: j.id,
    });
  }

  mergedJobs.sort((a, b) => (b.jobDate ?? "").localeCompare(a.jobDate ?? ""));

  return { entity, timeScope, cleanerJobRows: cjRows as CleanerJobRow[], completedJobRows: compRows, mergedJobs };
}

/**
 * Group field requests by compatible entity+scope, load shared contexts once per group.
 */
export async function loadSharedContexts(
  fieldRequests: FieldRequest[],
  entityMap: EntityResolutionMap,
  db: Db
): Promise<Map<string, SharedContext>> {
  // Determine primary entity for each field request
  // Priority: customer > team > cleaner > null (summary/list query)
  const primaryEntity = entityMap.customer ?? entityMap.team ?? entityMap.cleaner;

  // Group field requests by scope key
  const scopeGroups = new Map<string, { entity: EntityResolution | null; scope: TimeScope; fields: RequestedField[] }>();

  for (const fr of fieldRequests) {
    const scopeKey = `${fr.effectiveTimeScope.type}:${fr.effectiveTimeScope.specificDate ?? ""}`;
    if (!scopeGroups.has(scopeKey)) {
      scopeGroups.set(scopeKey, { entity: primaryEntity ?? null, scope: fr.effectiveTimeScope, fields: [] });
    }
    scopeGroups.get(scopeKey)!.fields.push(fr.field);
  }

  const result = new Map<string, SharedContext>();

  await Promise.all(
    Array.from(scopeGroups.entries()).map(async ([key, group]) => {
      if (!group.entity || group.entity.type === "ambiguous" || group.entity.type === "unresolved") {
        // No entity — load a broad context (all jobs for scope)
        const ctx = await loadBroadContext(group.scope, db);
        result.set(key, ctx);
      } else {
        const ctx = await loadContextForEntity(group.entity, group.scope, db);
        result.set(key, ctx);
      }
    })
  );

  return result;
}

async function loadBroadContext(timeScope: TimeScope, db: Db): Promise<SharedContext> {
  const { from, to, exactDate } = scopeToDateRange(timeScope);
  const cjConds: any[] = [
    ne(cleanerJobs.bookingStatus, "cancelled"),
    ne(cleanerJobs.bookingStatus, "rescheduled"),
  ];
  if (exactDate) cjConds.push(eq(cleanerJobs.jobDate, exactDate));
  else {
    if (from) cjConds.push(gte(cleanerJobs.jobDate, from));
    if (to) cjConds.push(sql`${cleanerJobs.jobDate} <= ${to}`);
  }

  const cjRows = await db
    .select({
      id: cleanerJobs.id, completedJobId: cleanerJobs.completedJobId, bookingId: cleanerJobs.bookingId,
      cleanerProfileId: cleanerJobs.cleanerProfileId, cleanerName: cleanerJobs.cleanerName, teamName: cleanerJobs.teamName,
      teamId: cleanerJobs.teamId, jobDate: cleanerJobs.jobDate, serviceDateTime: cleanerJobs.serviceDateTime,
      customerName: cleanerJobs.customerName, customerPhone: cleanerJobs.customerPhone, jobAddress: cleanerJobs.jobAddress,
      serviceType: cleanerJobs.serviceType, bookingStatus: cleanerJobs.bookingStatus, customerNotes: cleanerJobs.customerNotes,
      staffNotes: cleanerJobs.staffNotes, jobRevenue: cleanerJobs.jobRevenue, jobStatus: cleanerJobs.jobStatus,
      etaTimestamp: cleanerJobs.etaTimestamp, etaTimeStr: cleanerJobs.etaTimeStr, etaSource: cleanerJobs.etaSource,
      delayMinutes: cleanerJobs.delayMinutes, requestedTeam: cleanerJobs.requestedTeam, frequency: cleanerJobs.frequency,
    })
    .from(cleanerJobs)
    .where(and(...cjConds))
    .orderBy(desc(cleanerJobs.jobDate), cleanerJobs.serviceDateTime)
    .limit(100);

  const mergedJobs: MergedJobRow[] = cjRows.map(j => ({
    source: "cleaner_jobs" as const, id: j.id, jobDate: j.jobDate, teamName: j.teamName, cleanerName: j.cleanerName,
    customerName: j.customerName, jobAddress: j.jobAddress, serviceDateTime: j.serviceDateTime,
    jobStatus: normalizeJobStatus(j.jobStatus), jobRevenue: j.jobRevenue, lastBookingPrice: null,
    customerNotes: j.customerNotes, staffNotes: j.staffNotes, etaTimestamp: j.etaTimestamp, etaTimeStr: j.etaTimeStr,
    etaSource: j.etaSource, delayMinutes: j.delayMinutes, frequency: j.frequency, serviceType: j.serviceType,
    bookingId: j.bookingId, completedJobId: j.completedJobId,
  }));

  return {
    entity: { type: "unresolved", query: "" },
    timeScope,
    cleanerJobRows: cjRows as CleanerJobRow[],
    completedJobRows: [],
    mergedJobs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4: Resolvers
// ─────────────────────────────────────────────────────────────────────────────

function resolveAssignment(fr: FieldRequest, ctx: SharedContext): ResolvedField {
  const matches = ctx.mergedJobs.slice(0, 20).map(j => ({
    customerName: j.customerName,
    cleanerName: j.cleanerName,
    teamName: j.teamName,
    scheduledTime: j.serviceDateTime,
    jobDate: j.jobDate,
  }));
  return {
    field: "assignment",
    status: matches.length > 0 ? "resolved" : "not_found",
    data: matches.length > 0 ? { matches } : null,
  };
}

function resolveSchedule(fr: FieldRequest, ctx: SharedContext): ResolvedField {
  const matches = ctx.mergedJobs.slice(0, 20).map(j => ({
    customerName: j.customerName,
    scheduledTime: j.serviceDateTime,
    jobDate: j.jobDate,
    serviceType: j.serviceType,
  }));
  return {
    field: "scheduled_time",
    status: matches.length > 0 ? "resolved" : "not_found",
    data: matches.length > 0 ? { matches } : null,
  };
}

function resolveJobStatus(fr: FieldRequest, ctx: SharedContext): ResolvedField {
  const matches = ctx.mergedJobs.slice(0, 20).map(j => ({
    customerName: j.customerName,
    jobDate: j.jobDate,
    status: j.jobStatus,
    delayMinutes: j.delayMinutes,
    issueNote: null,
  }));
  return {
    field: "job_status",
    status: matches.length > 0 ? "resolved" : "not_found",
    data: matches.length > 0 ? { matches } : null,
  };
}

function resolveEta(fr: FieldRequest, ctx: SharedContext): ResolvedField {
  const matches = ctx.mergedJobs.slice(0, 10).map(j => ({
    customerName: j.customerName,
    jobDate: j.jobDate,
    etaTimestamp: j.etaTimestamp,
    etaTimeStr: j.etaTimeStr,
    etaSource: j.etaSource,
    jobStatus: j.jobStatus,
  }));
  const hasEta = matches.some(m => m.etaTimestamp != null || m.etaTimeStr != null);
  return {
    field: "eta",
    status: matches.length > 0 ? (hasEta ? "resolved" : "partial") : "not_found",
    data: matches.length > 0 ? { matches } : null,
  };
}

function resolveAddress(fr: FieldRequest, ctx: SharedContext): ResolvedField {
  const matches = ctx.mergedJobs.slice(0, 20).map(j => ({
    customerName: j.customerName,
    jobDate: j.jobDate,
    address: j.jobAddress,
  }));
  return {
    field: "address",
    status: matches.length > 0 ? "resolved" : "not_found",
    data: matches.length > 0 ? { matches } : null,
  };
}

// Access keyword patterns
const ACCESS_PATTERNS = [
  /\b(code|entry code|access code|door code|gate code|lockbox|lock box|key|garage|alarm|pin)\b/i,
  /\b(how (to|do) (get in|enter|access)|entry instructions|access instructions)\b/i,
];

function extractAccessInstructions(notes: string | null): string | null {
  if (!notes) return null;
  const lines = notes.split(/[.\n;]+/).map(l => l.trim()).filter(Boolean);
  const accessLines = lines.filter(l => ACCESS_PATTERNS.some(p => p.test(l)));
  return accessLines.length > 0 ? accessLines.join(". ") : null;
}

function resolveAccess(fr: FieldRequest, ctx: SharedContext): ResolvedField {
  const matches = ctx.mergedJobs.slice(0, 10).map(j => ({
    customerName: j.customerName,
    jobDate: j.jobDate,
    accessInstructions: extractAccessInstructions(j.customerNotes),
    rawNotes: j.customerNotes,
  }));
  const hasAccess = matches.some(m => m.accessInstructions != null);
  return {
    field: "access",
    status: matches.length > 0 ? (hasAccess ? "resolved" : "partial") : "not_found",
    data: matches.length > 0 ? { matches } : null,
  };
}

function resolveNotes(fr: FieldRequest, ctx: SharedContext): ResolvedField {
  const matches = ctx.mergedJobs.slice(0, 5).map(j => ({
    customerName: j.customerName,
    jobDate: j.jobDate,
    customerNotes: j.customerNotes,
    staffNotes: j.staffNotes,
  }));
  return {
    field: "notes",
    status: matches.length > 0 ? "resolved" : "not_found",
    data: matches.length > 0 ? { matches } : null,
  };
}

function resolvePricing(fr: FieldRequest, ctx: SharedContext): ResolvedField {
  const matches = ctx.mergedJobs.slice(0, 10).map(j => {
    const price = j.jobRevenue != null
      ? Math.round(parseFloat(j.jobRevenue))
      : j.lastBookingPrice ?? null;
    return { customerName: j.customerName, jobDate: j.jobDate, price, currency: "USD" as const };
  }).filter(m => m.price != null);
  return {
    field: "pricing",
    status: matches.length > 0 ? "resolved" : "not_found",
    data: matches.length > 0 ? { matches } : null,
  };
}

function resolvePaymentStatus(fr: FieldRequest, ctx: SharedContext): ResolvedField {
  const matches = ctx.mergedJobs.slice(0, 10).map(j => {
    const price = j.jobRevenue != null
      ? Math.round(parseFloat(j.jobRevenue))
      : j.lastBookingPrice ?? null;
    return {
      customerName: j.customerName,
      jobDate: j.jobDate,
      price,
      frequency: j.frequency,
      note: "Pricing data only — live payment status not available in this system",
    };
  });
  return {
    field: "payment_status",
    status: matches.length > 0 ? "partial" : "not_found",
    data: matches.length > 0 ? { matches } : null,
  };
}

function resolveHistory(fr: FieldRequest, ctx: SharedContext): ResolvedField {
  const jobs = ctx.mergedJobs.map(j => ({
    jobDate: j.jobDate,
    serviceType: j.serviceType,
    price: j.jobRevenue != null ? Math.round(parseFloat(j.jobRevenue)) : j.lastBookingPrice ?? null,
    teamName: j.teamName ?? j.cleanerName,
    jobStatus: j.jobStatus,
  }));
  const ltv = jobs.reduce((s, j) => s + (j.price ?? 0), 0);
  return {
    field: "history",
    status: jobs.length > 0 ? "resolved" : "not_found",
    data: jobs.length > 0 ? { jobs, totalCount: jobs.length, ltv } : null,
  };
}

async function resolveSummary(
  fr: FieldRequest,
  ctx: SharedContext,
  db: Db
): Promise<ResolvedField> {
  if (ctx.entity.type !== "customer") {
    return { field: "summary", status: "error", data: null };
  }
  const custEntity = ctx.entity as ResolvedCustomer;
  const phone10 = custEntity.phone10;
  const e164 = custEntity.phone;

  // completedJobs history for LTV
  const histRows = await db
    .select({ jobDate: completedJobs.jobDate, lastBookingPrice: completedJobs.lastBookingPrice, frequency: completedJobs.frequency })
    .from(completedJobs)
    .where(eq(completedJobs.phone, e164))
    .orderBy(desc(completedJobs.jobDate))
    .limit(50);

  const totalBookings = histRows.length + ctx.cleanerJobRows.length;
  const ltv = histRows.reduce((s, r) => s + (r.lastBookingPrice ?? 0), 0)
    + ctx.cleanerJobRows.reduce((s, j) => s + (j.jobRevenue ? parseFloat(j.jobRevenue) : 0), 0);
  const avgPrice = totalBookings > 0 ? Math.round(ltv / totalBookings) : null;
  const latestFrequency = histRows[0]?.frequency ?? ctx.cleanerJobRows[0]?.frequency ?? null;

  const teamCounts = new Map<string, number>();
  for (const j of ctx.cleanerJobRows) {
    if (j.teamName) teamCounts.set(j.teamName, (teamCounts.get(j.teamName) ?? 0) + 1);
  }
  const usualTeam = teamCounts.size > 0
    ? Array.from(teamCounts.entries()).sort((a, b) => b[1] - a[1])[0][0]
    : null;

  const today = getTodayET();
  const upcomingJob = ctx.cleanerJobRows.find(j => (j.jobDate ?? "") >= today) ?? null;

  // AI summary
  const contextLines = [
    `Customer: ${custEntity.name}`,
    `Total cleans: ${totalBookings}`,
    `LTV: $${Math.round(ltv)}`,
    `Frequency: ${latestFrequency ?? "unknown"}`,
    `Usual team: ${usualTeam ?? "unknown"}`,
    upcomingJob ? `Upcoming: ${upcomingJob.jobDate} — ${upcomingJob.jobStatus ?? "scheduled"}` : "No upcoming job",
  ];
  const llmResult = await invokeLLM({
    messages: [
      { role: "system", content: "You are a concise CRM assistant for a home cleaning company. Write 2 sentences max. Be specific and actionable." },
      { role: "user", content: `Summarize this customer and recommend the single best next action:\n${contextLines.join("\n")}` },
    ],
  });
  const aiSummary = ((llmResult?.choices?.[0]?.message?.content as string) ?? "").trim();

  const data: SummaryData = {
    name: custEntity.name,
    phone: e164,
    totalBookings,
    ltv: Math.round(ltv),
    avgPrice,
    usualTeam,
    frequency: latestFrequency,
    lastJobDate: ctx.mergedJobs[0]?.jobDate ?? null,
    upcomingJob: upcomingJob ? {
      jobDate: upcomingJob.jobDate,
      scheduledTime: upcomingJob.serviceDateTime,
      teamName: upcomingJob.teamName,
      jobStatus: normalizeJobStatus(upcomingJob.jobStatus),
    } : null,
    aiSummary,
  };

  return { field: "summary", status: "resolved", data };
}

function resolveRating(fr: FieldRequest, ctx: SharedContext): ResolvedField {
  // Extract all rated jobs (customerRating is 1–5, null means not yet rated)
  const ratedJobs = ctx.cleanerJobRows
    .filter(j => j.customerRating != null)
    .map(j => ({
      jobDate: j.jobDate,
      customerName: j.customerName,
      rating: j.customerRating as number,
      complaint: j.customerComplaint ?? null,
      teamName: j.teamName ?? j.cleanerName,
    }));

  if (ratedJobs.length === 0) {
    return { field: "rating", status: "not_found", data: null };
  }

  const avg = ratedJobs.reduce((s, j) => s + j.rating, 0) / ratedJobs.length;
  const complaints = ratedJobs.filter(j => j.complaint).length;

  return {
    field: "rating",
    status: "resolved",
    data: {
      ratedJobs,
      totalRated: ratedJobs.length,
      avgRating: Math.round(avg * 10) / 10,
      complaints,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolver registry
// ─────────────────────────────────────────────────────────────────────────────

type ResolverFn = (fr: FieldRequest, ctx: SharedContext, db: Db) => Promise<ResolvedField> | ResolvedField;

const RESOLVER_REGISTRY: Record<RequestedField, ResolverFn> = {
  assignment:     resolveAssignment,
  scheduled_time: resolveSchedule,
  job_status:     resolveJobStatus,
  eta:            resolveEta,
  address:        resolveAddress,
  access:         resolveAccess,
  notes:          resolveNotes,
  pricing:        resolvePricing,
  payment_status: resolvePaymentStatus,
  history:        resolveHistory,
  summary:        resolveSummary,
  rating:         resolveRating,
};

// ─────────────────────────────────────────────────────────────────────────────
// Phase 5: Projection + answer LLM
// ─────────────────────────────────────────────────────────────────────────────

function projectForAnswerLLM(resolvedFields: ResolvedField[]): Record<string, unknown> {
  const projection: Record<string, unknown> = {};
  for (const rf of resolvedFields) {
    if (rf.status === "not_found") {
      projection[rf.field] = null;
    } else {
      projection[rf.field] = rf.data;
    }
  }
  return projection;
}

async function generateAnswer(
  question: string,
  resolvedFields: ResolvedField[],
  projection: Record<string, unknown>
): Promise<string> {
  const fieldNames = resolvedFields.map(f => f.field).join(", ");
  const today = getTodayET();

  const systemPrompt = `You are an operations assistant for a home cleaning company. Answer the dispatcher's question using only the provided data.

Rules:
- Answer ONLY the specific question asked
- Requested fields: ${fieldNames}
- If a field is null, say that information is not available
- For "assignment": return only team name, cleaner name, and scheduled time — do not list full job history
- For "scheduled_time": return only the time and date
- For "job_status": return the status in plain English (e.g. "on the way", "in progress", "completed")
- For "eta": if etaTimeStr is available, use it; if only etaTimestamp, convert to readable time; if neither, say "No ETA available"
- For "access": return only the access instructions extracted from notes
- For "history": list jobs in reverse chronological order with date, team, and price
- For "summary": give a 2-3 sentence overview
- For "payment_status": note that only pricing data is available, not live payment status
- Do not include job IDs, phone numbers, or internal database fields
- Be concise and direct
- Today is ${today}`;

  const llmResult = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Data:\n${JSON.stringify(projection, null, 2)}\n\nQuestion: ${question}` },
    ],
  });

  return ((llmResult.choices[0].message.content as string) ?? "").trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 6: resolveQuery orchestrator
// ─────────────────────────────────────────────────────────────────────────────

export async function resolveQuery(
  plan: QueryPlan,
  db: Db,
  question: string,
  /** Pre-resolved entity from a UI chip (optional) */
  chipEntity?: { type: "customer"; name: string; phone: string; phone10: string } | { type: "cleaner"; name: string; cleanerProfileId: number }
): Promise<QueryResult | ClarificationResult> {
  // 1. Resolve entities
  let entityMap = await resolveEntities(plan, db);

  // Override with chip entity if provided
  if (chipEntity) {
    if (chipEntity.type === "customer") {
      entityMap = { ...entityMap, customer: { ...chipEntity } };
    } else if (chipEntity.type === "cleaner") {
      entityMap = { ...entityMap, cleaner: { ...chipEntity } };
    }
  }

  // 2. Check for ambiguity — return clarification immediately
  const ambiguous = [entityMap.customer, entityMap.cleaner, entityMap.team].find(
    e => e?.type === "ambiguous"
  ) as AmbiguousEntity | undefined;

  if (ambiguous) {
    const names = ambiguous.candidates
      .map((c, i) => `${i + 1}. ${c.name}${c.hint ? ` (${c.hint})` : ""}`)
      .join(", ");
    return {
      type: "clarification",
      question: `Found multiple people named "${ambiguous.query}": ${names}. Which one did you mean?`,
      candidates: ambiguous.candidates,
    };
  }

  // 3. Normalize field requests (per-field effective time scopes)
  const fieldRequests = normalizeFieldRequests(plan.requestedFields, plan.timeScope);

  if (fieldRequests.length === 0) {
    return {
      type: "query_result",
      answer: "I'm not sure what information you're looking for. Try asking about assignment, schedule, status, ETA, address, access codes, notes, pricing, or history.",
      resolvedFields: [],
      status: "error",
    };
  }

  // 4. Load shared contexts (grouped by entity+scope)
  const sharedContexts = await loadSharedContexts(fieldRequests, entityMap, db);

  // 5. Resolve all fields in parallel
  const resolvedFields = await Promise.all(
    fieldRequests.map(async fr => {
      const scopeKey = `${fr.effectiveTimeScope.type}:${fr.effectiveTimeScope.specificDate ?? ""}`;
      const ctx = sharedContexts.get(scopeKey);
      if (!ctx) {
        return { field: fr.field, status: "error" as const, data: null } as ResolvedField;
      }
      try {
        return await Promise.resolve(RESOLVER_REGISTRY[fr.field](fr, ctx, db));
      } catch (err) {
        console.error(`[resolveQuery] resolver error for field "${fr.field}":`, err);
        return { field: fr.field, status: "error" as const, data: null } as ResolvedField;
      }
    })
  );

  // 6. Determine overall status
  const statuses = resolvedFields.map(f => f.status);
  let overallStatus: QueryResultStatus = "complete";
  if (statuses.every(s => s === "not_found")) overallStatus = "not_found";
  else if (statuses.some(s => s === "not_found" || s === "partial" || s === "error")) overallStatus = "partial";

  // 7. Project and generate answer
  const projection = projectForAnswerLLM(resolvedFields);
  const answer = await generateAnswer(question, resolvedFields, projection);

  console.log("[resolveQuery] fields:", resolvedFields.map(f => `${f.field}:${f.status}`).join(", "), "status:", overallStatus);

  return {
    type: "query_result",
    answer,
    resolvedFields,
    status: overallStatus,
  };
}
