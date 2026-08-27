import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import {
  cleanerJobs,
  conversationSessions,
  opsChatMessages,
  smsOptOuts,
} from "../../drizzle/schema";
import { computeReadinessSummary } from "./readinessService";
import { normalizePhoneLegacy } from "../utils/phone";

export type MadisonMoveKind = "protect_tomorrow" | "save_cancellation" | "fill_capacity" | "recover_qualified_leads";

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
  status: "ready" | "dismissed" | "sent";
  source?: { bookingId?: number; jobDate?: string; address?: string; serviceDateTime?: string | null; parentMoveKey?: string };
};

type Db = any;
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
  return row.meta.outcome === "sent" ? "sent" as const : row.cardStatus === "dismissed" ? "dismissed" as const : "ready" as const;
}

export function buildFillCapacityMove(input: {
  parentMoveKey: string;
  source: Record<string, any>;
  recipients: MadisonMoveRecipient[];
  exclusions: string[];
  status: "ready" | "dismissed" | "sent";
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

/** Builds the two related move cards from one persisted, verified cancellation opening. */
export function buildCancellationOpeningMoves(input: {
  parentMoveKey: string;
  source: Record<string, any>;
  recipients: MadisonMoveRecipient[];
  exclusions: string[];
  fillStatus: "ready" | "dismissed" | "sent";
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

export async function listMadisonMoves(db: Db): Promise<MadisonMove[]> {
  const rows = await storedMoveRows(db);
  const stored = new Map<string, { id: number; meta: Record<string, any>; cardStatus: string | null }>();
  for (const row of rows) {
    const meta = parseMeta(row.metadata);
    if (typeof meta.moveKey === "string" && !stored.has(meta.moveKey)) stored.set(meta.moveKey, { id: row.id, meta, cardStatus: row.cardStatus });
  }
  const moves: MadisonMove[] = [];
  const tomorrow = easternDate(1);
  const readiness = await computeReadinessSummary(db, tomorrow);
  const readinessKey = `protect:${tomorrow}`;
  const readinessStatus = statusFor(stored, readinessKey);
  if (readiness.totalIssues > 0 && readinessStatus === "ready") {
    moves.push({
      id: stored.get(readinessKey)?.id, moveKey: readinessKey, kind: "protect_tomorrow", priority: "urgent",
      headline: `${readiness.totalIssues} verified item${readiness.totalIssues === 1 ? "" : "s"} could affect tomorrow`,
      businessReason: `${readiness.dimensions.jobs.issueCount} schedule, ${readiness.dimensions.teams.issueCount} team, and ${readiness.dimensions.confirmations.issueCount} confirmation issue${readiness.totalIssues === 1 ? "" : "s"} are still open.`,
      impact: "Protect tomorrow’s scheduled revenue and customer experience.", eligibleCount: 0, excludedCount: 0, excludedReasons: [], recipients: [], status: readinessStatus,
      details: [
        ...readiness.dimensions.jobs.unassigned.map((row) => `${row.customerName} is unassigned${row.jobTime ? ` at ${row.jobTime}` : ""}.`),
        ...readiness.dimensions.confirmations.rows.filter((row) => row.status === "pending").map((row) => `${row.customerName} has not confirmed${row.jobTime ? ` (${row.jobTime})` : ""}.`),
      ].slice(0, 8),
    });
  }

  const recoveryKey = `recover:${tomorrow}`;
  const recoveryStatus = statusFor(stored, recoveryKey);
  const recovery = await eligibleQualifiedLeads(db);
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

  for (const [moveKey, row] of stored) {
    if (row.cardStatus !== "active" || row.meta.kind !== "save_cancellation") continue;
    const source = row.meta.source ?? {};
    const candidates = await eligibleQualifiedLeads(db, { area: locality(source.address) });
    const fillKey = `fill:${moveKey}`;
    const fillStatus = statusFor(stored, fillKey);
    const pair = buildCancellationOpeningMoves({ parentMoveKey: moveKey, source, recipients: candidates.recipients, exclusions: candidates.exclusions, fillStatus, cancellationId: row.id, fillId: stored.get(fillKey)?.id });
    moves.push(pair.cancellation);
    if (pair.fill) moves.push(pair.fill);
  }
  return moves.sort((a, b) => (b.priority === "urgent" ? 3 : b.priority === "high" ? 2 : 1) - (a.priority === "urgent" ? 3 : a.priority === "high" ? 2 : 1));
}

export async function listMadisonMoveHistory(db: Db): Promise<MadisonMove[]> {
  const rows = await storedMoveRows(db);
  return rows.map((row: any) => {
    const meta = parseMeta(row.metadata);
    return {
      id: row.id,
      moveKey: meta.moveKey ?? `stored:${row.id}`,
      kind: meta.kind ?? "recover_qualified_leads",
      priority: "normal",
      headline: row.body,
      businessReason: meta.outcome === "sent" ? `Sent to ${meta.sentCount ?? 0} customer${meta.sentCount === 1 ? "" : "s"}.` : "Set aside for now.",
      impact: "Stored for review; no further customer action occurs automatically.",
      eligibleCount: 0,
      excludedCount: 0,
      excludedReasons: [],
      recipients: [],
      status: meta.outcome === "sent" ? "sent" : "dismissed",
      details: [],
    };
  });
}

export async function dismissMadisonMove(db: Db, moveKey: string, kind: MadisonMoveKind) {
  const rows = await storedMoveRows(db);
  const existing = rows.find((row: any) => parseMeta(row.metadata).moveKey === moveKey);
  if (existing) {
    const meta = { ...parseMeta(existing.metadata), outcome: "dismissed", dismissedAt: Date.now() };
    await db.update(opsChatMessages).set({ cardStatus: "dismissed", activeDedupKey: null, metadata: JSON.stringify(meta), lastActivityAt: Date.now() }).where(eq(opsChatMessages.id, existing.id));
    return;
  }
  await db.insert(opsChatMessages).values({ cleanerJobId: null, channel: "madison_moves", authorName: "Madison", authorRole: "system", body: "Madison move dismissed.", quickAction: "madisons_move", metadata: JSON.stringify({ moveKey, kind, outcome: "dismissed", dismissedAt: Date.now() }), cardStatus: "dismissed", lastActivityAt: Date.now() });
}
