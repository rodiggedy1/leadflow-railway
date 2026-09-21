import { z } from "zod";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { opsChatMessages } from "../drizzle/schema";
import { getDb } from "./db";
import { opsChatProcedure, router } from "./_core/trpc";

function easternOffsetMs(utcDate: Date): number {
  const easternWallClock = utcDate.toLocaleString("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const [datePart, timePart] = easternWallClock.split(", ");
  const [month, day, year] = datePart.split("/");
  return new Date(`${year}-${month}-${day}T${timePart}Z`).getTime() - utcDate.getTime();
}

function easternDayBounds(date: string) {
  const startUtc = new Date(`${date}T00:00:00.000Z`);
  const endUtc = new Date(`${date}T23:59:59.999Z`);
  return {
    start: new Date(startUtc.getTime() - easternOffsetMs(startUtc)),
    end: new Date(endUtc.getTime() - easternOffsetMs(endUtc)),
  };
}

/**
 * Header metrics follow the same Command Chat booking-announcement stream that
 * agents see, including announcements created manually from the workspace.
 */
export const commandChatBookingSummaryRouter = router({
  getToday: opsChatProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { count: 0, revenue: 0 };

      const { start, end } = easternDayBounds(input.date);
      const rows = await db
        .select({
          authorName: opsChatMessages.authorName,
          createdAt: opsChatMessages.createdAt,
          metadata: opsChatMessages.metadata,
        })
        .from(opsChatMessages)
        .where(and(
          eq(opsChatMessages.channel, "command"),
          eq(opsChatMessages.quickAction, "announce_booking"),
          gte(opsChatMessages.createdAt, start),
          lte(opsChatMessages.createdAt, end),
        ))
        .orderBy(desc(opsChatMessages.createdAt));

      const announcements = rows.map((row) => {
        try {
          const metadata = JSON.parse(row.metadata ?? "{}") as Record<string, unknown>;
          const rawAmount = typeof metadata.amount === "string" ? metadata.amount : null;
          const amount = rawAmount ? Number.parseFloat(rawAmount.replace(/[^0-9.]/g, "")) : Number.NaN;
          return {
            personName: typeof metadata.personName === "string" && metadata.personName.trim() ? metadata.personName.trim() : "Booking",
            authorName: row.authorName,
            amount: Number.isFinite(amount) ? amount : null,
            createdAt: row.createdAt.getTime(),
          };
        } catch {
          return { personName: "Booking", authorName: row.authorName, amount: null, createdAt: row.createdAt.getTime() };
        }
      });

      return {
        count: announcements.length,
        revenue: announcements.reduce((sum, announcement) => sum + (announcement.amount ?? 0), 0),
        announcements,
      };
    }),
});
