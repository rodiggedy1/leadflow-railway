import { int, mysqlTable, text } from "drizzle-orm/mysql-core";

/** Staff notes for one exact imported Launch27 visit; customer notes stay on the owned job. */
export const leadflowLaunch27VisitNotes = mysqlTable("leadflow_launch27_visit_notes", {
  launch27BookingId: int("launch27BookingId").primaryKey(),
  staffNotes: text("staffNotes"),
});
