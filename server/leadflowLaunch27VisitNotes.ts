import { inArray, sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { leadflowLaunch27VisitNotes } from "../drizzle/leadflowLaunch27VisitNotes";

type NotesReader = Pick<MySql2Database, "select">;
type NotesWriter = Pick<MySql2Database, "insert">;
type VisitIdentity = { origin: string; launch27BookingId: number | null; bookingId: number | null };
type StaffNote = { launch27BookingId: number; staffNotes: string | null };

function validStableId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
}

function isImportedVisit(job: VisitIdentity): boolean {
  return job.origin === "launch27_import" && job.bookingId === null && validStableId(job.launch27BookingId);
}

/** One batched read using only explicitly supplied stable Launch27 IDs. */
export async function staffNotesByLaunch27BookingIds(db: NotesReader, stableIds: readonly number[]) {
  const ids = Array.from(new Set(stableIds.filter(validStableId)));
  if (!ids.length) return new Map<number, string | null>();
  const rows = await db.select({
    launch27BookingId: leadflowLaunch27VisitNotes.launch27BookingId,
    staffNotes: leadflowLaunch27VisitNotes.staffNotes,
  }).from(leadflowLaunch27VisitNotes).where(inArray(leadflowLaunch27VisitNotes.launch27BookingId, ids));
  return new Map(rows.filter(row => ids.includes(row.launch27BookingId)).map(row => [row.launch27BookingId, row.staffNotes]));
}

/** Native and unbound visits never inherit notes from a household/contact match. */
export async function withLaunch27StaffNotes<T extends VisitIdentity>(db: NotesReader, jobs: readonly T[]) {
  const notes = await staffNotesByLaunch27BookingIds(db, jobs.filter(isImportedVisit).map(job => job.launch27BookingId!));
  return jobs.map(job => ({ ...job, staffNotes: isImportedVisit(job) ? notes.get(job.launch27BookingId!) ?? null : null }));
}

/** Save only staff notes for the supplied stable IDs, including explicit clearing. */
export async function saveLaunch27StaffNotes(db: NotesWriter, notes: readonly StaffNote[]) {
  if (!notes.length) return;
  const values = notes.map(note => {
    if (!validStableId(note.launch27BookingId)) throw new Error("Invalid Launch27 stable booking ID.");
    if (note.staffNotes !== null && (typeof note.staffNotes !== "string" || note.staffNotes.includes("\0") || Buffer.byteLength(note.staffNotes, "utf8") > 65_535)) {
      throw new Error("Invalid Launch27 staff notes.");
    }
    return { launch27BookingId: note.launch27BookingId, staffNotes: note.staffNotes || null };
  });
  await db.insert(leadflowLaunch27VisitNotes).values(values)
    .onDuplicateKeyUpdate({ set: { staffNotes: sql`VALUES(staffNotes)` } });
}
