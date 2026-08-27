import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import {
  cleanerJobs,
  conversationSessions,
  opsChatMessages,
  smsOptOuts,
} from "../../drizzle/schema";
import { computeReadinessSummary, type ReadinessSummary } from "./readinessService";
import { getTomorrowCapacityCandidate, type TomorrowCapacityCandidate } from "./tomorrowCapacity";
import { getTomorrowOvenUpsellCandidate, type SmartUpsellCandidate } from "./smartUpsells";
import { normalizePhoneLegacy } from "../utils/phone";

export type MadisonMoveKind = "protect_tomorrow" | "save_cancellation" | "fill_capacity" | "recover_qualified_leads" | "smart_upsell";
export type MadisonMoveDetailItem = { key: string; label: string; resolved: boolean };

export type MadisonMoveRecipient = { name: string; phone: string; reason: string };
export type MadisonMove = {
  id?: number;
  moveKey: string;
  kind: MadisonMoveKind;
  priority: "urgent" | "high" | "normal";
  headline: string;
  businessReason: string;
  impact: string;
  eligibleCount: number;
  excludedCount: number;
  excludedReasons: string[];
  recipients: MadisonMoveRecipient[];
  draftMessage?: string;
  targetDescription?: string;
  details?: string[];
  detailSections?: Array<{ heading: string; items: MadisonMoveDetailItem[] }>;
  remainingIssueCount?: number;
  completedIssueCount?: number;
  status: "ready" | "dismissed" | "sent" | "completed" | "sending";
  source?: { bookingId?: number; jobDate?: string; address?: string; serviceDateTime?: string | null; parentMoveKey?: string };
};

type Db = any;
type StoredMoveRow = { id: number; metadata: string | null; cardStatus: string | null };
type MadisonMovesDependencies = {
  storedMoveRows?: (db: Db) => Promise<StoredMoveRow[]>;
  computeReadinessSummary?: typeof computeReadinessSummary;
  eligibleQualifiedLeads?: (db: Db, options?: { area?: string }) => Promise<{ recipients: MadisonMoveRecipient[]; exclusions: string[] }>;
  tomorrowCapacityCandidate?: (db: Db, tomorrow: string) => Promise<TomorrowCapacityCandidate | null>;
  tomorrowOvenUpsellCandidate?: (db: Db, tomorrow: string) => Promise<SmartUpsellCandidate | null>;
};
const inactiveLeadStages = new Set(["COLD", "LOST", "QUALITY_RATING_DONE", "REVIEW_REBOOKING_DONE"]);
const DAY_MS = 86_400_000;

function easternDate(offsetDays = 0) {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  now.setDate(now.getDate() + offsetDays);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function locality(address: string | null | undefined) {
  if (!address) return "";
  const zip = address.match(/\b\d{5}\b/)?.[0];
  if (zip) return `zip:${zip}`;
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length >= 2 ? `city:${parts[parts.length - 2].toLowerCase()}` : "";
}

function parseMeta(value: string | null) {
  try { return JSON.parse(value ?? "{}") as Record<string, any>; } catch { return {}; }
}

async function storedMoveRows(db: Db) {
  return db.select().from(opsChatMessages)
    .where(eq(opsChatMessages.channel, "madison_moves"))
    .orderBy(desc(opsChatMessages.createdAt)).limit(250);
}

async function safetySets(db: Db) {
  const [globalStops, sessionStops, complaintRows, activeCsRows] = await Promise.all([
    db.select({ phone: smsOptOuts.phone }).from(smsOptOuts),
    db.select({ phone: conversationSessions.leadPhone }).from(conversationSessions).where(eq(conversationSessions.smsOptOut, 1)),
    db.select({ phone: cleanerJobs.customerPhone }).from(cleanerJobs)
      .where(sql`${cleanerJobs.customerComplaint} IS NOT NULL AND TRIM(${cleanerJobs.customerComplaint}) <> ''`),
    db.select({ phone: conversationSessions.leadPhone }).from(conversationSessions)
      .where(and(eq(conversationSessions.stage, "OPEN"), sql`${conversationSessions.csResolvedAt} IS NULL`)),
  ]);
  const normalize = (phone: string | null | undefined) => normalizePhoneLegacy(phone ?? "") ?? "";
  return {
    stops: new Set([...globalStops, ...sessionStops].map((row) => normalize(row.phone)).filter(Boolean)),
    complaints: new Set(complaintRows.map((row) => normalize(row.phone)).filter(Boolean)),
    activeCs: new Set(activeCsRows.map((row) => normalize(row.phone)).filter(Boolean)),
  };
}

async function eligibleQualifiedLeads(db: Db, options?: { area?: string }) {
  const now = Date.now();
  const { stops, complaints, activeCs } = await safetySets(db);
  const rows = await db.select({
    id: conversationSessions.id,
    leadName: conversationSessions.leadName,
    leadPhone: conversationSessions.leadPhone,
    address: conversationSessions.address,
    quotedPrice: conversationSessions.quotedPrice,
    stage: conversationSessions.stage,
    isBooked: conversationSessions.isBooked,
    smsOptOut: conversationSessions.smsOptOut,
    followUpDate: conversationSessions.followUpDate,
    followUpSent: conversationSessions.followUpSent,
    madisonDeferredUntil: conversationSessions.madisonDeferredUntil,
    lastMessageTs: conversationSessions.lastMessageTs,
    lastMessageRole: conversationSessions.lastMessageRole,
    csPriorityTag: conversationSessions.csPriorityTag,
  }).from(conversationSessions)
    .where(and(eq(conversationSessions.isBooked, 0), isNotNull(conversationSessions.leadPhone), isNotNull(conversationSessions.address), isNotNull(conversationSessions.quotedPrice)))
    .orderBy(desc(conversationSessions.lastMessageTs)).limit(250);

  const valid: MadisonMoveRecipient[] = [];
  const exclusions: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const phone = normalizePhoneLegacy(row.leadPhone ?? "");
    const age = row.lastMessageTs ? now - row.lastMessageTs : Number.POSITIVE_INFINITY;
    const areaMatches = !options?.area || locality(row.address) === options.area;
    let reason = "";
    if (!phone) reason = "invalid phone";
    else if (seen.has(phone)) reason = "duplicate customer";
    else if (!areaMatches) reason = "outside the verified service area";
    else if (stops.has(phone) || row.smsOptOut === 1) reason = "STOP opt-out";
    else if (complaints.has(phone)) reason = "open complaint";
    else if (activeCs.has(phone)) reason = "active customer-service conversation";
    else if (inactiveLeadStages.has(row.stage) || ["angry", "cancel"].includes(row.csPriorityTag ?? "")) reason = "not safe for outreach";
    else if (row.madisonDeferredUntil && row.madisonDeferredUntil > now) reason = "deferred by an agent";
    else if (row.followUpDate && row.followUpSent === 0) reason = "has a scheduled follow-up";
    else if (row.lastMessageRole !== "assistant" || age < 3 * DAY_MS || age > 30 * DAY_MS) reason = "not in the recovery window";
    if (reason) { exclusions.push(reason); continue; }
    seen.add(phone);
    valid.push({ name: row.leadName?.trim() || "Customer", phone, reason: options?.area ? "Qualified quote lead in the opening’s area" : "Qualified quote lead with no booking" });
  }
  return { recipients: valid.slice(0, 12), exclusions };
}

/** Only an observed active booking becoming cancelled/rescheduled may create an opening move. */
export function shouldObserveCancellationTransition(previousStatus: string | null, nextStatus: string | null) {
  return Boolean(
    previousStatus &&
    previousStatus !== nextStatus &&
    ["cancelled", "rescheduled"].includes(nextStatus ?? "") &&
    !["cancelled", "rescheduled", "completed"].includes(previousStatus)
  );
}

export async function recordCancellationObservation(db: Db, input: {
  bookingId: number; jobDate: string; jobId: number; customerName: string; address: string | null;
  serviceDateTime: string | null; previousStatus: string | null; nextStatus: string | null;
}) {
  if (!shouldObserveCancellationTransition(input.previousStatus, input.nextStatus)) return;
  const moveKey = `cancel:${input.bookingId}:${input.jobDate}`;
  const metadata = JSON.stringify({
    moveKey, kind: "save_cancellation", outcome: "ready", source: input,
  });
  try {
    await db.insert(opsChatMessages).values({
      cleanerJobId: input.jobId,
      channel: "madison_moves",
      authorName: "Madison",
      authorRole: "system",
      body: `Verified ${input.nextStatus} created an opening for ${input.jobDate}.`,
      quickAction: "madisons_move",
      metadata,
      cardStatus: "active",
      activeDedupKey: `move:${moveKey}`,
      lastActivityAt: Date.now(),
    });
  } catch (error: any) {
    if (error?.code !== "ER_DUP_ENTRY") throw error;
  }
}

function statusFor(stored: Map<string, { id: number; meta: Record<string, any>; cardStatus: string | null }>, moveKey: string) {
  const row = stored.get(moveKey);
  if (!row) return "ready" as const;
  return row.meta.outcome === "sent" || row.meta.outcome === "sending" ? "sent" as const : row.meta.outcome === "completed" ? "completed" as const : row.cardStatus === "dismissed" ? "dismissed" as const : "ready" as const;
}

export function buildFillCapacityMove(input: {
  parentMoveKey: string;
  source: Record<string, any>;
  recipients: MadisonMoveRecipient[];
  exclusions: string[];
  status: "ready" | "dismissed" | "sent" | "completed";
  id?: number;
}): MadisonMove | null {
  if (input.recipients.length === 0 || input.status !== "ready") return null;
  const { source } = input;
  return {
    id: input.id,
    moveKey: `fill:${input.parentMoveKey}`,
    kind: "fill_capacity",
    priority: "high",
    headline: `Fill a verified opening on ${source.jobDate ?? "the schedule"}`,
    businessReason: `A ${source.nextStatus ?? "cancelled"} booking opened capacity near ${locality(source.address).replace(/^(zip|city):/, "") || "the affected route"}.`,
    impact: `Review ${input.recipients.length} qualified nearby lead${input.recipients.length === 1 ? "" : "s"} before offering the opening.`,
    eligibleCount: input.recipients.length,
    excludedCount: input.exclusions.length,
    excludedReasons: Array.from(new Set(input.exclusions)).slice(0, 4),
    recipients: input.recipients,
    draftMessage: "Hi! We have a cleaning opening available near you and wanted to see if you would like to get on the schedule. Reply here and we’ll help find the best time.",
    targetDescription: "qualified leads near this verified opening",
    status: input.status,
    source: { ...source, parentMoveKey: input.parentMoveKey },
    details: [`This is tied to the verified opening from booking ${source.bookingId ?? "unknown"}.`, "Recipients are limited to qualified leads in the same verified area and rechecked before sending."],
  };
}

/** Keeps the Protect Tomorrow headline, category breakdown, and expanded detail rows on the same readiness totals. */
export function buildProtectTomorrowMove(input: { readiness: ReadinessSummary; tomorrow: string; status: "ready" | "dismissed" | "sent" | "completed"; id?: number; resolvedItemKeys?: Iterable<string> }): MadisonMove | null {
  const { readiness } = input;
  if (readiness.totalIssues <= 0 || input.status !== "ready") return null;
  const resolvedKeys = new Set(input.resolvedItemKeys ?? []);
  const item = (key: string, label: string): MadisonMoveDetailItem => ({ key, label, resolved: resolvedKeys.has(key) });
  const detailSections = [
    { heading: "Schedule", items: [
      ...readiness.dimensions.jobs.unassigned.map((row) => item(`schedule:unassigned:${row.jobId}`, `${row.customerName} is unassigned${row.jobTime ? ` at ${row.jobTime}` : ""}.`)),
      ...readiness.dimensions.jobs.doubleBooked.map((row) => item(`schedule:conflict:${row.jobId}`, `${row.customerName} is double-booked with ${row.cleanerName}${row.jobTime ? ` at ${row.jobTime}` : ""}.`)),
    ] },
    { heading: "Team confirmations", items: readiness.dimensions.teams.rows.filter((row) => !row.confirmed).map((row) => item(`team:confirmation:${row.cleanerProfileId}`, `${row.name} has not confirmed their team schedule.`)) },
    { heading: "Payment authorizations", items: readiness.dimensions.payments.rows.filter((row) => row.status !== "on_hold" && row.status !== "lf_on_hold").map((row) => item(`payment:${row.jobId}`, `${row.customerName} has no payment authorization${row.jobTime ? ` (${row.jobTime})` : ""}.`)) },
    { heading: "Customer confirmations", items: readiness.dimensions.confirmations.rows.filter((row) => row.status === "pending").map((row) => item(`customer:confirmation:${row.jobId}`, `${row.customerName} has not confirmed${row.jobTime ? ` (${row.jobTime})` : ""}.`)) },
    { heading: "Client requests", items: readiness.dimensions.clientRequests.rows.filter((row) => row.status !== "honored").map((row) => item(`request:${row.jobId}`, row.status === "unassigned" ? `${row.customerName}'s ${row.requestedTeam} request is unassigned.` : `${row.customerName}'s ${row.requestedTeam} request is assigned to ${row.assignedTeam ?? "another team"}.`)) },
  ].filter((section) => section.items.length > 0);
  const remainingCategories = detailSections.map((section) => ({ ...section, remaining: section.items.filter((entry) => !entry.resolved).length })).filter((section) => section.remaining > 0);
  const remainingIssueCount = remainingCategories.reduce((sum, section) => sum + section.remaining, 0);
  const completedIssueCount = readiness.totalIssues - remainingIssueCount;
  const breakdown = remainingCategories.map((section) => `${section.remaining} ${section.heading.toLowerCase()}`).join(", ");
  const completed = remainingIssueCount === 0;
  return {
    id: input.id, moveKey: `protect:${input.tomorrow}`, kind: "protect_tomorrow", priority: "urgent",
    headline: completed ? `All ${readiness.totalIssues} verified items were reviewed` : `${remainingIssueCount} verified item${remainingIssueCount === 1 ? "" : "s"} could affect tomorrow`,
    businessReason: completed ? "The internal review checklist is complete. Underlying schedule, team, payment, confirmation, and customer records are unchanged." : `${breakdown} issue${remainingIssueCount === 1 ? "" : "s"} ${remainingIssueCount === 1 ? "is" : "are"} still open.`,
    impact: completed ? "Review is complete; the original details remain available here for reference and Undo." : "Protect tomorrow’s scheduled revenue and customer experience.", eligibleCount: 0, excludedCount: 0, excludedReasons: [], recipients: [], status: completed ? "completed" : input.status,
    details: detailSections.flatMap((section) => section.items.map((entry) => entry.label)),
    detailSections,
    remainingIssueCount,
    completedIssueCount,
  };
}

/** Explicitly records only an agent's review state for one current Protect Tomorrow alert. */
export async function setProtectTomorrowChecklistItem(db: Db, input: { moveKey: string; itemKey: string; resolved: boolean; agentId: number }) {
  const date = input.moveKey.match(/^protect:(\d{4}-\d{2}-\d{2})$/)?.[1];
  if (!date) throw new Error("Invalid Protect Tomorrow move.");
  const rows = await storedMoveRows(db);
  const existing = rows.find((row: any) => parseMeta(row.metadata).moveKey === input.moveKey);
  const existingMeta = existing ? parseMeta(existing.metadata) : {};
  const previouslyResolved = new Set(Array.isArray(existingMeta.checklistResolvedItemKeys) ? existingMeta.checklistResolvedItemKeys.filter((key: unknown): key is string => typeof key === "string") : []);
  const baseline = buildProtectTomorrowMove({ readiness: await computeReadinessSummary(db, date), tomorrow: date, status: "ready" });
  const availableItems = baseline?.detailSections?.flatMap((section) => section.items) ?? [];
  if (!availableItems.some((entry) => entry.key === input.itemKey)) throw new Error("This readiness item is no longer active.");
  if (input.resolved) previouslyResolved.add(input.itemKey); else previouslyResolved.delete(input.itemKey);
  const updated = buildProtectTomorrowMove({ readiness: await computeReadinessSummary(db, date), tomorrow: date, status: "ready", id: existing?.id, resolvedItemKeys: previouslyResolved });
  if (!updated) throw new Error("This Protect Tomorrow move is no longer active.");
  const completed = updated.status === "completed";
  const metadata = JSON.stringify({
    ...existingMeta, moveKey: input.moveKey, kind: "protect_tomorrow", outcome: completed ? "completed" : "ready",
    checklistResolvedItemKeys: [...previouslyResolved], checklistUpdatedAt: Date.now(), checklistUpdatedBy: input.agentId, snapshot: updated,
  });
  if (existing) {
    await db.update(opsChatMessages).set({ body: updated.headline, cardStatus: completed ? "dismissed" : "active", activeDedupKey: completed ? null : `move:${input.moveKey}`, metadata, lastActivityAt: Date.now() }).where(eq(opsChatMessages.id, existing.id));
  } else {
    await db.insert(opsChatMessages).values({ cleanerJobId: null, channel: "madison_moves", authorName: "Madison", authorRole: "system", body: updated.headline, quickAction: "madisons_move", metadata, cardStatus: completed ? "dismissed" : "active", activeDedupKey: completed ? null : `move:${input.moveKey}`, lastActivityAt: Date.now() });
  }
  return { completed, remainingIssueCount: updated.remainingIssueCount ?? 0, completedIssueCount: updated.completedIssueCount ?? 0 };
}

/** Builds the two related move cards from one persisted, verified cancellation opening. */
export function buildCancellationOpeningMoves(input: {
  parentMoveKey: string;
  source: Record<string, any>;
  recipients: MadisonMoveRecipient[];
  exclusions: string[];
  fillStatus: "ready" | "dismissed" | "sent" | "completed";
  cancellationId?: number;
  fillId?: number;
}) {
  const cancellation: MadisonMove = {
    id: input.cancellationId, moveKey: input.parentMoveKey, kind: "save_cancellation", priority: "high",
    headline: `A verified cancellation opened ${input.source.jobDate ?? "a service window"}`,
    businessReason: `Launch27 changed booking ${input.source.bookingId ?? ""} from ${input.source.previousStatus ?? "active"} to ${input.source.nextStatus ?? "cancelled"}.`,
    impact: input.recipients.length > 0 ? `Review ${input.recipients.length} same-area qualified lead${input.recipients.length === 1 ? "" : "s"} to help refill the opening.` : "The opening is verified; no safe same-area lead is currently eligible.",
    eligibleCount: input.recipients.length, excludedCount: input.exclusions.length, excludedReasons: Array.from(new Set(input.exclusions)).slice(0, 4),
    recipients: input.recipients,
    draftMessage: input.recipients.length ? "Hi! We have an opening available and wanted to see whether you would still like to get your cleaning scheduled. Reply here and we’ll help find the best time." : undefined,
    targetDescription: "qualified leads near this opening", status: "ready", source: input.source,
    details: [`Opening source: booking ${input.source.bookingId ?? "unknown"} changed from ${input.source.previousStatus ?? "active"} to ${input.source.nextStatus ?? "cancelled"}.`, ...(input.recipients.length === 0 ? ["No same-area lead clears all current contact safeguards."] : [])],
  };
  const fill = buildFillCapacityMove({ parentMoveKey: input.parentMoveKey, source: input.source, recipients: input.recipients, exclusions: input.exclusions, status: input.fillStatus, id: input.fillId });
  return { cancellation, fill };
}

export async function listMadisonMoves(db: Db, dependencies: MadisonMovesDependencies = {}): Promise<MadisonMove[]> {
  const loadStoredMoveRows = dependencies.storedMoveRows ?? storedMoveRows;
  const getReadinessSummary = dependencies.computeReadinessSummary ?? computeReadinessSummary;
  const getEligibleQualifiedLeads = dependencies.eligibleQualifiedLeads ?? eligibleQualifiedLeads;
  const getTomorrowCapacity = dependencies.tomorrowCapacityCandidate ?? getTomorrowCapacityCandidate;
  const getTomorrowOvenUpsell = dependencies.tomorrowOvenUpsellCandidate ?? getTomorrowOvenUpsellCandidate;
  const rows = await loadStoredMoveRows(db);
  const stored = new Map<string, { id: number; meta: Record<string, any>; cardStatus: string | null }>();
  for (const row of rows) {
    const meta = parseMeta(row.metadata);
    if (typeof meta.moveKey === "string" && !stored.has(meta.moveKey)) stored.set(meta.moveKey, { id: row.id, meta, cardStatus: row.cardStatus });
  }
  const moves: MadisonMove[] = [];
  const tomorrow = easternDate(1);
  const readiness = await getReadinessSummary(db, tomorrow);
  const readinessKey = `protect:${tomorrow}`;
  const readinessStatus = statusFor(stored, readinessKey);
  const protectTomorrow = buildProtectTomorrowMove({ readiness, tomorrow, status: readinessStatus, id: stored.get(readinessKey)?.id, resolvedItemKeys: stored.get(readinessKey)?.meta.checklistResolvedItemKeys });
  if (protectTomorrow?.status === "ready") moves.push(protectTomorrow);

  const recoveryKey = `recover:${tomorrow}`;
  const recoveryStatus = statusFor(stored, recoveryKey);
  const recovery = await getEligibleQualifiedLeads(db);
  if (recovery.recipients.length > 0 && recoveryStatus === "ready") {
    moves.push({
      id: stored.get(recoveryKey)?.id, moveKey: recoveryKey, kind: "recover_qualified_leads", priority: "normal",
      headline: `${recovery.recipients.length} qualified quote lead${recovery.recipients.length === 1 ? "" : "s"} can be re-engaged`,
      businessReason: "They have a completed quote context, remain unbooked, and have been inactive after our last message.",
      impact: "Recover qualified demand already in the pipeline.", eligibleCount: recovery.recipients.length, excludedCount: recovery.exclusions.length,
      excludedReasons: Array.from(new Set(recovery.exclusions)).slice(0, 4), recipients: recovery.recipients,
      draftMessage: "Hi! We wanted to check back in—would you still like help getting your cleaning scheduled? We have availability and would be happy to find a time that works for you.",
      targetDescription: "qualified leads", status: recoveryStatus,
    });
  }

  const tomorrowCapacity = await getTomorrowCapacity(db, tomorrow);
  if (tomorrowCapacity && statusFor(stored, tomorrowCapacity.moveKey) === "ready") {
    moves.push({ ...tomorrowCapacity, kind: "fill_capacity", priority: "high", status: "ready" });
  }

  const tomorrowOvenUpsell = await getTomorrowOvenUpsell(db, tomorrow);
  if (tomorrowOvenUpsell && statusFor(stored, tomorrowOvenUpsell.moveKey) === "ready") {
    moves.push({ ...tomorrowOvenUpsell, kind: "smart_upsell", priority: "normal", status: "ready" });
  }

  for (const [moveKey, row] of stored) {
    if (row.cardStatus !== "active" || row.meta.kind !== "save_cancellation") continue;
    const source = row.meta.source ?? {};
    const candidates = await getEligibleQualifiedLeads(db, { area: locality(source.address) });
    const fillKey = `fill:${moveKey}`;
    const fillStatus = statusFor(stored, fillKey);
    const pair = buildCancellationOpeningMoves({ parentMoveKey: moveKey, source, recipients: candidates.recipients, exclusions: candidates.exclusions, fillStatus, cancellationId: row.id, fillId: stored.get(fillKey)?.id });
    moves.push(pair.cancellation);
    if (pair.fill) moves.push(pair.fill);
  }
  return moves.sort((a, b) => (b.priority === "urgent" ? 3 : b.priority === "high" ? 2 : 1) - (a.priority === "urgent" ? 3 : a.priority === "high" ? 2 : 1));
}

export async function listMadisonMoveHistory(db: Db, dependencies: Pick<MadisonMovesDependencies, "storedMoveRows"> = {}): Promise<MadisonMove[]> {
  const rows = await (dependencies.storedMoveRows ?? storedMoveRows)(db);
  return rows.filter((row: any) => ["dismissed", "sending", "sent", "completed"].includes(parseMeta(row.metadata).outcome)).map((row: any) => {
    const meta = parseMeta(row.metadata);
    const snapshot = meta.snapshot as Partial<MadisonMove> | undefined;
    if (snapshot?.moveKey && snapshot.kind && snapshot.headline && snapshot.businessReason && snapshot.impact) {
      return {
        ...snapshot,
        id: row.id,
        recipients: snapshot.recipients ?? [],
        excludedReasons: snapshot.excludedReasons ?? [],
        eligibleCount: snapshot.eligibleCount ?? 0,
        excludedCount: snapshot.excludedCount ?? 0,
        details: snapshot.details ?? [],
        status: meta.outcome === "sending" ? "sending" : meta.outcome === "sent" ? "sent" : meta.outcome === "completed" ? "completed" : "dismissed",
      } as MadisonMove;
    }
    return {
      id: row.id,
      moveKey: meta.moveKey ?? `stored:${row.id}`,
      kind: meta.kind ?? "recover_qualified_leads",
      priority: "normal",
      headline: row.body,
      businessReason: meta.outcome === "sending" ? "A send was started and is retained in history to prevent an automatic duplicate retry." : meta.outcome === "sent" ? `Sent to ${meta.sentCount ?? 0} customer${meta.sentCount === 1 ? "" : "s"}.` : "Set aside for now.",
      impact: "Stored for review; no further customer action occurs automatically.",
      eligibleCount: 0,
      excludedCount: 0,
      excludedReasons: [],
      recipients: [],
      status: meta.outcome === "sending" ? "sending" : meta.outcome === "sent" ? "sent" : meta.outcome === "completed" ? "completed" : "dismissed",
      details: [],
    };
  });
}

export async function dismissMadisonMove(db: Db, moveKey: string, kind: MadisonMoveKind, snapshot?: MadisonMove) {
  const rows = await storedMoveRows(db);
  const existing = rows.find((row: any) => parseMeta(row.metadata).moveKey === moveKey);
  if (existing) {
    const meta = { ...parseMeta(existing.metadata), outcome: "dismissed", dismissedAt: Date.now(), snapshot: snapshot ?? parseMeta(existing.metadata).snapshot };
    await db.update(opsChatMessages).set({ cardStatus: "dismissed", activeDedupKey: null, metadata: JSON.stringify(meta), lastActivityAt: Date.now() }).where(eq(opsChatMessages.id, existing.id));
    return;
  }
  await db.insert(opsChatMessages).values({ cleanerJobId: null, channel: "madison_moves", authorName: "Madison", authorRole: "system", body: snapshot?.headline ?? "Madison move dismissed.", quickAction: "madisons_move", metadata: JSON.stringify({ moveKey, kind, outcome: "dismissed", dismissedAt: Date.now(), snapshot }), cardStatus: "dismissed", lastActivityAt: Date.now() });
}

/** Restoring is explicit and only re-enables a dismissed recommendation; it never sends a message. */
export async function restoreMadisonMove(db: Db, moveKey: string) {
  const rows = await storedMoveRows(db);
  const existing = rows.find((row: any) => parseMeta(row.metadata).moveKey === moveKey);
  if (!existing) throw new Error("Stored move not found");
  const existingMeta = parseMeta(existing.metadata);
  if (existingMeta.outcome === "sent") throw new Error("Sent moves cannot be restored");
  const metadata = JSON.stringify({ ...existingMeta, outcome: "ready", restoredAt: Date.now() });
  await db.update(opsChatMessages).set({ cardStatus: "active", activeDedupKey: `move:${moveKey}`, metadata, lastActivityAt: Date.now() }).where(eq(opsChatMessages.id, existing.id));
}
