// Phase 2 quality records (owner-approved table team_quality_incidents).
// Every function here is a side record: callers never wait on it for a customer reply, and a failure here never
// changes an SMS, email, call, booking or task. No AI calls, no messages, no provider calls.
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { easternDateIso } from "../shared/easternTime";
import { shiftBookingDate } from "../shared/bookingReschedule";
import { isRecleanJob } from "./teamQualityRules";
import {
  categoryGroup, STRONG_DETECTORS, type IncidentForScoring, type QualityCategory, type QualityChannel, type QualityDetector,
  type QualityIncidentAction, type QualitySeverity,
} from "../shared/teamQualityIncidents";

type SqlClient = Pool | PoolConnection;
type Row = RowDataPacket & Record<string, unknown>;
type Value = string | number | null;

export type QualitySignal = {
  sourceKey: string; channel: QualityChannel; detector: QualityDetector; reportedAtMs: number;
  customerPhone?: string | null; customerEmail?: string | null; customerName?: string | null;
  evidenceQuote?: string | null; evidenceText?: string | null; sourceRef?: Record<string, unknown> | null;
  category: QualityCategory; severity: QualitySeverity; serviceDateHint?: string | null;
  /** Known only when the signal is already about one job (a portal rating, a cleaner sign-off, a review match). */
  leadflowJobId?: number | null;
  recleanRequested?: boolean; refundRequested?: boolean;
};
export type QualityIncidentRow = IncidentForScoring & {
  primaryId: number | null; sourceKey: string; channel: string; detector: string; reportedAtMs: number; weekStart: string;
  customerPhone: string | null; customerEmail: string | null; customerName: string | null;
  evidenceQuote: string | null; evidenceText: string | null; sourceRef: Record<string, unknown> | null;
  severity: string; serviceDateHint: string | null; attributionNote: string | null; statusNote: string | null;
  processingError: string | null; processingAttempts: number; updatedBy: number | null; createdAtMs: number; updatedAtMs: number;
};

const COLUMNS = "id, primaryId, sourceKey, channel, detector, reportedAtMs, weekStart, customerPhone, customerEmail, customerName, evidenceQuote, evidenceText, sourceRef, category, severity, serviceDateHint, leadflowJobId, teamId, attribution, attributionNote, status, statusNote, recleanStatus, refundStatus, processingStatus, processingError, processingAttempts, updatedBy, createdAtMs, updatedAtMs";
const TOMBSTONES = ["canceled", "cancelled", "missing_from_launch27", "rescheduled"];
/** Days before the message in which the visit being complained about is looked for when no date is given. */
export const ATTRIBUTION_LOOKBACK_DAYS = 7;
/** With no completed visit in those days, a complaint about an older visit is still matched (owner requirement). */
export const ATTRIBUTION_FALLBACK_DAYS = 45;
/** A new message about the same visit and team joins an open incident only within this many days of its last message. */
export const SAME_INCIDENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SEVERITY_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2 };
const fail = (code: string): never => { throw new Error(code); };

async function rows(db: SqlClient, sql: string, values: Value[] = []): Promise<Row[]> {
  const [result] = await db.execute<RowDataPacket[]>(sql, values);
  return result as Row[];
}
async function change(db: SqlClient, sql: string, values: Value[]): Promise<ResultSetHeader> {
  const [result] = await db.execute<ResultSetHeader>(sql, values);
  return result;
}
async function transaction<T>(pool: Pool, work: (tx: PoolConnection) => Promise<T>): Promise<T> {
  const tx = await pool.getConnection();
  let started = false;
  try {
    await tx.beginTransaction(); started = true;
    const result = await work(tx);
    await tx.commit();
    return result;
  } catch (error) {
    if (started) { try { await tx.rollback(); } catch { /* connection is released below */ } }
    throw error;
  } finally { tx.release(); }
}
const num = (value: unknown): number | null => value === null || value === undefined ? null : Number(value);
function parseJson(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  try { return (typeof value === "string" ? JSON.parse(value) : Buffer.isBuffer(value) ? JSON.parse(value.toString("utf8")) : value) as Record<string, unknown>; }
  catch { return null; }
}
function fromRow(row: Row): QualityIncidentRow {
  return {
    id: Number(row.id), primaryId: num(row.primaryId), sourceKey: String(row.sourceKey), channel: String(row.channel), detector: String(row.detector),
    reportedAtMs: Number(row.reportedAtMs), weekStart: String(row.weekStart), customerPhone: (row.customerPhone as string | null) ?? null,
    customerEmail: (row.customerEmail as string | null) ?? null, customerName: (row.customerName as string | null) ?? null,
    evidenceQuote: (row.evidenceQuote as string | null) ?? null, evidenceText: (row.evidenceText as string | null) ?? null, sourceRef: parseJson(row.sourceRef),
    category: String(row.category), severity: String(row.severity), serviceDateHint: (row.serviceDateHint as string | null) ?? null,
    leadflowJobId: num(row.leadflowJobId), teamId: num(row.teamId), attribution: String(row.attribution), attributionNote: (row.attributionNote as string | null) ?? null,
    status: String(row.status), statusNote: (row.statusNote as string | null) ?? null, recleanStatus: String(row.recleanStatus), refundStatus: String(row.refundStatus),
    processingStatus: String(row.processingStatus), processingError: (row.processingError as string | null) ?? null, processingAttempts: Number(row.processingAttempts),
    updatedBy: num(row.updatedBy), createdAtMs: Number(row.createdAtMs), updatedAtMs: Number(row.updatedAtMs),
  };
}
async function readIncident(db: SqlClient, id: number, lock = false): Promise<QualityIncidentRow | null> {
  const found = await rows(db, `SELECT ${COLUMNS} FROM team_quality_incidents WHERE id = ?${lock ? " FOR UPDATE" : ""}`, [id]);
  return found.length ? fromRow(found[0]) : null;
}

/** Sunday-start week (America/New_York) of an instant, the same convention as the leaderboard. */
export function reportWeekStart(ms: number): string {
  const day = easternDateIso(new Date(ms));
  return shiftBookingDate(day, -new Date(`${day}T12:00:00Z`).getUTCDay());
}
const digits10 = (phone: string | null | undefined): string | null => {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
};
const clip = (value: string | null | undefined, max: number): string | null => value == null ? null : value.length > max ? value.slice(0, max) : value;

/** 1. Save the signal first (durable, idempotent by sourceKey). 2. Match it to a job/team and incident.
 * A matching failure leaves a visible "failed" record that staff can retry; nothing is re-sent. */
export async function recordQualitySignal(pool: Pool, signal: QualitySignal, nowMs = Date.now()): Promise<{ id: number; duplicate: boolean; processed: boolean }> {
  if (!signal.sourceKey || signal.sourceKey.length > 191 || !Number.isFinite(signal.reportedAtMs)) return fail("QUALITY_SIGNAL_INVALID");
  let result: ResultSetHeader;
  try {
    result = await change(pool, `INSERT INTO team_quality_incidents (primaryId, sourceKey, channel, detector, reportedAtMs, weekStart, customerPhone, customerEmail, customerName,
      evidenceQuote, evidenceText, sourceRef, category, severity, serviceDateHint, leadflowJobId, teamId, attribution, attributionNote, status, statusNote,
      recleanStatus, refundStatus, processingStatus, processingError, processingAttempts, updatedBy, createdAtMs, updatedAtMs)
    VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'unattributed', NULL, 'open', NULL, ?, ?, 'pending', NULL, 0, NULL, ?, ?)`, [
    signal.sourceKey, signal.channel, signal.detector, Math.round(signal.reportedAtMs), reportWeekStart(signal.reportedAtMs),
    clip(signal.customerPhone ?? null, 32), clip(signal.customerEmail?.toLowerCase() ?? null, 320), clip(signal.customerName ?? null, 255),
    clip(signal.evidenceQuote ?? null, 4000), clip(signal.evidenceText ?? null, 8000), signal.sourceRef ? JSON.stringify(signal.sourceRef) : null,
    signal.category, signal.severity, signal.serviceDateHint ?? null, signal.leadflowJobId ?? null,
    signal.recleanRequested ? "requested" : "none", signal.refundRequested ? "requested" : "none", nowMs, nowMs,
    ]);
  } catch (error) {
    // The same message/email thread/call is already recorded: keep the first record, never a second one.
    // Drizzle/mysql2 may wrap the driver error, so check the cause too. Any other error is not hidden.
    const code = (error as { code?: string })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
    if (code !== "ER_DUP_ENTRY") throw error;
    const existing = await rows(pool, "SELECT id FROM team_quality_incidents WHERE sourceKey = ?", [signal.sourceKey]);
    if (!existing.length) throw error;
    return { id: Number(existing[0].id), duplicate: true, processed: false };
  }
  if (result.affectedRows !== 1 || !result.insertId) return fail("QUALITY_SIGNAL_SAVE_FAILED");
  const id = Number(result.insertId);
  const processed = await processQualityIncident(pool, id, nowMs).then(() => true, () => false);
  return { id, duplicate: false, processed };
}

type Candidate = { id: number; jobDate: string; teamId: number | null; imported: boolean };
async function teamFor(db: SqlClient, job: Candidate): Promise<number | null> {
  if (job.teamId === null) return null;
  const teams = await rows(db, job.imported ? "SELECT id FROM scheduling_teams WHERE launch27TeamId = ?" : "SELECT id FROM scheduling_teams WHERE id = ?", [job.teamId]);
  return teams.length === 1 ? Number(teams[0].id) : null;
}
function candidate(row: Row): Candidate {
  const origin = String(row.origin ?? "");
  // Same namespace rule as the leaderboard counts: imported (Launch27) jobs keep their Launch27 team ID; native jobs use the roster ID.
  const imported = row.launch27BookingId !== null || origin === "launch27_import" || (row.bookingId === null && origin === "leadflow_recurrence");
  return { id: Number(row.id), jobDate: String(row.jobDate), teamId: num(row.teamId), imported };
}
const JOB_FIELDS = "j.id, j.jobDate, j.bookingStatus, j.teamId, j.origin, j.bookingId, j.launch27BookingId";
async function readJob(db: SqlClient, id: number): Promise<Candidate | null> {
  const found = await rows(db, `SELECT ${JOB_FIELDS} FROM leadflow_jobs j WHERE j.id = ?`, [id]);
  return found.length ? candidate(found[0]) : null;
}
/** The customer's visits (Launch27 and native) by phone or email, newest first. */
export async function customerVisits(db: SqlClient, contact: { phone: string | null; email: string | null }, from: string, through: string): Promise<Array<Candidate & { bookingStatus: string; signedOff: boolean }>> {
  const phone = digits10(contact.phone), email = contact.email?.trim().toLowerCase() || null;
  if (!phone && !email) return [];
  const found = await rows(db, `SELECT ${JOB_FIELDS}, (SELECT COUNT(*) FROM cleaner_portal_job_signoffs s WHERE s.leadflowJobId = j.id) AS signoffs
    FROM leadflow_jobs j LEFT JOIN bookings b ON b.id = j.bookingId
    WHERE j.jobDate >= ? AND j.jobDate <= ? AND (
      (? IS NOT NULL AND (RIGHT(REGEXP_REPLACE(COALESCE(j.customerPhone, ''), '[^0-9]', ''), 10) = ? OR RIGHT(REGEXP_REPLACE(COALESCE(b.customerPhone, ''), '[^0-9]', ''), 10) = ?))
      OR (? IS NOT NULL AND (LOWER(j.customerEmail) = ? OR LOWER(b.customerEmail) = ?)))
    ORDER BY j.jobDate DESC, j.id DESC LIMIT 50`, [from, through, phone, phone, phone, email, email, email]);
  return found.map(row => ({ ...candidate(row), bookingStatus: String(row.bookingStatus ?? ""), signedOff: Number(row.signoffs) > 0 }));
}
/** Which visit and team a complaint is about, decided automatically: the visit the customer named, otherwise the most
 * recent completed visit in the days before the message. No matching visit or no single team → "unattributed"
 * (it does not count, and is retried automatically when the week is recalculated). Never a staff step. */
export async function resolveAttribution(db: SqlClient, incident: Pick<QualityIncidentRow, "reportedAtMs" | "customerPhone" | "customerEmail" | "serviceDateHint" | "leadflowJobId">):
  Promise<{ leadflowJobId: number | null; teamId: number | null; attribution: "auto" | "unattributed"; note: string }> {
  if (incident.leadflowJobId !== null) {
    const job = await readJob(db, incident.leadflowJobId);
    if (!job) return { leadflowJobId: null, teamId: null, attribution: "unattributed", note: "The job this came from no longer exists." };
    const teamId = await teamFor(db, job);
    return teamId === null ? { leadflowJobId: job.id, teamId: null, attribution: "unattributed", note: `Job ${job.id} is not assigned to exactly one team.` }
      : { leadflowJobId: job.id, teamId, attribution: "auto", note: `From job ${job.id} (${job.jobDate}).` };
  }
  const today = easternDateIso(new Date(incident.reportedAtMs));
  const completed = (visits: Awaited<ReturnType<typeof customerVisits>>) => visits
    .filter(visit => !TOMBSTONES.includes(visit.bookingStatus.trim().toLowerCase()))
    // A visit dated today counts only once it has happened (sign-off or completed), like the leaderboard counts.
    .filter(visit => visit.jobDate < today || visit.signedOff || visit.bookingStatus.trim().toLowerCase() === "completed");
  const contact = { phone: incident.customerPhone, email: incident.customerEmail };
  const hint = incident.serviceDateHint && incident.serviceDateHint <= today && incident.serviceDateHint >= shiftBookingDate(today, -45) ? incident.serviceDateHint : null;
  let visits = hint ? completed(await customerVisits(db, contact, hint, hint)) : [];
  const named = visits.length > 0;
  if (!named) visits = completed(await customerVisits(db, contact, shiftBookingDate(today, -ATTRIBUTION_LOOKBACK_DAYS), today));
  // A legitimate complaint is not discarded because the visit was longer ago: look back further for the latest visit.
  const older = !named && !visits.length;
  if (older) visits = completed(await customerVisits(db, contact, shiftBookingDate(today, -ATTRIBUTION_FALLBACK_DAYS), today));
  if (!visits.length) return { leadflowJobId: null, teamId: null, attribution: "unattributed",
    note: `No completed visit found for this customer in the ${ATTRIBUTION_FALLBACK_DAYS} days before the message${hint ? ` or on ${hint}` : ""}; retried automatically.` };
  // The most recent completed visit. Two visits on that same date by different teams cannot be told apart → unattributed.
  const latest = visits.filter(visit => visit.jobDate === visits[0].jobDate);
  const teams = await Promise.all(latest.map(visit => teamFor(db, visit)));
  if (new Set(teams).size > 1) return { leadflowJobId: null, teamId: null, attribution: "unattributed", note: `${latest.length} visits on ${visits[0].jobDate} by different teams.` };
  const teamId = teams[0];
  const how = named ? `the visit the customer named, ${visits[0].jobDate}`
    : older ? `the most recent completed visit, ${visits[0].jobDate} (none in the last ${ATTRIBUTION_LOOKBACK_DAYS} days; looked back ${ATTRIBUTION_FALLBACK_DAYS})`
    : `the most recent completed visit, ${visits[0].jobDate}${visits.length > 1 ? ` (of ${visits.length} in the last ${ATTRIBUTION_LOOKBACK_DAYS} days)` : ""}`;
  return teamId === null ? { leadflowJobId: visits[0].id, teamId: null, attribution: "unattributed", note: `Visit ${visits[0].id} (${visits[0].jobDate}) is not assigned to exactly one team.` }
    : { leadflowJobId: visits[0].id, teamId, attribution: "auto", note: `Matched ${how}.` };
}

const strong = (detector: string) => STRONG_DETECTORS.includes(detector);
/** Match the saved signal to a visit/team and to an incident. Safe to re-run (automatic retry, or a staff Retry). */
export async function processQualityIncident(pool: Pool, id: number, nowMs = Date.now()): Promise<QualityIncidentRow> {
  try {
    return await transaction(pool, async tx => {
      const row = await readIncident(tx, id, true);
      if (!row) return fail("QUALITY_INCIDENT_NOT_FOUND");
      if (row.processingStatus === "ok") return row;
      const resolved = await resolveAttribution(tx, row);
      let primaryId: number | null = null;
      if (resolved.attribution === "auto" && resolved.leadflowJobId !== null && resolved.teamId !== null) {
        // Same visit + team, still open and recent → the same incident (counts once) when it is the same kind of issue,
        // or when either side is only a supporting/rule-based signal (it joins the AI-labelled complaint).
        // Resolved or dismissed incidents, or a different kind of issue reported by the AI, stay separate complaints.
        const open = await rows(tx, `SELECT p.id, p.category, p.detector,
            (SELECT COUNT(*) FROM team_quality_incidents c WHERE c.primaryId = p.id AND c.detector IN (${STRONG_DETECTORS.map(() => "?").join(", ")})) AS strongChildren,
            GREATEST(p.reportedAtMs, COALESCE((SELECT MAX(c.reportedAtMs) FROM team_quality_incidents c WHERE c.primaryId = p.id), 0)) AS lastAt
          FROM team_quality_incidents p WHERE p.primaryId IS NULL AND p.id <> ? AND p.leadflowJobId = ? AND p.teamId = ? AND p.status = 'open' AND p.processingStatus = 'ok'
          ORDER BY p.id DESC FOR UPDATE`, [...STRONG_DETECTORS, id, resolved.leadflowJobId, resolved.teamId]);
        const rowWeak = !strong(row.detector) || row.category === "unclassified";
        const match = open.find(p => {
          if (Math.abs(row.reportedAtMs - Number(p.lastAt)) > SAME_INCIDENT_WINDOW_MS) return false;
          const primaryWeak = (!strong(String(p.detector)) && Number(p.strongChildren) === 0) || String(p.category) === "unclassified";
          return rowWeak || primaryWeak || categoryGroup(String(p.category)) === categoryGroup(row.category);
        });
        if (match) primaryId = Number(match.id);
      }
      await change(tx, `UPDATE team_quality_incidents SET primaryId = ?, leadflowJobId = ?, teamId = ?, attribution = ?, attributionNote = ?,
          processingStatus = 'ok', processingError = NULL, processingAttempts = processingAttempts + 1, updatedAtMs = ? WHERE id = ?`,
        [primaryId, resolved.leadflowJobId, resolved.teamId, resolved.attribution, clip(resolved.note, 500), nowMs, id]);
      if (primaryId !== null) {
        // Any messages already grouped under this row follow it into the incident.
        await change(tx, "UPDATE team_quality_incidents SET primaryId = ?, leadflowJobId = ?, teamId = ?, updatedAtMs = ? WHERE primaryId = ?", [primaryId, resolved.leadflowJobId, resolved.teamId, nowMs, id]);
        await absorb(tx, primaryId, row, nowMs);
      }
      return (await readIncident(tx, id))!;
    });
  } catch (error) {
    const code = error instanceof Error && /^QUALITY_[A-Z_]+$/.test(error.message) ? error.message : "QUALITY_PROCESSING_FAILED";
    console.warn(`[quality-incident] processing failed id=${id} code=${code}`);
    try { await change(pool, "UPDATE team_quality_incidents SET processingStatus = 'failed', processingError = ?, processingAttempts = processingAttempts + 1, updatedAtMs = ? WHERE id = ? AND processingStatus <> 'ok'", [code, nowMs, id]); }
    catch { /* the row stays "pending" and is retried automatically */ }
    throw error;
  }
}
/** A further message raises the incident's severity and requests, never its count. The AI's category replaces a
 * rule-based or supporting-signal category (the AI read the full message); a staff override is never replaced. */
async function absorb(tx: PoolConnection, primaryId: number, row: Pick<QualityIncidentRow, "severity" | "recleanStatus" | "refundStatus" | "category" | "detector">, nowMs: number): Promise<void> {
  const primary = await readIncident(tx, primaryId, true);
  if (!primary) return;
  const severity = (SEVERITY_ORDER[row.severity] ?? 0) > (SEVERITY_ORDER[primary.severity] ?? 0) ? row.severity : primary.severity;
  const reclean = primary.recleanStatus === "none" && row.recleanStatus !== "none" ? "requested" : primary.recleanStatus;
  const refund = primary.refundStatus === "none" && row.refundStatus !== "none" ? "requested" : primary.refundStatus;
  const strongChildren = await rows(tx, `SELECT COUNT(*) AS n FROM team_quality_incidents WHERE primaryId = ? AND detector IN (${STRONG_DETECTORS.map(() => "?").join(", ")})`, [primaryId, ...STRONG_DETECTORS]);
  // This row is already attached when absorb runs, so do not count it as an earlier AI message.
  const primaryAi = strong(primary.detector) || Number(strongChildren[0]?.n ?? 0) > (strong(row.detector) ? 1 : 0);
  const upgrade = primary.updatedBy === null && row.category !== "unclassified"
    && (primary.category === "unclassified" || (strong(row.detector) && !primaryAi));
  await change(tx, "UPDATE team_quality_incidents SET severity = ?, recleanStatus = ?, refundStatus = ?, category = ?, updatedAtMs = ? WHERE id = ?",
    [severity, reclean, refund, upgrade ? row.category : primary.category, nowMs, primaryId]);
}

/** Automatic upkeep for a week, run whenever its scores are calculated: retries failed/pending records, re-tries
 * attribution for unattributed complaints (for example a visit marked completed later), and records completed
 * recleans found in the job records. Staff overrides (updatedBy set) are left alone. */
export async function refreshQualityWeek(pool: Pool, weekStart: string, nowMs = Date.now()): Promise<{ retried: number; reattributed: number; recleans: number }> {
  let retried = 0, reattributed = 0, recleans = 0;
  for (const row of await rows(pool, "SELECT id FROM team_quality_incidents WHERE weekStart = ? AND processingStatus <> 'ok' AND processingAttempts < 10 ORDER BY id LIMIT 200", [weekStart])) {
    try { await processQualityIncident(pool, Number(row.id), nowMs); retried++; } catch { /* stays listed with its code; retried next time */ }
  }
  for (const row of await rows(pool, `SELECT id FROM team_quality_incidents WHERE weekStart = ? AND primaryId IS NULL AND attribution = 'unattributed'
      AND status <> 'dismissed' AND updatedBy IS NULL AND processingStatus = 'ok' ORDER BY id LIMIT 200`, [weekStart])) {
    try {
      await change(pool, "UPDATE team_quality_incidents SET processingStatus = 'pending' WHERE id = ? AND attribution = 'unattributed' AND processingStatus = 'ok'", [Number(row.id)]);
      if ((await processQualityIncident(pool, Number(row.id), nowMs)).attribution !== "unattributed") reattributed++;
    } catch { /* retried next time */ }
  }
  const counted = await rows(pool, `SELECT t.id, t.leadflowJobId, j.jobDate, j.customerPhone, j.customerEmail FROM team_quality_incidents t JOIN leadflow_jobs j ON j.id = t.leadflowJobId
    WHERE t.weekStart = ? AND t.primaryId IS NULL AND t.status <> 'dismissed' AND t.updatedBy IS NULL AND t.recleanStatus <> 'completed'
      AND t.category IN ('cleaning_quality', 'team_service') AND t.attribution <> 'unattributed' AND t.processingStatus = 'ok' ORDER BY t.id LIMIT 200`, [weekStart]);
  for (const incident of counted) {
    const reclean = await findCompletedReclean(pool, { jobId: Number(incident.leadflowJobId), jobDate: String(incident.jobDate),
      phone: (incident.customerPhone as string | null) ?? null, email: (incident.customerEmail as string | null) ?? null }, nowMs);
    if (!reclean) continue;
    await change(pool, "UPDATE team_quality_incidents SET recleanStatus = 'completed', statusNote = ?, updatedAtMs = ? WHERE id = ? AND updatedBy IS NULL",
      [clip(`Reclean visit detected automatically: job ${reclean.id} on ${reclean.jobDate}.`, 500), nowMs, Number(incident.id)]);
    recleans++;
  }
  return { retried, reattributed, recleans };
}
/** A completed reclean visit for the same customer within 21 days after the complained-about visit. */
async function findCompletedReclean(db: SqlClient, visit: { jobId: number; jobDate: string; phone: string | null; email: string | null }, nowMs: number): Promise<{ id: number; jobDate: string } | null> {
  const phone = digits10(visit.phone), email = visit.email?.trim().toLowerCase() || null;
  if (!phone && !email) return null;
  const today = easternDateIso(new Date(nowMs));
  const found = await rows(db, `SELECT j.id, j.jobDate, j.bookingStatus, j.serviceName, j.customerNotes, j.extras, j.jobTotalCents,
      (SELECT COUNT(*) FROM cleaner_portal_job_signoffs s WHERE s.leadflowJobId = j.id) AS signoffs
    FROM leadflow_jobs j WHERE j.id <> ? AND j.jobDate > ? AND j.jobDate <= ? AND (
      (? IS NOT NULL AND RIGHT(REGEXP_REPLACE(COALESCE(j.customerPhone, ''), '[^0-9]', ''), 10) = ?) OR (? IS NOT NULL AND LOWER(j.customerEmail) = ?))
    ORDER BY j.jobDate ASC, j.id ASC LIMIT 20`, [visit.jobId, visit.jobDate, shiftBookingDate(visit.jobDate, 21), phone, phone, email, email]);
  const match = found.find(job => !TOMBSTONES.includes(String(job.bookingStatus ?? "").trim().toLowerCase())
    && isRecleanJob({ serviceName: job.serviceName as string | null, customerNotes: job.customerNotes as string | null, extras: job.extras as string | null, jobTotalCents: num(job.jobTotalCents) })
    && (String(job.jobDate) < today || Number(job.signoffs) > 0 || String(job.bookingStatus ?? "").trim().toLowerCase() === "completed"));
  return match ? { id: Number(match.id), jobDate: String(match.jobDate) } : null;
}

/** Optional staff overrides (never required). Every action applies to an incident (primary) except "separate". */
export async function applyQualityIncidentAction(pool: Pool, action: QualityIncidentAction, actorId: number, nowMs = Date.now()): Promise<QualityIncidentRow> {
  return transaction(pool, async tx => {
    const row = await readIncident(tx, action.id, true);
    if (!row) return fail("QUALITY_INCIDENT_NOT_FOUND");
    const primaryOnly = () => { if (row.primaryId !== null) fail("QUALITY_INCIDENT_NOT_PRIMARY"); };
    const set = async (sql: string, values: Value[]) => change(tx, `UPDATE team_quality_incidents SET ${sql}, updatedBy = ?, updatedAtMs = ? WHERE id = ?`, [...values, actorId, nowMs, row.id]);
    const syncChildren = async (jobId: number | null, teamId: number | null) =>
      change(tx, "UPDATE team_quality_incidents SET leadflowJobId = ?, teamId = ?, updatedAtMs = ? WHERE primaryId = ?", [jobId, teamId, nowMs, row.id]);
    switch (action.action) {
      case "attribute": {
        primaryOnly();
        const job = await readJob(tx, action.leadflowJobId);
        if (!job) return fail("QUALITY_JOB_NOT_FOUND");
        const teamId = await teamFor(tx, job);
        if (teamId === null) return fail("QUALITY_JOB_TEAM_UNMAPPED");
        await set("leadflowJobId = ?, teamId = ?, attribution = 'staff', attributionNote = ?, processingStatus = 'ok', processingError = NULL",
          [job.id, teamId, clip(action.note?.trim() || `Staff chose job ${job.id} (${job.jobDate}).`, 500)]);
        await syncChildren(job.id, teamId);
        break;
      }
      case "unattribute":
        primaryOnly();
        await set("leadflowJobId = NULL, teamId = NULL, attribution = 'unattributed', attributionNote = ?", [clip(action.note?.trim() || "Staff override: team attribution removed.", 500)]);
        await syncChildren(null, null);
        break;
      case "classify": primaryOnly(); await set("category = ?, severity = ?", [action.category, action.severity]); break;
      case "dismiss": primaryOnly(); await set("status = 'dismissed', statusNote = ?", [clip(action.note, 500)]); break;
      case "restore": primaryOnly(); await set("status = 'open', statusNote = NULL", []); break;
      case "resolve": primaryOnly(); await set("status = 'resolved', statusNote = ?", [clip(action.note?.trim() || null, 500)]); break;
      case "recovery": primaryOnly(); await set("recleanStatus = ?, refundStatus = ?", [action.recleanStatus, action.refundStatus]); break;
      case "separate":
        if (row.primaryId === null) return fail("QUALITY_INCIDENT_ALREADY_SEPARATE");
        await set("primaryId = NULL, status = 'open', statusNote = 'Separated by staff as its own complaint.'", []);
        break;
      case "merge": {
        primaryOnly();
        const into = await readIncident(tx, action.intoId, true);
        if (!into || into.primaryId !== null || into.id === row.id) return fail("QUALITY_MERGE_TARGET_INVALID");
        await change(tx, "UPDATE team_quality_incidents SET primaryId = ?, leadflowJobId = ?, teamId = ?, updatedAtMs = ? WHERE primaryId = ?", [into.id, into.leadflowJobId, into.teamId, nowMs, row.id]);
        await set("primaryId = ?, leadflowJobId = ?, teamId = ?", [into.id, into.leadflowJobId, into.teamId]);
        await absorb(tx, into.id, row, nowMs);
        break;
      }
    }
    return (await readIncident(tx, row.id))!;
  });
}

export type QualityIncidentView = QualityIncidentRow & { messages: QualityIncidentRow[] };
/** Incidents reported in a Sunday week, each with its further messages; plus every failed/pending record (any week). */
export async function listQualityIncidents(pool: Pool, weekStart: string): Promise<{ incidents: QualityIncidentView[]; unprocessed: QualityIncidentRow[] }> {
  const primaries = (await rows(pool, `SELECT ${COLUMNS} FROM team_quality_incidents WHERE primaryId IS NULL AND weekStart = ? AND processingStatus = 'ok' ORDER BY reportedAtMs DESC, id DESC LIMIT 500`, [weekStart])).map(fromRow);
  const children = primaries.length ? (await rows(pool, `SELECT ${COLUMNS} FROM team_quality_incidents WHERE primaryId IN (${primaries.map(() => "?").join(", ")}) ORDER BY reportedAtMs ASC, id ASC`, primaries.map(p => p.id))).map(fromRow) : [];
  const unprocessed = (await rows(pool, `SELECT ${COLUMNS} FROM team_quality_incidents WHERE processingStatus <> 'ok' ORDER BY id DESC LIMIT 200`)).map(fromRow);
  return { incidents: primaries.map(p => ({ ...p, messages: children.filter(c => c.primaryId === p.id) })), unprocessed };
}
/** Incidents (primaries) used for the week's scores. */
export async function readWeekIncidents(pool: Pool, weekStart: string): Promise<Array<QualityIncidentRow & { jobDate: string | null; jobCustomerName: string | null }>> {
  const prefixed = COLUMNS.split(", ").map(column => `t.${column}`).join(", ");
  return (await rows(pool, `SELECT ${prefixed}, j.jobDate AS jobDate, j.customerName AS jobCustomerName FROM team_quality_incidents t LEFT JOIN leadflow_jobs j ON j.id = t.leadflowJobId
    WHERE t.primaryId IS NULL AND t.weekStart = ? ORDER BY t.id ASC`, [weekStart])).map(row => ({ ...fromRow(row), jobDate: row.jobDate == null ? null : String(row.jobDate), jobCustomerName: row.jobCustomerName == null ? null : String(row.jobCustomerName) }));
}
/** Visits staff can choose from when correcting attribution (30 days either side of the report). */
export async function attributionChoices(pool: Pool, id: number): Promise<Array<{ leadflowJobId: number; jobDate: string; bookingStatus: string; teamId: number | null; teamName: string | null }>> {
  const row = await readIncident(pool, id);
  if (!row) return fail("QUALITY_INCIDENT_NOT_FOUND");
  const day = easternDateIso(new Date(row.reportedAtMs));
  const visits = await customerVisits(pool, { phone: row.customerPhone, email: row.customerEmail }, shiftBookingDate(day, -30), shiftBookingDate(day, 30));
  const result = [];
  for (const visit of visits) {
    const teamId = await teamFor(pool, visit);
    const names = teamId === null ? [] : await rows(pool, "SELECT name FROM scheduling_teams WHERE id = ?", [teamId]);
    result.push({ leadflowJobId: visit.id, jobDate: visit.jobDate, bookingStatus: visit.bookingStatus, teamId, teamName: names[0]?.name == null ? null : String(names[0].name) });
  }
  return result;
}
