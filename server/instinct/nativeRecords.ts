import { createHash } from "node:crypto";
import {
  authorizedScopeSchema, nativeRecordSchema, nativeSnapshotSchema, targetOccurrenceSchema, verifiedIdentitySchema,
  localDateSchema, localTimeSchema, timeZoneSchema,
  type AuthorizedScope, type Clock, type NativeRecord, type NativeRecordReader, type NativeSnapshot,
  type TargetOccurrence, type VerifiedIdentity,
} from "../../shared/instinct";
import { bookingArrivalPreferenceSchema } from "../../shared/bookingArrival";
import { normalizePhone } from "../utils/phone";
import { normalizeIdentityEmail, nativeIdentityProblems, recordMatchesIdentity, type IdentitySessionContact } from "./identity";
import { createLazyReadDb, safeReadDbError, type ReadDb, type SelectPort, type SqlRow, type SqlValue } from "./readDb";

export interface NativeRecordReaderOptions {
  readonly db?: ReadDb;
  readonly clock?: Clock;
  /** This callback binds the native installation database before any SELECT. */
  readonly authorizeScope: (scope: AuthorizedScope) => boolean | Promise<boolean>;
}
const BOOKING_COLUMNS = "CAST(`id` AS CHAR) AS `id`, `publicBookingNumber`, `customerPhone`, `customerEmail`, `customerName`, `requestedLocalDate`, `requestedLocalTime`, `requestedTimeZone`, CAST(`requestedStartAt` AS CHAR) AS `requestedStartAt`, `status`, `address`, `serviceId`, `serviceName`, `extras`, `recurrence`, `companyNotes`, `specialRequestNotes`, `priceSnapshot`, `updatedAt`";
const JOB_COLUMNS = "CAST(`id` AS CHAR) AS `id`, CAST(`bookingId` AS CHAR) AS `bookingId`, CAST(`launch27BookingId` AS CHAR) AS `launch27BookingId`, CAST(`bookingSeriesId` AS CHAR) AS `bookingSeriesId`, `customerPhone`, `customerEmail`, `customerName`, `jobDate`, `serviceDateTime`, `bookingStatus`, `jobAddress`, `serviceName`, `extras`, `frequency`, `teamName`, `customerNotes`, `updatedAt`";
const SERIES_COLUMNS = "CAST(`id` AS CHAR) AS `id`, CAST(`bookingId` AS CHAR) AS `bookingId`, `status`, `frequency`, `anchorLocalDate`, `anchorLocalTime`, `timeZone`, `updatedAt`";
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function text(value: unknown): string | null { return typeof value === "string" ? value : null; }
function id(value: unknown): string | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  return typeof value === "string" && /^[1-9]\d*$/.test(value) ? value : null;
}
function timestamp(value: unknown): string | null {
  if (!(value instanceof Date) && (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value))) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function json(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return undefined; }
}
/** Literal proven bookingLifecycleService.nativeBookingCustomerNotes projection;
 * do not import its database/business writers or cleaner-authenticated router.
 */
export function composeCanonicalCleanerNotes(specialRequestNotes: readonly string[], companyNotes: string | null): string | null {
  const notes = [...specialRequestNotes, companyNotes?.trim() ?? ""].filter(Boolean);
  return notes.length ? notes.join("\n") : null;
}
function parseExtras(value: unknown, limitations: string[]): NativeRecord["extras"] {
  const parsed = json(value);
  if (!Array.isArray(parsed)) { limitations.push("EXTRAS_UNAVAILABLE"); return null; }
  const extras: NonNullable<NativeRecord["extras"]> = [];
  for (const item of parsed) {
    if (typeof item === "string" && item) extras.push({ id: item, label: item, quantity: null });
    else if (item && typeof item === "object" && "id" in item && "label" in item && typeof item.id === "string" && item.id && typeof item.label === "string") {
      const quantity = "quantity" in item && typeof item.quantity === "number" && Number.isFinite(item.quantity) && item.quantity >= 0 ? item.quantity : null;
      extras.push({ id: item.id, label: item.label, quantity });
    } else { limitations.push("EXTRAS_MALFORMED"); return null; }
  }
  return extras;
}
function dateField(value: unknown, reasons: string[]): string | null {
  const parsed = localDateSchema.safeParse(value);
  if (!parsed.success) { reasons.push("LOCAL_DATE_UNAVAILABLE"); return null; }
  return parsed.data;
}
function timeField(value: unknown, reasons: string[]): string | null {
  const parsed = localTimeSchema.safeParse(value);
  if (!parsed.success) { reasons.push("LOCAL_TIME_UNAVAILABLE"); return null; }
  return parsed.data;
}
function zoneField(value: unknown, reasons: string[]): string | null {
  const parsed = timeZoneSchema.safeParse(value);
  if (!parsed.success) { reasons.push("TIMEZONE_UNAVAILABLE"); return null; }
  return parsed.data;
}
function base(source: NativeRecord["source"], row: SqlRow, observedAtUtc: string): NativeRecord {
  const rowId = id(row.id);
  if (!rowId) throw new Error("NATIVE_ID_MALFORMED");
  return { key: `${source === "bookings" ? "booking" : source === "leadflow_jobs" ? "leadflow:job" : "series"}:${rowId}`,
    source, bookingId: source === "bookings" ? rowId : id(row.bookingId), jobId: source === "leadflow_jobs" ? rowId : null,
    launch27BookingId: source === "leadflow_jobs" ? id(row.launch27BookingId) : null,
    bookingSeriesId: source === "booking_series" ? rowId : id(row.bookingSeriesId), publicBookingNumber: text(row.publicBookingNumber),
    customerPhone: normalizePhone(text(row.customerPhone)), customerEmail: normalizeIdentityEmail(text(row.customerEmail)), customerName: text(row.customerName),
    localDate: null, localTime: null, timeZone: null, arrivalWindow: null, requestedStartAt: null, serviceDateTime: null,
    status: text(row.status), address: text(row.address), serviceId: text(row.serviceId), serviceName: text(row.serviceName), extras: null,
    recurrence: text(row.recurrence), teamName: null, companyNotes: null, specialRequestNotes: null, customerNotes: null,
    cleanerFacingNotes: null, notesBasis: "unavailable", availability: "complete", limitations: [], fingerprint: "0".repeat(64),
    observedAtUtc, updatedAtUtc: timestamp(row.updatedAt) };
}
function seal(record: NativeRecord): NativeRecord {
  const limitations = [...Array.from(new Set(record.limitations))];
  const semantic = { ...record, limitations, availability: limitations.length ? "partial" as const : "complete" as const };
  // Observation time is not semantic: unchanged fresh reads retain their hash.
  const { fingerprint: _fingerprint, observedAtUtc: _observed, ...values } = semantic;
  return nativeRecordSchema.parse({ ...semantic, fingerprint: hash(values) });
}
function bookingRecord(row: SqlRow, now: string): NativeRecord {
  const record = base("bookings", row, now), reasons = record.limitations;
  if (!record.publicBookingNumber) throw new Error("PUBLIC_BOOKING_NUMBER_UNAVAILABLE");
  record.localDate = dateField(row.requestedLocalDate, reasons);
  record.localTime = timeField(row.requestedLocalTime, reasons);
  record.timeZone = zoneField(row.requestedTimeZone, reasons);
  record.requestedStartAt = typeof row.requestedStartAt === "string" && /^\d+$/.test(row.requestedStartAt) ? row.requestedStartAt :
    typeof row.requestedStartAt === "number" && Number.isSafeInteger(row.requestedStartAt) && row.requestedStartAt >= 0 ? String(row.requestedStartAt) : null;
  if (!record.requestedStartAt) reasons.push("REQUESTED_START_UNAVAILABLE");
  if (!record.customerPhone || !record.customerEmail) reasons.push("CANONICAL_CONTACT_UNAVAILABLE");
  record.companyNotes = text(row.companyNotes);
  const notes = json(row.specialRequestNotes);
  record.specialRequestNotes = Array.isArray(notes) && notes.every(item => typeof item === "string") ? notes : null;
  if (record.specialRequestNotes === null) reasons.push("CANONICAL_NOTES_UNAVAILABLE");
  else { record.cleanerFacingNotes = composeCanonicalCleanerNotes(record.specialRequestNotes, record.companyNotes); record.notesBasis = "canonical_composition"; }
  record.extras = parseExtras(row.extras, reasons);
  const priceSnapshot = json(row.priceSnapshot);
  // Literal getPublicBookingArrivalPreference proof, without its unrelated
  // pricing/widget import graph: version, input, breakdown and service name.
  const snapshotObject = priceSnapshot && typeof priceSnapshot === "object" ? priceSnapshot as Record<string, unknown> : null;
  const input = snapshotObject?.input && typeof snapshotObject.input === "object" ? snapshotObject.input as Record<string, unknown> : null;
  const parsedPreference = snapshotObject?.version === "public-book-v2" && input && snapshotObject.breakdown && typeof snapshotObject.breakdown === "object" && typeof snapshotObject.serviceName === "string"
    ? bookingArrivalPreferenceSchema.safeParse(input.arrivalPreference) : null;
  const preference = parsedPreference?.success ? parsedPreference.data : undefined;
  if (preference) {
    if (preference.startLocalTime !== record.localTime) reasons.push("ARRIVAL_PREFERENCE_START_CONFLICT");
    record.arrivalWindow = { start: preference.startLocalTime, end: preference.endLocalTime }; record.localTime = null;
  } else if (priceSnapshot && typeof priceSnapshot === "object" && "input" in priceSnapshot && priceSnapshot.input && typeof priceSnapshot.input === "object" && "arrivalPreference" in priceSnapshot.input) reasons.push("ARRIVAL_PREFERENCE_MALFORMED");
  return seal(record);
}
function jobRecord(row: SqlRow, now: string, canonical?: NativeRecord): NativeRecord {
  const record = base("leadflow_jobs", row, now), reasons = record.limitations;
  record.localDate = dateField(row.jobDate, reasons); record.status = text(row.bookingStatus); record.address = text(row.jobAddress);
  record.recurrence = text(row.frequency); record.teamName = text(row.teamName); record.customerNotes = text(row.customerNotes);
  record.serviceDateTime = text(row.serviceDateTime); record.extras = parseExtras(row.extras, reasons);
  record.timeZone = canonical?.timeZone ?? "America/New_York"; // Existing operational portal/recurrence business zone.
  const utc = timestamp(row.serviceDateTime);
  if (utc && record.timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: record.timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(utc));
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
    record.localTime = `${get("hour")}:${get("minute")}`;
    if (`${get("year")}-${get("month")}-${get("day")}` !== record.localDate) reasons.push("SERVICE_DATETIME_DATE_CONFLICT");
  } else if (record.serviceDateTime && /^\d{4}-\d{2}-\d{2} [0-2]\d:[0-5]\d(?::[0-5]\d)?$/.test(record.serviceDateTime)) {
    // The existing portal treats this storage form as a local clock, not UTC.
    record.localTime = timeField(record.serviceDateTime.slice(11, 16), reasons);
    if (record.serviceDateTime.slice(0, 10) !== record.localDate) reasons.push("SERVICE_DATETIME_DATE_CONFLICT");
  } else reasons.push("SERVICE_DATETIME_UNAVAILABLE");
  if (record.bookingId) {
    if (!canonical) reasons.push("CANONICAL_COUNTERPART_UNAVAILABLE");
    else if ((record.customerPhone && record.customerPhone !== canonical.customerPhone) || (record.customerEmail && record.customerEmail !== canonical.customerEmail) || (!record.customerPhone && !record.customerEmail)) reasons.push("CANONICAL_CONTACT_CONFLICT");
    else {
      record.companyNotes = canonical.companyNotes; record.specialRequestNotes = canonical.specialRequestNotes;
      record.cleanerFacingNotes = canonical.cleanerFacingNotes; record.notesBasis = canonical.notesBasis;
      if (canonical.notesBasis === "unavailable") reasons.push("CANONICAL_NOTES_UNAVAILABLE");
      if (canonical.arrivalWindow) {
        if (record.localDate === canonical.localDate && record.localTime === canonical.arrivalWindow.start) { record.arrivalWindow = canonical.arrivalWindow; record.localTime = null; }
        else reasons.push("VISIT_ARRIVAL_PREFERENCE_UNPROVEN");
      }
    }
  } else { record.cleanerFacingNotes = record.customerNotes; record.notesBasis = "operational_customer_notes"; }
  return seal(record);
}
function seriesRecord(row: SqlRow, now: string, canonical?: NativeRecord): NativeRecord {
  const record = base("booking_series", row, now), reasons = record.limitations;
  if (!record.bookingId) throw new Error("SERIES_BOOKING_LINK_MALFORMED");
  record.localDate = dateField(row.anchorLocalDate, reasons); record.localTime = timeField(row.anchorLocalTime, reasons);
  record.timeZone = zoneField(row.timeZone, reasons); record.recurrence = text(row.frequency);
  if (!canonical) reasons.push("CANONICAL_COUNTERPART_UNAVAILABLE");
  else { record.customerPhone = canonical.customerPhone; record.customerEmail = canonical.customerEmail; record.customerName = canonical.customerName; }
  return seal(record);
}
function contactPredicate(identity: VerifiedIdentity): { sql: string; params: SqlValue[] } {
  const predicates: string[] = [], params: SqlValue[] = [];
  if (identity.phone) {
    predicates.push("REGEXP_REPLACE(`customerPhone`, ?, ?) IN (?, ?)");
    params.push("[^0-9]", "", identity.phone.slice(2), identity.phone.slice(1));
  }
  if (identity.email) { predicates.push("LOWER(TRIM(`customerEmail`)) = ?"); params.push(identity.email); }
  return { sql: `(${predicates.join(" OR ")})`, params };
}
function scopeValid(identity: VerifiedIdentity, scope: AuthorizedScope): boolean {
  return identity.installationScope === scope.installationScope && identity.sourceAccountKey === scope.sourceAccountKey && identity.evidenceRefs.length > 0 && identity.evidenceRefs.every(ref => ref.sourceAccountKey === scope.sourceAccountKey);
}
function snapshot(scope: AuthorizedScope, records: NativeRecord[], now: string, reasons: string[], missing = false): NativeSnapshot {
  const limitations = [...Array.from(new Set([...reasons, ...records.flatMap(record => record.limitations)]))];
  const sorted = [...records].sort((a, b) => a.key.localeCompare(b.key));
  const fingerprint = hash([scope.installationScope, scope.sourceAccountKey, sorted.map(record => [record.key, record.fingerprint]), limitations]);
  return nativeSnapshotSchema.parse({ snapshotId: `native:${hash([fingerprint, now])}`, sourceAccountKey: scope.sourceAccountKey, records: sorted,
    fingerprint, checkedAtUtc: now, availability: missing ? "missing" : limitations.length ? "partial" : "complete", continuation: null, limitations });
}

export function createNativeRecordReader(options: NativeRecordReaderOptions): NativeRecordReader {
  const db = options.db ?? createLazyReadDb(); // Constructor cannot connect or read URL.
  const clock = options.clock ?? { now: () => new Date() };
  async function read(scopeValue: AuthorizedScope, identityValue: VerifiedIdentity, targetValue?: TargetOccurrence, cursor?: string): Promise<NativeSnapshot> {
    const scope = authorizedScopeSchema.parse(scopeValue), identity = verifiedIdentitySchema.parse(identityValue);
    const target = targetValue ? targetOccurrenceSchema.parse(targetValue) : undefined;
    const now = clock.now().toISOString();
    if (!scopeValid(identity, scope) || !(await options.authorizeScope(scope))) return snapshot(scope, [], now, ["IDENTITY_SCOPE_UNAUTHORIZED"], true);
    if (cursor) return snapshot(scope, [], now, ["INVALID_NATIVE_CONTINUATION"], true);
    if (!identity.phone && !identity.email) return snapshot(scope, [], now, ["SOURCE_CONTACT_UNAVAILABLE"], true);
    if (identity.decision !== "verified" && (target || identity.reasons.length !== 1 || identity.reasons[0] !== "NATIVE_CONTACT_CORROBORATION_REQUIRED")) return snapshot(scope, [], now, ["SOURCE_IDENTITY_UNVERIFIED"], true);
    try {
      return await db.snapshot(async port => {
        const predicate = contactPredicate(identity);
        const reasons: string[] = [];
        async function select(sql: string, params: SqlValue[] = []): Promise<SqlRow[]> {
          try { return await port.select(sql, params); } catch (error) { reasons.push(safeReadDbError(error).reason); return []; }
        }
        // No first/latest/tail limit. These complete ascending SELECTs also work
        // on installations without a source/customer FK. JS rechecks conservative
        // normalization because the SQL predicate is only candidate discovery.
        const bookingRows = new Map<string, SqlRow>(), jobRows = new Map<string, SqlRow>(), seriesRows = new Map<string, SqlRow>();
        const put = (map: Map<string, SqlRow>, rows: SqlRow[]) => { for (const row of rows) { const key = id(row.id); if (key) map.set(key, row); else reasons.push("NATIVE_ID_MALFORMED"); } };
        const initial = async (table: "bookings" | "leadflow_jobs", columns: string, map: Map<string, SqlRow>) => {
          const rows = await select(`SELECT ${columns} FROM \`${table}\` WHERE ${predicate.sql} ORDER BY \`id\` ASC`, predicate.params);
          put(map, rows.filter(row => (identity.phone && normalizePhone(text(row.customerPhone)) === identity.phone) || (identity.email && normalizeIdentityEmail(text(row.customerEmail)) === identity.email)));
        };
        await initial("bookings", BOOKING_COLUMNS, bookingRows); await initial("leadflow_jobs", JOB_COLUMNS, jobRows);
        const loadedBookings = new Set<string>(), loadedSeries = new Set<string>();
        // Follow every exact native link until closure, including counterparts
        // outside the initial contact selection. Never trust the FK as identity.
        while (true) {
          const bookingIds = [...Array.from(new Set([...Array.from(bookingRows.keys()), ...[...Array.from(jobRows.values()), ...Array.from(seriesRows.values())].flatMap(row => id(row.bookingId) ? [id(row.bookingId)!] : [])]))].filter(value => !loadedBookings.has(value));
          const seriesIds = [...Array.from(new Set([...Array.from(jobRows.values())].flatMap(row => id(row.bookingSeriesId) ? [id(row.bookingSeriesId)!] : [])))].filter(value => !loadedSeries.has(value));
          if (!bookingIds.length && !seriesIds.length) break;
          for (const bookingId of bookingIds) {
            loadedBookings.add(bookingId);
            if (!bookingRows.has(bookingId)) put(bookingRows, await select(`SELECT ${BOOKING_COLUMNS} FROM \`bookings\` WHERE \`id\` = ? ORDER BY \`id\` ASC`, [bookingId]));
            if (!bookingRows.has(bookingId)) reasons.push("CANONICAL_COUNTERPART_UNAVAILABLE");
            put(jobRows, await select(`SELECT ${JOB_COLUMNS} FROM \`leadflow_jobs\` WHERE \`bookingId\` = ? ORDER BY \`id\` ASC`, [bookingId]));
            put(seriesRows, await select(`SELECT ${SERIES_COLUMNS} FROM \`booking_series\` WHERE \`bookingId\` = ? ORDER BY \`id\` ASC`, [bookingId]));
          }
          for (const seriesId of seriesIds) {
            loadedSeries.add(seriesId);
            if (!seriesRows.has(seriesId)) put(seriesRows, await select(`SELECT ${SERIES_COLUMNS} FROM \`booking_series\` WHERE \`id\` = ? ORDER BY \`id\` ASC`, [seriesId]));
            if (!seriesRows.has(seriesId)) reasons.push("SERIES_COUNTERPART_UNAVAILABLE");
            put(jobRows, await select(`SELECT ${JOB_COLUMNS} FROM \`leadflow_jobs\` WHERE \`bookingSeriesId\` = ? ORDER BY \`id\` ASC`, [seriesId]));
          }
        }
        const canonical = new Map<string, NativeRecord>(), records: NativeRecord[] = [];
        const project = (make: () => NativeRecord) => { try { const record = make(); records.push(record); return record; } catch { reasons.push("NATIVE_RECORD_MALFORMED"); return null; } };
        for (const [bookingId, row] of Array.from(bookingRows)) { const record = project(() => bookingRecord(row, now)); if (record) canonical.set(bookingId, record); }
        for (const row of Array.from(jobRows.values())) project(() => jobRecord(row, now, canonical.get(id(row.bookingId) ?? "")));
        for (const row of Array.from(seriesRows.values())) project(() => seriesRecord(row, now, canonical.get(id(row.bookingId) ?? "")));
        if (!records.length) reasons.push("NATIVE_CONTACT_NOT_FOUND");
        // Retain conflicting proof for the resolver, but never return it as a
        // successful exact customer snapshot.
        reasons.push(...nativeIdentityProblems(identity, records));
        if (target) {
          const exact = target.jobId ? records.find(record => record.key === `leadflow:job:${target.jobId}`) : target.bookingId ? records.find(record => record.key === `booking:${target.bookingId}`) : null;
          if (!exact) reasons.push("EXACT_TARGET_NOT_FOUND");
          else if (!recordMatchesIdentity(exact, identity) || (target.bookingId && exact.bookingId !== target.bookingId) ||
            (target.bookingSeriesId && exact.source === "leadflow_jobs" && exact.bookingSeriesId !== target.bookingSeriesId) ||
            (target.launch27BookingId && exact.launch27BookingId !== target.launch27BookingId) || (target.publicBookingNumber && (exact.publicBookingNumber ?? canonical.get(exact.bookingId ?? "")?.publicBookingNumber) !== target.publicBookingNumber)) reasons.push("EXACT_TARGET_LINK_CONFLICT");
          if (target.bookingSeriesId && !records.some(record => record.key === `series:${target.bookingSeriesId}` && record.bookingId === target.bookingId)) reasons.push("EXACT_SERIES_LINK_CONFLICT");
          if (["subsequent", "series"].includes(target.scope) && !target.bookingSeriesId) reasons.push("RECURRING_SERIES_UNVERIFIED");
        }
        return snapshot(scope, records, now, reasons);
      });
    } catch (error) { return snapshot(scope, [], now, [safeReadDbError(error).reason], true); }
  }
  return Object.freeze({ readCandidates: (scope: AuthorizedScope, identity: VerifiedIdentity, cursor?: string) => read(scope, identity, undefined, cursor), readExact: (scope: AuthorizedScope, identity: VerifiedIdentity, target: TargetOccurrence) => read(scope, identity, target) });
}

/** Actual conversation_sessions.leadPhone binding; no routing-session rewrite,
 * latest-business-line inference, portal creation or generic customer helper.
 */
export function createSessionContactReader(db: ReadDb, authorizeScope: NativeRecordReaderOptions["authorizeScope"]): (scope: AuthorizedScope, sessionIds: readonly string[]) => Promise<readonly IdentitySessionContact[]> {
  return async (scopeValue, sessionIds) => {
    const scope = authorizedScopeSchema.parse(scopeValue);
    if (!(await authorizeScope(scope)) || sessionIds.some(value => !id(value))) throw new Error("IDENTITY_SCOPE_UNAUTHORIZED");
    return db.snapshot(async (port: SelectPort) => {
      const contacts: IdentitySessionContact[] = [];
      for (const sessionId of [...Array.from(new Set(sessionIds))]) {
        const rows = await port.select("SELECT CAST(`id` AS CHAR) AS `id`, `leadPhone`, `leadName` FROM `conversation_sessions` WHERE `id` = ? ORDER BY `id` ASC", [sessionId]);
        for (const row of rows) { const rowId = id(row.id); if (!rowId || rowId !== sessionId) throw new Error("SESSION_CONTACT_CONFLICT"); contacts.push({ sessionId: rowId, phone: normalizePhone(text(row.leadPhone)), displayName: text(row.leadName)?.trim() || null }); }
      }
      return contacts;
    });
  };
}
